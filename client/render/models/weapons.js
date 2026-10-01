// Procedural weapon models: third-person/pickup models (createWorldWeapon) and the first-person
// ViewModel (arms + detailed weapons + procedural animation).
//
// Weapon space conventions (both world and view models):
//   origin = center of the right hand's grip (palm wraps here), barrel / blade along -Z, up = +Y.
//   Guns: pistol grip passes vertically (+Y) through the fist.
//   Melee: the handle runs along Z through the fist, blade/bat toward -Z, cutting edge / hammer face toward -Y.
//   Throwables (molotov, pipebomb, road flare): long axis along +Y (held like a bottle).
import * as THREE from 'three';
import { ITEM, CONSUMABLES } from '../../../shared/defs.js';
import { WR, CR } from './charTextures.js';
import {
  MeshBuilder,
  getPropMaterial,
  getViewWeaponMaterial,
  getViewArmMaterial,
  getViewCharMaterial,
  ikTwoBone,
  mulberry32,
  fbm3,
} from './skinning.js';

const PI = Math.PI;

// ================================================================== geometry helpers
function projUV(geo) {
  // planar projection: u along Z (length), v along Y, normalized to the bounding box
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const p = geo.attributes.position;
  const uv = new Float32Array(p.count * 2);
  const rz = Math.max(1e-5, bb.max.z - bb.min.z), ry = Math.max(1e-5, bb.max.y - bb.min.y);
  const rx = Math.max(1e-5, bb.max.x - bb.min.x);
  for (let i = 0; i < p.count; i++) {
    const useX = rz < rx * 0.5; // mostly flat in z -> project on x/y
    uv[i * 2] = useX ? (p.getX(i) - bb.min.x) / rx : (p.getZ(i) - bb.min.z) / rz;
    uv[i * 2 + 1] = (p.getY(i) - bb.min.y) / ry;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function makeShape(pts) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (p.length === 4) s.quadraticCurveTo(p[0], p[1], p[2], p[3]);
    else s.lineTo(p[0], p[1]);
  }
  s.closePath();
  return s;
}

/** Side profile extruded along X. pts in (f = forward distance (-Z), u = up (+Y)). Centered at x. */
function profile(mb, pts, width, o = {}) {
  const bevel = o.bevel ?? 0.0015;
  const depth = Math.max(0.0005, width - bevel * 2);
  const geo = new THREE.ExtrudeGeometry(makeShape(pts), {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: o.bevelSegs ?? 1,
    curveSegments: o.curveSegs ?? 6,
    steps: 1,
  });
  geo.translate(0, 0, -depth / 2);
  if (o.widthFn) {
    // per-position width scale (f = shape x = forward distance, u = up)
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) * o.widthFn(p.getX(i), p.getY(i)));
  }
  geo.rotateY(PI / 2); // (x,y,z) -> (z, y, -x): shape x = forward (-Z), extrude = X
  if (o.x) geo.translate(o.x, 0, 0);
  projUV(geo);
  return mb.geom(0, geo, { ...o, keepNormals: false });
}

/** Cross-section (x, y) extruded along Z from z0 to z1. */
function sectionZ(mb, pts, z0, z1, o = {}) {
  const bevel = o.bevel ?? 0.001;
  const len = Math.abs(z1 - z0) - bevel * 2;
  const geo = new THREE.ExtrudeGeometry(makeShape(pts), {
    depth: Math.max(0.0005, len),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: o.curveSegs ?? 6,
    steps: 1,
  });
  geo.translate(0, 0, Math.min(z0, z1) + bevel);
  projUV(geo);
  return mb.geom(0, geo, o);
}

/**
 * Lathe along the Z axis. prof = [[r, f], ...] where f = forward distance (-Z). Centered at (x, y).
 * Traverse so the solid is on the left (e.g. axis->out->forward->in). o.sharp duplicates points for hard edges.
 */
function latheZ(mb, prof, x, y, o = {}) {
  const pts = [];
  for (let i = 0; i < prof.length; i++) {
    const v = new THREE.Vector2(Math.max(0, prof[i][0]), prof[i][1]);
    pts.push(v);
    if (o.sharp && i > 0 && i < prof.length - 1) pts.push(v.clone());
  }
  const geo = new THREE.LatheGeometry(pts, o.rs || 12);
  if (o.swapUV) {
    // grain along the length instead of around
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i);
      uv.setXY(i, uv.getY(i), u);
    }
  }
  if (o.sx || o.sz) geo.scale(o.sx || 1, 1, o.sz || 1);
  geo.rotateX(-PI / 2); // lathe y -> -z (forward), lathe z -> y
  geo.translate(x, y, 0);
  return mb.geom(0, geo, o);
}

/** Lathe along the Y axis (bottles, pipes). prof = [[r, y], ...] bottom -> top. */
function latheY(mb, prof, x, z, o = {}) {
  const pts = [];
  for (let i = 0; i < prof.length; i++) {
    const v = new THREE.Vector2(Math.max(0, prof[i][0]), prof[i][1]);
    pts.push(v);
    if (o.sharp && i > 0 && i < prof.length - 1) pts.push(v.clone());
  }
  const geo = new THREE.LatheGeometry(pts, o.rs || 12);
  geo.translate(x, 0, z);
  return mb.geom(0, geo, o);
}

/** Solid cylinder along Z between z0,z1 (flat ends). */
function cylZ(mb, x, y, z0, z1, r, o = {}) {
  const f0 = -Math.max(z0, z1), f1 = -Math.min(z0, z1);
  return latheZ(mb, [[0, f0], [r, f0], [o.r1 ?? r, f1], [0, f1]], x, y, { sharp: true, ...o });
}

/** Tube (open-bore) along Z: outer r, bore ri visible at the front end. */
function barrelZ(mb, x, y, z0, z1, r, ri, o = {}) {
  const f0 = -Math.max(z0, z1), f1 = -Math.min(z0, z1);
  const r1 = o.r1 ?? r;
  return latheZ(mb, [[0, f0], [r, f0], [r1, f1], [ri, f1], [ri, f1 - Math.min(0.03, (f1 - f0) * 0.4)], [0, f1 - Math.min(0.03, (f1 - f0) * 0.4)]], x, y, { sharp: true, ...o });
}

/** Box from ranges. */
function boxR(mb, x0, x1, y0, y1, z0, z1, o = {}) {
  return mb.box(0, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], [Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)], o);
}

function mirrorX(geo) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    p.setX(i, -p.getX(i));
    n.setX(i, -n.getX(i));
  }
  const idx = geo.index.array;
  for (let i = 0; i < idx.length; i += 3) {
    const t = idx[i + 1];
    idx[i + 1] = idx[i + 2];
    idx[i + 2] = t;
  }
  p.needsUpdate = true;
  n.needsUpdate = true;
  geo.index.needsUpdate = true;
  geo.computeBoundingSphere();
  return geo;
}

// material presets (vertex color multiplies the atlas cell)
const M = {
  gun: { region: WR.GUNMETAL, color: [1.2, 1.14, 1.02], mottle: 0.05 },
  gunDark: { region: WR.GUNMETAL, color: [0.95, 0.92, 0.88], mottle: 0.05 },
  steel: { region: WR.STEEL, color: [1.0, 1.0, 1.02], mottle: 0.05 },
  blade: { region: WR.STEEL, color: [0.86, 0.86, 0.9], mottle: 0.05 },
  poly: { region: WR.POLYMER, color: [1.5, 1.5, 1.5], mottle: 0.04 },
  polyDark: { region: WR.POLYMER, color: [1.0, 1.0, 1.0], mottle: 0.03 },
  wood: { region: WR.WOOD, color: [0.66, 0.5, 0.44], mottle: 0.05, swapUV: true, uv: [1, 0.45, 0, 0.3] },
  walnut: { region: WR.WALNUT, color: [0.95, 0.85, 0.8], mottle: 0.05, swapUV: true, uv: [1, 0.45, 0, 0.3] },
  ash: { region: WR.ASH, color: [0.92, 0.88, 0.8], mottle: 0.06, swapUV: true },
  tape: { region: WR.TAPE, color: [0.45, 0.45, 0.47], mottle: 0.05 },
  tapeGrey: { region: WR.TAPE, color: [1, 1, 1], mottle: 0.05 },
  rust: { region: WR.RUST, color: [1, 1, 1], mottle: 0.1 },
  black: { region: WR.PLAIN, color: 0x0a0a0a, mottle: 0.0, ao: false },
  brass: { region: WR.STEEL, color: [1.05, 0.78, 0.35], mottle: 0.04 },
  red: { region: WR.PLAIN, color: 0x8a1a14, mottle: 0.06 },
  leather: { region: WR.LEATHER, color: [1, 1, 1], mottle: 0.05 },
};

// ================================================================== part collection
class PartSet {
  constructor(split, hi) {
    this.split = split;
    this.hi = hi;
    this.map = new Map();
    this.pivots = {};
    this.meta = { muzzle: null, leftHand: null, frames: {} };
  }
  get(name) {
    const key = this.split ? name : 'body';
    let mb = this.map.get(key);
    if (!mb) {
      mb = new MeshBuilder({ skinned: false, atlas: 'weapon' });
      mb.aoStrength = 0.22;
      this.map.set(key, mb);
    }
    return mb;
  }
  pivot(name, p) {
    this.pivots[name] = p;
  }
}

const R = (hi, a, b) => (hi ? a : b);

// ------------------------------------------------------------------ AK-47
function buildAK(P) {
  const hi = P.hi;
  const B = P.get('body');
  // receiver
  boxR(B, -0.021, 0.021, 0.028, 0.074, 0.07, -0.2, M.gun);
  cylZ(B, 0, 0.07, 0.068, -0.158, 0.0205, { ...M.gun, rs: R(hi, 14, 8) }); // dust cover
  boxR(B, -0.008, 0.008, 0.086, 0.094, 0.07, 0.058, M.gun); // rear latch
  if (hi) {
    for (let i = 0; i < 3; i++) boxR(B, -0.0206, 0.0206, 0.083 + i * 0.0015, 0.0845 + i * 0.0015, -0.03 - i * 0.04, -0.05 - i * 0.04, M.gunDark);
    // rivets
    for (const z of [0.03, -0.02, -0.12, -0.17]) for (const s of [-1, 1]) cylZ(B, s * 0.0212, 0.035, z + 0.002, z - 0.002, 0.0028, { ...M.gunDark, rs: 5 });
    // magazine well lip
    boxR(B, -0.022, 0.022, 0.026, 0.033, -0.078, -0.145, M.gun);
  }
  // rear sight block + leaf (notch at y=0.13)
  profile(B, [[0.158, 0.074], [0.215, 0.074], [0.215, 0.118], [0.2, 0.121], [0.158, 0.1]], 0.026, { ...M.gun, bevel: 0.001 });
  boxR(B, -0.011, -0.0018, 0.118, 0.131, -0.19, -0.2, M.gun);
  boxR(B, 0.0018, 0.011, 0.118, 0.131, -0.19, -0.2, M.gun);
  boxR(B, -0.011, 0.011, 0.114, 0.124, -0.16, -0.2, M.gunDark);
  // front trunnion
  boxR(B, -0.019, 0.019, 0.03, 0.09, -0.2, -0.228, M.gun);
  // barrel
  barrelZ(B, 0, 0.078, -0.2, -0.6, 0.0105, 0.004, { ...M.gun, rs: R(hi, 12, 7) });
  // muzzle brake
  barrelZ(B, 0, 0.078, -0.598, -0.645, 0.0128, 0.0055, { ...M.gunDark, rs: R(hi, 12, 7) });
  if (hi) boxR(B, -0.004, 0.004, 0.088, 0.0915, -0.615, -0.635, M.black);
  // front sight block (post tip at y=0.131, protective ears)
  profile(B, [[0.552, 0.064], [0.584, 0.064], [0.584, 0.112], [0.575, 0.118], [0.56, 0.118], [0.552, 0.108]], 0.022, { ...M.gun, bevel: 0.001 });
  boxR(B, -0.0105, -0.0078, 0.112, 0.14, -0.562, -0.578, M.gun);
  boxR(B, 0.0078, 0.0105, 0.112, 0.14, -0.562, -0.578, M.gun);
  B.seg(0, [0, 0.115, -0.57], [0, 0.131, -0.57], 0.0017, 0.0014, { ...M.gunDark, rs: 5, hs: 1 });
  // bayonet lug + cleaning rod
  boxR(B, -0.006, 0.006, 0.052, 0.066, -0.545, -0.585, M.gun);
  cylZ(B, 0, 0.06, -0.4, -0.59, 0.003, { ...M.gun, rs: 5 });
  // gas block + gas tube
  boxR(B, -0.012, 0.012, 0.07, 0.116, -0.472, -0.49, M.gun);
  cylZ(B, 0, 0.104, -0.39, -0.475, 0.0095, { ...M.gun, rs: R(hi, 10, 6) });
  // upper handguard (wood over gas tube)
  latheZ(B, [[0, 0.235], [0.0165, 0.235], [0.0175, 0.245], [0.0175, 0.38], [0.013, 0.392], [0, 0.392]], 0, 0.103, { ...M.wood, rs: R(hi, 12, 7), sx: 1.28 });
  // lower handguard
  profile(B, [[0.228, 0.086], [0.228, 0.036], [0.245, 0.03], [0.27, 0.029], [0.29, 0.034], [0.31, 0.029], [0.33, 0.034], [0.35, 0.029], [0.375, 0.032], [0.405, 0.04], [0.412, 0.086]], 0.054, { ...M.wood, bevel: 0.006, curveSegs: 4 });
  boxR(B, -0.0265, 0.0265, 0.03, 0.089, -0.222, -0.232, M.gun); // retainer
  boxR(B, -0.027, 0.027, 0.03, 0.089, -0.412, -0.422, M.gun);
  // pistol grip
  profile(B, [[0.028, 0.029], [0.02, -0.01], [0.012, -0.045], [0.004, -0.072], [-0.03, -0.078], [-0.037, -0.062], [-0.024, -0.02], [-0.014, 0.029]], 0.029, { ...M.wood, bevel: 0.004, x: 0 });
  // trigger guard + trigger
  B.tube(0, [[0, 0.029, -0.012], [0, 0.004, -0.018], [0, -0.004, -0.045], [0, 0.0, -0.075], [0, 0.029, -0.086]], 0.0032, 0.0032, { ...M.gun, rs: 5, ts: R(hi, 12, 6), cap: false });
  B.tube(0, [[0, 0.03, -0.04], [0, 0.017, -0.043], [0, 0.009, -0.037]], 0.0025, 0.002, { ...M.gunDark, rs: 5, ts: 4 });
  // selector lever (right side)
  boxR(B, 0.021, 0.0232, 0.052, 0.066, 0.02, -0.115, M.gun);
  boxR(B, 0.021, 0.026, 0.036, 0.052, -0.1, -0.118, M.gun);
  // stock
  profile(B, [[-0.068, 0.078], [-0.375, 0.058], [-0.375, -0.062], [-0.3, -0.04], [-0.2, -0.008], [-0.12, 0.018], [-0.068, 0.029]], 0.036, { ...M.wood, bevel: 0.005, widthFn: (f) => 1 + Math.min(0, f + 0.1) * 0.35 });
  profile(B, [[-0.375, 0.06], [-0.383, 0.06], [-0.383, -0.065], [-0.375, -0.065]], 0.04, { ...M.gun, bevel: 0.001 });
  // bolt carrier slot (right)
  boxR(B, 0.0206, 0.0214, 0.056, 0.066, -0.03, -0.155, M.black);
  // magazine
  const MG = P.get('mag');
  const magPts = [];
  const N = hi ? 10 : 5;
  const cf = (t) => [0.11 + 0.075 * t * t + 0.018 * t, 0.032 - 0.235 * t];
  for (let i = 0; i <= N; i++) {
    const t = i / N, c = cf(t), w = 0.025 + 0.007 * t;
    magPts.push([c[0] + w, c[1]]);
  }
  for (let i = N; i >= 0; i--) {
    const t = i / N, c = cf(t), w = 0.025 + 0.007 * t;
    magPts.push([c[0] - w, c[1]]);
  }
  profile(MG, magPts, 0.027, { ...M.gun, color: [0.95, 0.9, 0.85], bevel: 0.0025 });
  if (hi) {
    // ribs
    for (let i = 1; i < 4; i++) {
      const t = i / 4.5, c = cf(t);
      boxR(MG, -0.0147, 0.0147, c[1] - 0.004, c[1] + 0.004, -(c[0] - 0.02), -(c[0] + 0.02), { ...M.gunDark, color: [0.8, 0.76, 0.72] });
    }
  }
  P.pivot('mag', new THREE.Vector3(0, 0.03, -0.135));
  // charging handle / carrier
  const CH = P.get('charge');
  CH.seg(0, [0.021, 0.061, -0.145], [0.038, 0.063, -0.148], 0.0042, 0.004, { ...M.gun, rs: 6, hs: 1 });
  CH.ellip(0, [0.04, 0.063, -0.148], [0.0065, 0.0058, 0.0058], { ...M.gun, ws: 8, hs: 6 });
  boxR(CH, 0.0195, 0.0215, 0.057, 0.065, -0.1, -0.15, M.gunDark);

  P.meta.muzzle = new THREE.Vector3(0, 0.078, -0.648);
  P.meta.leftHand = new THREE.Vector3(0, 0.064, -0.315);
  P.meta.sight = new THREE.Vector3(0, 0.1305, -0.195);
  P.meta.chargeKnob = new THREE.Vector3(0.042, 0.063, -0.148);
  P.meta.magGrab = new THREE.Vector3(0, -0.06, -0.15);
}

// ------------------------------------------------------------------ Pistol (polymer striker-fired)
function buildPistol(P) {
  const hi = P.hi;
  const B = P.get('body');
  // frame + dust cover
  profile(B, [[-0.012, 0.047], [-0.012, 0.03], [0.02, 0.028], [0.1, 0.028], [0.155, 0.032], [0.162, 0.047]], 0.024, { ...M.poly, bevel: 0.002 });
  if (hi) for (let i = 0; i < 3; i++) boxR(B, -0.0121, 0.0121, 0.029, 0.034, -0.12 - i * 0.012, -0.126 - i * 0.012, M.polyDark);
  // grip (slanted, finger grooves)
  profile(B, [[-0.016, 0.037], [-0.004, 0.029], [-0.046, -0.08], [0.0, -0.08], [0.006, -0.064], [0.013, -0.057], [0.011, -0.048], [0.02, -0.037], [0.018, -0.028], [0.027, -0.015], [0.026, -0.006], [0.036, 0.012], [0.042, 0.029]], 0.029, { ...M.poly, bevel: 0.003 });
  if (hi) {
    // stipple panels
    for (const s of [-1, 1]) profile(B, [[-0.006, 0.01], [-0.034, -0.062], [-0.004, -0.062], [0.018, 0.0]], 0.001, { ...M.polyDark, bevel: 0, x: s * 0.0146 });
  }
  // trigger guard + trigger
  B.tube(0, [[0, 0.029, -0.04], [0, 0.006, -0.046], [0, 0.0, -0.065], [0, 0.001, -0.094], [0, 0.028, -0.1]], 0.0036, 0.0036, { ...M.poly, rs: 5, ts: R(hi, 12, 6), cap: false });
  B.tube(0, [[0, 0.03, -0.062], [0, 0.017, -0.064], [0, 0.01, -0.058]], 0.0028, 0.0022, { ...M.polyDark, rs: 5, ts: 4 });
  // mag base (fixed part is only the grip; mag is separate)
  const MG = P.get('mag');
  const ga = Math.atan2(0.042, 0.109); // grip angle
  const magLen = 0.105;
  const magStart = MG.parts.length; // in world mode MG === body builder: only transform the mag's own parts
  MG.box(0, [0, -magLen / 2, 0], [0.021, magLen, 0.03], { ...M.polyDark });
  MG.box(0, [0, -magLen - 0.004, 0.001], [0.027, 0.009, 0.042], { ...M.poly, round: 0.35, seg: 2 });
  // orient mag along grip axis; pivot at mag top
  const magGeoRot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -ga);
  for (let i = magStart; i < MG.parts.length; i++) {
    const part = MG.parts[i];
    part.geo.applyQuaternion(magGeoRot);
    part.geo.translate(0, 0.025, -0.013);
    part.geo.computeVertexNormals();
  }
  P.pivot('mag', new THREE.Vector3(0, 0.025, -0.013));
  P.meta.magAxis = new THREE.Vector3(0, -Math.cos(ga), Math.sin(ga));
  // slide
  const S = P.get('slide');
  profile(S, [[-0.018, 0.047], [0.168, 0.047], [0.168, 0.074], [0.162, 0.0805], [-0.013, 0.0805], [-0.018, 0.076]], 0.025, { ...M.gun, bevel: 0.0015 });
  if (hi) {
    for (let i = 0; i < 6; i++) for (const s of [-1, 1]) boxR(S, s * 0.0124, s * 0.0132, 0.052, 0.074, 0.01 - i * 0.0045, 0.0085 - i * 0.0045, M.black);
    // ejection port + barrel hood
    boxR(S, -0.003, 0.0126, 0.078, 0.0812, -0.03, -0.075, M.black);
    boxR(S, -0.002, 0.009, 0.077, 0.08, -0.034, -0.07, M.steel);
    // muzzle bore
    cylZ(S, 0, 0.0625, -0.166, -0.1686, 0.0055, { ...M.black, rs: 8 });
    // rear sight (notch)
    boxR(S, -0.011, -0.0022, 0.0805, 0.088, 0.012, 0.004, M.gunDark);
    boxR(S, 0.0022, 0.011, 0.0805, 0.088, 0.012, 0.004, M.gunDark);
    boxR(S, -0.011, 0.011, 0.0805, 0.084, 0.012, 0.004, M.gunDark);
    // sight dots
    boxR(S, -0.007, -0.0045, 0.0845, 0.0865, 0.0038, 0.0034, { region: WR.PLAIN, color: 0xe8e8d0, glow: 0.3 });
    boxR(S, 0.0045, 0.007, 0.0845, 0.0865, 0.0038, 0.0034, { region: WR.PLAIN, color: 0xe8e8d0, glow: 0.3 });
  } else {
    boxR(S, -0.011, 0.011, 0.0805, 0.087, 0.012, 0.004, M.gunDark);
  }
  boxR(S, -0.0018, 0.0018, 0.0805, 0.0875, -0.152, -0.16, M.gunDark); // front sight
  if (hi) boxR(S, -0.0012, 0.0012, 0.0855, 0.0875, -0.1515, -0.152, { region: WR.PLAIN, color: 0xe8e8d0, glow: 0.3 });
  P.meta.muzzle = new THREE.Vector3(0, 0.0625, -0.17);
  P.meta.leftHand = new THREE.Vector3(-0.028, -0.02, -0.012);
  P.meta.sight = new THREE.Vector3(0, 0.086, 0.004);
  P.meta.slideGrab = new THREE.Vector3(0, 0.065, 0.0);
}

// ------------------------------------------------------------------ Pump shotgun
function buildShotgun(P) {
  const hi = P.hi;
  const B = P.get('body');
  // authoring origin: receiver rear bottom; shift so the stock wrist is the grip origin
  const O = [0, -0.035, -0.058]; // added to authored coords at the end (stock wrist -> origin)
  // receiver
  boxR(B, -0.019, 0.019, 0.018, 0.068, 0.03, -0.19, M.gun);
  cylZ(B, 0, 0.066, 0.03, -0.19, 0.019, { ...M.gun, rs: R(hi, 14, 8), sx: 1 });
  if (hi) {
    boxR(B, 0.0185, 0.0194, 0.042, 0.07, -0.06, -0.135, M.black); // ejection port
    boxR(B, -0.012, 0.012, 0.0172, 0.019, -0.035, -0.16, M.black); // loading port
    boxR(B, 0.0188, 0.0196, 0.028, 0.036, -0.05, -0.058, M.gunDark); // pins
    boxR(B, 0.0188, 0.0196, 0.028, 0.036, -0.15, -0.158, M.gunDark);
    // receiver top groove (sight)
    boxR(B, -0.003, 0.003, 0.084, 0.0855, 0.02, -0.18, M.black);
  }
  // trigger group
  boxR(B, -0.009, 0.009, 0.004, 0.019, 0.02, -0.075, M.gun);
  B.tube(0, [[0, 0.006, 0.012], [0, -0.012, 0.005], [0, -0.016, -0.03], [0, -0.006, -0.062], [0, 0.006, -0.07]], 0.0032, 0.0032, { ...M.gun, rs: 5, ts: R(hi, 12, 6), cap: false });
  B.tube(0, [[0, 0.006, -0.02], [0, -0.006, -0.024], [0, -0.012, -0.018]], 0.0025, 0.002, { ...M.gunDark, rs: 5, ts: 4 });
  // stock (walnut)
  profile(B, [[-0.03, 0.074], [-0.085, 0.058], [-0.38, 0.03], [-0.38, -0.108], [-0.3, -0.085], [-0.2, -0.062], [-0.12, -0.035], [-0.075, -0.012], [-0.045, 0.006], [-0.03, 0.018]], 0.038, { ...M.walnut, bevel: 0.005, curveSegs: 4 });
  if (hi) {
    // checkering at wrist
    for (const s of [-1, 1]) profile(B, [[-0.05, 0.05], [-0.1, 0.04], [-0.1, -0.02], [-0.06, 0.0]], 0.001, { ...M.walnut, color: [0.55, 0.5, 0.5], bevel: 0, x: s * 0.0191 });
  }
  profile(B, [[-0.38, 0.032], [-0.402, 0.032], [-0.402, -0.111], [-0.38, -0.111]], 0.04, { ...M.polyDark, bevel: 0.003 }); // recoil pad
  // barrel + vent rib + bead
  barrelZ(B, 0, 0.062, -0.19, -0.72, 0.0118, 0.0092, { ...M.gun, rs: R(hi, 14, 8) });
  if (hi) {
    boxR(B, -0.004, 0.004, 0.0775, 0.0795, -0.2, -0.712, M.gun);
    for (let i = 0; i < 9; i++) boxR(B, -0.0015, 0.0015, 0.071, 0.078, -0.23 - i * 0.055, -0.236 - i * 0.055, M.gun);
  }
  B.ellip(0, [0, 0.0815, -0.706], [0.0023, 0.0023, 0.0023], { region: WR.PLAIN, color: 0xd8d0b0, ws: 6, hs: 4 });
  // magazine tube + cap
  cylZ(B, 0, 0.036, -0.19, -0.63, 0.0108, { ...M.gun, rs: R(hi, 12, 7) });
  latheZ(B, [[0, 0.628], [0.0128, 0.628], [0.0128, 0.64], [0.0122, 0.642], [0.0128, 0.645], [0.0128, 0.658], [0.009, 0.664], [0, 0.664]], 0, 0.036, { ...M.gunDark, rs: R(hi, 12, 7), sharp: true });
  boxR(B, -0.008, 0.008, 0.036, 0.062, -0.605, -0.62, M.gun); // barrel clamp
  // pump (forend) — separate part
  const PU = P.get('pump');
  const pp = [[0, 0.27]];
  const grooves = hi ? 9 : 0;
  pp.push([0.0195, 0.27], [0.021, 0.275]);
  for (let i = 0; i < grooves; i++) {
    const f = 0.29 + i * 0.016;
    pp.push([0.0215, f], [0.0198, f + 0.003], [0.0198, f + 0.007], [0.0215, f + 0.01]);
  }
  pp.push([0.0215, 0.43], [0.0195, 0.44], [0, 0.44]);
  latheZ(PU, pp, 0, 0.042, { ...M.walnut, rs: R(hi, 14, 8), sx: 1.12, sharp: hi });
  boxR(PU, -0.0135, -0.0105, 0.033, 0.041, -0.12, -0.28, M.gun); // action bars
  boxR(PU, 0.0105, 0.0135, 0.033, 0.041, -0.12, -0.28, M.gun);
  // spare shell (for loading anims)
  if (P.split) {
    const SH = P.get('shell');
    cylZ(SH, 0, 0, 0.0, -0.052, 0.0105, { region: WR.PLAIN, color: 0xa01810, rs: 10 });
    cylZ(SH, 0, 0, 0.012, 0.0, 0.0112, { ...M.brass, rs: 10 });
  }
  // shift so the stock wrist is the grip origin
  for (const [name, mb] of P.map) {
    if (name === 'shell') continue;
    for (const part of mb.parts) part.geo.translate(O[0], O[1], O[2]);
  }
  const sh = (x, y, z) => new THREE.Vector3(x + O[0], y + O[1], z + O[2]);
  P.meta.muzzle = sh(0, 0.062, -0.722);
  P.meta.leftHand = sh(0, 0.041, -0.355);
  P.meta.sight = sh(0, 0.0845, -0.706); // front bead (ADS pivots around it)
  P.meta.loadPort = sh(0, 0.014, -0.1);
}

// ------------------------------------------------------------------ Bolt-action hunting rifle
function buildRifle(P) {
  const hi = P.hi;
  const B = P.get('body');
  const O = [0, 0.015, -0.025];
  // stock
  profile(B, [
    [-0.42, 0.042], [-0.14, 0.056], [-0.1, 0.05], [-0.07, 0.038], [-0.045, 0.048], [-0.03, 0.06], [0.2, 0.06], [0.42, 0.058],
    [0.44, 0.05], [0.438, 0.036], [0.2, 0.026], [0.11, 0.02], [0.03, 0.016], [0.014, 0.004], [0.002, -0.028],
    [-0.012, -0.056], [-0.036, -0.064], [-0.056, -0.05], [-0.066, -0.026], [-0.085, -0.02], [-0.2, -0.042], [-0.42, -0.082],
  ], 0.04, {
    ...M.walnut,
    bevel: 0.007,
    bevelSegs: hi ? 2 : 1,
    curveSegs: 4,
    // slimmer wrist and forend, full butt
    widthFn: (f, u) => (f > 0.05 ? 0.85 - Math.min(0.2, (f - 0.05) * 0.4) : f > -0.1 ? 0.8 : 0.8 + Math.min(0.25, (-0.1 - f) * 0.9)) * (u > 0.05 && f > -0.03 ? 0.9 : 1),
  });
  profile(B, [[-0.42, 0.05], [-0.435, 0.05], [-0.435, -0.08], [-0.42, -0.08]], 0.042, { ...M.polyDark, bevel: 0.003 }); // butt pad
  if (hi) {
    profile(B, [[-0.012, -0.059], [-0.038, -0.068], [-0.042, -0.064], [-0.016, -0.055]], 0.03, { ...M.polyDark, bevel: 0.001 }); // grip cap
    for (const s of [-1, 1]) profile(B, [[0.25, 0.05], [0.38, 0.05], [0.38, 0.03], [0.25, 0.028]], 0.001, { ...M.walnut, color: [0.6, 0.55, 0.55], bevel: 0, x: s * 0.0201 });
  }
  // receiver
  cylZ(B, 0, 0.07, 0.04, -0.16, 0.0165, { ...M.gun, rs: R(hi, 14, 8) });
  if (hi) boxR(B, 0.004, 0.0168, 0.078, 0.0852, -0.02, -0.1, M.black); // ejection port
  // floor plate + trigger guard + trigger
  boxR(B, -0.01, 0.01, 0.012, 0.018, -0.02, -0.12, M.gun);
  B.tube(0, [[0, 0.016, 0.02], [0, -0.004, 0.018], [0, -0.012, -0.005], [0, -0.004, -0.03], [0, 0.016, -0.038]], 0.0032, 0.0032, { ...M.gun, rs: 5, ts: R(hi, 12, 6), cap: false });
  B.tube(0, [[0, 0.016, -0.004], [0, 0.002, -0.006], [0, -0.004, 0.0]], 0.0025, 0.002, { ...M.gunDark, rs: 5, ts: 4 });
  // barrel (tapered)
  barrelZ(B, 0, 0.07, -0.16, -0.685, 0.0125, 0.004, { ...M.gun, r1: 0.0092, rs: R(hi, 12, 8) });
  // scope rings + bases (ring = outer band only, keeps the tube see-through from inside)
  for (const z of [0.02, -0.13]) {
    boxR(B, -0.008, 0.008, 0.084, 0.11, z + 0.007, z - 0.007, M.gun);
    latheZ(B, [[0.0152, -z - 0.007], [0.0152, -z + 0.007]], 0, 0.123, { ...M.gun, rs: R(hi, 14, 8), sharp: true });
  }
  // scope tube, bells (open, with inner surface)
  const srs = R(hi, 16, 8);
  // (outer surfaces + end rims only: from inside the tube everything is back-face culled -> see-through ADS)
  latheZ(B, [[0.0125, -0.088], [0.0125, 0.188]], 0, 0.123, { ...M.gun, rs: srs, sharp: true });
  latheZ(B, [[0.0152, -0.135], [0.018, -0.135], [0.018, -0.115], [0.0125, -0.086]], 0, 0.123, { ...M.gun, rs: srs, sharp: true });
  latheZ(B, [[0.0125, 0.186], [0.024, 0.235], [0.024, 0.268], [0.0212, 0.268]], 0, 0.123, { ...M.gun, rs: srs, sharp: true });
  if (hi) {
    // reticle wires inside the objective
    boxR(B, -0.021, 0.021, 0.12255, 0.12345, -0.25, -0.2505, { ...M.black });
    boxR(B, -0.00045, 0.00045, 0.102, 0.144, -0.25, -0.2505, { ...M.black });
  }
  // turrets (open at the tube side)
  const tur = [[0.0088, 0.0125], [0.0088, 0.03], [0.0, 0.03]].map((p) => new THREE.Vector2(p[0], p[1]));
  B.geom(0, new THREE.LatheGeometry(tur, R(hi, 10, 6)), { ...M.gun, at: [0, 0.123, -0.05] });
  B.geom(0, new THREE.LatheGeometry(tur, R(hi, 10, 6)), { ...M.gun, rot: [0, 0, -PI / 2], at: [0, 0.123, -0.05] });
  // bolt (separate)
  const BO = P.get('bolt');
  cylZ(BO, 0, 0.07, 0.085, 0.035, 0.012, { ...M.gun, rs: R(hi, 12, 7) }); // shroud
  cylZ(BO, 0, 0.07, 0.04, -0.03, 0.0095, { ...M.steel, rs: R(hi, 10, 6) });
  BO.tube(0, [[0.006, 0.07, 0.028], [0.03, 0.066, 0.03], [0.047, 0.052, 0.034]], 0.004, 0.0035, { ...M.steel, rs: 6, ts: 6 });
  BO.ellip(0, [0.05, 0.049, 0.035], [0.0085, 0.0085, 0.0085], { ...M.gun, ws: 8, hs: 6 });
  P.pivot('bolt', new THREE.Vector3(0, 0.07, 0.03));
  if (P.split) {
    const RD = P.get('round');
    cylZ(RD, 0, 0, 0.0, -0.05, 0.006, { ...M.brass, rs: 8 });
    latheZ(RD, [[0, 0.05], [0.0045, 0.05], [0.004, 0.062], [0.0015, 0.072], [0, 0.074]], 0, 0, { region: WR.STEEL, color: [0.95, 0.55, 0.35], rs: 8 });
  }
  for (const [name, mb] of P.map) if (name !== 'round') for (const part of mb.parts) part.geo.translate(O[0], O[1], O[2]);
  for (const k in P.pivots) P.pivots[k].add(new THREE.Vector3(O[0], O[1], O[2]));
  const sh = (x, y, z) => new THREE.Vector3(x + O[0], y + O[1], z + O[2]);
  P.meta.muzzle = sh(0, 0.07, -0.688);
  P.meta.leftHand = sh(0, 0.038, -0.3);
  P.meta.sight = sh(0, 0.123, 0.13);
  P.meta.boltKnob = sh(0.05, 0.049, 0.035);
  P.meta.port = sh(0.0, 0.1, -0.06);
}

// ------------------------------------------------------------------ M4A1 carbine (flat-top, collapsible stock)
function buildM4(P) {
  const hi = P.hi;
  const B = P.get('body');
  // lower receiver + flared magwell
  boxR(B, -0.019, 0.019, 0.02, 0.053, 0.062, -0.14, M.gun);
  profile(B, [[0.064, 0.021], [0.066, -0.014], [0.138, -0.014], [0.142, -0.004], [0.142, 0.021]], 0.034, { ...M.gun, bevel: 0.002 });
  // upper receiver + picatinny rail
  boxR(B, -0.0185, 0.0185, 0.053, 0.094, 0.07, -0.142, M.gun);
  boxR(B, -0.0105, 0.0105, 0.094, 0.1, 0.066, -0.142, M.gunDark);
  if (hi) {
    for (let i = 0; i < 11; i++) boxR(B, -0.0107, 0.0107, 0.0985, 0.1005, 0.056 - i * 0.018, 0.05 - i * 0.018, M.black); // rail slots
    boxR(B, 0.0184, 0.0192, 0.059, 0.082, -0.005, -0.075, M.black); // ejection port
    boxR(B, 0.0185, 0.024, 0.074, 0.086, 0.012, -0.004, M.gun); // brass deflector
    cylZ(B, 0.021, 0.081, 0.052, 0.012, 0.0075, { ...M.gunDark, rs: 8 }); // forward assist
    cylZ(B, 0.0195, 0.034, -0.09, -0.098, 0.0045, { ...M.gunDark, rs: 6 }); // mag release
    boxR(B, -0.0215, -0.0185, 0.03, 0.05, -0.1, -0.124, M.gun); // bolt catch
    // selector (left)
    B.seg(0, [-0.02, 0.041, 0.018], [-0.024, 0.041, 0.018], 0.0045, 0.0045, { ...M.gun, rs: 6, hs: 1 });
    boxR(B, -0.0255, -0.0215, 0.038, 0.044, 0.018, 0.034, M.gun);
    // takedown pins
    for (const z of [0.052, -0.13]) B.seg(0, [-0.02, 0.048, z], [0.02, 0.048, z], 0.0028, 0.0028, { ...M.gunDark, rs: 6, hs: 1 });
  }
  // flip-up rear sight (aperture centre at y 0.127)
  profile(B, [[-0.058, 0.1], [-0.026, 0.1], [-0.03, 0.112], [-0.042, 0.118], [-0.058, 0.114]], 0.028, { ...M.gunDark, bevel: 0.001 });
  boxR(B, -0.004, 0.004, 0.112, 0.121, 0.047, 0.043, M.gunDark);
  latheZ(B, [[0.0033, -0.047], [0.0065, -0.047], [0.0065, -0.043], [0.0033, -0.043], [0.0033, -0.047]], 0, 0.127, { ...M.gunDark, rs: R(hi, 12, 6), sharp: true });
  for (const s of [-1, 1]) boxR(B, s * 0.0078, s * 0.0108, 0.112, 0.136, 0.049, 0.041, M.gunDark);
  // barrel, delta ring, ribbed handguard, front sight base, birdcage
  barrelZ(B, 0, 0.072, -0.142, -0.5, 0.0092, 0.0035, { ...M.gunDark, rs: R(hi, 12, 7) });
  latheZ(B, [[0, 0.142], [0.031, 0.142], [0.031, 0.154], [0, 0.154]], 0, 0.072, { ...M.gun, rs: R(hi, 14, 8), sharp: true });
  const hg = [[0, 0.152], [0.0245, 0.152], [0.027, 0.16]];
  if (hi) {
    for (let i = 0; i < 8; i++) {
      const f = 0.17 + i * 0.018;
      hg.push([0.027, f], [0.0248, f + 0.004], [0.0248, f + 0.01], [0.027, f + 0.014]);
    }
  }
  hg.push([0.027, 0.316], [0.024, 0.322], [0, 0.322]);
  latheZ(B, hg, 0, 0.072, { ...M.polyDark, rs: R(hi, 14, 8), sx: 0.94, sharp: hi });
  latheZ(B, [[0, 0.32], [0.026, 0.32], [0.026, 0.328], [0, 0.328]], 0, 0.072, { ...M.gun, rs: R(hi, 12, 7), sharp: true });
  profile(B, [[0.338, 0.06], [0.374, 0.06], [0.374, 0.082], [0.36, 0.118], [0.35, 0.118], [0.338, 0.082]], 0.022, { ...M.gun, bevel: 0.001 });
  boxR(B, -0.005, 0.005, 0.046, 0.06, -0.34, -0.37, M.gun); // bayonet lug
  for (const s of [-1, 1]) boxR(B, s * 0.0072, s * 0.0102, 0.114, 0.132, -0.349, -0.359, M.gun); // sight ears
  B.seg(0, [0, 0.114, -0.354], [0, 0.127, -0.354], 0.0018, 0.0014, { ...M.gunDark, rs: 5, hs: 1 }); // post
  barrelZ(B, 0, 0.072, -0.498, -0.548, 0.0108, 0.0056, { ...M.black, rs: R(hi, 10, 6) });
  if (hi) for (const s of [-1, 1]) boxR(B, s * 0.004 - 0.0012, s * 0.004 + 0.0012, 0.08, 0.0832, -0.51, -0.538, M.black);
  // A2 pistol grip + squared trigger guard + trigger
  profile(B, [[0.03, 0.022], [0.022, -0.012], [0.012, -0.03], [0.016, -0.04], [0.006, -0.074], [-0.028, -0.08], [-0.036, -0.066], [-0.024, -0.024], [-0.016, 0.022]], 0.028, { ...M.poly, bevel: 0.004 });
  B.tube(0, [[0, 0.021, -0.012], [0, 0.0, -0.016], [0, -0.004, -0.04], [0, -0.004, -0.064], [0, 0.021, -0.068]], 0.003, 0.003, { ...M.gun, rs: 5, ts: R(hi, 12, 6), cap: false });
  B.tube(0, [[0, 0.022, -0.036], [0, 0.009, -0.039], [0, 0.002, -0.034]], 0.0025, 0.002, { ...M.gunDark, rs: 5, ts: 4 });
  // buffer tube + collapsible stock
  cylZ(B, 0, 0.074, 0.062, 0.27, 0.0155, { ...M.gunDark, rs: R(hi, 12, 7) });
  cylZ(B, 0, 0.074, 0.062, 0.074, 0.0185, { ...M.gun, rs: R(hi, 10, 6) });
  profile(B, [[-0.19, 0.095], [-0.31, 0.098], [-0.325, 0.09], [-0.325, -0.045], [-0.305, -0.05], [-0.255, 0.03], [-0.2, 0.052], [-0.19, 0.062]], 0.042, { ...M.polyDark, bevel: 0.004, curveSegs: 4 });
  profile(B, [[-0.325, 0.092], [-0.335, 0.092], [-0.335, -0.048], [-0.325, -0.048]], 0.044, { ...M.polyDark, color: [0.7, 0.7, 0.7], bevel: 0.002 });
  if (hi) boxR(B, -0.005, 0.005, 0.048, 0.056, 0.2, 0.235, M.polyDark); // adjustment lever
  // STANAG magazine
  const MG = P.get('mag');
  const magPts = [];
  const N = hi ? 8 : 4;
  const cf = (t) => [0.103 + 0.028 * t * t + 0.012 * t, 0.02 - 0.19 * t];
  for (let i = 0; i <= N; i++) {
    const c = cf(i / N);
    magPts.push([c[0] + 0.03, c[1]]);
  }
  for (let i = N; i >= 0; i--) {
    const c = cf(i / N);
    magPts.push([c[0] - 0.03, c[1]]);
  }
  profile(MG, magPts, 0.022, { ...M.gun, color: [0.9, 0.88, 0.84], bevel: 0.002 });
  if (hi) {
    const c = cf(1);
    boxR(MG, -0.0125, 0.0125, c[1] - 0.004, c[1] + 0.006, -(c[0] - 0.032), -(c[0] + 0.033), M.polyDark); // floor plate
    for (const t of [0.35, 0.6]) {
      const q = cf(t);
      boxR(MG, -0.0115, 0.0115, q[1] - 0.012, q[1] + 0.012, -(q[0] - 0.012), -(q[0] + 0.012), { ...M.gunDark, color: [0.8, 0.78, 0.75] });
    }
  }
  P.pivot('mag', new THREE.Vector3(0, 0.02, -0.103));
  // T charging handle (rear of the upper; the shaft shows when pulled)
  const CH = P.get('charge');
  boxR(CH, -0.006, 0.006, 0.086, 0.093, 0.068, -0.02, M.gunDark);
  boxR(CH, -0.021, 0.021, 0.085, 0.095, 0.068, 0.082, M.gunDark);
  if (hi) boxR(CH, -0.024, -0.017, 0.083, 0.097, 0.074, 0.084, M.gunDark); // latch

  P.meta.muzzle = new THREE.Vector3(0, 0.072, -0.55);
  P.meta.leftHand = new THREE.Vector3(0, 0.068, -0.25);
  P.meta.sight = new THREE.Vector3(0, 0.127, 0.045);
  P.meta.chargeKnob = new THREE.Vector3(-0.026, 0.04, -0.112); // reload ends with a slap on the bolt catch
  P.meta.magGrab = new THREE.Vector3(0, -0.06, -0.113);
}

// ------------------------------------------------------------------ MP5 (fixed polymer stock)
function buildMP5(P) {
  const hi = P.hi;
  const B = P.get('body');
  // stamped receiver (round top), end cap
  boxR(B, -0.019, 0.019, 0.03, 0.068, 0.055, -0.2, M.gun);
  cylZ(B, 0, 0.068, 0.055, -0.2, 0.019, { ...M.gun, rs: R(hi, 14, 8) });
  boxR(B, -0.02, 0.02, 0.03, 0.084, 0.055, 0.068, M.gunDark);
  if (hi) {
    boxR(B, 0.0185, 0.0194, 0.058, 0.078, -0.05, -0.1, M.black); // ejection port
    for (const s of [-1, 1]) boxR(B, s * 0.0192 - 0.0006, s * 0.0192 + 0.0006, 0.036, 0.04, 0.05, -0.195, M.gunDark); // stamping seam
    for (const z of [0.02, -0.15]) B.seg(0, [-0.02, 0.04, z], [0.02, 0.04, z], 0.0026, 0.0026, { ...M.gunDark, rs: 6, hs: 1 }); // pins
  }
  // cocking tube over the barrel
  cylZ(B, 0, 0.078, -0.19, -0.345, 0.0125, { ...M.gun, rs: R(hi, 12, 7) });
  if (hi) boxR(B, -0.0128, -0.0118, 0.073, 0.083, -0.2, -0.31, M.black); // cocking slot (left)
  // slim polymer handguard
  profile(B, [[0.198, 0.066], [0.198, 0.03], [0.212, 0.021], [0.326, 0.023], [0.338, 0.033], [0.338, 0.066]], 0.044, { ...M.polyDark, bevel: 0.006, curveSegs: 4 });
  if (hi) for (const s of [-1, 1]) for (let i = 0; i < 4; i++) boxR(B, s * 0.0222 - 0.0006, s * 0.0222 + 0.0006, 0.035, 0.055, -0.226 - i * 0.026, -0.238 - i * 0.026, M.black); // grip grooves
  // barrel + locking lugs
  barrelZ(B, 0, 0.05, -0.335, -0.405, 0.0085, 0.0035, { ...M.gun, rs: R(hi, 12, 7) });
  if (hi) for (let i = 0; i < 3; i++) {
    const a = (i / 3) * PI * 2;
    boxR(B, Math.sin(a) * 0.0095 - 0.002, Math.sin(a) * 0.0095 + 0.002, 0.05 + Math.cos(a) * 0.0095 - 0.002, 0.05 + Math.cos(a) * 0.0095 + 0.002, -0.37, -0.382, M.gun);
  }
  // hooded front sight (post tip at y 0.114) + drum rear sight (aperture at y 0.114)
  boxR(B, -0.008, 0.008, 0.086, 0.103, -0.325, -0.345, M.gun);
  latheZ(B, [[0.0095, 0.325], [0.0118, 0.325], [0.0118, 0.345], [0.0095, 0.345], [0.0095, 0.325]], 0, 0.114, { ...M.gun, rs: R(hi, 12, 7), sharp: true });
  B.seg(0, [0, 0.102, -0.335], [0, 0.114, -0.335], 0.0017, 0.0013, { ...M.gunDark, rs: 5, hs: 1 });
  boxR(B, -0.012, 0.012, 0.082, 0.096, 0.03, 0.06, M.gun);
  B.seg(0, [-0.0125, 0.1, 0.045], [0.0125, 0.1, 0.045], 0.0085, 0.0085, { ...M.gun, rs: R(hi, 12, 7), hs: 1 });
  latheZ(B, [[0.0042, -0.048], [0.0072, -0.048], [0.0072, -0.043], [0.0042, -0.043], [0.0042, -0.048]], 0, 0.114, { ...M.gunDark, rs: R(hi, 14, 6), sharp: true });
  // polymer trigger group, pistol grip, trigger guard + trigger, selector
  profile(B, [[0.066, 0.031], [0.066, 0.012], [0.04, 0.004], [-0.026, 0.004], [-0.046, 0.018], [-0.05, 0.031]], 0.034, { ...M.poly, bevel: 0.003 });
  profile(B, [[0.03, 0.01], [0.022, -0.012], [0.012, -0.03], [0.017, -0.042], [0.007, -0.074], [-0.027, -0.08], [-0.035, -0.066], [-0.026, -0.024], [-0.02, 0.01]], 0.029, { ...M.poly, bevel: 0.004 });
  B.tube(0, [[0, 0.006, -0.012], [0, -0.008, -0.016], [0, -0.012, -0.04], [0, -0.008, -0.062], [0, 0.006, -0.066]], 0.003, 0.003, { ...M.poly, rs: 5, ts: R(hi, 12, 6), cap: false });
  B.tube(0, [[0, 0.008, -0.034], [0, -0.002, -0.037], [0, -0.008, -0.032]], 0.0025, 0.002, { ...M.gunDark, rs: 5, ts: 4 });
  if (hi) {
    boxR(B, -0.0195, -0.0175, 0.016, 0.026, 0.02, -0.012, M.gunDark); // selector lever
    boxR(B, -0.006, 0.006, 0.0, 0.01, -0.07, -0.086, M.gunDark); // paddle release
  }
  // magwell
  boxR(B, -0.017, 0.017, 0.008, 0.032, -0.098, -0.148, M.gun);
  // fixed A2 stock + butt plate
  profile(B, [[-0.055, 0.082], [-0.33, 0.072], [-0.34, 0.062], [-0.34, -0.062], [-0.3, -0.058], [-0.2, -0.022], [-0.11, 0.008], [-0.055, 0.03]], 0.036, { ...M.polyDark, bevel: 0.005, curveSegs: 4 });
  profile(B, [[-0.34, 0.066], [-0.35, 0.066], [-0.35, -0.066], [-0.34, -0.066]], 0.04, { ...M.polyDark, color: [0.7, 0.7, 0.7], bevel: 0.002 });
  // curved 9mm magazine
  const MG = P.get('mag');
  const magPts = [];
  const N = hi ? 8 : 4;
  const cf = (t) => [0.123 + 0.05 * t * t + 0.018 * t, 0.024 - 0.2 * t];
  for (let i = 0; i <= N; i++) {
    const c = cf(i / N);
    magPts.push([c[0] + 0.021, c[1]]);
  }
  for (let i = N; i >= 0; i--) {
    const c = cf(i / N);
    magPts.push([c[0] - 0.021, c[1]]);
  }
  profile(MG, magPts, 0.02, { ...M.gun, color: [0.92, 0.9, 0.86], bevel: 0.002 });
  if (hi) {
    const c = cf(1);
    boxR(MG, -0.0115, 0.0115, c[1] - 0.004, c[1] + 0.005, -(c[0] - 0.023), -(c[0] + 0.024), M.gunDark);
  }
  P.pivot('mag', new THREE.Vector3(0, 0.024, -0.123));
  // cocking handle (front left of the tube)
  const CH = P.get('charge');
  CH.seg(0, [-0.011, 0.079, -0.3], [-0.033, 0.082, -0.296], 0.0034, 0.003, { ...M.gun, rs: 6, hs: 1 });
  CH.ellip(0, [-0.036, 0.082, -0.296], [0.0055, 0.0055, 0.0065], { ...M.gunDark, ws: 8, hs: 6 });

  P.meta.muzzle = new THREE.Vector3(0, 0.05, -0.408);
  P.meta.leftHand = new THREE.Vector3(0, 0.044, -0.27);
  P.meta.sight = new THREE.Vector3(0, 0.114, 0.045);
  P.meta.chargeKnob = new THREE.Vector3(-0.037, 0.082, -0.296);
  P.meta.magGrab = new THREE.Vector3(0, -0.065, -0.14);
}

// ------------------------------------------------------------------ Side-by-side double-barrel shotgun
function buildDoubleBarrel(P) {
  const hi = P.hi;
  const B = P.get('body');
  const O = [0, -0.035, -0.058]; // authored like the pump: stock wrist -> grip origin
  // action (frame) + top lever
  boxR(B, -0.0235, 0.0235, 0.016, 0.066, 0.03, -0.075, M.gun);
  profile(B, [[0.03, 0.066], [0.062, 0.066], [0.075, 0.058], [0.075, 0.016], [0.03, 0.016]], 0.047, { ...M.gun, bevel: 0.003 });
  boxR(B, -0.004, 0.004, 0.066, 0.072, 0.03, -0.004, M.gunDark);
  B.seg(0, [0.0, 0.07, 0.022], [0.016, 0.071, 0.03], 0.0035, 0.003, { ...M.gunDark, rs: 6, hs: 1 });
  if (hi) {
    for (const s of [-1, 1]) profile(B, [[-0.02, 0.058], [0.06, 0.058], [0.07, 0.03], [-0.02, 0.022]], 0.001, { ...M.steel, color: [0.8, 0.78, 0.72], bevel: 0, x: s * 0.0238 }); // side plates
    B.seg(0, [-0.024, 0.03, -0.075], [0.024, 0.03, -0.075], 0.004, 0.004, { ...M.gunDark, rs: 8, hs: 1 }); // hinge pin
    boxR(B, -0.003, 0.003, 0.0705, 0.074, 0.005, -0.004, M.steel); // safety
  }
  // twin triggers + guard
  boxR(B, -0.009, 0.009, 0.004, 0.017, 0.02, -0.06, M.gun);
  B.tube(0, [[0, 0.006, 0.012], [0, -0.014, 0.004], [0, -0.018, -0.03], [0, -0.008, -0.062], [0, 0.006, -0.07]], 0.0032, 0.0032, { ...M.gun, rs: 5, ts: R(hi, 12, 6), cap: false });
  for (const z of [-0.024, -0.04]) B.tube(0, [[0, 0.006, z], [0, -0.006, z - 0.004], [0, -0.012, z + 0.002]], 0.0024, 0.002, { ...M.gunDark, rs: 5, ts: 4 });
  // walnut stock + pad
  profile(B, [[-0.03, 0.068], [-0.085, 0.056], [-0.38, 0.03], [-0.38, -0.108], [-0.3, -0.085], [-0.2, -0.062], [-0.12, -0.035], [-0.075, -0.012], [-0.045, 0.006], [-0.03, 0.016]], 0.038, { ...M.walnut, bevel: 0.005, curveSegs: 4 });
  if (hi) for (const s of [-1, 1]) profile(B, [[-0.05, 0.05], [-0.1, 0.04], [-0.1, -0.02], [-0.06, 0.0]], 0.001, { ...M.walnut, color: [0.55, 0.5, 0.5], bevel: 0, x: s * 0.0191 });
  profile(B, [[-0.38, 0.032], [-0.398, 0.032], [-0.398, -0.111], [-0.38, -0.111]], 0.04, { ...M.leather, bevel: 0.003 });
  // barrels, rib, bead, lug and splinter forend: one part that breaks open around the hinge pin
  const BR = P.get('barrels');
  for (const s of [-1, 1]) barrelZ(BR, s * 0.0118, 0.052, -0.075, -0.64, 0.0122, 0.0094, { ...M.gun, r1: 0.0112, rs: R(hi, 14, 8) });
  boxR(BR, -0.0045, 0.0045, 0.058, 0.067, -0.078, -0.636, M.gunDark);
  BR.ellip(0, [0, 0.0695, -0.628], [0.0023, 0.0023, 0.0023], { region: WR.PLAIN, color: 0xd8d0b0, ws: 6, hs: 4 });
  boxR(BR, -0.009, 0.009, 0.022, 0.046, -0.075, -0.12, M.gun); // under-lug
  profile(BR, [[0.105, 0.046], [0.105, 0.026], [0.12, 0.016], [0.3, 0.02], [0.33, 0.03], [0.34, 0.046]], 0.05, { ...M.walnut, bevel: 0.006, curveSegs: 4 });
  if (hi) boxR(BR, -0.0035, 0.0035, 0.018, 0.02, -0.28, -0.3, M.steel); // forend latch
  // two spare shells (loading animation only)
  if (P.split) {
    const SH = P.get('shell');
    for (const s of [-1, 1]) {
      cylZ(SH, s * 0.0118, 0, 0.0, -0.052, 0.009, { region: WR.PLAIN, color: 0xa01810, rs: 10 });
      cylZ(SH, s * 0.0118, 0, 0.012, 0.0, 0.0102, { ...M.brass, rs: 10 });
    }
  }
  const hinge = new THREE.Vector3(0, 0.03, -0.075);
  P.pivot('barrels', hinge);
  for (const [name, mb] of P.map) {
    if (name === 'shell') continue;
    for (const part of mb.parts) part.geo.translate(O[0], O[1], O[2]);
  }
  for (const k in P.pivots) P.pivots[k].add(new THREE.Vector3(O[0], O[1], O[2]));
  const sh = (x, y, z) => new THREE.Vector3(x + O[0], y + O[1], z + O[2]);
  P.meta.muzzle = sh(0, 0.052, -0.642);
  P.meta.leftHand = sh(0, 0.034, -0.23);
  P.meta.sight = sh(0, 0.072, -0.628); // front bead
  P.meta.chamber = sh(0, 0.052, -0.075);
}

// ------------------------------------------------------------------ Melee
function buildKnife(P) {
  const hi = P.hi;
  const B = P.get('body');
  // handle (ribbed)
  const hp = [[0, -0.068], [0.0105, -0.068]];
  const rings = hi ? 6 : 3;
  for (let i = 0; i < rings; i++) {
    const f = -0.062 + i * (0.106 / rings);
    hp.push([0.0128, f + 0.004], [0.0118, f + 0.1 / rings]);
  }
  hp.push([0.0128, 0.046], [0.011, 0.05], [0, 0.05]);
  latheZ(B, hp, 0, 0, { ...M.polyDark, rs: R(hi, 10, 6), sx: 0.82 });
  cylZ(B, 0, 0, 0.068, 0.076, 0.0105, { ...M.gun, rs: R(hi, 10, 6), sx: 0.85 }); // pommel
  boxR(B, -0.0055, 0.0055, -0.024, 0.02, -0.05, -0.058, M.gun); // guard
  // blade
  const bp = [[0.056, 0.011]];
  if (hi) for (let i = 0; i < 6; i++) bp.push([0.066 + i * 0.008, 0.014], [0.07 + i * 0.008, 0.011]);
  bp.push([0.165, 0.011], [0.2, 0.008], [0.236, -0.001], [0.21, -0.011], [0.17, -0.016], [0.1, -0.017], [0.058, -0.015]);
  profile(B, bp, 0.0048, { ...M.blade, bevel: 0.0014, curveSegs: 3 });
  if (hi) for (const s of [-1, 1]) boxR(B, s * 0.0024, s * 0.0028, -0.001, 0.003, -0.075, -0.16, M.gunDark); // fuller
  P.meta.muzzle = null;
}

function batBody(B, hi) {
  const prof = [[0, -0.126], [0.017, -0.124], [0.0215, -0.117], [0.0205, -0.108], [0.0138, -0.098], [0.0138, 0.0], [0.0152, 0.1], [0.018, 0.2], [0.0245, 0.3], [0.03, 0.4], [0.0325, 0.5], [0.0332, 0.62], [0.0322, 0.7], [0.027, 0.733], [0.014, 0.744], [0, 0.746]];
  latheZ(B, prof, 0, 0, { ...M.ash, rs: R(hi, 14, 8) });
  // tape grip
  latheZ(B, [[0.0137, -0.098], [0.0153, -0.096], [0.0153, 0.11], [0.0137, 0.112]], 0, 0, { ...M.tape, rs: R(hi, 14, 8) });
  if (hi) for (let i = 0; i < 6; i++) latheZ(B, [[0.0153, -0.08 + i * 0.03], [0.0158, -0.078 + i * 0.03], [0.0158, -0.072 + i * 0.03], [0.0153, -0.07 + i * 0.03]], 0, 0, { ...M.tape, color: [0.35, 0.35, 0.37], rs: 14 });
}

function buildBat(P) {
  batBody(P.get('body'), P.hi);
  P.meta.leftHand = new THREE.Vector3(0, 0, 0.078);
}

function buildSpikedBat(P) {
  const hi = P.hi;
  const B = P.get('body');
  batBody(B, hi);
  const rnd = mulberry32(777);
  const nails = hi ? 26 : 16;
  for (let i = 0; i < nails; i++) {
    const f = 0.36 + rnd() * 0.34;
    const a = rnd() * PI * 2;
    const r = f < 0.4 ? 0.03 : 0.032;
    const dx = Math.cos(a), dy = Math.sin(a);
    const len = 0.03 + rnd() * 0.025;
    const tilt = (rnd() - 0.5) * 0.4;
    B.spike(0, [dx * r * 0.8, dy * r * 0.8, -f], [dx * (r + len), dy * (r + len), -f + tilt * len], 0.0022, { ...(rnd() < 0.5 ? M.rust : M.steel), rs: 4 });
    if (hi) B.ellip(0, [dx * r * 0.98, dy * r * 0.98, -f], [0.0035, 0.0035, 0.0035], { ...M.rust, ws: 5, hs: 3 });
  }
  // barbed wire helix
  const pts = [];
  const turns = 2.6, N = hi ? 64 : 26;
  for (let i = 0; i <= N; i++) {
    const t = i / N, a = t * turns * PI * 2;
    const f = 0.3 + t * 0.36;
    const r = (f < 0.4 ? 0.0265 : 0.0335) + 0.002;
    pts.push([Math.cos(a) * r, Math.sin(a) * r, -f]);
  }
  B.tube(0, pts, 0.0017, 0.0017, { ...M.rust, rs: 4, ts: N * 2, cap: false });
  if (hi) {
    for (let i = 2; i < N; i += 5) {
      const p = pts[i];
      B.spike(0, p, [p[0] * 1.35, p[1] * 1.35, p[2] + 0.004], 0.0012, { ...M.rust, rs: 3 });
      B.spike(0, p, [p[0] * 1.25 - p[1] * 0.2, p[1] * 1.25 + p[0] * 0.2, p[2] - 0.004], 0.0012, { ...M.rust, rs: 3 });
    }
  }
  // blood soaking the barrel
  B.blood([0.03, 0.0, -0.55], 0.06, 1);
  B.blood([-0.02, 0.025, -0.66], 0.05, 1);
  B.blood([0.0, -0.03, -0.42], 0.045, 0.9);
  B.bloodColor.setRGB(0.12, 0.004, 0.004);
  P.meta.leftHand = new THREE.Vector3(0, 0, 0.078);
}

function buildMachete(P) {
  const hi = P.hi;
  const B = P.get('body');
  // handle scales
  profile(B, [[-0.082, 0.012], [-0.088, 0.004], [-0.086, -0.012], [-0.075, -0.016], [0.0, -0.015], [0.04, -0.016], [0.055, -0.018], [0.055, 0.013], [0.0, 0.013]], 0.024, { ...M.polyDark, color: [1.3, 1.1, 0.9], bevel: 0.004 });
  if (hi) for (const f of [-0.06, -0.015, 0.03]) B.seg(0, [-0.0125, -0.001, -f], [0.0125, -0.001, -f], 0.0032, 0.0032, { ...M.steel, rs: 6, hs: 1, caps: 1, capScale: 0.1 });
  // blade
  profile(B, [[0.05, 0.012], [0.25, 0.014], [0.44, 0.016], [0.5, 0.012], [0.525, -0.004], [0.515, -0.026], [0.49, -0.04], [0.4, -0.043], [0.25, -0.037], [0.1, -0.029], [0.05, -0.022]], 0.0042, {
    ...M.blade,
    bevel: 0.0014,
    curveSegs: 3,
    tint: (p, n, c) => {
      const r = fbm3(p.x * 40, p.y * 60, p.z * 30, 3, 5);
      if (r > 0.52) c.lerp(new THREE.Color(0.35, 0.14, 0.05), Math.min(1, (r - 0.52) * 5));
      if (p.y < -0.03) c.multiplyScalar(1.25); // sharpened edge
    },
  });
  P.meta.muzzle = null;
}

function buildHammer(P) {
  const hi = P.hi;
  const B = P.get('body');
  // handle: wood with rubber grip
  latheZ(B, [[0, -0.105], [0.0135, -0.104], [0.0145, -0.09], [0.0138, 0.03], [0.0118, 0.1], [0.0105, 0.19], [0.0, 0.195]], 0, 0, { ...M.ash, rs: R(hi, 12, 7), sx: 0.8 });
  latheZ(B, [[0, -0.108], [0.0148, -0.106], [0.016, -0.09], [0.0152, 0.03], [0.0138, 0.04], [0, 0.041]], 0, 0, { ...M.polyDark, color: [0.9, 0.3, 0.2], rs: R(hi, 12, 7), sx: 0.82 });
  // head: eye block, neck and face (toward -Y), claw (toward +Y, curving back)
  boxR(B, -0.012, 0.012, -0.018, 0.024, -0.182, -0.218, { ...M.gun, round: 0.25, seg: 2 });
  B.seg(0, [0, -0.018, -0.2], [0, -0.05, -0.2], 0.0105, 0.0125, { ...M.gun, rs: R(hi, 12, 8), hs: 1, caps: 1, capScale: 0.02 });
  B.seg(0, [0, -0.048, -0.2], [0, -0.058, -0.2], 0.0145, 0.0145, { ...M.steel, rs: R(hi, 12, 8), hs: 1, caps: 1, capScale: 0.02 });
  for (const s of [-1, 1]) {
    profile(B, [[0.182, 0.022], [0.218, 0.022], [0.21, 0.05], [0.19, 0.075], [0.165, 0.092], [0.158, 0.088], [0.176, 0.06], [0.185, 0.04]], 0.0085, { ...M.gun, bevel: 0.0015, curveSegs: 3, x: s * 0.0052 });
  }
  P.meta.muzzle = null;
}

// ------------------------------------------------------------------ Throwables
function buildMolotov(P) {
  const hi = P.hi;
  const B = P.get('body');
  latheY(B, [[0, -0.08], [0.028, -0.08], [0.0325, -0.076], [0.0335, -0.06], [0.0335, 0.045], [0.03, 0.066], [0.02, 0.088], [0.0128, 0.104], [0.0118, 0.15], [0.0135, 0.154], [0.0135, 0.16], [0.011, 0.162], [0.0, 0.162]], 0, 0, {
    region: WR.GLASS,
    color: [0.42, 0.36, 0.2],
    rs: R(hi, 14, 8),
    mottle: 0.08,
    swapUV: false,
    // liquid line: darker below
    tint: (p, n, c) => {
      if (p.y < 0.03) c.multiplyScalar(0.6);
    },
  });
  // label (partial wrap)
  const lab = new THREE.CylinderGeometry(0.0342, 0.0342, 0.06, R(hi, 12, 6), 1, true, -1.2, 3.6);
  B.geom(0, lab, { region: WR.RAG, uv: [1, 0.35, 0, 0], color: [0.95, 0.88, 0.7], at: [0, -0.005, 0] });
  // rag stuffed in the neck: crumpled wad + hanging strips
  B.tube(0, [[0, 0.125, 0], [0.001, 0.165, 0.001], [0.004, 0.19, 0.003], [0.01, 0.203, 0.006]], 0.0105, 0.009, { region: WR.RAG, color: [0.9, 0.86, 0.78], rs: 7, ts: R(hi, 8, 4), noise: 0.003, nf: 120 });
  B.ellip(0, [0.008, 0.205, 0.005], [0.014, 0.01, 0.012], { region: WR.RAG, color: [0.85, 0.8, 0.72], ws: 7, hs: 5, noise: 0.003, nf: 150, rot: [0.3, 0.4, 0.5] });
  B.box(0, [0.012, 0.15, 0.008], [0.014, 0.05, 0.0025], { region: WR.RAG, color: [0.9, 0.85, 0.76], rot: [0.1, 0.5, -0.15] });
  B.box(0, [-0.009, 0.152, -0.006], [0.012, 0.042, 0.0025], { region: WR.RAG, color: [0.85, 0.8, 0.7], rot: [-0.1, -0.6, 0.2] });
  P.meta.flame = new THREE.Vector3(0.008, 0.215, 0.005);
}

function buildPipebomb(P) {
  const hi = P.hi;
  const B = P.get('body');
  latheY(B, [[0, -0.075], [0.021, -0.075], [0.021, 0.075], [0, 0.075]], 0, 0, { ...M.rust, rs: R(hi, 12, 8), sharp: true });
  for (const s of [-1, 1]) {
    const y0 = s < 0 ? -0.098 : 0.072, y1 = s < 0 ? -0.072 : 0.098;
    latheY(B, [[0, y0], [0.026, y0], [0.027, y0 + 0.003], [0.027, y1 - 0.003], [0.026, y1], [0, y1]], 0, 0, { ...M.gun, rs: 6, sharp: true });
  }
  latheY(B, [[0, -0.028], [0.0222, -0.028], [0.0222, 0.026], [0, 0.026]], 0, 0, { ...M.tapeGrey, rs: R(hi, 12, 8), sharp: true });
  if (hi) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * PI * 2 + 0.3;
      B.seg(0, [Math.cos(a) * 0.0232, -0.05, Math.sin(a) * 0.0232], [Math.cos(a) * 0.0232, 0.045, Math.sin(a) * 0.0232], 0.0017, 0.0017, { ...M.steel, rs: 4, hs: 1 });
    }
  }
  B.tube(0, [[0, 0.098, 0], [0.002, 0.118, 0], [0.012, 0.132, 0.004], [0.025, 0.13, 0.012], [0.03, 0.12, 0.02]], 0.0022, 0.002, { region: WR.PLAIN, color: 0x2a2018, rs: 5, ts: R(hi, 10, 5) });
  P.meta.flame = new THREE.Vector3(0.03, 0.12, 0.02);
}

// road flare: red paper tube (long axis +Y), ignition button on top, black cap + wire stand on the tail
function buildFlare(P) {
  const hi = P.hi;
  const B = P.get('body');
  const rs = R(hi, 12, 7);
  latheY(B, [[0, -0.092], [0.0158, -0.092], [0.0166, -0.086], [0.0166, 0.098], [0.0158, 0.103], [0, 0.103]], 0, 0, { region: WR.PLAIN, color: 0xa81c12, mottle: 0.08, rs, sharp: true });
  // printed band + warning stripe
  latheY(B, [[0.0167, 0.004], [0.0169, 0.006], [0.0169, 0.05], [0.0167, 0.052]], 0, 0, { region: WR.PLAIN, color: 0xd8cfb0, mottle: 0.06, rs, sharp: true });
  latheY(B, [[0.0169, 0.018], [0.0171, 0.019], [0.0171, 0.03], [0.0169, 0.031]], 0, 0, { region: WR.PLAIN, color: 0xc89a18, mottle: 0.04, rs, sharp: true });
  // ignition compound on the striking end
  latheY(B, [[0, 0.102], [0.0142, 0.102], [0.0132, 0.112], [0.006, 0.116], [0, 0.116]], 0, 0, { region: WR.PLAIN, color: 0x2b1c12, mottle: 0.1, rs });
  // struck cap pushed onto the tail as a handle, ribbed
  latheY(B, [[0, -0.108], [0.0188, -0.108], [0.0194, -0.1], [0.0194, -0.058], [0.0178, -0.054], [0, -0.054]], 0, 0, { ...M.polyDark, rs, sharp: true });
  if (hi) for (let i = 0; i < 3; i++) { const y = -0.096 + i * 0.012; latheY(B, [[0.0194, y], [0.0202, y + 0.002], [0.0202, y + 0.005], [0.0194, y + 0.007]], 0, 0, { ...M.polyDark, rs, sharp: true }); }
  // wire stand
  for (const s of [-1, 1]) B.seg(0, [s * 0.006, -0.105, 0], [s * 0.022, -0.16, 0.006], 0.0012, 0.0012, { ...M.steel, rs: 4, hs: 1 });
  P.meta.flame = new THREE.Vector3(0, 0.12, 0);
}

const BUILDERS = {
  [ITEM.AK47]: buildAK,
  [ITEM.PISTOL]: buildPistol,
  [ITEM.SHOTGUN]: buildShotgun,
  [ITEM.HUNTING_RIFLE]: buildRifle,
  [ITEM.M4A1]: buildM4,
  [ITEM.MP5]: buildMP5,
  [ITEM.DB_SHOTGUN]: buildDoubleBarrel,
  [ITEM.KNIFE]: buildKnife,
  [ITEM.BAT]: buildBat,
  [ITEM.SPIKED_BAT]: buildSpikedBat,
  [ITEM.MACHETE]: buildMachete,
  [ITEM.HAMMER]: buildHammer,
  [ITEM.MOLOTOV]: buildMolotov,
  [ITEM.PIPEBOMB]: buildPipebomb,
  [ITEM.FLARE]: buildFlare,
};

function finishParts(P) {
  const out = {};
  for (const [name, mb] of P.map) {
    const rig = mb.build();
    const piv = P.pivots[name];
    if (piv) rig.geometry.translate(-piv.x, -piv.y, -piv.z);
    rig.geometry.computeBoundingSphere();
    out[name] = { geometry: rig.geometry, pivot: piv ? piv.clone() : new THREE.Vector3(), tris: rig.tris };
  }
  return out;
}

// ================================================================== world weapons
const worldCache = new Map();
function getWorldData(itemId) {
  let d = worldCache.get(itemId);
  if (d === undefined) {
    const fn = BUILDERS[itemId];
    if (!fn) {
      worldCache.set(itemId, null);
      return null;
    }
    const P = new PartSet(false, false);
    fn(P);
    const parts = finishParts(P);
    d = { geometry: parts.body.geometry, tris: parts.body.tris, meta: P.meta };
    worldCache.set(itemId, d);
  }
  return d;
}

/**
 * Third-person / pickup weapon model. Grip at origin, barrel/blade along -Z.
 * userData: { itemId, leftHand?: Vector3 (support-hand grip point), tris }
 * Guns have a child Object3D named 'muzzle'. Molotov/pipebomb have a child named 'flame'.
 */
export function createWorldWeapon(itemId) {
  const group = new THREE.Group();
  group.name = 'weapon';
  group.userData.itemId = itemId;
  const d = itemId ? getWorldData(itemId) : null;
  if (!d) return group;
  const mesh = new THREE.Mesh(d.geometry, getPropMaterial());
  mesh.name = 'weaponMesh';
  group.add(mesh);
  if (d.meta.muzzle) {
    const m = new THREE.Object3D();
    m.name = 'muzzle';
    m.position.copy(d.meta.muzzle);
    group.add(m);
  }
  if (d.meta.flame) {
    const f = new THREE.Object3D();
    f.name = 'flame';
    f.position.copy(d.meta.flame);
    group.add(f);
  }
  if (d.meta.leftHand) group.userData.leftHand = d.meta.leftHand.clone();
  group.userData.tris = d.tris;
  return group;
}

/** Triangle count of the cached world model (debug). */
export function worldWeaponTris(itemId) {
  const d = getWorldData(itemId);
  return d ? d.tris : 0;
}

// ================================================================== viewmodel data
const vmCache = new Map();
function getVMData(itemId) {
  let d = vmCache.get(itemId);
  if (d === undefined) {
    const fn = BUILDERS[itemId];
    if (!fn) {
      vmCache.set(itemId, null);
      return null;
    }
    const P = new PartSet(true, true);
    fn(P);
    const parts = finishParts(P);
    let tris = 0;
    for (const k in parts) tris += parts[k].tris;
    d = { parts, meta: P.meta, tris };
    vmCache.set(itemId, d);
  }
  return d;
}

// ------------------------------------------------------------------ hands & arms
// Hand local frame (right hand): wrist at origin, fingers along -Y, palm faces -X, thumb/index toward -Z.
// Grip tunnel (fist) axis = local Z. Left hand = mirror in X.
const HAND_POSES = {
  grip: { curl: [[1.25, 1.45, 0.9], [1.3, 1.5, 0.9], [1.35, 1.5, 0.9], [1.4, 1.45, 0.9]], spread: 0.0, thumb: [[-0.62, -0.52, -0.58], [-0.25, -0.95, -0.2]], center: [-0.034, -0.083, 0] },
  // pistol grip with the index finger on the trigger
  trigger: { curl: [[0.4, 1.0, 0.55], [1.3, 1.5, 0.9], [1.35, 1.5, 0.9], [1.4, 1.45, 0.9]], spread: 0.0, thumb: [[-0.6, -0.79, -0.09], [-0.1, -0.93, -0.34]], center: [-0.034, -0.083, 0] },
  // pistol support hand wrapped around the gun hand, thumb forward along the frame
  cup: { curl: [[1.05, 1.2, 0.8], [1.1, 1.25, 0.8], [1.15, 1.25, 0.8], [1.2, 1.2, 0.8]], spread: 0.0, thumb: [[-0.22, -0.77, -0.6], [-0.16, -0.8, -0.57]], center: [-0.03, -0.085, 0] },
  support: { curl: [[0.95, 1.1, 0.7], [1.0, 1.15, 0.7], [1.05, 1.15, 0.7], [1.1, 1.1, 0.7]], spread: 0.02, thumb: [[-0.7, -0.45, -0.55], [-0.4, -0.9, 0.1]], center: [-0.042, -0.088, 0] },
  pinch: { curl: [[0.9, 1.2, 0.8], [1.1, 1.4, 0.9], [1.25, 1.45, 0.9], [1.35, 1.4, 0.9]], spread: 0.0, thumb: [[-0.55, -0.6, -0.55], [-0.2, -0.85, 0.45]], center: [-0.03, -0.1, -0.02] },
  open: { curl: [[0.25, 0.3, 0.2], [0.2, 0.3, 0.2], [0.25, 0.3, 0.2], [0.3, 0.35, 0.25]], spread: 0.08, thumb: [[-0.4, -0.55, -0.73], [-0.1, -0.8, -0.6]], center: [-0.035, -0.095, 0] },
  claw: { curl: [[0.45, 0.55, 0.45], [0.4, 0.55, 0.45], [0.45, 0.6, 0.45], [0.55, 0.65, 0.5]], spread: 0.2, thumb: [[-0.55, -0.5, -0.67], [-0.35, -0.85, -0.3]], center: [-0.035, -0.11, 0] },
};
// Knuckles sit on an arc (middle finger furthest out, pinky set back). r = proximal phalanx radius.
const FINGERS = [
  { z: -0.0285, y: -0.0875, L: [0.043, 0.026, 0.021], r: 0.0094 },
  { z: -0.0095, y: -0.089, L: [0.047, 0.029, 0.022], r: 0.0097 },
  { z: 0.0095, y: -0.0875, L: [0.044, 0.027, 0.021], r: 0.0092 },
  { z: 0.0275, y: -0.0845, L: [0.035, 0.021, 0.018], r: 0.0081 },
];
const PHALANX_R = [1.0, 0.9, 0.82];
// full-finger tactical gloves (tan synthetic, darker rubber knuckle guard / pads / strap) and an olive jacket
const HAND_MAT = {
  glove: { region: WR.GLOVE, color: [1.3, 1.12, 0.88], mottle: 0.06 },
  finger: { region: WR.GLOVE, color: [1.25, 1.08, 0.85], mottle: 0.05 },
  trim: { region: WR.GLOVE, color: [0.5, 0.45, 0.4], mottle: 0.04 },
  sleeve: { region: WR.SLEEVE, color: [0.34, 0.36, 0.26], mottle: 0.1 },
  hem: { region: WR.SLEEVE, color: [0.27, 0.29, 0.2], mottle: 0.06 },
};
const THUMB_MCP = [-0.012, -0.03, -0.034]; // thumb poses rotate about this joint

const sstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const _hx = new THREE.Vector3();
const _hy = new THREE.Vector3();
const _hz = new THREE.Vector3();
const _hm = new THREE.Matrix4();

/**
 * Capsule from a to b (radius r0 -> r1) with smooth hemispherical caps and analytic normals.
 * The cross-section X axis (scaled by o.sx) is aligned with n, e.g. the back of a finger.
 * o.cap0 / o.cap1: rings in the start / end cap (0 = open end). o.prof(t): radius multiplier along the length.
 */
function limb(mb, a, b, r0, r1, n, o = {}) {
  _hy.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = _hy.length();
  _hy.divideScalar(len);
  _hx.set(n[0], n[1], n[2]);
  _hx.addScaledVector(_hy, -_hx.dot(_hy)).normalize();
  _hz.crossVectors(_hx, _hy);
  const cr0 = o.cap0 ?? 2, cr1 = o.cap1 ?? 2, cs = o.capScale ?? 1, hs = o.hs ?? 2;
  const pts = [];
  if (cr0 > 0) {
    for (let i = 0; i < cr0; i++) {
      const f = (i / cr0 - 1) * (PI / 2);
      pts.push(new THREE.Vector2(Math.cos(f) * r0, Math.sin(f) * r0 * cs));
    }
  }
  for (let i = 0; i <= hs; i++) {
    const t = i / hs;
    pts.push(new THREE.Vector2((r0 + (r1 - r0) * t) * (o.prof ? o.prof(t) : 1), len * t));
  }
  if (cr1 > 0) {
    for (let i = 1; i <= cr1; i++) {
      const f = (i / cr1) * (PI / 2);
      pts.push(new THREE.Vector2(Math.cos(f) * r1, len + Math.sin(f) * r1 * cs));
    }
  }
  const geo = new THREE.LatheGeometry(pts, o.rs || 10);
  if (o.sx || o.sz) geo.scale(o.sx || 1, 1, o.sz || 1);
  geo.applyMatrix4(_hm.makeBasis(_hx, _hy, _hz).setPosition(a[0], a[1], a[2]));
  return mb.geom(0, geo, { ...o, keepNormals: true });
}

/** Closed tube: fn(v, u, out) gives the surface point for v in [0,1] (along) and u in [0,1) (around). Ends should pinch to a point. */
function loft(mb, nv, nu, fn, o = {}) {
  const row = nu + 1;
  const pos = new Float32Array((nv + 1) * row * 3), uv = new Float32Array((nv + 1) * row * 2), idx = [];
  const P = new THREE.Vector3();
  for (let i = 0, k = 0; i <= nv; i++) {
    for (let j = 0; j <= nu; j++, k++) {
      fn(i / nv, (j % nu) / nu, P);
      pos[k * 3] = P.x;
      pos[k * 3 + 1] = P.y;
      pos[k * 3 + 2] = P.z;
      uv[k * 2] = j / nu;
      uv[k * 2 + 1] = i / nv;
    }
  }
  for (let i = 0; i < nv; i++) {
    for (let j = 0; j < nu; j++) {
      const a = i * row + j, c = a + row;
      idx.push(a, a + 1, c, a + 1, c + 1, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // weld the u seam, and give each pinched end ring one averaged normal
  const nr = geo.attributes.normal;
  for (let i = 0; i <= nv; i++) {
    const a = i * row, b = a + nu;
    _hx.fromBufferAttribute(nr, a).add(_hy.fromBufferAttribute(nr, b)).normalize();
    nr.setXYZ(a, _hx.x, _hx.y, _hx.z);
    nr.setXYZ(b, _hx.x, _hx.y, _hx.z);
  }
  for (const i of [0, nv]) {
    _hx.set(0, 0, 0);
    for (let j = 0; j < nu; j++) _hx.add(_hy.fromBufferAttribute(nr, i * row + j));
    _hx.normalize();
    for (let j = 0; j <= nu; j++) nr.setXYZ(i * row + j, _hx.x, _hx.y, _hx.z);
  }
  return mb.geom(0, geo, { ...o, keepNormals: true });
}

/**
 * Palm/back of the hand as a loft along -Y (wrist -> knuckles). Superellipse cross-sections: rounder
 * across the back, flatter on the palm, with thenar/hypothenar pads near the heel. Both ends are domed.
 */
function palmSurface(S) {
  return (v, u, out) => {
    let e = 1;
    if (v < S.d0) e = Math.sqrt(Math.max(0, 1 - ((S.d0 - v) / S.d0) ** 2));
    else if (v > 1 - S.d1) e = Math.sqrt(Math.max(0, 1 - ((v - 1 + S.d1) / S.d1) ** 2));
    const hz = S.hz0 + (S.hz1 - S.hz0) * sstep(0, 0.75, v);
    const th = u * 2 * PI, c = Math.cos(th), s = Math.sin(th);
    const back = c >= 0;
    const k = back ? 2 / 2.3 : 2 / 3.4;
    const ux = Math.sign(c) * Math.abs(c) ** k, uz = Math.sign(s) * Math.abs(s) ** k;
    let depth;
    if (back) depth = S.xd0 + (S.xd1 - S.xd0) * v;
    else depth = S.xp0 + (S.xp1 - S.xp0) * v + (Math.max(0, -uz) * S.thenar + Math.max(0, uz) * S.hypo) * (1 - v) ** 0.7;
    out.set(S.cx + ux * depth * e, S.y0 + (S.y1 - S.y0) * v, S.cz + uz * hz * e);
  };
}

// cheap baked shading for hand parts: darker on the side facing away from n (palm side), creases near the joints,
// and (digits) contact shadow on the flanks that face the neighbouring fingers
function handShade(n, joints, flank = 0) {
  return (P, N, C) => {
    const back = N.x * n[0] + N.y * n[1] + N.z * n[2];
    C.multiplyScalar(1 - 0.2 * Math.max(0, -back) - flank * N.z * N.z);
    if (joints) {
      const [a, d, len] = joints;
      const t = ((P.x - a[0]) * d[0] + (P.y - a[1]) * d[1] + (P.z - a[2]) * d[2]) / len;
      const k = Math.max(1 - sstep(-0.05, 0.2, t), sstep(0.8, 1.05, t)) * Math.max(0, back);
      C.multiplyScalar(1 - 0.14 * k);
      C.r *= 1 + 0.06 * k;
    }
  };
}

const handGeoCache = new Map();
function getHandGeo(poseName, style, side) {
  const key = poseName + ':' + style + ':' + side;
  let g = handGeoCache.get(key);
  if (g) return g;
  const pose = HAND_POSES[poseName];
  const claw = style === 'claw';
  const mb = new MeshBuilder({ skinned: false, atlas: claw ? 'char' : 'weapon' });
  mb.aoStrength = 0; // handShade bakes hand-space shading instead
  const skin = claw ? { region: CR.SKIN, color: [0.46, 0.5, 0.4], mottle: 0.25 } : HAND_MAT.finger; // digits
  const { glove, trim } = HAND_MAT;
  const bone = { region: CR.BONE, color: [0.12, 0.1, 0.09] };
  const palmMat = claw ? skin : glove;
  const BACK = [1, 0, 0];
  const shade = handShade(BACK);

  // palm + back of the hand (a zombie's is thinner, with the tendons showing)
  loft(
    mb,
    12,
    20,
    palmSurface({
      y0: 0.004, y1: -0.097, d0: 0.12, d1: 0.16, cx: -0.002, cz: -0.001,
      hz0: 0.026, hz1: claw ? 0.038 : 0.0405,
      xd0: claw ? 0.011 : 0.0135, xd1: claw ? 0.0085 : 0.0105,
      xp0: claw ? 0.013 : 0.016, xp1: claw ? 0.011 : 0.0135,
      thenar: claw ? 0.003 : 0.006, hypo: claw ? 0.0015 : 0.0035,
    }),
    { ...palmMat, tint: shade }
  );
  // knuckles (metacarpal heads)
  for (const F of FINGERS) {
    if (claw) mb.ellip(0, [0.001, F.y + 0.001, F.z], [0.0086, 0.0086, 0.009], { ...skin, color: [0.54, 0.57, 0.47], ws: 8, hs: 6, tint: shade });
    else mb.ellip(0, [0.003, F.y + 0.001, F.z], [0.0098, 0.0092, 0.0094], { ...palmMat, ws: 8, hs: 5, tint: shade });
  }
  // wrist: a rounded mass around the joint that keeps it filled however far the hand bends
  // (the sleeve / glove cuff belongs to the forearm, see getArmGeos)
  mb.ellip(0, [-0.001, -0.003, 0], claw ? [0.0185, 0.02, 0.0235] : [0.021, 0.021, 0.0275], { ...palmMat, ws: 14, hs: 8, tint: shade });
  if (claw) {
    // tendons fanning out to the knuckles
    for (const F of FINGERS) {
      mb.seg(0, [0.009, -0.012, F.z * 0.45], [0.0105, F.y + 0.008, F.z * 0.95], 0.0026, 0.0022, { ...skin, color: [0.52, 0.56, 0.46], rs: 5, hs: 1, caps: 1, capScale: 0.5, tint: shade });
    }
  } else {
    // padded knuckle guard
    mb.box(0, [0.0135, -0.0835, -0.001], [0.0062, 0.015, 0.071], {
      ...trim,
      round: 0.65,
      seg: 3,
      shape: (p) => {
        const w = p.z / 0.0355;
        p.x -= w * w * 0.0035;
        p.y += w * w * (w > 0 ? 0.004 : 0.0015);
      },
      tint: shade,
    });
  }

  // fingers: three phalanges each, curled toward the palm (-X) by the pose
  const rnd = mulberry32(side > 0 ? 11 : 12);
  for (let i = 0; i < 4; i++) {
    const F = FINGERS[i];
    const cz = pose.curl[i];
    const spread = (i - 1.5) * pose.spread;
    const L = claw ? F.L.map((l) => l * 1.22) : F.L;
    let p = [0.0, F.y, F.z];
    let ang = 0;
    for (let j = 0; j < 3; j++) {
      ang += cz[j] + (claw ? (rnd() - 0.5) * 0.15 : 0);
      const dl = Math.sqrt(1 + spread * spread);
      const d = [-Math.sin(ang) / dl, -Math.cos(ang) / dl, spread / dl];
      const n = [Math.cos(ang), -Math.sin(ang), 0]; // back of this phalanx
      const q = [p[0] + d[0] * L[j], p[1] + d[1] * L[j], p[2] + d[2] * L[j]];
      const r0 = F.r * PHALANX_R[j] * (claw ? 0.8 : 1.06);
      const r1 = r0 * (j === 2 ? 0.88 : 0.93);
      limb(mb, p, q, r0, r1, n, {
        ...skin,
        rs: 8,
        hs: 2,
        cap1: j === 2 ? 3 : 2,
        sx: j === 2 ? 0.84 : 0.9,
        prof: (t) => 1 - (claw ? 0.16 : 0.04) * Math.sin(PI * t), // joints stand out
        tint: handShade(n, [p, d, L[j]], claw ? 0 : 0.3),
      });
      if (j === 0 && !claw) {
        // padded strip across the back of the first knuckle
        const c = [p[0] + d[0] * L[0] * 0.55 + n[0] * r0 * 0.72, p[1] + d[1] * L[0] * 0.55 + n[1] * r0 * 0.72, p[2] + d[2] * L[0] * 0.55];
        limb(mb, [c[0] - d[0] * 0.009, c[1] - d[1] * 0.009, c[2] - d[2] * 0.009], [c[0] + d[0] * 0.009, c[1] + d[1] * 0.009, c[2] + d[2] * 0.009], r0 * 0.62, r0 * 0.6, n, { ...trim, rs: 6, hs: 1, sx: 0.55, capScale: 0.6, tint: handShade(n) });
      }
      if (j === 2) {
        if (claw) {
          // hooked claw growing out of the nail bed, curling toward the palm side
          const b0 = [p[0] + d[0] * L[2] * 0.45 + n[0] * r0 * 0.45, p[1] + d[1] * L[2] * 0.45 + n[1] * r0 * 0.45, p[2] + d[2] * L[2] * 0.45];
          const mid = [q[0] + d[0] * 0.03 + n[0] * 0.001, q[1] + d[1] * 0.03 + n[1] * 0.001, q[2] + d[2] * 0.03];
          const tip = [mid[0] + d[0] * 0.024 - n[0] * 0.016, mid[1] + d[1] * 0.024 - n[1] * 0.016, mid[2] + d[2] * 0.024];
          limb(mb, b0, mid, 0.0062, 0.0046, n, { ...bone, rs: 6, hs: 1, sx: 0.6, capScale: 0.4 });
          mb.spike(0, mid, tip, 0.0045, { ...bone, color: [0.1, 0.085, 0.075], rs: 6 });
        }
      }
      p = q;
    }
  }

  // thumb: metacarpal (with the thenar pad) from the heel of the hand to THUMB_MCP, then two phalanges
  {
    const c0 = [-0.004, -0.004, -0.019];
    const tb = [0.5, 0, -0.85];
    limb(mb, c0, THUMB_MCP, 0.0145, 0.0124, tb, { ...palmMat, rs: 10, hs: 1, sx: 0.85, tint: shade });
    mb.ellip(0, [-0.0145, -0.029, -0.017], [0.0095, 0.021, 0.0125], { ...palmMat, ws: 10, hs: 6, rot: [0.52, 0, 0], tint: shade });
    const L = claw ? [0.04, 0.034] : [0.036, 0.03];
    const R = [
      [0.0118, 0.0108],
      [0.0112, 0.0096],
    ];
    let p = THUMB_MCP;
    for (let j = 0; j < 2; j++) {
      const t = pose.thumb[j];
      const l = Math.hypot(t[0], t[1], t[2]);
      const d = [t[0] / l, t[1] / l, t[2] / l];
      const q = [p[0] + d[0] * L[j], p[1] + d[1] * L[j], p[2] + d[2] * L[j]];
      const r0 = R[j][0] * (claw ? 0.82 : 1.05), r1 = R[j][1] * (claw ? 0.82 : 1.05);
      limb(mb, p, q, r0, r1, tb, { ...skin, rs: 8, hs: 2, cap1: j === 1 ? 3 : 2, sx: j === 1 ? 0.84 : 0.9, prof: (s) => 1 - (claw ? 0.14 : 0.04) * Math.sin(PI * s), tint: handShade(tb, [p, d, L[j]]) });
      if (j === 1 && claw) mb.spike(0, q, [q[0] + d[0] * 0.03, q[1] + d[1] * 0.03, q[2] + d[2] * 0.03], 0.0065, { ...bone, color: [0.1, 0.085, 0.075], rs: 6 });
      p = q;
    }
  }
  if (claw) {
    mb.blood([-0.02, -0.1, 0.0], 0.05, 0.9);
    mb.blood([0.01, -0.03, 0.02], 0.03, 0.6);
  }
  g = mb.build().geometry;
  if (side < 0) mirrorX(g);
  handGeoCache.set(key, g);
  return g;
}

const ARM_L1 = 0.34, ARM_L2 = 0.3;
const armGeoCache = new Map();
function getArmGeos(style, side) {
  const key = style + ':' + side;
  let g = armGeoCache.get(key);
  if (g) return g;
  const claw = style === 'claw';
  const sleeve = claw ? { region: CR.CLOTH, color: [0.24, 0.23, 0.2], mottle: 0.2 } : HAND_MAT.sleeve;
  const hem = HAND_MAT.hem;
  const skin = { region: CR.SKIN, color: [0.5, 0.54, 0.44], mottle: 0.25 };
  // upper arm (shoulder local, along -Y)
  const up = new MeshBuilder({ skinned: false, atlas: claw ? 'char' : 'weapon' });
  up.seg(0, [0, 0.05, 0], [0, -ARM_L1 - 0.02, 0], 0.06, 0.05, { ...sleeve, rs: 10, hs: 3, caps: 2, noise: 0.004, nf: 25, tear: claw ? { amt: 0.36, f: 30, seed: 3 } : null });
  if (claw) up.seg(0, [0, 0.04, 0], [0, -ARM_L1, 0], 0.042, 0.036, { ...skin, rs: 8, hs: 2, caps: 1 });
  // forearm (elbow local)
  const fo = new MeshBuilder({ skinned: false, atlas: claw ? 'char' : 'weapon' });
  if (!claw) {
    // jacket sleeve tapering to a turned-back hem; the glove's gauntlet runs from under it to the wrist
    const W = -ARM_L2;
    fo.seg(0, [0, 0.03, 0], [0, W + 0.1, 0], 0.047, 0.041, { ...sleeve, rs: 14, hs: 4, caps: 2, capScale: 0.3, noise: 0.0015, nf: 30 });
    limb(fo, [0, W + 0.112, 0], [0, W + 0.094, 0], 0.0425, 0.0418, [1, 0, 0], { ...hem, rs: 14, hs: 1, cap0: 1, cap1: 2, capScale: 0.45 });
    const shade = handShade([1, 0, 0]);
    // gauntlet (X = back of the hand, see VMArm.orient); its rounded end tucks around the hand's wrist
    limb(fo, [0, W + 0.1, 0], [0, W - 0.002, 0], 0.0335, 0.0282, [1, 0, 0], { ...HAND_MAT.glove, rs: 14, hs: 3, sx: 0.86, sz: 1.12, cap0: 0, cap1: 3, capScale: 0.25, ao: false, tint: shade, prof: (t) => 1 + 0.03 * Math.sin(PI * t) });
    // velcro strap and tab around the cuff
    limb(fo, [0, W + 0.047, 0], [0, W + 0.027, 0], 0.0322, 0.0305, [1, 0, 0], { ...HAND_MAT.trim, rs: 14, hs: 1, sx: 0.87, sz: 1.12, cap0: 1, cap1: 1, capScale: 0.25, ao: false, tint: shade });
    fo.box(0, [0.0285, W + 0.037, 0.004], [0.0045, 0.02, 0.03], {
      ...HAND_MAT.trim,
      round: 0.5,
      seg: 2,
      shape: (p) => {
        p.x -= (p.z / 0.015) ** 2 * 0.0028;
      },
      ao: false,
      tint: shade,
    });
  } else {
    // torn sleeve near the elbow, gaunt pale forearm with tendons
    fo.seg(0, [0, 0.03, 0], [0, -0.13, 0], 0.05, 0.046, { ...sleeve, rs: 10, hs: 3, caps: 0, noise: 0.006, nf: 30, tear: { amt: 0.42, f: 40, seed: 5, fn: (x, y) => y < -0.09 && fbm3(x * 80, 0, 0, 1, 3) > 0.5 } });
    fo.seg(0, [0, 0.03, 0], [0, -ARM_L2 + 0.004, 0], 0.036, 0.023, { ...skin, rs: 8, hs: 4, caps: 1, sx: 0.88, sz: 1.1, noise: 0.003, nf: 60 });
    for (const s of [-1, 1]) fo.seg(0, [s * 0.012, -0.05, -0.02], [s * 0.01, -ARM_L2 + 0.03, -0.012], 0.005, 0.004, { ...skin, color: [0.5, 0.55, 0.45], rs: 4, hs: 1 });
    fo.blood([0, -0.2, -0.03], 0.06, 1);
    fo.blood([0.03, -0.08, 0], 0.04, 0.8);
  }
  const ug = up.build().geometry, fg = fo.build().geometry;
  if (side < 0) {
    mirrorX(ug);
    mirrorX(fg);
  }
  g = { upper: ug, fore: fg };
  armGeoCache.set(key, g);
  return g;
}

class VMArm {
  constructor(side) {
    this.side = side;
    this.shoulder = new THREE.Object3D();
    this.elbow = new THREE.Object3D();
    this.wrist = new THREE.Object3D();
    this.elbow.position.set(0, -ARM_L1, 0);
    this.wrist.position.set(0, -ARM_L2, 0);
    this.shoulder.add(this.elbow);
    this.elbow.add(this.wrist);
    this.sets = {};
    for (const style of ['normal', 'claw']) {
      const mat = style === 'claw' ? getViewCharMaterial() : getViewArmMaterial();
      const ag = getArmGeos(style, side);
      const upper = new THREE.Mesh(ag.upper, mat);
      const fore = new THREE.Mesh(ag.fore, mat);
      this.shoulder.add(upper);
      this.elbow.add(fore);
      const hands = {};
      const poses = style === 'claw' ? ['claw', 'open'] : ['grip', 'trigger', 'cup', 'support', 'pinch', 'open'];
      for (const p of poses) {
        const h = new THREE.Mesh(getHandGeo(p, style === 'claw' ? 'claw' : 'glove', side), mat);
        h.visible = false;
        this.wrist.add(h);
        hands[p] = h;
      }
      this.sets[style] = { upper, fore, hands, meshes: [upper, fore, ...Object.values(hands)] };
    }
    for (const m of [...this.sets.normal.meshes, ...this.sets.claw.meshes]) {
      m.frustumCulled = false;
      m.renderOrder = 1;
    }
    this.style = 'normal';
    this.pose = 'grip';
    this.visible = true;
    this.applyVis();
  }
  setStyle(style) {
    if (style !== this.style) {
      this.style = style;
      this.applyVis();
    }
  }
  setPose(p) {
    if (p !== this.pose) {
      this.pose = p;
      this.applyVis();
    }
  }
  setVisible(v) {
    if (v !== this.visible) {
      this.visible = v;
      this.applyVis();
    }
  }
  applyVis() {
    for (const style in this.sets) {
      const s = this.sets[style];
      const on = this.visible && style === this.style;
      s.upper.visible = on;
      s.fore.visible = on;
      for (const p in s.hands) s.hands[p].visible = on && p === this.pose;
    }
    if (this.style === 'claw' && !this.sets.claw.hands[this.pose] && this.visible) this.sets.claw.hands.claw.visible = true;
  }
  gripCenter(out) {
    const pose = HAND_POSES[this.style === 'claw' ? (this.pose === 'open' ? 'open' : 'claw') : this.pose] || HAND_POSES.grip;
    return out.set(pose.center[0] * this.side, pose.center[1], pose.center[2]);
  }
  /**
   * Apply solved upper-arm (qU, in shoulder-parent space) and elbow (qL) rotations plus the hand orientation.
   * The forearm rolls about its own axis with the hand (pronation), so the wrist only bends and the oval
   * wrist, glove cuff and forearm stay lined up.
   */
  orient(qU, qL, handQ) {
    this.shoulder.quaternion.copy(qU);
    _armW.copy(qU).multiply(qL).invert().multiply(handQ); // wrist relative to the unrolled forearm
    const l = Math.hypot(_armW.y, _armW.w);
    if (l > 1e-6) _armT.set(0, _armW.y / l, 0, _armW.w / l);
    else _armT.identity();
    this.elbow.quaternion.copy(qL).multiply(_armT);
    this.wrist.quaternion.copy(_armT.invert().multiply(_armW));
  }
}
const _armW = new THREE.Quaternion();
const _armT = new THREE.Quaternion();

// ================================================================== viewmodel configuration
const Q = (x, y, z, order = 'YXZ') => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, order));
// right-hand orientation (in weapon space) for gun grips: Rx(pi/2 - tilt)
const gunGrip = (tilt, yaw = 0, roll = 0) => new THREE.Quaternion().setFromEuler(new THREE.Euler(PI / 2 - tilt, yaw, roll, 'YXZ'));
/**
 * Hand orientation (weapon space) from where the fingers point and which way the palm faces.
 * side: 1 = right hand, -1 = left (mirrored geometry, palm = local +X).
 */
function handQ(side, finger, palm) {
  const y = new THREE.Vector3(-finger[0], -finger[1], -finger[2]).normalize();
  const x = new THREE.Vector3(palm[0], palm[1], palm[2]).multiplyScalar(-side);
  x.addScaledVector(y, -x.dot(y)).normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}
// left support under a handguard: hand X -> weapon Y (palm up), fingers (-Y) -> weapon +X, tunnel Z along barrel
const supportGrip = (roll, yaw, pitch = 0) => {
  // mirrored left hand (palm = +X_hand): X_hand -> weapon +Y (palm up), -Y_hand (fingers) -> weapon +X, Z_hand -> weapon +Z
  const base = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), PI / 2);
  const tw = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
  return tw.multiply(base);
};

// kinds: rifle | shotgun | pistol | melee | throw
// chargeFire: false = the charging handle stays put while firing; chargeQ: left-hand Euler on the charging handle;
// chargeTravel: how far the handle is pulled on reload (0 = the hand just slaps meta.chargeKnob, e.g. a bolt catch);
// breakAction: break-open shotgun (barrels part hinges down to reload)
const VM = {
  [ITEM.AK47]: {
    kind: 'rifle', hip: [0.19, -0.19, -0.28, 0.03, 0.17, 0.0], ads: 0.2, adsZ: -0.2,
    rGrip: { p: [0, 0, 0], q: gunGrip(0.15) }, lGrip: { q: supportGrip(-0.4, 0.6, 0.0), pose: 'support' },
    recoil: { z: 0.028, rx: 0.045, ry: 0.01 }, sprint: [-0.03, -0.015, 0.0, -0.22, 0.5, 0.35],
  },
  [ITEM.SHOTGUN]: {
    kind: 'shotgun', hip: [0.2, -0.19, -0.2, 0.03, 0.17, 0.0], ads: 0.22, adsZ: -0.95, adsPitch: 0.1,
    rPose: 'grip', rGrip: { p: [0, 0, 0], q: gunGrip(0.75) }, lGrip: { q: supportGrip(-0.4, 0.6, 0.0), pose: 'support' },
    recoil: { z: 0.06, rx: 0.12, ry: 0.02 }, sprint: [-0.03, -0.015, 0.0, -0.22, 0.5, 0.35],
  },
  [ITEM.HUNTING_RIFLE]: {
    kind: 'rifle', bolt: true, scope: true, hip: [0.19, -0.205, -0.3, 0.03, 0.17, 0.0], ads: 0.22, adsZ: -0.085,
    rGrip: { p: [0, 0, 0], q: gunGrip(0.35) }, lGrip: { q: supportGrip(-0.4, 0.6, 0.0), pose: 'support' },
    recoil: { z: 0.05, rx: 0.1, ry: 0.015 }, sprint: [-0.03, -0.015, 0.0, -0.22, 0.5, 0.35],
  },
  [ITEM.M4A1]: {
    kind: 'rifle', hip: [0.18, -0.185, -0.27, 0.03, 0.17, 0.0], ads: 0.2, adsZ: -0.16, chargeFire: false, chargeTravel: 0, chargeQ: [1.3, 0.1, 0],
    rGrip: { p: [0, 0, 0], q: gunGrip(0.15) }, lGrip: { q: supportGrip(-0.4, 0.6, 0.0), pose: 'support' },
    recoil: { z: 0.022, rx: 0.035, ry: 0.008 }, sprint: [-0.03, -0.015, 0.0, -0.22, 0.5, 0.35],
  },
  [ITEM.MP5]: {
    kind: 'rifle', hip: [0.17, -0.18, -0.3, 0.03, 0.15, 0.0], ads: 0.2, adsZ: -0.2, chargeFire: false, chargeQ: [1.6, -0.3, 0.4],
    rGrip: { p: [0, 0, 0], q: gunGrip(0.2) }, lGrip: { q: supportGrip(-0.4, 0.6, 0.0), pose: 'support' },
    recoil: { z: 0.016, rx: 0.026, ry: 0.008 }, sprint: [-0.03, -0.015, 0.0, -0.22, 0.5, 0.35],
  },
  [ITEM.DB_SHOTGUN]: {
    kind: 'shotgun', breakAction: true, hip: [0.2, -0.19, -0.2, 0.03, 0.17, 0.0], ads: 0.22, adsZ: -0.9, adsPitch: 0.1,
    rPose: 'grip', rGrip: { p: [0, 0, 0], q: gunGrip(0.75) }, lGrip: { q: supportGrip(-0.4, 0.6, 0.0), pose: 'support' },
    recoil: { z: 0.07, rx: 0.14, ry: 0.025 }, sprint: [-0.03, -0.015, 0.0, -0.22, 0.5, 0.35],
  },
  [ITEM.PISTOL]: {
    // CS-style: low on the right, angled in toward the crosshair; index finger on the trigger, the left hand
    // cupping the right from below with its fingers wrapped over the front of the grip
    kind: 'pistol', hip: [0.11, -0.158, -0.29, 0.09, 0.18, -0.06], ads: 0.2, adsZ: -0.42,
    rPose: 'trigger', rGrip: { p: [0, -0.004, -0.006], q: handQ(1, [0, -0.36, -0.93], [-1, 0, 0]) },
    lGrip: { p: [0, -0.028, -0.03], q: handQ(-1, [0.05, -0.55, -0.83], [0.92, 0.3, 0.15]), pose: 'cup' },
    poleR: new THREE.Vector3(0.5, -1, 0.2), poleL: new THREE.Vector3(-0.6, -0.9, 0.2), // elbows down
    recoil: { z: 0.03, rx: 0.1, ry: 0.01 }, sprint: [0.0, -0.015, 0.03, -0.3, 0.22, 0.28],
  },
  [ITEM.KNIFE]: { kind: 'melee', hip: [0.15, -0.16, -0.3, 0.55, 0.35, -0.35], rGrip: { p: [0, 0, 0], q: Q(0, 0, 0) }, sprint: [0.02, -0.05, 0.05, -0.3, 0.1, 0] },
  [ITEM.BAT]: { kind: 'melee', twoHand: true, hip: [0.17, -0.2, -0.3, 1.2, 0.3, 0.15], rGrip: { p: [0, 0, 0], q: Q(0, 0, 0) }, lGrip: { q: Q(0, 0, 0), pose: 'grip' }, sprint: [0.05, -0.05, 0.08, -0.4, 0.1, 0] },
  [ITEM.SPIKED_BAT]: { kind: 'melee', twoHand: true, hip: [0.17, -0.2, -0.3, 1.2, 0.3, 0.15], rGrip: { p: [0, 0, 0], q: Q(0, 0, 0) }, lGrip: { q: Q(0, 0, 0), pose: 'grip' }, sprint: [0.05, -0.05, 0.08, -0.4, 0.1, 0] },
  [ITEM.MACHETE]: { kind: 'melee', hip: [0.16, -0.19, -0.3, 0.95, 0.3, 0.1], rGrip: { p: [0, 0, 0], q: Q(0, 0, 0) }, sprint: [0.03, -0.05, 0.06, -0.4, 0.1, 0] },
  [ITEM.HAMMER]: { kind: 'melee', hip: [0.16, -0.19, -0.3, 0.85, 0.25, 0.0], rGrip: { p: [0, 0, 0], q: Q(0, 0, 0) }, sprint: [0.03, -0.05, 0.06, -0.4, 0.1, 0] },
  [ITEM.MOLOTOV]: { kind: 'throw', hip: [0.17, -0.235, -0.38, 0.12, 0.2, -0.2], rGrip: { p: [0, 0, 0], q: gunGrip(0.0) }, sprint: [0.0, -0.08, 0.05, -0.3, 0.1, 0] },
  [ITEM.PIPEBOMB]: { kind: 'throw', hip: [0.16, -0.2, -0.34, 0.1, 0.2, -0.2], rGrip: { p: [0, 0, 0], q: gunGrip(0.0) }, sprint: [0.0, -0.08, 0.05, -0.3, 0.1, 0] },
  [ITEM.FLARE]: { kind: 'throw', hip: [0.16, -0.2, -0.35, 0.12, 0.2, -0.25], rGrip: { p: [0, 0, 0], q: gunGrip(0.0) }, sprint: [0.0, -0.08, 0.05, -0.3, 0.1, 0] },
};

// melee swing keyframes: [t, px,py,pz, rx,ry,rz, ease] (absolute weapon pose, Euler YXZ); ease 0 smooth,1 linear,2 out,3 in
const SWINGS = {
  knife: { dur: 0.36, keys: [[0.28, 0.2, 0.0, -0.28, 0.9, -0.4, -0.9, 0], [0.55, -0.12, -0.2, -0.4, 0.2, 0.9, 0.9, 1], [0.7, -0.14, -0.24, -0.36, 0.1, 1.0, 1.0, 2]] },
  stab: { dur: 0.62, keys: [[0.3, 0.16, -0.17, -0.2, 0.3, 0.35, -1.3, 0], [0.48, 0.05, -0.11, -0.5, 0.15, 0.35, -1.4, 2], [0.66, 0.05, -0.11, -0.48, 0.15, 0.35, -1.4, 0]] },
  bat: { dur: 0.62, keys: [[0.3, 0.26, -0.13, -0.34, 0.5, -1.7, 0.4, 0], [0.47, 0.08, -0.19, -0.45, 0.1, 0.5, 0.1, 1], [0.64, -0.2, -0.17, -0.36, 0.2, 1.8, -0.3, 2]] },
  machete: { dur: 0.5, keys: [[0.32, 0.21, 0.06, -0.3, 1.6, -0.3, -0.4, 0], [0.52, -0.02, -0.15, -0.42, -0.3, 0.9, 0.6, 1], [0.66, -0.12, -0.23, -0.36, -0.8, 1.1, 0.8, 2]] },
  hammer: { dur: 0.5, keys: [[0.32, 0.2, 0.05, -0.3, 1.8, 0.1, 0.0, 0], [0.52, 0.06, -0.16, -0.45, -0.2, 0.2, 0.0, 1], [0.64, 0.05, -0.18, -0.43, -0.3, 0.2, 0.0, 2]] },
  shove: { dur: 0.5, keys: [[0.25, 0.14, -0.16, -0.24, 0.15, 0.45, 0.55, 0], [0.42, 0.0, -0.12, -0.44, 0.1, 0.55, 0.65, 2], [0.55, 0.0, -0.12, -0.42, 0.1, 0.55, 0.65, 0]] },
};

// claws: wrist frames (camera space): [t, px,py,pz, rx,ry,rz, ease] for the swinging (right) hand; mirrored for left
const CLAW_IDLE = [0.18, -0.15, -0.38, -0.55, -0.35, 0.85];
const CLAW_SWING = { dur: 0.5, keys: [[0.3, 0.3, 0.02, -0.22, 0.0, -0.9, 1.3, 0], [0.55, -0.16, -0.24, -0.44, -1.2, 0.5, -0.2, 1]] };

const ease = (u, e) => (e === 1 ? u : e === 2 ? 1 - (1 - u) * (1 - u) : e === 3 ? u * u : u * u * (3 - 2 * u));
function evalSwing(sw, idle, t, out) {
  // t in 0..1 over sw.dur; first/last keys = idle
  const keys = sw.keys;
  let t0 = 0, a = idle;
  for (let i = 0; i <= keys.length; i++) {
    const k = i < keys.length ? keys[i] : null;
    const t1 = k ? k[0] : 1;
    if (t <= t1 || !k) {
      const u = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 1;
      const w = ease(u, k ? k[7] : 0);
      for (let j = 0; j < 6; j++) {
        const av = a === idle ? idle[j] : a[j + 1];
        const bv = k ? k[j + 1] : idle[j];
        out[j] = av + (bv - av) * w;
      }
      return out;
    }
    t0 = t1;
    a = k;
  }
  return out;
}

// ================================================================== ViewModel
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _qU = new THREE.Quaternion();
const _qL = new THREE.Quaternion();
const _e1 = new THREE.Euler(0, 0, 0, 'YXZ');
const _m1 = new THREE.Matrix4();
const _pose6 = new Float64Array(6);
const _pose6b = new Float64Array(6);
const SHOULDER_R = new THREE.Vector3(0.2, -0.29, 0.1);
const SHOULDER_L = new THREE.Vector3(-0.12, -0.31, -0.06);
const POLE_R = new THREE.Vector3(0.75, -0.65, 0.15);
const POLE_L = new THREE.Vector3(-0.75, -0.65, 0.15);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const SWAY_PIVOT = new THREE.Vector3(0.1, -0.14, -0.32); // roughly between the hands
const IDLE_RATE = 1.35; // breathing, rad/s (~4.7 s per breath)
const softClamp = (x, m) => m * Math.tanh(x / m);

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const win = (u, a, b, c, d) => smoothstep(a, b, u) * (1 - smoothstep(c, d, u)); // rise a..b, fall c..d

class Spring {
  constructor(k, c) {
    this.k = k;
    this.c = c;
    this.x = 0;
    this.v = 0;
  }
  step(dt, target = 0) {
    const a = -this.k * (this.x - target) - this.c * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
    return this.x;
  }
}

function makeScopeOverlay() {
  const g = new THREE.Group();
  g.name = 'scopeOverlay';
  const mat = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false, depthTest: false, depthWrite: false });
  const z = -0.1;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.052, 1.0, 64, 1), mat);
  ring.position.z = z;
  g.add(ring);
  // soft inner edge: a second, slightly transparent ring
  const edge = new THREE.Mesh(new THREE.RingGeometry(0.047, 0.0525, 64, 1), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, fog: false, depthTest: false, depthWrite: false }));
  edge.position.z = z;
  g.add(edge);
  const bar = (w, h, x, y) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z);
    g.add(m);
  };
  // thin crosshair + thick outer posts (duplex)
  bar(0.1, 0.00018, 0, 0);
  bar(0.00018, 0.1, 0, 0);
  for (const s of [-1, 1]) {
    bar(0.03, 0.0009, s * 0.037, 0);
    bar(0.0009, 0.03, 0, s * 0.037);
  }
  g.traverse((o) => {
    o.renderOrder = 10;
    o.frustumCulled = false;
  });
  return g;
}

function makeKit() {
  const mb = new MeshBuilder({ skinned: false, atlas: 'weapon' });
  mb.box(0, [0, 0, 0], [0.15, 0.1, 0.055], { region: WR.PLAIN, color: 0xb01c16, round: 0.2, seg: 2 });
  mb.box(0, [0, 0, 0.028], [0.045, 0.012, 0.004], { region: WR.PLAIN, color: 0xf0f0e8 });
  mb.box(0, [0, 0, 0.028], [0.012, 0.045, 0.004], { region: WR.PLAIN, color: 0xf0f0e8 });
  mb.box(0, [0, 0.053, 0], [0.06, 0.008, 0.012], { region: WR.PLAIN, color: 0x222222 });
  mb.box(0, [0, 0.0, 0.0], [0.152, 0.004, 0.057], { region: WR.PLAIN, color: 0x303030 });
  // bandage roll
  mb.seg(0, [-0.03, 0.06, -0.01], [0.03, 0.06, -0.01], 0.018, 0.018, { region: WR.RAG, color: 0xf2eee4, rs: 10, hs: 1, caps: 1, capScale: 0.05 });
  mb.blood([0.02, 0.07, -0.02], 0.02, 0.8);
  return mb.build().geometry;
}

// opened tin of tuna (food "use" prop): held upright between the palms, lid peeled back off the far rim
function makeCan() {
  const mb = new MeshBuilder({ skinned: false, atlas: 'weapon' });
  const R = 0.043, H = 0.036;
  mb.seg(0, [0, -H / 2, 0], [0, H / 2, 0], R, R, { region: WR.PLAIN, color: 0xb4b6b2, rs: 14, hs: 1, caps: 1, capScale: 0.02 });
  mb.seg(0, [0, -H * 0.32, 0], [0, H * 0.32, 0], R + 0.0006, R + 0.0006, { region: WR.PLAIN, color: 0x2c5a8e, rs: 14, hs: 1, caps: 0 });
  mb.seg(0, [0, -H * 0.06, 0], [0, H * 0.08, 0], R + 0.001, R + 0.001, { region: WR.PLAIN, color: 0xe0c45a, rs: 14, hs: 1, caps: 0 });
  mb.seg(0, [0, H / 2 - 0.003, 0], [0, H / 2 + 0.0012, 0], R * 0.9, R * 0.9, { region: WR.PLAIN, color: 0xbfa08a, rs: 12, hs: 1, caps: 1, capScale: 0.1 });
  // lid: hinged at the far rim and bent back past upright, underside to the camera
  const a = (115 * PI) / 180, r = R * 0.92;
  const c = [0, H / 2 + Math.sin(a) * r, -R + Math.cos(a) * r], n = [0, Math.cos(a) * 0.0006, -Math.sin(a) * 0.0006];
  mb.seg(0, [c[0], c[1] - n[1], c[2] - n[2]], [c[0], c[1] + n[1], c[2] + n[2]], r, r, { region: WR.PLAIN, color: 0xc8cac6, rs: 12, hs: 1, caps: 1, capScale: 0.02 });
  return mb.build().geometry;
}

export class ViewModel {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'viewmodel';
    this.sway = new THREE.Group();
    this.group.add(this.sway);
    this.weaponRoot = new THREE.Group();
    this.sway.add(this.weaponRoot);
    this.armR = new VMArm(1);
    this.armL = new VMArm(-1);
    this.armR.shoulder.position.copy(SHOULDER_R);
    this.armL.shoulder.position.copy(SHOULDER_L);
    this.sway.add(this.armR.shoulder, this.armL.shoulder);
    // sniper-scope overlay (hunting rifle ADS): black ring + duplex reticle, drawn on top
    this.scopeOverlay = makeScopeOverlay();
    this.scopeOverlay.visible = false;
    this.group.add(this.scopeOverlay);
    this.scoped = false;
    this.kitGeo = makeKit();
    this.canGeo = makeCan();
    this.kitGrip = 0.1; // half the distance between the hands holding it
    this.kit = new THREE.Mesh(this.kitGeo, getViewWeaponMaterial());
    this.kit.visible = false;
    this.kit.frustumCulled = false;
    this.sway.add(this.kit);
    this.flameAnchor = new THREE.Object3D();
    this.flameAnchor.name = 'flameAnchor';
    this.group.userData.flameAnchor = this.flameAnchor;
    this.group.userData.flameVisible = false;
    this.group.userData.scoped = false;
    this.items = new Map();
    this.cur = null; // current item view
    this.itemId = 0;
    this.claws = false;
    // state
    this.time = 0;
    this.drawT = 1;
    this.adsT = 0;
    this.sprintT = 0;
    this.crouchT = 0;
    this.moveT = 0;
    this.bobPhase = 0;
    this.wasOnGround = true;
    this.land = new Spring(120, 22);
    this.recZ = new Spring(260, 22);
    this.recX = new Spring(200, 18);
    this.recY = new Spring(150, 16);
    this.swayX = new Spring(160, 25); // look lag, critically damped (no wobble)
    this.swayY = new Spring(160, 25);
    this.act = null; // {type, t, dur, heavy, perShell}
    this.fireT = 9; // time since last shot
    this.cycleT = 9; // bolt/pump cycle timer
    this.clawSide = 1;
    this.reloadHold = 0;
    this.visible = true;
    this.muzzleLocal = new THREE.Vector3();
    // cached targets
    this._wp = new THREE.Vector3();
    this._wq = new THREE.Quaternion();
    this._lp = new THREE.Vector3();
    this._lq = new THREE.Quaternion();
    this._rp = new THREE.Vector3();
    this._rq = new THREE.Quaternion();
    this._tmpP = new THREE.Vector3();
    this._tmpQ = new THREE.Quaternion();
    this.armR.setVisible(false);
    this.armL.setVisible(false);
  }

  _getItemView(itemId) {
    let v = this.items.get(itemId);
    if (v !== undefined) return v;
    const d = getVMData(itemId);
    const cfg = VM[itemId];
    if (!d || !cfg) {
      this.items.set(itemId, null);
      return null;
    }
    const root = new THREE.Group();
    root.visible = false;
    const mat = getViewWeaponMaterial();
    const parts = {};
    for (const name in d.parts) {
      const pd = d.parts[name];
      const mesh = new THREE.Mesh(pd.geometry, mat);
      mesh.position.copy(pd.pivot);
      mesh.frustumCulled = false;
      mesh.userData.base = pd.pivot.clone();
      root.add(mesh);
      parts[name] = mesh;
    }
    if (parts.shell) parts.shell.visible = false;
    if (parts.round) parts.round.visible = false;
    this.weaponRoot.add(root);
    const lp = cfg.lGrip && (cfg.lGrip.p ? new THREE.Vector3(...cfg.lGrip.p) : d.meta.leftHand && d.meta.leftHand.clone());
    const lGrip = lp ? { p: lp, q: cfg.lGrip.q, pose: cfg.lGrip.pose } : null;
    v = { itemId, cfg, d, root, parts, meta: d.meta, lGrip, rGrip: { p: new THREE.Vector3(...cfg.rGrip.p), q: cfg.rGrip.q }, tris: d.tris };
    this.items.set(itemId, v);
    return v;
  }

  setItem(itemId, opts = {}) {
    const claws = !!(opts && opts.claws);
    if (this.cur) this.cur.root.visible = false;
    if (this.flameAnchor.parent) this.flameAnchor.parent.remove(this.flameAnchor);
    this.claws = claws;
    this.itemId = claws ? 0 : itemId | 0;
    this.scoped = false;
    this.scopeOverlay.visible = false;
    this.group.userData.scoped = false;
    this.cur = claws ? null : this._getItemView(this.itemId);
    this.act = null;
    this.kit.visible = false;
    this.drawT = 0;
    this.fireT = 9;
    this.cycleT = 9;
    this.reloadHold = 0;
    this.recZ.x = this.recX.x = this.recY.x = 0;
    this.recZ.v = this.recX.v = this.recY.v = 0;
    const style = claws ? 'claw' : 'normal';
    this.armR.setStyle(style);
    this.armL.setStyle(style);
    if (this.cur) {
      this.cur.root.visible = true;
      for (const n in this.cur.parts) {
        const m = this.cur.parts[n];
        m.position.copy(m.userData.base);
        m.quaternion.identity();
        m.visible = n !== 'shell' && n !== 'round';
      }
      if (this.cur.meta.flame && this.itemId === ITEM.MOLOTOV) {
        this.cur.parts.body.add(this.flameAnchor);
        this.flameAnchor.position.copy(this.cur.meta.flame);
      }
      if (this.cur.meta.muzzle) this.muzzleLocal.copy(this.cur.meta.muzzle);
    }
    const armsOn = claws || !!this.cur;
    this.armR.setVisible(armsOn);
    this.armL.setVisible(claws || !!(this.cur && this.cur.lGrip));
    this.armR.setPose(claws ? 'claw' : 'grip');
    this.armL.setPose(claws ? 'claw' : this.cur && this.cur.lGrip ? this.cur.lGrip.pose : 'grip');
  }

  setVisible(v) {
    this.visible = v;
    this.group.visible = v;
  }

  fire() {
    if (!this.cur || this.cur.cfg.kind === 'melee' || this.cur.cfg.kind === 'throw') return;
    const rc = this.cur.cfg.recoil;
    const ads = 1 - this.adsT * 0.45;
    this.recZ.v += rc.z * 32 * ads;
    this.recX.v += rc.rx * 30 * ads;
    this.recY.v += (Math.random() - 0.5) * rc.ry * 40;
    this.fireT = 0;
    if (this.cur.cfg.kind === 'shotgun' || this.cur.cfg.bolt) this.cycleT = 0;
  }

  reload(duration = 2, perShell = false) {
    if (!this.cur || this.claws) return;
    const k = this.cur.cfg.kind;
    if (k !== 'rifle' && k !== 'shotgun' && k !== 'pistol') return;
    this.act = { type: 'reload', t: 0, dur: Math.max(0.2, duration), perShell: !!perShell };
  }

  melee(heavy = false) {
    if (this.claws) {
      this.clawSide = -this.clawSide;
      this.act = { type: 'claw', t: 0, dur: CLAW_SWING.dur, side: this.clawSide };
      return;
    }
    if (!this.cur) return;
    const id = this.itemId;
    let sw = 'shove';
    if (id === ITEM.KNIFE) sw = heavy ? 'stab' : 'knife';
    else if (id === ITEM.BAT || id === ITEM.SPIKED_BAT) sw = 'bat';
    else if (id === ITEM.MACHETE) sw = 'machete';
    else if (id === ITEM.HAMMER) sw = 'hammer';
    this.act = { type: 'melee', t: 0, dur: SWINGS[sw].dur, swing: SWINGS[sw] };
  }

  throwItem() {
    if (!this.cur || this.cur.cfg.kind !== 'throw') return;
    this.act = { type: 'throw', t: 0, dur: 1.15 };
  }

  /** item: what is being used (food shows a tin instead of the medkit) */
  useItem(duration = 2, item = 0) {
    const food = !!CONSUMABLES[item]?.food;
    this.kit.geometry = food ? this.canGeo : this.kitGeo;
    this.kitGrip = food ? 0.068 : 0.1;
    this.act = { type: 'use', t: 0, dur: Math.max(0.6, duration) + 0.35 };
  }

  getMuzzle(out) {
    if (!this.cur || !this.cur.meta.muzzle) {
      return out.set(0.12, -0.12, -0.5);
    }
    out.copy(this.cur.meta.muzzle);
    out.applyQuaternion(this._wq).add(this._wp);
    out.applyQuaternion(this.sway.quaternion).add(this.sway.position);
    return out;
  }

  // ---------------------------------------------------------------- update
  update(dt, s = {}) {
    dt = Math.min(0.1, Math.max(0, dt || 0));
    // molotov rag flame: game shows its fire sprite at userData.flameAnchor while this is true
    this.group.userData.flameVisible = !!(this.cur && this.flameAnchor.parent && this.cur.root.visible && this.group.visible);
    this.time = s.time !== undefined ? s.time : this.time + dt;
    const t = this.time;
    const speed = s.speed || 0;
    const onGround = s.onGround !== false;
    const cur = this.cur;
    const kind = cur ? cur.cfg.kind : this.claws ? 'claws' : 'none';
    const isGun = kind === 'rifle' || kind === 'shotgun' || kind === 'pistol';
    const busy = this.act && (this.act.type === 'reload' || this.act.type === 'use' || this.act.type === 'throw');
    const wantAds = !!s.aiming && isGun && !busy && !s.sprint;
    const wantSprint = !!s.sprint && speed > 1 && !wantAds;
    const k = 1 - Math.exp(-dt * 12);
    this.adsT += ((wantAds ? 1 : 0) - this.adsT) * (1 - Math.exp(-dt * 14));
    this.sprintT += ((wantSprint && (!this.act || this.act.type === 'draw') ? 1 : 0) - this.sprintT) * (1 - Math.exp(-dt * 9));
    this.crouchT += ((s.crouch ? 1 : 0) - this.crouchT) * k;
    this.moveT += ((onGround ? Math.min(1, speed / 4.3) : 0) - this.moveT) * k;
    this.drawT = Math.min(1, this.drawT + dt / 0.35);
    this.fireT += dt;
    this.cycleT += dt;
    // landing
    if (onGround && !this.wasOnGround) this.land.v -= 0.9;
    this.wasOnGround = onGround;
    this.land.step(dt);
    // recoil springs
    this.recZ.step(dt);
    this.recX.step(dt);
    this.recY.step(dt);
    // look lag (lookDX/lookDY: camera rotation this frame, radians; +x = turning right, +y = looking down).
    // Kept small: the weapon trails the view by about a degree at normal turn rates.
    const ldx = Math.max(-0.08, Math.min(0.08, s.lookDX || 0));
    const ldy = Math.max(-0.08, Math.min(0.08, s.lookDY || 0));
    const swayGain = 1 - this.adsT * 0.7;
    this.swayX.v += ldx * 4.5 * swayGain;
    this.swayY.v += ldy * 4.5 * swayGain;
    this.swayX.step(dt);
    this.swayY.step(dt);
    // action timer
    if (this.act) {
      this.act.t += dt;
      if (this.act.t >= this.act.dur) {
        const done = this.act;
        this.act = null;
        if (done.type === 'use') this.drawT = 0;
        if ((done.type === 'throw' || done.type === 'use') && cur) cur.root.visible = true;
      }
    }
    this.reloadHold = this.act && this.act.type === 'reload' ? Math.min(1, this.reloadHold + dt * 6) : Math.max(0, this.reloadHold - dt * 3);

    // ---- sway root: CS-style, the arms stay almost still. A slow breathing figure-8 while idle, a small
    // smooth walk bob, a slight look lag and a landing dip. Rotations pivot about the hands (not the eye),
    // so they read as the arms settling rather than the whole weapon swinging across the screen.
    const bobAmp = this.moveT * (1 - this.adsT * 0.85) * (1 - this.crouchT * 0.4) * (1 + this.sprintT * 0.9);
    const bobRate = wantSprint ? 13.5 : 9.0 + speed * 0.4;
    this.bobPhase += dt * bobRate * (0.3 + this.moveT * 0.7);
    const bp = this.bobPhase;
    const bobX = Math.sin(bp * 0.5), bobY = (Math.cos(bp) - 1) * 0.5; // lateral sway per stride, dip per step
    const idleW = (1 - this.adsT * 0.75) * (1 - this.moveT * 0.6);
    const bt = t * IDLE_RATE;
    const lagX = softClamp(this.swayX.x, 0.035), lagY = softClamp(this.swayY.x, 0.03);
    _e1.set(
      lagY * 0.9 + Math.sin(bt + 0.6) * 0.006 * idleW + Math.sin(bp) * 0.003 * bobAmp + this.land.x * 0.2,
      lagX * 0.9 + Math.sin(bt * 0.5 + 0.4) * 0.005 * idleW + bobX * 0.003 * bobAmp,
      lagX * 0.35 + Math.sin(bt * 0.5 + 1.3) * 0.011 * idleW + bobX * 0.008 * bobAmp,
      'YXZ'
    );
    this.sway.quaternion.setFromEuler(_e1);
    _v1.copy(SWAY_PIVOT).applyQuaternion(this.sway.quaternion);
    this.sway.position.set(
      SWAY_PIVOT.x - _v1.x + Math.sin(bt * 0.5) * 0.0014 * idleW + bobX * 0.003 * bobAmp - lagX * 0.012,
      SWAY_PIVOT.y - _v1.y + Math.sin(bt) * 0.0024 * idleW + bobY * 0.0035 * bobAmp + lagY * 0.01 + this.land.x * 0.06 - this.crouchT * 0.006,
      SWAY_PIVOT.z - _v1.z
    );

    if (this.claws) {
      this._updateClaws(dt, t);
      return;
    }
    if (!cur) {
      // no weapon: only the generic use animation shows hands
      if (this.act && this.act.type === 'use') this._animUse(this.act.t / this.act.dur, t);
      else if (this.armR.visible || this.armL.visible || this.kit.visible) {
        this.armR.setVisible(false);
        this.armL.setVisible(false);
        this.kit.visible = false;
      }
      return;
    }
    const cfg = cur.cfg;
    const meta = cur.meta;

    // ---- base weapon pose (hip / ads / sprint)
    const P6 = _pose6;
    for (let i = 0; i < 6; i++) P6[i] = cfg.hip[i];
    if (isGun && this.adsT > 0.001) {
      // align the sight point on the view axis (optionally pitched around it by cfg.adsPitch)
      const pitch = cfg.adsPitch || 0;
      const c = Math.cos(pitch), sn = Math.sin(pitch);
      const sx = meta.sight.x, sy = meta.sight.y * c - meta.sight.z * sn, sz = meta.sight.y * sn + meta.sight.z * c;
      const a = this.adsT;
      P6[0] += (-sx - P6[0]) * a;
      P6[1] += (-sy - P6[1]) * a;
      P6[2] += (cfg.adsZ - sz - P6[2]) * a;
      P6[3] += (pitch - P6[3]) * a;
      P6[4] *= 1 - a;
      P6[5] *= 1 - a;
    }
    if (this.sprintT > 0.001) for (let i = 0; i < 6; i++) P6[i] += cfg.sprint[i] * this.sprintT;
    // draw (raise from below)
    const dr = 1 - ease(this.drawT, 2);
    P6[1] -= dr * 0.28;
    P6[3] -= dr * 0.9;
    P6[2] += dr * 0.05;

    // default hand poses / attachments
    let lPose = cur.lGrip ? cur.lGrip.pose : 'grip';
    let rPose = cfg.rPose || 'grip';
    let lVisible = !!cur.lGrip;
    // part animation defaults
    const parts = cur.parts;
    const act = this.act;
    const u = act ? act.t / act.dur : 0;
    let altLw = 0; // blend weight toward the reload target
    let altR = null, altRw = 0;

    // ---- firearm moving parts
    if (parts.slide) {
      const s1 = this.fireT < 0.09 ? Math.sin((this.fireT / 0.09) * PI) : 0;
      parts.slide.position.z = parts.slide.userData.base.z + s1 * 0.026;
    }
    if (parts.charge) {
      const s1 = cfg.chargeFire !== false && this.fireT < 0.07 ? Math.sin((this.fireT / 0.07) * PI) : 0;
      parts.charge.position.z = parts.charge.userData.base.z + s1 * 0.07;
    }
    if (parts.pump) {
      let pz = 0;
      if (cfg.kind === 'shotgun' && this.cycleT < 0.55 && !(act && act.type === 'reload')) {
        const c = this.cycleT;
        pz = smoothstep(0.14, 0.28, c) * (1 - smoothstep(0.32, 0.46, c)) * 0.085;
        P6[3] += pz * 0.8;
        P6[2] += pz * 0.25;
      }
      parts.pump.position.z = parts.pump.userData.base.z + pz;
    }
    if (parts.bolt) {
      let lift = 0, back = 0, rOnBolt = 0;
      if (cfg.bolt && this.cycleT < 0.95 && !(act && act.type === 'reload')) {
        const c = this.cycleT;
        rOnBolt = win(c, 0.22, 0.34, 0.8, 0.94);
        lift = smoothstep(0.34, 0.42, c) * (1 - smoothstep(0.66, 0.74, c));
        back = smoothstep(0.42, 0.52, c) * (1 - smoothstep(0.56, 0.66, c));
        P6[5] += rOnBolt * -0.3;
        P6[3] += rOnBolt * 0.06;
        P6[0] -= rOnBolt * 0.035;
        P6[1] += rOnBolt * 0.025;
      }
      if (act && act.type === 'reload') {
        rOnBolt = win(u, 0.0, 0.1, 0.86, 0.96);
        lift = smoothstep(0.08, 0.14, u) * (1 - smoothstep(0.78, 0.84, u));
        back = smoothstep(0.14, 0.22, u) * (1 - smoothstep(0.7, 0.78, u));
      }
      parts.bolt.rotation.z = lift * 1.2;
      parts.bolt.position.z = parts.bolt.userData.base.z + back * 0.085;
      if (rOnBolt > 0.001) {
        altR = this._rBoltTarget || (this._rBoltTarget = new THREE.Vector3());
        // knob position follows the bolt transform
        altR.copy(meta.boltKnob).sub(parts.bolt.userData.base);
        altR.applyQuaternion(parts.bolt.quaternion).add(parts.bolt.position);
        altRw = rOnBolt;
        if (rOnBolt > 0.5) rPose = 'pinch';
      }
    }
    if (parts.barrels) parts.barrels.rotation.x = 0; // closed unless the reload opens it
    if (parts.mag) {
      parts.mag.position.copy(parts.mag.userData.base);
      parts.mag.quaternion.identity();
      parts.mag.visible = true;
    }

    // ---- actions
    if (act) {
      if (act.type === 'reload') this._animReload(cur, u, P6, parts, meta);
      else if (act.type === 'melee') {
        evalSwing(act.swing, P6.slice ? P6 : P6, u, _pose6b);
        for (let i = 0; i < 6; i++) P6[i] = _pose6b[i];
      } else if (act.type === 'throw') {
        this._animThrow(u, P6, cur);
        if (u > 0.4 && u < 0.72) rPose = 'open';
      } else if (act.type === 'use') {
        const up = win(u, 0.0, 0.18, 0.82, 1.0);
        P6[1] -= up * 0.35;
        P6[3] -= up * 0.6;
        cur.root.visible = up < 0.6;
      }
    }
    const rs = this._reloadState;
    this._reloadState = null;
    if (rs) {
      altLw = rs.w;
      if (rs.pose && rs.w > 0.3) lPose = rs.pose;
    }
    // shotgun: tilt hold between per-shell reload calls
    if (cfg.kind === 'shotgun' && !cfg.breakAction && this.reloadHold > 0) {
      const h = smoothstep(0, 1, this.reloadHold);
      P6[5] -= 1.05 * h;
      P6[3] += 0.18 * h;
      P6[4] += 0.1 * h;
      P6[0] -= 0.05 * h;
      P6[1] += 0.05 * h;
    }

    // ---- sniper scope: full overlay once aimed in
    const scoped = !!cfg.scope && this.adsT > 0.92 && !busy;
    if (scoped !== this.scoped) {
      this.scoped = scoped;
      this.group.userData.scoped = scoped;
      this.scopeOverlay.visible = scoped;
      cur.root.visible = !scoped;
    }
    if (scoped) {
      this.armR.setVisible(false);
      this.armL.setVisible(false);
      // gentle sway of the reticle
      this.scopeOverlay.position.set(this.swayX.x * 0.01, this.swayY.x * 0.01 + this.recX.x * 0.05, 0);
      this._wp.set(P6[0], P6[1], P6[2]);
      _e1.set(P6[3], P6[4], P6[5], 'YXZ');
      this._wq.setFromEuler(_e1);
      return;
    }

    // ---- final weapon transform (+ recoil)
    const wp = this._wp.set(P6[0], P6[1], P6[2] + this.recZ.x);
    _e1.set(P6[3] + this.recX.x, P6[4] + this.recY.x, P6[5], 'YXZ');
    const wq = this._wq.setFromEuler(_e1);
    this.weaponRoot.position.copy(wp);
    this.weaponRoot.quaternion.copy(wq);

    // ---- hands
    // right: grip frame (or bolt knob)
    const rg = cur.rGrip;
    const rp = this._rp.copy(rg.p).applyQuaternion(wq).add(wp);
    const rq = this._rq.copy(wq).multiply(rg.q);
    if (altR && altRw > 0) {
      _v1.copy(altR).applyQuaternion(wq).add(wp);
      rp.lerp(_v1, altRw);
      // pinch orientation: fingers toward the knob from above
      _q1.copy(wq).multiply(_q2.setFromEuler(_e1.set(0.4, 0.2, -1.2, 'YXZ')));
      rq.slerp(_q1, altRw);
    }
    if (cfg.kind === 'throw' && rPose === 'grip' && this.itemId === ITEM.MOLOTOV) rPose = 'support';
    this.armR.setPose(rPose);
    this.armR.setVisible(true);
    this._solveArm(this.armR, rp, rq, SHOULDER_R, cfg.poleR || POLE_R);

    // left
    if (act && act.type === 'use') {
      this._animUse(u, t);
      return;
    } else {
      this.kit.visible = false;
    }
    if (cur.lGrip || altLw > 0) {
      const lp = this._lp;
      const lq = this._lq;
      if (cur.lGrip) {
        lp.copy(cur.lGrip.p);
        if (parts.pump) lp.z += parts.pump.position.z - parts.pump.userData.base.z;
        if (parts.barrels) lp.sub(parts.barrels.userData.base).applyQuaternion(parts.barrels.quaternion).add(parts.barrels.position);
        lp.applyQuaternion(wq).add(wp);
        lq.copy(wq).multiply(cur.lGrip.q);
      } else {
        lp.set(-0.2, -0.45, -0.1);
        lq.copy(wq);
      }
      if (rs && altLw > 0) {
        // resolve A and B into sway space, mix, then blend from the grip
        if (rs.aCam) _v2.copy(rs.a);
        else _v2.copy(rs.a).applyQuaternion(wq).add(wp);
        if (rs.bCam) _v3.copy(rs.b);
        else _v3.copy(rs.b).applyQuaternion(wq).add(wp);
        _v2.lerp(_v3, rs.m);
        lp.lerp(_v2, altLw);
        if (rs.aCam) _q1.copy(rs.qa);
        else _q1.copy(wq).multiply(rs.qa);
        if (rs.bCam) _q2.copy(rs.qb);
        else _q2.copy(wq).multiply(rs.qb);
        _q1.slerp(_q2, rs.m);
        lq.slerp(_q1, altLw);
      }
      this.armL.setPose(lPose);
      this.armL.setVisible(lVisible || altLw > 0.01);
      this._solveArm(this.armL, lp, lq, SHOULDER_L, cfg.poleL || POLE_L);
    } else {
      this.armL.setVisible(false);
    }
  }

  _solveArm(arm, gripPos, handQ, shoulderPos, pole) {
    // wrist = grip - handQ * gripCenter
    arm.gripCenter(_v3).applyQuaternion(handQ);
    _v1.copy(gripPos).sub(_v3);
    ikTwoBone(shoulderPos, _v1, ARM_L1, ARM_L2, pole, _qU, _qL);
    arm.orient(_qU, _qL, handQ);
  }

  _animReload(cur, u, P6, parts, meta) {
    const kind = cur.cfg.kind;
    // left-hand override: blend weapon grip -> lerp(A, B, m) by weight w. A/B in weapon space unless *Cam.
    const st =
      this._rs ||
      (this._rs = { w: 0, m: 0, a: new THREE.Vector3(), b: new THREE.Vector3(), qa: new THREE.Quaternion(), qb: new THREE.Quaternion(), aCam: false, bCam: false, pose: null });
    st.w = 0;
    st.m = 0;
    st.aCam = st.bCam = false;
    st.pose = null;
    this._reloadState = st;
    if (kind === 'rifle' && !cur.cfg.bolt) {
      // AK: tilt, mag rock out, new mag in, charge
      const tilt = win(u, 0.0, 0.12, 0.86, 1.0);
      P6[5] += tilt * 0.42;
      P6[3] += tilt * 0.14;
      P6[0] -= tilt * 0.035;
      P6[1] += tilt * 0.02;
      const chRoll = smoothstep(0.68, 0.78, u) * (1 - smoothstep(0.88, 0.97, u));
      P6[5] += chRoll * 0.3;
      P6[0] -= chRoll * 0.03;
      P6[1] += chRoll * 0.03;
      const outRot = smoothstep(0.14, 0.22, u) * (1 - smoothstep(0.62, 0.7, u));
      const away = smoothstep(0.22, 0.4, u) * (1 - smoothstep(0.46, 0.62, u));
      parts.mag.rotation.x = outRot * 0.45;
      parts.mag.position.y = parts.mag.userData.base.y - away * 0.38;
      parts.mag.position.z = parts.mag.userData.base.z + away * 0.08;
      parts.mag.visible = u < 0.36 || u > 0.47;
      const pull = smoothstep(0.8, 0.84, u) * (1 - smoothstep(0.86, 0.88, u));
      const travel = cur.cfg.chargeTravel ?? 0.1;
      parts.charge.position.z = parts.charge.userData.base.z + pull * travel;
      // A: on the magazine (follows it), B: on the charging handle
      st.a.copy(meta.magGrab).sub(parts.mag.userData.base).applyQuaternion(parts.mag.quaternion).add(parts.mag.position);
      st.a.x -= 0.02;
      st.qa.setFromEuler(_e1.set(PI / 2 + 0.35 + parts.mag.rotation.x, 0.15, 0.0, 'YXZ'));
      st.b.copy(meta.chargeKnob);
      st.b.z += pull * travel;
      st.b.x += 0.004;
      st.b.y += 0.006;
      const cq = cur.cfg.chargeQ;
      st.qb.setFromEuler(cq ? _e1.set(cq[0], cq[1], cq[2], 'YXZ') : _e1.set(0.35, PI, 0.1, 'YXZ'));
      st.w = win(u, 0.06, 0.16, 0.9, 0.98);
      st.m = smoothstep(0.7, 0.78, u);
      st.pose = st.m > 0.5 ? (travel ? 'pinch' : 'open') : 'support';
    } else if (kind === 'pistol') {
      // tilt and lift the gun toward the middle so the magazine change stays on screen
      const tilt = win(u, 0.0, 0.12, 0.86, 1.0);
      P6[5] += tilt * 0.3;
      P6[3] += tilt * 0.2;
      P6[0] -= tilt * 0.04;
      P6[1] += tilt * 0.1;
      P6[2] -= tilt * 0.07;
      const ax = meta.magAxis;
      const drop = smoothstep(0.1, 0.22, u) * (1 - smoothstep(0.58, 0.7, u));
      const fall = smoothstep(0.22, 0.34, u) * (1 - smoothstep(0.44, 0.58, u));
      parts.mag.position.copy(parts.mag.userData.base).addScaledVector(ax, drop * 0.1 + fall * 0.3);
      parts.mag.visible = u < 0.3 || u > 0.46;
      const pull = smoothstep(0.78, 0.83, u) * (1 - smoothstep(0.85, 0.87, u));
      parts.slide.position.z = parts.slide.userData.base.z + pull * 0.03;
      if (u < 0.6) {
        // A: below the screen (camera space), B: holding the new magazine
        st.a.set(-0.05, -0.5, -0.3);
        st.aCam = true;
        st.qa.setFromEuler(_e1.set(1.2, 0.0, 0.0, 'YXZ'));
        st.b.copy(parts.mag.position).addScaledVector(ax, 0.1);
        st.b.x -= 0.02;
        st.qb.setFromEuler(_e1.set(0.3, 0.4, 0.5, 'YXZ'));
        st.m = smoothstep(0.4, 0.5, u);
        st.pose = 'support';
      } else {
        // A: magazine, B: slide (overhand rack)
        st.a.copy(parts.mag.position).addScaledVector(ax, 0.1);
        st.a.x -= 0.02;
        st.qa.setFromEuler(_e1.set(0.3, 0.4, 0.5, 'YXZ'));
        st.b.set(0, meta.slideGrab.y + 0.02, meta.slideGrab.z + 0.01 + pull * 0.03);
        st.qb.setFromEuler(_e1.set(-0.3, -0.2, -PI / 2 - 0.2, 'YXZ'));
        st.m = smoothstep(0.7, 0.76, u);
        st.pose = st.m > 0.5 ? 'pinch' : 'support';
      }
      st.w = win(u, 0.08, 0.2, 0.88, 0.96);
    } else if (cur.cfg.breakAction) {
      // double-barrel: tilt, break open, fetch two shells from below, thumb them into the chambers, snap shut
      const tilt = win(u, 0.0, 0.12, 0.84, 0.98);
      P6[0] -= tilt * 0.1;
      P6[1] += tilt * 0.06;
      P6[2] -= tilt * 0.04;
      P6[3] -= tilt * 0.05;
      P6[4] += tilt * 0.25;
      P6[5] -= tilt * 0.3;
      const open = smoothstep(0.08, 0.2, u) * (1 - smoothstep(0.8, 0.87, u));
      const br = parts.barrels;
      br.rotation.x = -open * 0.62;
      // chambers + barrel axis (toward the breech) in weapon space
      const ch = _v1.copy(meta.chamber).sub(br.userData.base).applyQuaternion(br.quaternion).add(br.position);
      const back = _v3.set(0, 0, 1).applyQuaternion(br.quaternion);
      const push = smoothstep(0.54, 0.68, u);
      const sh = parts.shell;
      st.a.set(-0.02, -0.5, -0.32);
      st.aCam = true;
      st.qa.setFromEuler(_e1.set(1.2, 0.0, 0.0, 'YXZ'));
      st.b.copy(ch).addScaledVector(back, 0.03 + (1 - push) * 0.07);
      st.b.y += 0.02;
      st.qb.setFromEuler(_e1.set(-0.2 - open * 0.62, 0.5, -PI / 2 - 0.4, 'YXZ'));
      st.m = smoothstep(0.3, 0.48, u);
      st.w = win(u, 0.12, 0.24, 0.7, 0.8);
      st.pose = 'pinch';
      sh.visible = st.m > 0.3 && push < 0.97 && st.w > 0.3;
      sh.position.copy(ch).addScaledVector(back, (1 - push) * 0.07);
      sh.quaternion.copy(br.quaternion);
    } else if (kind === 'shotgun') {
      // one shell: fetch from below the screen, push into the loading port, return to the pump
      const push = smoothstep(0.55, 0.72, u);
      const sh = parts.shell;
      st.a.set(0.0, -0.5, -0.32);
      st.aCam = true;
      st.qa.setFromEuler(_e1.set(1.2, 0.0, 0.0, 'YXZ'));
      st.b.copy(meta.loadPort);
      st.b.y -= 0.03;
      st.b.z += 0.02 - push * 0.03;
      st.qb.setFromEuler(_e1.set(-0.3, 0.2, -PI / 2 - 0.3, 'YXZ'));
      st.m = smoothstep(0.28, 0.5, u);
      st.w = win(u, 0.0, 0.18, 0.8, 0.96);
      st.pose = 'pinch';
      sh.visible = st.m > 0.3 && push < 0.95;
      sh.position.set(meta.loadPort.x, meta.loadPort.y - 0.005 - (1 - push) * 0.012, meta.loadPort.z + 0.06 - push * 0.07);
      sh.quaternion.identity();
    } else if (cur.cfg.bolt) {
      // hunting rifle: bolt open (handled in the bolt block), insert two rounds, close
      const tilt = win(u, 0.0, 0.1, 0.88, 1.0);
      P6[5] -= tilt * 0.28;
      P6[3] += tilt * 0.1;
      P6[0] -= tilt * 0.02;
      const rd = parts.round;
      let m = 0, press = 0;
      for (let i = 0; i < 2; i++) {
        const a = 0.22 + i * 0.26;
        const mi = win(u, a + 0.06, a + 0.12, a + 0.2, a + 0.25);
        if (mi > m) {
          m = mi;
          press = smoothstep(a + 0.13, a + 0.19, u);
        }
      }
      st.a.set(0.0, -0.5, -0.32);
      st.aCam = true;
      st.qa.setFromEuler(_e1.set(1.2, 0.0, 0.0, 'YXZ'));
      st.b.copy(meta.port);
      st.b.y += 0.02 - press * 0.03;
      st.b.x -= 0.01;
      st.qb.setFromEuler(_e1.set(-0.9, 0.3, -PI / 2, 'YXZ'));
      st.m = m;
      st.w = win(u, 0.18, 0.24, 0.74, 0.8);
      st.pose = 'pinch';
      rd.visible = m > 0.4 && press < 0.95;
      rd.position.set(meta.port.x, meta.port.y - 0.02 - press * 0.02, meta.port.z + 0.02);
    }
  }

  _animThrow(u, P6, cur) {
    // wind up (0..0.38), throw (0.38..0.5), release at ~0.46, lower (0.5..0.75), re-draw (0.75..1)
    const wind = smoothstep(0.0, 0.38, u) * (1 - smoothstep(0.38, 0.5, u));
    const thr = smoothstep(0.38, 0.5, u) * (1 - smoothstep(0.55, 0.75, u));
    const low = smoothstep(0.55, 0.75, u) * (1 - smoothstep(0.78, 1.0, u));
    P6[0] += wind * 0.17 - thr * 0.1;
    P6[1] += wind * 0.17 + thr * 0.1 - low * 0.35;
    P6[2] += wind * 0.1 - thr * 0.26;
    P6[3] += -wind * 0.6 + thr * 0.9 - low * 0.4;
    P6[5] += wind * 0.35 - thr * 0.2;
    cur.root.visible = u < 0.46 || u > 0.8;
    if (u > 0.8) {
      const r = smoothstep(0.8, 1.0, u);
      P6[1] -= (1 - r) * 0.1;
    }
  }

  _animUse(u, t) {
    // kit held in front with both hands on its sides; small fiddling motion while "using"
    const up = win(u, 0.05, 0.25, 0.78, 0.95);
    const kitPos = _v2.set(0.0, -0.13 - (1 - up) * 0.3 + Math.sin(t * 5.3) * 0.004 * up, -0.38);
    this.kit.visible = up > 0.02;
    this.kit.position.copy(kitPos);
    this.kit.quaternion.setFromEuler(_e1.set(0.35 - (1 - up) * 0.6, Math.sin(t * 3.1) * 0.12 * up, Math.sin(t * 4.3) * 0.08 * up, 'YXZ'));
    _q2.setFromAxisAngle(X_AXIS, PI / 2); // palm on the side, fingers forward, index up
    _q1.copy(this.kit.quaternion).multiply(_q2);
    for (let side = -1; side <= 1; side += 2) {
      const arm = side < 0 ? this.armL : this.armR;
      _v1.set(side * this.kitGrip, -0.012, 0.0).applyQuaternion(this.kit.quaternion).add(kitPos);
      arm.setVisible(up > 0.02);
      arm.setPose('support');
      this._solveArm(arm, _v1, _q1, side < 0 ? SHOULDER_L : SHOULDER_R, side < 0 ? POLE_L : POLE_R);
    }
  }

  _updateClaws(dt, t) {
    const act = this.act && this.act.type === 'claw' ? this.act : null;
    const P6 = _pose6, idle = _pose6b;
    for (let side = 1; side >= -1; side -= 2) {
      const arm = side > 0 ? this.armR : this.armL;
      // right-hand-space idle (mirrored below for the left hand)
      idle[0] = CLAW_IDLE[0];
      idle[1] = CLAW_IDLE[1] + Math.sin(t * 1.9 + side) * 0.006;
      idle[2] = CLAW_IDLE[2] + Math.sin(t * 1.3 + side) * 0.006;
      idle[3] = CLAW_IDLE[3] + Math.sin(t * 2.3 + side * 2) * 0.03;
      idle[4] = CLAW_IDLE[4];
      idle[5] = CLAW_IDLE[5];
      if (act && act.side === side) evalSwing(CLAW_SWING, idle, act.t / act.dur, P6);
      else for (let i = 0; i < 6; i++) P6[i] = idle[i];
      if (side < 0) {
        P6[0] = -P6[0];
        P6[4] = -P6[4];
        P6[5] = -P6[5];
      }
      const dr = 1 - ease(this.drawT, 2);
      P6[1] -= dr * 0.3;
      P6[3] -= dr * 0.6;
      _v1.set(P6[0], P6[1], P6[2]);
      _q1.setFromEuler(_e1.set(P6[3], P6[4], P6[5], 'YXZ'));
      // base hand frame: palm facing forward (-Z), fingers up
      if (side > 0) _m1.makeBasis(_v2.set(0, 0, 1), _v3.set(0, -1, 0), this._tmpP.set(1, 0, 0));
      else _m1.makeBasis(_v2.set(0, 0, -1), _v3.set(0, -1, 0), this._tmpP.set(-1, 0, 0));
      _q2.setFromRotationMatrix(_m1);
      _q3.copy(_q1).multiply(_q2); // hand orientation
      arm.setVisible(true);
      arm.setPose('claw');
      ikTwoBone(side > 0 ? SHOULDER_R : SHOULDER_L, _v1, ARM_L1, ARM_L2, side > 0 ? POLE_R : POLE_L, _qU, _qL);
      arm.orient(_qU, _qL, _q3);
    }
  }
}

/** Debug/tuning access to pose tables (sandbox only). */
export const VM_DEBUG = { VM, CLAW_IDLE, SWINGS, CLAW_SWING, HAND_POSES, HAND_MAT, handQ };
/** Debug: hand geometry. */
export function getHandGeoForDebug(pose, side) {
  return getHandGeo(pose, pose === 'claw' ? 'claw' : 'glove', side);
}
/** Debug: triangle counts for the viewmodel of an item. */
export function viewModelTris(itemId) {
  const d = getVMData(itemId);
  return d ? d.tris : 0;
}
export function handTris() {
  let n = 0;
  for (const p of ['grip', 'support', 'pinch', 'open', 'claw']) {
    const g = getHandGeo(p, p === 'claw' ? 'claw' : 'glove', 1);
    n = Math.max(n, g.index.count / 3);
  }
  return n;
}
