// Procedural weapon models: third-person/pickup models (createWorldWeapon) and the first-person
// ViewModel (arms + detailed weapons + procedural animation).
//
// Weapon space conventions (both world and view models):
//   origin = center of the right hand's grip (palm wraps here), barrel / blade along -Z, up = +Y.
//   Guns: pistol grip passes vertically (+Y) through the fist.
//   Melee: the handle runs along Z through the fist, blade/bat toward -Z, cutting edge / hammer face toward -Y.
//   Throwables (molotov, pipebomb, road flare, frag grenade, noisemaker): long axis along +Y (held like a bottle).
import * as THREE from 'three';
import { ITEM, CONSUMABLES } from '../../../shared/defs.js';
import { NK_GEOM, NK_CHAIN } from '../../../shared/nunchaku.js';
import { NunchakuFP, FP_SHOULDER_L, FP_SHOULDER_R } from './nunchaku.js';
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

/** Outline (x, f = forward distance (-Z)) extruded along Y from y0 to y1. */
function plateY(mb, pts, y0, y1, o = {}) {
  const bevel = o.bevel ?? 0.001;
  const geo = new THREE.ExtrudeGeometry(makeShape(pts), {
    depth: Math.max(0.0005, Math.abs(y1 - y0) - bevel * 2),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: o.curveSegs ?? 6,
    steps: 1,
  });
  geo.rotateX(-PI / 2); // (x, y, z) -> (x, z, -y): shape y = forward (-Z), extrude = Y
  geo.translate(0, Math.min(y0, y1) + bevel, 0);
  projUV(geo);
  return mb.geom(0, geo, o);
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

// ------------------------------------------------------------------ Flare gun (26.5mm break-open signal pistol)
// Moulded orange plastic, Orion style: a chunky grip and frame laid out like the pistol's (the same hands fit it),
// a fat smooth-bore barrel over them that tips down about a pin in front of the trigger guard, an exposed hammer.
// Parts (viewmodel): body, barrel (pivots on the hinge pin), hammer (pivots at its foot), shell (reload only).
const FG_ORANGE = { region: WR.PLAIN, color: 0xe0601c, mottle: 0.06 };
const FG_SEAM = { region: WR.PLAIN, color: 0xa8401a, mottle: 0.05 };
function buildFlareGun(P) {
  const hi = P.hi;
  const B = P.get('body');
  const rs = R(hi, 16, 9);
  const BY = 0.058; // bore axis
  // grip: the pistol's outline, rounder at the front and flared at the butt
  profile(B, [[-0.03, 0.036], [-0.008, 0.03], [-0.047, -0.074], [-0.05, -0.085], [-0.044, -0.091], [0.004, -0.091], [0.009, -0.083], [0.013, -0.06], [0.022, -0.036], [0.03, -0.012], [0.038, 0.012], [0.044, 0.03]], 0.031, { ...FG_ORANGE, bevel: 0.004, curveSegs: 4 });
  if (hi) {
    // moulded grip panels + a lanyard loop at the butt
    for (const s of [-1, 1]) profile(B, [[-0.01, 0.016], [-0.038, -0.07], [-0.006, -0.07], [0.017, -0.004]], 0.001, { ...FG_SEAM, bevel: 0, x: s * 0.0156 });
    B.tube(0, [[-0.006, -0.092, 0.038], [-0.006, -0.102, 0.043], [0.006, -0.102, 0.043], [0.006, -0.092, 0.038]], 0.0018, 0.0018, { ...M.gunDark, rs: 5, ts: 6, cap: false });
  }
  // frame: standing breech over the hand, a lug under the barrel out to the hinge
  // (its top stays under the barrel's, so the barrel is the line the eye follows)
  profile(B, [[-0.034, 0.06], [-0.026, 0.07], [-0.003, 0.074], [-0.003, 0.038], [0.098, 0.036], [0.106, 0.029], [0.098, 0.02], [0.0, 0.022], [-0.034, 0.03]], 0.03, { ...FG_ORANGE, bevel: 0.003 });
  if (hi) for (const s of [-1, 1]) profile(B, [[-0.03, 0.04], [-0.006, 0.04], [-0.006, 0.064], [-0.024, 0.062]], 0.001, { ...FG_SEAM, bevel: 0, x: s * 0.0151 }); // side plate seam
  // trigger guard + trigger (where the pistol's are: the trigger finger finds it)
  B.tube(0, [[0, 0.024, -0.04], [0, 0.004, -0.046], [0, -0.003, -0.066], [0, -0.001, -0.093], [0, 0.023, -0.1]], 0.0042, 0.0042, { ...FG_ORANGE, rs: 6, ts: R(hi, 12, 6), cap: false });
  B.tube(0, [[0, 0.024, -0.062], [0, 0.013, -0.064], [0, 0.006, -0.058]], 0.003, 0.0024, { ...M.gunDark, rs: 5, ts: 4 });
  // barrel latch: a thumb lever on the left of the frame
  boxR(B, -0.0172, -0.0146, 0.061, 0.068, 0.002, 0.014, M.gunDark);
  // hinge pin through the lug
  B.seg(0, [-0.0158, 0.029, -0.106], [0.0158, 0.029, -0.106], 0.0042, 0.0042, { ...M.gunDark, rs: 8, hs: 1 });
  // barrel: fat moulded tube, black bore, a rib with a bump of a front sight, its own lug round the pin
  const BR = P.get('barrel');
  barrelZ(BR, 0, BY, -0.002, -0.168, 0.0215, 0.0142, { ...FG_ORANGE, rs });
  latheZ(BR, [[0.0215, 0.158], [0.0232, 0.16], [0.0232, 0.168], [0.0215, 0.169]], 0, BY, { ...FG_ORANGE, rs, sharp: true }); // muzzle lip
  latheZ(BR, [[0.0215, 0.002], [0.0228, 0.004], [0.0228, 0.016], [0.0215, 0.018]], 0, BY, { ...FG_SEAM, rs, sharp: true }); // breech collar
  cylZ(BR, 0, BY, -0.135, -0.163, 0.0141, { ...M.black, rs: R(hi, 12, 7) });
  boxR(BR, -0.0042, 0.0042, 0.0775, 0.0832, -0.012, -0.156, FG_ORANGE);
  boxR(BR, -0.0021, 0.0021, 0.0832, 0.0872, -0.148, -0.157, FG_SEAM);
  boxR(BR, -0.0098, 0.0098, 0.021, 0.043, -0.094, -0.118, FG_ORANGE);
  if (hi) for (const s of [-1, 1]) boxR(BR, s * 0.0214, s * 0.0219, 0.051, 0.065, -0.05, -0.11, FG_SEAM); // moulded flats
  P.pivot('barrel', new THREE.Vector3(0, 0.029, -0.106));
  // hammer, cocked: a broad ribbed spur standing up behind the breech
  const HM = P.get('hammer');
  profile(HM, [[-0.012, 0.062], [-0.004, 0.072], [-0.02, 0.09], [-0.036, 0.099], [-0.043, 0.094], [-0.03, 0.08], [-0.024, 0.06]], 0.009, { ...M.gunDark, bevel: 0.0015 });
  if (hi) for (let i = 0; i < 3; i++) boxR(HM, -0.0052, 0.0052, 0.093 - i * 0.003, 0.0965 - i * 0.003, 0.033 - i * 0.004, 0.0355 - i * 0.004, M.black);
  P.pivot('hammer', new THREE.Vector3(0, 0.064, 0.018));
  // a fresh shell (loading animation only): red paper hull, aluminium head; origin at its head, hull toward -Z
  if (P.split) {
    const SH = P.get('shell');
    cylZ(SH, 0, 0, -0.004, -0.094, 0.0128, { region: WR.PLAIN, color: 0xb0241a, rs: 12 });
    cylZ(SH, 0, 0, 0.0, -0.016, 0.0136, { ...M.steel, color: [0.92, 0.9, 0.86], rs: 12 });
    cylZ(SH, 0, 0, 0.0035, 0.0, 0.0152, { ...M.steel, color: [0.92, 0.9, 0.86], rs: 12 });
  }
  P.meta.muzzle = new THREE.Vector3(0, BY, -0.172);
  P.meta.leftHand = new THREE.Vector3(-0.028, -0.02, -0.012);
  P.meta.sight = new THREE.Vector3(0, 0.102, 0.0); // (no sights: the eye rides just over the hammer spur)
  P.meta.chamber = new THREE.Vector3(0, BY, -0.002);
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

// ------------------------------------------------------------------ Crossbow (scrap-built: plank tiller, leaf-spring prod, rope string)
// Modelled latched with a bolt on the rail. The viewmodel swings the two limbs about their roots and re-aims
// the two string halves (unit-length parts) every frame; meta.xbow carries what it needs for that.
function buildCrossbow(P) {
  const hi = P.hi;
  const B = P.get('body');
  const O = [0, -0.035, -0.058]; // authored like the shotguns: stock wrist -> grip origin
  const RAIL = 0.066; // top of the tiller, where the bolt lies
  const SY = RAIL + 0.002; // the string rides just above it
  const PROD = -0.47; // z of the limb roots
  const LATCHED = 0.72, FLEX = 0.5, LIMB = 0.27, CURL = 0.03; // limb sweep (rad) when latched, how far it springs forward, length, recurve
  // tiller: butt, wrist and a long fore-end cut from one plank, slimmer ahead of the trigger
  profile(B, [
    [0.5, RAIL], [0.16, RAIL], [0.09, RAIL], [-0.03, RAIL], [-0.085, 0.056], [-0.37, 0.03], [-0.37, -0.108], [-0.3, -0.085], [-0.2, -0.062],
    [-0.12, -0.035], [-0.075, -0.012], [-0.045, 0.006], [-0.03, 0.016], [0.09, 0.02], [0.16, 0.028], [0.44, 0.034], [0.5, 0.042],
  ], 0.038, { ...M.walnut, color: [1.2, 1.14, 1.04], bevel: 0.004, curveSegs: 4, widthFn: (f) => (f > 0.12 ? 0.8 : 1) });
  profile(B, [[-0.37, 0.032], [-0.386, 0.032], [-0.386, -0.11], [-0.37, -0.11]], 0.04, { ...M.tape, bevel: 0.003 }); // taped butt
  if (hi) {
    boxR(B, -0.0035, 0.0035, RAIL, RAIL + 0.0006, -0.17, -0.5, M.black); // bolt groove
    for (const z of [-0.2, -0.36]) boxR(B, -0.0157, 0.0157, 0.03, RAIL - 0.004, z, z - 0.014, M.tape); // tape wraps
  }
  // trigger plate, strap guard, trigger
  boxR(B, -0.008, 0.008, 0.006, 0.02, 0.02, -0.075, M.gun);
  B.tube(0, [[0, 0.008, 0.012], [0, -0.014, 0.004], [0, -0.018, -0.03], [0, -0.008, -0.062], [0, 0.008, -0.07]], 0.0032, 0.0032, { ...M.gun, rs: 5, ts: R(hi, 12, 6), cap: false });
  B.tube(0, [[0, 0.008, -0.024], [0, -0.006, -0.028], [0, -0.012, -0.022]], 0.0025, 0.002, { ...M.gunDark, rs: 5, ts: 4 });
  // prod bracket, rope lashing (clear of the rail), stirrup
  boxR(B, -0.028, 0.028, 0.04, RAIL - 0.001, PROD + 0.016, PROD - 0.016, M.gun);
  const rope = { region: WR.RAG, color: [0.72, 0.6, 0.4], mottle: 0.08 };
  for (const z of [PROD + 0.03, PROD - 0.018]) boxR(B, -0.0172, 0.0172, 0.03, RAIL - 0.005, z, z - 0.012, rope);
  B.tube(0, [[-0.03, 0.05, -0.495], [-0.04, 0.05, -0.55], [0, 0.05, -0.585], [0.04, 0.05, -0.55], [0.03, 0.05, -0.495]], 0.004, 0.004, { ...M.rust, rs: 5, ts: R(hi, 14, 8), cap: false });
  // limb tip (right, relative to its root) for a sweep angle: out along the limb, curled toward the front
  const tipAt = (b) => [LIMB * Math.cos(b) + CURL * Math.sin(b), LIMB * Math.sin(b) - CURL * Math.cos(b)];
  const [tx, tz] = tipAt(LATCHED);
  const [rx] = tipAt(LATCHED - FLEX);
  const ROOT = 0.022;
  const half = ROOT + rx; // the string is straight at rest: half its length = how far out the tips are
  const nock = PROD + tz + Math.sqrt(half * half - (ROOT + tx) * (ROOT + tx)); // latched: the string meets the latch here
  // latch: two cheeks, the nut between them, rear sight notch on a bridge
  for (const s of [-1, 1]) boxR(B, s * 0.0105, s * 0.016, RAIL - 0.004, RAIL + 0.016, nock + 0.05, nock + 0.004, M.gun);
  B.seg(0, [-0.0105, RAIL + 0.004, nock + 0.008], [0.0105, RAIL + 0.004, nock + 0.008], 0.007, 0.007, { ...M.steel, rs: R(hi, 10, 6), hs: 1 });
  boxR(B, -0.016, 0.016, RAIL + 0.016, RAIL + 0.021, nock + 0.05, nock + 0.03, M.gun);
  for (const s of [-1, 1]) boxR(B, s * 0.0018, s * 0.008, RAIL + 0.021, RAIL + 0.031, nock + 0.047, nock + 0.041, M.gunDark);
  // front sight: a wire arch over the bolt, ahead of the string at rest, with a pin on top
  for (const s of [-1, 1]) boxR(B, s * 0.0152, s * 0.018, RAIL - 0.012, RAIL + 0.025, PROD + 0.017, PROD + 0.011, M.gunDark);
  boxR(B, -0.018, 0.018, RAIL + 0.022, RAIL + 0.025, PROD + 0.017, PROD + 0.011, M.gunDark);
  boxR(B, -0.0012, 0.0012, RAIL + 0.025, RAIL + 0.0295, PROD + 0.0155, PROD + 0.0125, M.gunDark);
  // limbs: tapered leaf springs, one part each so they can flex about the root
  const spring = { ...M.steel, color: [0.72, 0.68, 0.62], mottle: 0.12 };
  const N = hi ? 7 : 4;
  for (const s of [1, -1]) {
    const L = P.get(s > 0 ? 'limbR' : 'limbL');
    const ca = Math.cos(LATCHED), sa = Math.sin(LATCHED);
    const edge = (t, side) => {
      const along = LIMB * t, out = CURL * Math.pow(t, 2.2) + side * (0.0045 - 0.002 * t); // toward the front
      return [s * (ROOT + along * ca + out * sa), -(PROD + along * sa - out * ca)];
    };
    const pts = [];
    for (let i = 0; i <= N; i++) pts.push(edge(i / N, 1));
    for (let i = N; i >= 0; i--) pts.push(edge(i / N, -1));
    plateY(L, pts, RAIL - 0.021, RAIL - 0.003, { ...spring, bevel: 0.0008 });
    L.seg(0, [s * (ROOT + tx), RAIL - 0.023, PROD + tz], [s * (ROOT + tx), SY + 0.004, PROD + tz], 0.0035, 0.003, { ...M.rust, rs: 6, hs: 1 }); // string pin
    P.pivot(s > 0 ? 'limbR' : 'limbL', new THREE.Vector3(s * ROOT, 0, PROD));
  }
  // string: latched V in the merged world model; in the viewmodel two unit lengths (+Z) the animation places
  if (P.split) {
    for (const n of ['stringR', 'stringL']) cylZ(P.get(n), 0, 0, 0, 1, 0.0017, { ...rope, rs: 5 });
  } else {
    for (const s of [-1, 1]) B.seg(0, [s * (ROOT + tx), SY, PROD + tz], [0, SY, nock], 0.0017, 0.0017, { ...rope, rs: 4, hs: 1, caps: 0 });
  }
  // bolt: ash shaft, scrap head, two tape vanes lying flat on the rail
  const A = P.get('arrow');
  const by = RAIL + 0.0045, tipZ = nock - 0.34;
  cylZ(A, 0, by, nock, tipZ, 0.0042, { ...M.wood, color: [1.0, 1.1, 1.2], rs: R(hi, 8, 5) });
  latheZ(A, [[0, -tipZ - 0.002], [0.0052, -tipZ - 0.002], [0.0068, -tipZ + 0.006], [0, -tipZ + 0.042]], 0, by, { ...M.steel, rs: R(hi, 8, 5), sharp: true });
  for (const s of [-1, 1]) profile(A, [[-nock + 0.012, s * 0.004], [-nock + 0.022, s * 0.013], [-nock + 0.062, s * 0.013], [-nock + 0.075, s * 0.004]], 0.0012, { ...M.red, bevel: 0 });
  for (const part of A.parts.slice(-2)) part.geo.rotateZ(PI / 2).translate(0, by, 0); // vanes were drawn upright: lay them flat
  for (const [name, mb] of P.map) {
    if (name === 'stringR' || name === 'stringL') continue;
    for (const part of mb.parts) part.geo.translate(O[0], O[1], O[2]);
  }
  for (const k in P.pivots) P.pivots[k].add(new THREE.Vector3(O[0], O[1], O[2]));
  const sh = (x, y, z) => new THREE.Vector3(x + O[0], y + O[1], z + O[2]);
  P.meta.muzzle = sh(0, by, PROD - 0.05);
  P.meta.leftHand = sh(0, 0.046, -0.3);
  P.meta.sight = sh(0, RAIL + 0.0295, PROD + 0.014); // front pin (ADS pivots around it)
  P.meta.xbow = { pivot: sh(ROOT, SY, PROD), tip: new THREE.Vector3(tx, 0, tz), flex: FLEX, half, rail: sh(0, by, nock - 0.17) };
}

// ------------------------------------------------------------------ RPG (RPG-7 style: one grenade at a time)
// A steel tube with a wooden heat shield round its middle, the pistol grip and trigger under the front third and a
// second grip ahead of them, the sight off the left of the tube and a flared venturi at the back. The grenade is its
// own part ('warhead', pivot on the muzzle): its bulb and nose stand out ahead of the tube, and in the viewmodel a
// stub of its motor meta.rpg.stroke long sits in the bore, which is how far the reload pushes it in.
function buildRPG(P) {
  const hi = P.hi;
  const B = P.get('body');
  const TY = 0.082; // bore axis, above the grip
  const MZ = -0.37, VZ = 0.44, RZ = 0.58; // muzzle, front of the venturi, back end
  const RT = 0.026, BORE = 0.021, STROKE = 0.1;
  const SX = -0.078, SH = TY + 0.064; // the sight line, left of and above the bore
  const rs = R(hi, 16, 8);
  const OD = { region: WR.GUNMETAL, color: [1.18, 1.3, 0.62], mottle: 0.06 }; // olive-drab paint
  const ODd = { ...OD, color: [0.72, 0.8, 0.4] };
  const shield = { ...M.wood, color: [0.7, 0.58, 0.5] }; // varnished
  // tube, with a ring round the muzzle and a dark bore
  barrelZ(B, 0, TY, VZ + 0.005, MZ, RT, BORE, { ...M.gunDark, rs });
  latheZ(B, [[RT - 0.001, -MZ - 0.02], [0.029, -MZ - 0.02], [0.029, -MZ + 0.001], [BORE, -MZ + 0.001], [BORE, -MZ - 0.02]], 0, TY, { ...M.gunDark, rs, sharp: true });
  cylZ(B, 0, TY, MZ + 0.0295, MZ + 0.0285, BORE - 0.0005, { ...M.black, rs: R(hi, 12, 7) });
  if (hi) {
    // front sight folded down on top, behind the muzzle ring
    boxR(B, -0.006, 0.006, TY + RT - 0.003, TY + RT + 0.006, MZ + 0.065, MZ + 0.035, M.gun);
    boxR(B, -0.0016, 0.0016, TY + RT + 0.006, TY + RT + 0.0092, MZ + 0.062, MZ + 0.104, M.gunDark);
  }
  // trigger housing under the tube, pistol grip (runs up through the fist), guard and trigger
  boxR(B, -0.0165, 0.0165, 0.026, TY - RT + 0.008, 0.04, -0.09, M.gun);
  for (const z of [0.04, -0.09]) latheZ(B, [[RT, -z - 0.006], [RT + 0.0035, -z - 0.006], [RT + 0.0035, -z + 0.006], [RT, -z + 0.006]], 0, TY, { ...M.gunDark, rs, sharp: true });
  profile(B, [[0.028, 0.029], [0.02, -0.01], [0.012, -0.045], [0.004, -0.072], [-0.03, -0.078], [-0.037, -0.062], [-0.024, -0.02], [-0.014, 0.029]], 0.029, { ...M.polyDark, bevel: 0.004 });
  B.tube(0, [[0, 0.029, -0.012], [0, 0.004, -0.018], [0, -0.004, -0.045], [0, 0.0, -0.075], [0, 0.029, -0.086]], 0.0032, 0.0032, { ...M.gun, rs: 5, ts: R(hi, 12, 6), cap: false });
  B.tube(0, [[0, 0.03, -0.04], [0, 0.017, -0.043], [0, 0.009, -0.037]], 0.0025, 0.002, { ...M.gunDark, rs: 5, ts: 4 });
  if (hi) B.seg(0, [-0.017, 0.045, 0.012], [0.017, 0.045, 0.012], 0.004, 0.004, { ...M.gunDark, rs: 6, hs: 1 }); // safety
  // front grip on a clamp band
  latheZ(B, [[RT, 0.138], [RT + 0.0035, 0.138], [RT + 0.0035, 0.192], [RT, 0.192]], 0, TY, { ...M.gunDark, rs, sharp: true });
  boxR(B, -0.011, 0.011, TY - RT - 0.012, TY - RT + 0.004, -0.142, -0.188, M.gun);
  profile(B, [[0.146, 0.048], [0.186, 0.048], [0.19, 0.02], [0.196, -0.034], [0.19, -0.047], [0.158, -0.05], [0.15, -0.038], [0.145, 0.02]], 0.03, { ...M.polyDark, bevel: 0.004, curveSegs: 4 });
  // wooden heat shield: two sleeves round the middle, steel bands at their ends
  for (const [z0, z1] of [[0.06, 0.205], [0.215, 0.36]]) {
    latheZ(B, [[0, -z1], [0.031, -z1], [0.0355, -z1 + 0.008], [0.0355, -z0 - 0.008], [0.031, -z0], [0, -z0]], 0, TY, { ...shield, rs });
    if (hi || z0 > 0.1) for (const z of [z0 + 0.012, z1 - 0.012]) latheZ(B, [[0.0355, -z - 0.004], [0.0366, -z - 0.004], [0.0366, -z + 0.004], [0.0355, -z + 0.004]], 0, TY, { ...M.gun, rs, sharp: true });
  }
  // venturi: a cone flaring open at the back, dark inside
  latheZ(B, [[0, -0.47], [0.019, -0.47], [0.024, -0.52], [0.04, -0.574], [0.046, -RZ], [0.0475, -RZ + 0.006], [0.042, -0.54], [0.033, -0.49], [0.0305, -VZ], [0, -VZ]], 0, TY, { ...M.gun, rs: R(hi, 18, 8), sharp: hi });
  cylZ(B, 0, TY, 0.4725, 0.4715, 0.0188, { ...M.black, rs: R(hi, 12, 7) });
  // sight: a bracket off the left of the tube, the optic (objective ahead, eyepiece behind), and a notch and post on
  // top of it that the sight line runs through
  const top = TY + 0.05; // top of the optic
  boxR(B, -0.064, -0.018, TY - 0.012, TY + 0.012, 0.035, -0.03, M.gun);
  boxR(B, SX - 0.016, SX + 0.016, TY + 0.004, top, 0.07, -0.058, ODd);
  cylZ(B, SX, TY + 0.027, -0.056, -0.082, 0.0165, { ...ODd, rs: R(hi, 12, 7) });
  cylZ(B, SX, TY + 0.027, -0.0815, -0.0825, 0.0138, { region: WR.GLASS, color: [0.3, 0.42, 0.5], mottle: 0.02, rs: R(hi, 12, 7) });
  cylZ(B, SX - 0.003, TY + 0.022, 0.068, 0.082, 0.009, { ...M.polyDark, rs: R(hi, 10, 6) }); // eyepiece
  if (hi) B.seg(0, [SX - 0.016, TY + 0.03, 0.012], [SX - 0.025, TY + 0.03, 0.012], 0.008, 0.008, { ...M.gunDark, rs: 10, hs: 1 }); // range drum
  boxR(B, SX - 0.009, SX + 0.009, top, SH, 0.058, 0.05, M.gunDark); // rear notch
  for (const s of [-1, 1]) boxR(B, SX + s * 0.0025, SX + s * 0.009, SH, SH + 0.008, 0.058, 0.05, M.gunDark);
  boxR(B, SX - 0.009, SX + 0.009, top, top + 0.005, -0.03, -0.05, M.gunDark); // front post between two ears
  for (const s of [-1, 1]) boxR(B, SX + s * 0.0065, SX + s * 0.009, top + 0.005, SH + 0.006, -0.038, -0.048, M.gunDark);
  boxR(B, SX - 0.0013, SX + 0.0013, top + 0.005, SH, -0.0415, -0.0445, M.gunDark);
  // the grenade: motor out of the muzzle, boat tail, bulb, ogive and fuze (the world model shows it loaded)
  const W = P.get('warhead');
  const f = -MZ;
  cylZ(W, 0, TY, MZ + (P.split ? STROKE : 0.005), MZ - 0.04, 0.0195, { ...M.gunDark, rs: R(hi, 12, 7) });
  latheZ(W, [[0, f + 0.038], [0.0195, f + 0.038], [0.024, f + 0.044], [0.0405, f + 0.088], [0.0425, f + 0.1], [0.0425, f + 0.165], [0.0412, f + 0.178], [0.035, f + 0.22], [0.025, f + 0.27], [0.0135, f + 0.322], [0.0095, f + 0.332], [0, f + 0.332]], 0, TY, { ...OD, rs });
  if (hi) latheZ(W, [[0.0425, f + 0.118], [0.0429, f + 0.119], [0.0429, f + 0.131], [0.0425, f + 0.132]], 0, TY, { ...M.black, rs, sharp: true }); // painted band
  latheZ(W, [[0, f + 0.33], [0.0082, f + 0.33], [0.0082, f + 0.356], [0.0062, f + 0.364], [0, f + 0.368]], 0, TY, { ...M.steel, color: [0.7, 0.7, 0.68], rs: R(hi, 10, 6) });
  P.pivot('warhead', new THREE.Vector3(0, TY, MZ));
  P.meta.muzzle = new THREE.Vector3(0, TY, MZ);
  P.meta.leftHand = new THREE.Vector3(0, 0.002, -0.168);
  P.meta.sight = new THREE.Vector3(SX, SH, -0.043); // front post
  P.meta.rpg = { grab: new THREE.Vector3(0, -0.022, -0.1325), stroke: STROKE }; // grab: where the left hand holds the grenade (from its pivot)
}

// ------------------------------------------------------------------ Flamethrower (scrap-built: pipe lance, fuel bottle, gas bottle for a stock)
// The fuel bottle screws in from below like a magazine ('mag': swapped on reload); the gas valve on the left
// is the 'charge' part (the reload ends with a hand on it).
function buildFlamethrower(P) {
  const hi = P.hi;
  const B = P.get('body');
  const AX = 0.068; // height of the lance
  const BZ = -0.118; // the fuel bottle hangs here
  const red = { region: WR.PLAIN, color: 0x9c2f1a, mottle: 0.12 };
  const blue = { region: WR.PLAIN, color: 0x3a5568, mottle: 0.12 };
  const hose = { region: WR.PLAIN, color: 0x16130f, mottle: 0.05 };
  // receiver: a welded box under a length of wide pipe that the lance, grip and bottles hang off, with a collar
  // for the fuel bottle
  boxR(B, -0.02, 0.02, 0.022, 0.07, 0.07, -0.17, M.gun);
  cylZ(B, 0, 0.07, 0.07, -0.17, 0.0215, { ...M.gun, rs: R(hi, 14, 8) });
  latheY(B, [[0, 0.004], [0.021, 0.004], [0.023, 0.008], [0.023, 0.024], [0, 0.024]], 0, BZ, { ...M.gunDark, rs: R(hi, 12, 7), sharp: true });
  if (hi) {
    for (const z of [0.05, -0.02, -0.15]) for (const s of [-1, 1]) cylZ(B, s * 0.0202, 0.034, z + 0.002, z - 0.002, 0.0028, { ...M.gunDark, rs: 5 }); // rivets
    boxR(B, -0.0206, 0.0206, 0.05, 0.053, 0.06, -0.16, M.gunDark); // weld seam
  }
  // pistol grip (taped), strap trigger guard, trigger
  profile(B, [[0.03, 0.022], [0.022, -0.012], [0.012, -0.03], [0.016, -0.04], [0.006, -0.074], [-0.028, -0.08], [-0.036, -0.066], [-0.024, -0.024], [-0.016, 0.022]], 0.028, { ...M.tape, bevel: 0.004 });
  B.tube(0, [[0, 0.021, -0.012], [0, 0.0, -0.016], [0, -0.004, -0.04], [0, -0.004, -0.064], [0, 0.021, -0.068]], 0.003, 0.003, { ...M.gun, rs: 5, ts: R(hi, 12, 6), cap: false });
  B.tube(0, [[0, 0.022, -0.036], [0, 0.009, -0.039], [0, 0.002, -0.034]], 0.0025, 0.002, { ...M.gunDark, rs: 5, ts: 4 });
  // gas bottle behind the receiver (it is the stock), taped butt pad
  latheZ(B, [[0, -0.3], [0.022, -0.3], [0.034, -0.282], [0.034, -0.105], [0.02, -0.078], [0.011, -0.07], [0, -0.07]], 0, 0.058, { ...blue, rs: R(hi, 14, 8) });
  latheZ(B, [[0, -0.312], [0.03, -0.312], [0.034, -0.304], [0.034, -0.284], [0, -0.284]], 0, 0.058, { ...M.tape, rs: R(hi, 14, 8), sharp: true });
  if (hi) for (const z of [0.13, 0.23]) latheZ(B, [[0.034, -z - 0.006], [0.0355, -z - 0.006], [0.0355, -z + 0.006], [0.034, -z + 0.006]], 0, 0.058, { ...M.steel, rs: 14, sharp: true }); // hose clamps
  // lance: pipe, wooden sleeve for the support hand, finned heat shield, flared nozzle
  cylZ(B, 0, AX, -0.17, -0.61, 0.0125, { ...M.steel, rs: R(hi, 12, 7) });
  latheZ(B, [[0, 0.168], [0.024, 0.168], [0.024, 0.19], [0, 0.19]], 0, AX, { ...M.gun, rs: R(hi, 12, 7), sharp: true });
  cylZ(B, 0, AX, -0.2, -0.335, 0.0225, { ...M.walnut, rs: R(hi, 12, 7) });
  for (let i = 0, n = hi ? 6 : 3; i < n; i++) {
    const f = 0.39 + (i * 0.192) / n;
    latheZ(B, [[0.0125, f], [0.023, f], [0.023, f + 0.014], [0.0125, f + 0.014]], 0, AX, { ...M.gunDark, rs: R(hi, 12, 7), sharp: true });
  }
  barrelZ(B, 0, AX, -0.6, -0.672, 0.017, 0.02, { ...M.rust, r1: 0.03, rs: R(hi, 14, 8) });
  // pilot light: a thin gas line along the underside to a jet below the nozzle
  B.tube(0, [[0.0, 0.03, -0.17], [0, AX - 0.03, -0.36], [0, AX - 0.034, -0.56], [0, AX - 0.034, -0.655], [0, AX - 0.024, -0.675]], 0.0034, 0.0034, { ...M.brass, rs: 5, ts: R(hi, 14, 7) });
  if (hi) {
    for (const z of [-0.37, -0.5, -0.59]) boxR(B, -0.006, 0.006, AX - 0.04, AX - 0.012, z, z - 0.008, M.gunDark); // line clips
    // gas hose from the stock bottle round the right of the receiver
    B.tube(0, [[0.018, 0.078, 0.09], [0.032, 0.07, 0.04], [0.03, 0.05, -0.06], [0.024, 0.04, -0.15], [0.006, 0.034, -0.172]], 0.0042, 0.0042, { ...hose, rs: 5, ts: 12 });
  }
  // fuel bottle: neck up into the collar, a painted steel flask with a stencilled band
  const MG = P.get('mag');
  const rs = R(hi, 14, 8);
  latheY(MG, [[0, -0.2], [0.03, -0.2], [0.038, -0.19], [0.038, -0.04], [0.032, -0.018], [0.015, -0.006], [0.015, 0.016], [0, 0.016]], 0, BZ, { ...red, rs });
  latheY(MG, [[0.038, -0.13], [0.0388, -0.128], [0.0388, -0.082], [0.038, -0.08]], 0, BZ, { region: WR.PLAIN, color: 0xd9cfae, mottle: 0.08, rs, sharp: true });
  latheY(MG, [[0, -0.208], [0.024, -0.208], [0.03, -0.2], [0, -0.2]], 0, BZ, { ...M.gunDark, rs, sharp: true });
  P.pivot('mag', new THREE.Vector3(0, 0.016, BZ));
  // gas valve: a little hand wheel on the left
  const CH = P.get('charge');
  CH.seg(0, [-0.02, 0.07, -0.045], [-0.031, 0.07, -0.045], 0.004, 0.004, { ...M.steel, rs: 6, hs: 1 });
  CH.seg(0, [-0.031, 0.07, -0.045], [-0.036, 0.07, -0.045], 0.015, 0.015, { ...red, rs: R(hi, 10, 6), hs: 1 });

  P.meta.muzzle = new THREE.Vector3(0, AX, -0.69);
  P.meta.leftHand = new THREE.Vector3(0, AX - 0.004, -0.268);
  P.meta.sight = new THREE.Vector3(0, 0.112, 0.02); // no sights: the eye rides just over the lance
  P.meta.chargeKnob = new THREE.Vector3(-0.037, 0.07, -0.045);
  P.meta.magGrab = new THREE.Vector3(0, -0.1, BZ);
}

// ------------------------------------------------------------------ Anti-tank rifle (PTRD-style: single shot, 14.5mm)
// A long thin barrel with a two-port brake, a folded bipod and a carry handle; iron sights off to the left of the
// bore; a tube stock to a padded shoulder piece. The loading port is the top right of the receiver, cut open: the
// 'bolt' part slides back out of it (handle on the right), and in the viewmodel the 'round' is laid in it on the
// reload and the spent 'case' thrown out of it (_animReloadSingle).
const ATR = { BY: 0.085, RR: 0.0245, PORT0: -0.028, PORT1: -0.168, SEAT: -0.04 };
// where the left hand holds a round (pinched over its middle) relative to its base, for the round turned by (tilt,
// yaw) as its mesh is (Euler XYZ: nose down, then crosswise)
const _atE = new THREE.Euler();
function atHold(out, tilt, yaw) {
  return out.set(0, 0.0175, -0.07).applyEuler(_atE.set(tilt, yaw, 0));
}
// a 14.5x114 round along -Z from its base at the origin (case only for the spent one)
function atRound(mb, hi, bullet) {
  const rs = R(hi, 8, 6);
  latheZ(mb, [[0, 0], [0.0135, 0], [0.0135, 0.004], [0.0117, 0.0055], [0.0117, 0.008], [0.0134, 0.0095], [0.0124, 0.088], [0.0084, 0.097], [0.0083, 0.114], [0, 0.114]], 0, 0, { ...M.brass, rs });
  if (!bullet) return;
  latheZ(mb, [[0, 0.113], [0.0074, 0.113], [0.0074, 0.124], [0.0062, 0.138], [0, 0.155]], 0, 0, { region: WR.STEEL, color: [0.9, 0.6, 0.42], mottle: 0.05, rs }); // copper-washed jacket
  latheZ(mb, [[0, 0.1428], [0.0047, 0.1428], [0, 0.1557]], 0, 0, { region: WR.PLAIN, color: 0x1a1a1a, mottle: 0.04, rs }); // black (armour-piercing) tip
}
function buildATRifle(P) {
  const hi = P.hi;
  const B = P.get('body');
  const { BY, RR } = ATR;
  const OD = { region: WR.GUNMETAL, color: [1.18, 1.3, 0.62], mottle: 0.06 }; // olive-drab paint
  const ODd = { ...OD, color: [0.92, 1.0, 0.5] };
  const barrel = { ...M.gun, color: [0.95, 0.95, 0.92] }; // bare blued steel
  const rs = R(hi, 12, 8);
  const rb = R(hi, 10, 6); // (bands and clamps)
  // part of a tube about the bore (or about (x, y)): radius r, z0 -> z1 (z0 behind), from phi0 round phiLen (phi 0 =
  // up, pi/2 = right); inward: the inside face
  const arcZ = (mb, x, y, r, z0, z1, phi0, phiLen, inward, o) => {
    const pts = (inward ? [[r, -z1], [r, -z0]] : [[r, -z0], [r, -z1]]).map((p) => new THREE.Vector2(p[0], p[1]));
    const geo = new THREE.LatheGeometry(pts, R(hi, 12, 7), phi0, phiLen);
    geo.rotateX(-PI / 2);
    geo.translate(x, y, 0);
    return mb.geom(0, geo, o);
  };
  // ---- receiver: closed behind and ahead of the port, and under it a trough (the top right cut away)
  // (far off, in the world model: one closed tube with a dark plate for the port)
  if (!hi) {
    cylZ(B, 0, BY, 0.036, -0.215, RR, { ...OD, rs });
    boxR(B, 0.0, 0.022, BY + 0.016, BY + 0.0275, ATR.PORT0, ATR.PORT1, M.black);
  } else {
    cylZ(B, 0, BY, 0.036, ATR.PORT0, RR, { ...OD, rs });
    cylZ(B, 0, BY, ATR.PORT1, -0.215, RR, { ...OD, rs });
    const OPEN0 = 1.75, OPEN = 2.1; // the cut: from just below the right side over the top to a little left of it
    arcZ(B, 0, BY, RR, ATR.PORT0, ATR.PORT1, OPEN0, 2 * PI - OPEN, false, OD);
    arcZ(B, 0, BY, RR - 0.0025, ATR.PORT0, ATR.PORT1, OPEN0, 2 * PI - OPEN, true, { ...M.gunDark, color: [0.5, 0.5, 0.48] });
    for (const a of [OPEN0, OPEN0 - OPEN + 2 * PI]) {
      const x = Math.sin(a) * (RR - 0.00125), y = BY + Math.cos(a) * (RR - 0.00125);
      B.seg(0, [x, y, ATR.PORT0], [x, y, ATR.PORT1], 0.0014, 0.0014, { ...OD, rs: 5, hs: 1 }); // the cut edges
    }
    cylZ(B, 0, BY, ATR.PORT1 + 0.0006, ATR.PORT1 - 0.0004, 0.0136, { ...M.black, rs: 10 }); // the chamber mouth
  }
  // trigger group and its housing, wooden pistol grip, guard, trigger
  boxR(B, -0.012, 0.012, 0.028, BY - 0.02, 0.03, -0.1, OD);
  profile(B, [[0.032, 0.04], [0.03, 0.02], [0.0, -0.07], [-0.006, -0.08], [-0.032, -0.083], [-0.042, -0.074], [-0.022, 0.04]], 0.032, {
    ...M.walnut,
    bevel: 0.006,
    bevelSegs: hi ? 2 : 1,
    curveSegs: 4,
  });
  B.tube(0, [[0, 0.03, -0.026], [0, 0.006, -0.03], [0, -0.004, -0.052], [0, 0.004, -0.076], [0, 0.03, -0.086]], 0.0034, 0.0034, { ...OD, rs: R(hi, 5, 4), ts: R(hi, 9, 5), cap: false });
  B.tube(0, [[0, 0.03, -0.046], [0, 0.015, -0.049], [0, 0.006, -0.044]], 0.0026, 0.002, { ...M.gunDark, rs: 5, ts: 4 });
  // ---- stock: a tube back to the shoulder piece, a cheek rest, the steel yoke and its padded leather cushion
  const SY = 0.032;
  cylZ(B, 0, SY, 0.37, -0.02, 0.019, { ...OD, rs: rb });
  profile(B, [[-0.15, SY + 0.012], [-0.172, SY + 0.05], [-0.31, SY + 0.053], [-0.33, SY + 0.012]], 0.036, { ...M.walnut, bevel: 0.006, curveSegs: 3 });
  profile(B, [[-0.238, SY - 0.012], [-0.244, -0.058], [-0.256, -0.068], [-0.282, -0.066], [-0.276, SY - 0.012]], 0.03, { ...M.walnut, bevel: 0.005, curveSegs: 3 }); // rear grip
  boxR(B, -0.024, 0.024, -0.08, 0.108, 0.358, 0.378, { ...OD, round: 0.2, seg: 2 });
  B.box(0, [0, 0.014, 0.408], [0.06, 0.21, 0.06], { ...M.leather, color: [0.78, 0.66, 0.52], round: 0.55, seg: R(hi, 3, 2) });
  // ---- barrel: a heavy chamber section, the long taper, a wooden handguard over its back for the left hand
  cylZ(B, 0, BY, -0.21, -0.32, 0.021, { ...OD, rs });
  barrelZ(B, 0, BY, -0.32, -1.13, 0.0175, 0.0074, { ...barrel, r1: 0.0135, rs: R(hi, 10, 8) });
  latheZ(B, [[0, 0.24], [0.0236, 0.24], [0.0266, 0.258], [0.0266, 0.452], [0.0236, 0.47], [0, 0.47]], 0, BY, { ...M.walnut, rs, swapUV: true });
  if (hi) for (const z of [-0.236, -0.474]) latheZ(B, [[0.016, -z - 0.006], [0.0272, -z - 0.006], [0.0272, -z + 0.006], [0.016, -z + 0.006]], 0, BY, { ...OD, rs: rb });
  // carry handle on two clamps, offset to the right, with a wooden grip
  for (const z of [-0.6, -0.72]) latheZ(B, [[0.0155, -z - 0.008], [0.019, -z - 0.008], [0.019, -z + 0.008], [0.0155, -z + 0.008]], 0, BY, { ...OD, rs: rb });
  B.tube(0, [[0.01, BY + 0.014, -0.6], [0.02, BY + 0.048, -0.612], [0.022, BY + 0.056, -0.64], [0.022, BY + 0.056, -0.68], [0.02, BY + 0.048, -0.708], [0.01, BY + 0.014, -0.72]], 0.005, 0.005, { ...OD, rs: 6, ts: R(hi, 10, 6), cap: false });
  B.seg(0, [0.022, BY + 0.057, -0.636], [0.022, BY + 0.057, -0.684], 0.0085, 0.0085, { ...M.walnut, rs: R(hi, 10, 6), hs: 1 });
  // folded bipod: hinge collar under the barrel, two legs lying back along it, spade feet
  const HZ = -0.86;
  if (hi) latheZ(B, [[0.0145, -HZ - 0.013], [0.0205, -HZ - 0.013], [0.0205, -HZ + 0.013], [0.0145, -HZ + 0.013]], 0, BY, { ...OD, rs: rb });
  boxR(B, -0.017, 0.017, BY - 0.034, BY - 0.012, HZ + 0.013, HZ - 0.013, OD);
  for (const s of [-1, 1]) {
    B.seg(0, [s * 0.011, BY - 0.028, HZ], [s * 0.013, BY - 0.031, -0.52], 0.0058, 0.005, { ...ODd, rs: 6, hs: 1 });
    boxR(B, s * 0.009, s * 0.017, BY - 0.046, BY - 0.02, -0.505, -0.535, ODd);
  }
  // front sight, off to the left on its own clamp: a post under a hood
  const SX = -0.04, SH = 0.148;
  if (hi) latheZ(B, [[0.0132, 1.068], [0.0168, 1.068], [0.0168, 1.092], [0.0132, 1.092]], 0, BY, { ...OD, rs: rb });
  boxR(B, SX - 0.006, -0.012, BY - 0.006, BY + 0.008, -1.07, -1.09, OD);
  boxR(B, SX - 0.006, SX + 0.006, BY + 0.008, SH - 0.016, -1.073, -1.087, OD);
  boxR(B, SX - 0.0024, SX + 0.0024, SH - 0.016, SH, -1.077, -1.083, M.gunDark);
  if (hi) {
    arcZ(B, SX, SH - 0.004, 0.0115, -1.066, -1.094, -1.65, 3.3, false, OD);
    arcZ(B, SX, SH - 0.004, 0.0095, -1.066, -1.094, -1.65, 3.3, true, ODd);
  }
  // rear sight: a leaf on a bracket off the left of the receiver, an aperture at the top
  boxR(B, SX - 0.006, -0.0232, BY + 0.004, BY + 0.018, -0.088, -0.112, OD);
  boxR(B, SX - 0.004, SX + 0.004, BY + 0.02, SH - 0.008, -0.096, -0.104, ODd);
  if (hi) latheZ(B, [[0.0038, 0.097], [0.0085, 0.097], [0.0085, 0.103], [0.0038, 0.103]], SX, SH, { ...ODd, rs: 12, sharp: true });
  else boxR(B, SX - 0.008, SX + 0.008, SH - 0.008, SH + 0.008, -0.097, -0.103, ODd);
  // muzzle brake: three plates on straps - the two ports between them open right through
  const MB0 = -1.128, MB1 = -1.236;
  cylZ(B, 0, BY, -1.11, MB0, 0.0172, { ...barrel, rs: rb });
  for (const z of [MB0, -1.176, MB1 + 0.012]) boxR(B, -0.029, 0.029, BY - 0.023, BY + 0.023, z, z - 0.012, ODd);
  for (const s of [-1, 1]) boxR(B, -0.029, 0.029, BY + s * 0.017, BY + s * 0.0245, MB0, MB1, OD);
  if (hi) cylZ(B, 0, BY, MB1 + 0.0004, MB1 - 0.0004, 0.008, { ...M.black, rs: 10 });
  // bolt (separate): body, cocking piece out the back, the handle on the right with a ball knob
  const BO = P.get('bolt');
  cylZ(BO, 0, BY, 0.07, ATR.SEAT, 0.0195, { ...M.steel, color: [0.4, 0.4, 0.42], rs: R(hi, 10, 6) });
  cylZ(BO, 0, BY, 0.09, 0.07, 0.0155, { ...OD, rs: R(hi, 10, 6) });
  BO.tube(0, [[0.016, BY, 0.058], [0.044, BY - 0.012, 0.06], [0.068, BY - 0.03, 0.064]], 0.005, 0.0045, { ...M.gun, rs: R(hi, 6, 4), ts: R(hi, 6, 3) });
  BO.ellip(0, [0.072, BY - 0.033, 0.064], [0.0105, 0.0105, 0.0105], { ...M.gunDark, ws: R(hi, 8, 6), hs: R(hi, 6, 4) });
  P.pivot('bolt', new THREE.Vector3(0, BY, 0.06));
  if (P.split) {
    atRound(P.get('round'), hi, true);
    atRound(P.get('case'), hi, false);
  }
  P.meta.muzzle = new THREE.Vector3(0, BY, -1.24);
  P.meta.leftHand = new THREE.Vector3(0, BY - 0.002, -0.36);
  P.meta.sight = new THREE.Vector3(SX, SH, -0.1); // the rear aperture
  P.meta.boltKnob = new THREE.Vector3(0.072, BY - 0.033, 0.064);
  P.meta.port = new THREE.Vector3(0.008, BY + 0.018, -0.1);
  P.meta.seat = new THREE.Vector3(0, BY, ATR.SEAT); // the base of a chambered round
}

// ------------------------------------------------------------------ Melee
/**
 * Blade from cross-sections: rings[i] is a closed loop of [x, y, z] points (the same count in every ring),
 * stations running along the blade. Each face between two neighbouring loop points is its own geometry with
 * mats[k] (k = the face's first point), so grind lines, spine and edge stay crisp while every face shades
 * smoothly along the length.
 */
function facetLoft(mb, rings, mats) {
  const ns = rings.length, np = rings[0].length;
  const z0 = rings[0][0][2], z1 = rings[ns - 1][0][2];
  for (let k = 0; k < np; k++) {
    const k1 = (k + 1) % np;
    const pos = new Float32Array(ns * 6), uv = new Float32Array(ns * 4), idx = [];
    for (let i = 0; i < ns; i++) {
      for (let s = 0; s < 2; s++) {
        const p = rings[i][s ? k1 : k];
        pos.set(p, (i * 2 + s) * 3);
        uv[(i * 2 + s) * 2] = (p[2] - z0) / (z1 - z0); // brushed grain along the blade
        uv[(i * 2 + s) * 2 + 1] = (k + s) / np;
      }
      if (i < ns - 1) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    mb.geom(0, geo, { ...mats[k], keepNormals: true });
  }
}

// Knife handle cross-section: an oval, narrow across the flats (X) and tall from spine to edge (Y). The 'knife'
// hand pose closes its fingers on this oval, so the two stay in step. tilt: how far the handle leans off square
// across the palm (rad), which points the blade along the forearm the way a real knife hand holds it.
const KNIFE_GRIP = { rx: 0.0122, ry: 0.015, tilt: 0.52 };

// A Ka-Bar style fighting knife: stacked leather washers, oval steel guard and pommel, a clip-point blade
// with a fuller, flat sides and a brighter ground edge.
function buildKnife(P) {
  const hi = P.hi;
  const B = P.get('body');
  const { rx, ry } = KNIFE_GRIP;
  const sx = rx / ry;
  // handle: washers with a shallow seam between each, swelling a little under the palm
  const H0 = -0.0505, H1 = 0.068; // guard face .. pommel (z)
  const swell = (z) => 0.94 + 0.06 * Math.sin(PI * (z - H0) / (H1 - H0));
  const hp = [[0, -H1], [ry * swell(H1) * 0.96, -H1]];
  const washers = hi ? 16 : 1, seam = hi ? 0.0007 : 0;
  for (let i = 0; i < washers; i++) {
    const za = H1 - (i * (H1 - H0)) / washers, zb = H1 - ((i + 1) * (H1 - H0)) / washers;
    hp.push([ry * swell(za) - seam, -za], [ry * swell(za), -za + 0.0012], [ry * swell(zb), -zb - 0.0012]);
  }
  hp.push([ry * swell(H0) - seam, -H0], [0, -H0]);
  latheZ(B, hp, 0, 0, {
    region: WR.PLAIN,
    color: 0x5c3a24,
    mottle: 0.14,
    rs: R(hi, 14, 7),
    sx,
    tint: (p, n, c) => {
      if (!hi) return;
      const q = ((H1 - p.z) * washers) / (H1 - H0), fr = q - Math.floor(q);
      if (Math.floor(q) % 2) c.multiplyScalar(0.86); // each washer a slightly different hide
      if (fr < 0.1 || fr > 0.9) c.multiplyScalar(0.7); // dark seams
    },
  });
  // pommel: an oval steel cap with the tang's peened nut
  latheZ(B, [[0, -0.0838], [ry * 0.45, -0.0835], [ry * 0.78, -0.0815], [ry * 1.0, -0.077], [ry * 1.02, -0.0705], [ry * 0.95, -0.0675], [0, -0.0675]], 0, 0, { ...M.gunDark, rs: R(hi, 14, 7), sx });
  if (hi) cylZ(B, 0, 0, 0.0832, 0.0858, 0.0042, { ...M.steel, rs: 6 });
  // guard: an oval plate, longer below (it keeps the fingers off the edge); the quillon tips lean forward
  const G = [[-0.0062, 0.0168], [-0.0062, 0.0218, 0, 0.0218], [0.0062, 0.0218, 0.0062, 0.0168], [0.0062, -0.0232], [0.0062, -0.0282, 0, -0.0282], [-0.0062, -0.0282, -0.0062, -0.0232]];
  sectionZ(B, G, -0.0505, -0.0565, {
    ...M.gunDark,
    bevel: 0.0009,
    curveSegs: R(hi, 5, 2),
    shape: (p) => {
      p.z -= Math.max(0, Math.abs(p.y + 0.003) - 0.016) * 0.22;
    },
  });

  // blade: f = distance forward of the grip (-z), u = up (spine +Y, edge -Y)
  const F0 = 0.054, PLUNGE = 0.068, CLIP = 0.153, TIP = 0.238, UT = -0.0018;
  const top = (f) => {
    if (f < CLIP) return 0.0112;
    const t = (f - CLIP) / (TIP - CLIP);
    return 0.0112 + (UT - 0.0112) * (t + 0.6 * t * (1 - t)); // a hollow clip
  };
  const edge = (f) => (f < 0.138 ? -0.0163 : -0.0163 + (UT + 0.0163) * ((f - 0.138) / (TIP - 0.138)) ** 1.8);
  const rings = [];
  const N = hi ? 36 : 12;
  for (let i = 0; i <= N; i++) {
    const f = F0 + (TIP - F0) * (i / N) ** 0.92;
    const uT = top(f), uE = edge(f), z = -f;
    // distal taper, pinching to the point
    const w = 0.0024 * (1 - 0.3 * ((f - F0) / (TIP - F0))) * Math.min(1, (TIP - f) / 0.03) ** 0.6;
    const ground = sstep(PLUNGE - 0.012, PLUNGE + 0.006, f); // 0 on the blunt ricasso by the guard
    const uG = uE + 0.44 * (uT - uE) * ground; // grind line
    const wE = w + (0.00022 - w) * ground; // edge half-thickness
    const clip = sstep(CLIP - 0.008, CLIP + 0.03, f); // sharpened swedge along the clip
    const uS = Math.max(uG, uT - clip * Math.min(0.0042, 0.5 * (uT - uG)));
    const wS = w * (1 - 0.75 * clip);
    const side = [[wS, uT], [w, uS]];
    if (hi) {
      // fuller: a flat-bottomed groove that follows the spine and fades out at both ends
      const fr = sstep(0.07, 0.08, f) * (1 - sstep(0.148, 0.162, f));
      const fc = uT - 0.0062, fh = 0.0021 * Math.sqrt(fr), fd = 0.0008 * fr;
      const cl = (u) => Math.min(uS, Math.max(uG, u));
      side.push([w, cl(fc + fh)], [w - fd, cl(fc + fh * 0.45)], [w - fd, cl(fc - fh * 0.45)], [w, cl(fc - fh)]);
    }
    side.push([w, uG], [wE, uE]);
    const ring = side.map(([x, u]) => [x, u, z]);
    for (let k = side.length - 1; k >= 0; k--) ring.push([-side[k][0], side[k][1], z]);
    rings.push(ring);
  }
  const flat = { ...M.blade, mottle: 0.04 };
  const bright = { ...M.blade, color: [1.08, 1.08, 1.13], mottle: 0.03 }; // freshly ground
  const fuller = { ...M.blade, color: [0.66, 0.66, 0.7] };
  const n = rings[0].length / 2, last = n - 1; // points per side
  const mats = [];
  for (let k = 0; k < n * 2; k++) {
    const s = k < n ? k : n * 2 - 2 - k; // the matching face on the right side
    if (k === n * 2 - 1) mats.push({ ...M.blade, color: [0.78, 0.78, 0.82] }); // spine
    else if (s === 0 || s >= last - 1 || k === last) mats.push(bright); // swedge, edge bevel, edge
    else if (hi && s >= 2 && s <= 4) mats.push(fuller);
    else mats.push(flat);
  }
  facetLoft(B, rings, mats);
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

// ------------------------------------------------------------------ Nunchucks
// One handle, in weapon space: the hand's grip at the origin, the wood from its butt at +Z to its chain end at -Z,
// then the steel cap, the swivel and its eye (the chain's first link runs through it, NK_GEOM.eye past the wood).
// Octagonal hardwood, 30 cm, thicker at the butt, oiled dark and worn pale where hands and blows have been at it,
// friction tape round the grip. Both handles are this one shape (shared/nunchaku.js: NK_GEOM).
const NK_OCT = 8;
const nkR = (z) => {
  // the wood's radius (to its corners) along its length: a straight taper, eased in at both ends
  const { handle, grip, rTop, rButt } = NK_GEOM;
  const t = Math.min(1, Math.max(0, (z + grip) / handle)); // 0 at the chain end .. 1 at the butt
  return (rTop + (rButt - rTop) * t) * (1 - 0.12 * Math.max(0, 1 - (1 - t) / 0.02) ** 2 - 0.05 * Math.max(0, 1 - t / 0.015) ** 2);
};
function nkRing(z, r) {
  const ring = [];
  for (let k = 0; k < NK_OCT; k++) {
    const a = -((k + 0.5) / NK_OCT) * PI * 2; // (clockwise seen from +Z: facetLoft's faces then point out)
    ring.push([Math.cos(a) * r, Math.sin(a) * r, z]);
  }
  return ring;
}
const _nkPale = new THREE.Color(0.86, 0.7, 0.5);
function nunchakuHandle(B, hi, at = null) {
  const { handle, grip, eye, rTop } = NK_GEOM;
  const Z0 = -grip, Z1 = handle - grip; // chain end .. butt
  const mark = B.parts.length;
  // the wood: two turned grooves below the cap
  const grooves = hi ? [Z0 + 0.03, Z0 + 0.037] : [];
  const rings = [];
  const N = hi ? 40 : 8;
  for (let i = 0; i <= N; i++) {
    const z = Z0 + ((Z1 - Z0) * i) / N;
    let r = nkR(z);
    for (const g of grooves) r -= 0.0007 * Math.max(0, 1 - Math.abs(z - g) / 0.0035);
    rings.push(nkRing(z, r));
  }
  const rnd = mulberry32(57);
  const faceTone = Array.from({ length: NK_OCT }, () => 0.92 + rnd() * 0.16);
  const wood = (k) => ({
    region: WR.WALNUT,
    color: [1.02 * faceTone[k], 0.76 * faceTone[k], 0.56 * faceTone[k]],
    mottle: 0.07,
    uv: [1, 0.5, 0, 0.25],
    tint: (p, n, c) => {
      if (!hi) return;
      // long dark streaks of grain, dents toward the butt (the striking end), the butt and the chain end rubbed pale
      const g = fbm3(p.x * 180 + k * 3.1, p.y * 180, p.z * 14, 3, 11);
      c.multiplyScalar(0.8 + 0.4 * g);
      const dent = fbm3(p.x * 90, p.y * 90, p.z * 90, 2, 23);
      if (p.z > 0.02 && dent > 0.62) c.multiplyScalar(1 - Math.min(0.5, (dent - 0.62) * 3));
      const worn = sstep(0.06, 0.1, p.z) * 0.22 + (1 - sstep(Z0 + 0.02, Z0 + 0.06, p.z)) * 0.1;
      c.lerp(_nkPale, worn * (0.5 + 0.5 * g));
      if (grooves.some((gz) => Math.abs(p.z - gz) < 0.002)) c.multiplyScalar(0.45);
    },
  });
  facetLoft(B, rings, Array.from({ length: NK_OCT }, (_, k) => wood(k)));
  // the butt: closed with a shallow dome of end grain
  latheZ(B, [[0, -Z1 - 0.0022], [nkR(Z1) * 0.6, -Z1 - 0.0016], [nkR(Z1) * 0.93, -Z1 + 0.0004], [nkR(Z1) * 0.93, -Z1 + 0.004], [0, -Z1 + 0.004]], 0, 0, { region: WR.WALNUT, color: [0.78, 0.56, 0.4], mottle: 0.1, rs: NK_OCT, sharp: true });
  // friction tape round the grip: wound on in turns, each lapping the last
  const T0 = -0.058, T1 = 0.072, turns = hi ? 13 : 1, TN = turns * (hi ? 3 : 1);
  const trings = [];
  for (let i = 0; i <= TN; i++) {
    const f = i / TN;
    const z = T0 + (T1 - T0) * f;
    const lap = hi && (f * turns) % 1 < 0.34 ? 0.00035 : 0;
    const endIn = i === 0 || i === TN ? -0.0009 : 0; // (the two ends turned in under the wood's surface: closed)
    trings.push(nkRing(z, nkR(z) + 0.0007 + lap + endIn));
  }
  const tape = {
    ...M.tape,
    color: [0.3, 0.3, 0.31],
    mottle: 0.09,
    tint: (p, n, c) => {
      if (!hi) return;
      const f = (((p.z - T0) / (T1 - T0)) * turns) % 1;
      if (f < 0.34) c.multiplyScalar(1.18);
      if (f > 0.9) c.multiplyScalar(0.7);
      c.multiplyScalar(0.85 + 0.3 * fbm3(p.x * 300, p.y * 300, p.z * 120, 2, 5));
    },
  };
  facetLoft(B, trings, Array.from({ length: NK_OCT }, () => tape));
  // the cap: a steel ferrule over the end of the wood, a domed top, the swivel's post and ball, and the eye
  const F0 = -Z0 - 0.013, F1 = -Z0; // (as distances forward, for latheZ)
  const rf = rTop + 0.0009;
  latheZ(B, [[0, F0], [rf, F0], [rf, F1 - 0.0012], [rf - 0.0012, F1 + 0.0008], [rf * 0.55, F1 + 0.003], [0.0034, F1 + 0.0036], [0.003, F1 + 0.0066], [0.0044, F1 + 0.0078], [0.0044, F1 + 0.0098], [0.0026, F1 + 0.0112], [0, F1 + 0.0112]], 0, 0, { ...M.steel, color: [0.82, 0.83, 0.86], mottle: 0.08, rs: hi ? 14 : 8, sharp: true });
  // (the eye: a ring standing on the ball, its hole across the handle's X axis)
  const ring = new THREE.TorusGeometry(0.0038, 0.00135, hi ? 7 : 5, hi ? 14 : 8);
  ring.rotateY(PI / 2);
  ring.translate(0, 0, Z0 - eye);
  B.geom(0, ring, { ...M.steel, color: [0.9, 0.9, 0.94], mottle: 0.05 });
  if (at) for (let i = mark; i < B.parts.length; i++) B.parts[i].geo.applyMatrix4(at);
}
// One link of the chain, in its own space: its two ends (where the next links bear on it) at z = -+link/2, lying in
// the YZ plane. Welded steel, 3.2 mm wire.
const NK_WIRE = 0.0016;
function nunchakuLink(B, hi, at = null) {
  const Rw = 0.0042, half = NK_GEOM.link / 2 + NK_WIRE - Rw;
  const g = new THREE.TorusGeometry(Rw, NK_WIRE, hi ? 7 : 5, hi ? 16 : 10);
  g.rotateY(PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + (p.getZ(i) > 1e-6 ? half : p.getZ(i) < -1e-6 ? -half : 0));
  if (at) g.applyMatrix4(at);
  B.geom(0, g, { ...M.steel, color: [0.95, 0.95, 1.0], mottle: 0.08 });
}
// The chain's joints for the model that is not simulated (lying on the ground): the two handles side by side, the
// chain in a loop between their eyes.
const NK_FOLD = 0.036;
function nkFoldJoints() {
  const n = NK_GEOM.links, a = NK_FOLD / 2;
  // half an ellipse of the chain's length over that chord: its depth by bisection, then points an equal way apart
  const perim = (b) => (PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)))) / 2;
  let lo = 0.001, up = 0.2;
  for (let i = 0; i < 40; i++) {
    const m = (lo + up) / 2;
    if (perim(m) < NK_CHAIN) lo = m;
    else up = m;
  }
  const b = (lo + up) / 2, S = 800, pts = [];
  let acc = 0, next = 0, prev = [0, 0];
  for (let i = 0; i <= S; i++) {
    const t = (i / S) * PI, q = [a - a * Math.cos(t), -b * Math.sin(t)];
    if (i) acc += Math.hypot(q[0] - prev[0], q[1] - prev[1]);
    while (pts.length <= n && acc >= next - 1e-9) {
      pts.push(q);
      next += NK_CHAIN / n;
    }
    prev = q;
  }
  while (pts.length <= n) pts.push([NK_FOLD, 0]);
  pts[n] = [NK_FOLD, 0];
  const z0 = -NK_GEOM.grip - NK_GEOM.eye;
  return pts.map(([x, z]) => new THREE.Vector3(x, 0, z0 + z));
}
function buildNunchaku(P) {
  const hi = P.hi;
  const B = P.get('body');
  nunchakuHandle(B, hi);
  P.meta.muzzle = null;
  if (P.split) return; // the first-person view draws the other handle and the chain itself, from the simulation
  nunchakuHandle(B, hi, new THREE.Matrix4().makeRotationZ(PI / NK_OCT).setPosition(NK_FOLD, 0, 0));
  const J = nkFoldJoints();
  const zAxis = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i < J.length - 1; i++) {
    const d = new THREE.Vector3().subVectors(J[i + 1], J[i]).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(zAxis, d);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(zAxis, i % 2 ? 0 : PI / 2));
    nunchakuLink(B, hi, new THREE.Matrix4().compose(new THREE.Vector3().addVectors(J[i], J[i + 1]).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  }
}
/** The parts both views draw the simulated half from: { handle, link } geometries (hi: the first-person detail). */
const nkGeoCache = new Map();
export function getNunchakuGeo(hi) {
  let g = nkGeoCache.get(!!hi);
  if (!g) {
    const P = new PartSet(true, !!hi);
    nunchakuHandle(P.get('handle'), !!hi);
    nunchakuLink(P.get('link'), !!hi);
    const parts = finishParts(P);
    g = { handle: parts.handle.geometry, link: parts.link.geometry, tris: parts.handle.tris * 2 + NK_GEOM.links * parts.link.tris };
    nkGeoCache.set(!!hi, g);
  }
  return g;
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

// Frag grenade: a Mk 2 "pineapple" at real size (6.4 cm across the body, 9.5 cm with the fuze). Cast-iron egg cut into
// 8 columns x 5 rows of knobs by its grooves, olive drab worn back to dark iron on the knobs' corners; the fuze on top
// with its striker housing, the spoon (safety lever) down the +Z side under the palm, the cotter pin through the fuze
// and its pull ring hanging on the -X side, where the other hand finds it. Long axis +Y, the grip at the body's middle.
const FRAG = { yc: -0.006, a: 0.037, R: 0.032, cols: 8, rows: 5, y0: -0.041, y1: 0.025 };
const fragR = (y) => FRAG.R * Math.sqrt(Math.max(0, 1 - ((y - FRAG.yc) / FRAG.a) ** 2));
// how much of a knob's face (1) or groove (0) is at (angle, height): the cast segments of the body
function fragKnob(phi, y) {
  const u = (((phi / (PI * 2)) * FRAG.cols) % 1 + 1) % 1;
  const v = (y - FRAG.y0) / (FRAG.y1 - FRAG.y0);
  if (v <= 0 || v >= 1) return 0.4;
  const vr = (v * FRAG.rows) % 1;
  const ss = (e0, e1, x) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  return ss(0.0, 0.16, Math.min(u, 1 - u)) * ss(0.0, 0.16, Math.min(vr, 1 - vr));
}
function buildGrenade(P) {
  const hi = P.hi;
  const B = P.get('body');
  // the cast body: a lathed egg, its radius pushed in along the grooves
  // (8 columns: a ring of 3 or 6 to a column, its first vertex on a groove; each of the 5 rows sampled from its groove
  // up, so every groove is a vertex line and stays crisp even on the 3rd-person model)
  const ring = R(hi, 48, 24);
  const ys = [FRAG.yc - FRAG.a, FRAG.yc - FRAG.a * 0.94, FRAG.yc - FRAG.a * 0.8];
  const steps = hi ? [0, 0.1, 0.24, 0.5, 0.76, 0.9] : [0, 0.25, 0.75];
  for (let k = 0; k < FRAG.rows; k++) for (const t of steps) ys.push(FRAG.y0 + ((k + t) / FRAG.rows) * (FRAG.y1 - FRAG.y0));
  ys.push(FRAG.y1, 0.027, 0.0295);
  const prof = ys.map((y, i) => new THREE.Vector2(i ? fragR(y) : 0, y));
  const body = new THREE.LatheGeometry(prof, ring);
  {
    const p = body.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const r = Math.hypot(x, z);
      if (r < 1e-6) continue;
      const k = 1 - 0.13 * (1 - fragKnob(Math.atan2(z, x), y));
      p.setXYZ(i, x * k, y, z * k);
    }
  }
  B.geom(0, body, {
    region: WR.PLAIN,
    color: [0.2, 0.23, 0.12],
    mottle: 0.14,
    mf: 140,
    // olive drab paint, darker down in the grooves, rubbed back to iron on the knobs' sharp corners
    tint: (p, n, c) => {
      const kn = fragKnob(Math.atan2(p.z, p.x), p.y);
      c.multiplyScalar(0.62 + 0.38 * kn);
      const wear = kn > 0.55 && kn < 0.9 ? (fbm3(p.x * 300, p.y * 300, p.z * 300, 2, 5) > 0.58 ? 1 : 0) : 0;
      if (wear) c.lerp(new THREE.Color(0.2, 0.2, 0.19), 0.7);
    },
  });
  // filler plug in the base
  latheY(B, [[0, -0.0442], [0.0072, -0.0442], [0.0078, -0.0425], [0.0078, -0.039], [0, -0.039]], 0, 0, { ...M.gunDark, rs: R(hi, 12, 7), sharp: true });
  // fuze: threaded collar, body, striker housing with the lever's pivot ears
  const rs = R(hi, 14, 8);
  latheY(B, [[0, 0.024], [0.0112, 0.024], [0.0116, 0.026], [0.0116, 0.031], [0.0098, 0.0325], [0, 0.0325]], 0, 0, { ...M.gun, rs, sharp: true });
  latheY(B, [[0, 0.032], [0.0086, 0.032], [0.0086, 0.041], [0.0102, 0.0418], [0.0102, 0.0468], [0.0088, 0.0488], [0.004, 0.0505], [0, 0.0505]], 0, 0, { ...M.steel, color: [0.6, 0.62, 0.58], rs, sharp: true });
  if (hi) for (let i = 0; i < 6; i++) latheY(B, [[0.0117, 0.0262 + i * 0.0008], [0.0121, 0.0265 + i * 0.0008], [0.0117, 0.0268 + i * 0.0008]], 0, 0, { ...M.gun, rs });
  for (const s of [-1, 1]) boxR(B, s * 0.0058 - 0.0016, s * 0.0058 + 0.0016, 0.038, 0.0475, 0.006, 0.0128, { ...M.steel, color: [0.56, 0.58, 0.54], round: 0.3, seg: 2 });
  // the spoon: a strip of pressed steel hooked over the striker, then down the side, hugging the body to its waist
  // (its inner face: over the striker, down the fuze, then a millimetre off the knobs, flaring at the tip)
  const spoonOuter = [[0.001, 0.0512], [0.0102, 0.051], [0.0118, 0.0488], [0.0122, 0.041], [0.0128, 0.0338]];
  for (let y = 0.03; y > -0.017; y -= 0.0045) spoonOuter.push([Math.max(fragR(y), 0.0128) + 0.001, y]);
  spoonOuter.push([fragR(-0.0195) + 0.0026, -0.0195]);
  const th = 0.0016;
  const spoonInner = spoonOuter.map(([z, y], i) => {
    const a = spoonOuter[Math.max(0, i - 1)];
    const b = spoonOuter[Math.min(spoonOuter.length - 1, i + 1)];
    const tz = b[0] - a[0], ty = b[1] - a[1];
    const l = Math.hypot(tz, ty) || 1;
    return [z + (ty / l) * -th, y - (tz / l) * -th];
  });
  // (profile: f = -z, u = y; the strip is 1.3 cm wide, a little narrower where it hooks over the top)
  const pts = [...spoonOuter.map(([z, y]) => [-z, y]), ...spoonInner.reverse().map(([z, y]) => [-z, y])];
  profile(B, pts, 0.013, { region: WR.PLAIN, color: [0.24, 0.26, 0.15], mottle: 0.1, bevel: 0.0005, curveSegs: 2, widthFn: (f, u) => (u > 0.045 ? 0.72 : 1) });
  // cotter pin through the fuze head, crimped over on the +X side, the pull ring on the -X side
  const pinY = 0.0442, pinZ = 0.0066;
  B.seg(0, [-0.0128, pinY, pinZ], [0.0118, pinY, pinZ], 0.0011, 0.0011, { ...M.steel, color: [1.05, 1.03, 0.96], rs: 5, hs: 1 });
  B.tube(0, [[0.0118, pinY, pinZ], [0.0142, pinY - 0.0016, pinZ + 0.0012], [0.0152, pinY - 0.0052, pinZ + 0.0024]], 0.001, 0.001, { ...M.steel, color: [1.05, 1.03, 0.96], rs: 4, ts: R(hi, 6, 3) });
  B.tube(0, [[0.0118, pinY, pinZ - 0.0004], [0.0138, pinY + 0.0018, pinZ - 0.002], [0.0145, pinY + 0.0048, pinZ - 0.0034]], 0.001, 0.001, { ...M.steel, color: [1.05, 1.03, 0.96], rs: 4, ts: R(hi, 6, 3) });
  const pull = new THREE.TorusGeometry(0.0108, 0.0012, R(hi, 6, 4), R(hi, 22, 12));
  B.geom(0, pull, { ...M.steel, color: [1.1, 1.08, 1.0], rot: [0.25, 0.35, 0], at: [-0.0236, pinY - 0.0036, pinZ - 0.001] });
  P.meta.muzzle = null;
}

// Noisemaker: a wind-up twin-bell alarm clock (11 cm across the bells, 13 cm from its feet to the handle). Red enamel
// drum case, chrome bezel round a cream dial with its hour marks and hands, two steel bells on posts with the hammer
// between them, a wire carrying handle over the top, splayed ball feet, and the two winding keys on the back. Long
// axis +Y; the dial faces +Z (the holder), the keys -Z.
function buildDecoy(P) {
  const hi = P.hi;
  const B = P.get('body');
  const rs = R(hi, 28, 16);
  const red = { region: WR.PLAIN, color: [0.62, 0.1, 0.07], mottle: 0.06 };
  const chrome = { ...M.steel, color: [0.95, 0.95, 0.93] };
  const dark = { region: WR.PLAIN, color: 0x141414, mottle: 0.02 };
  // drum case (along Z): back plate, red drum, chrome bezel, dial (latheZ: [r, f], f forward = -Z)
  latheZ(B, [[0, 0.0175], [0.034, 0.0175], [0.0392, 0.0158], [0.0418, 0.0128], [0.042, 0.0], [0.0418, -0.0118], [0, -0.0118]], 0, 0, { ...red, rs, sharp: true });
  latheZ(B, [[0, 0.0182], [0.031, 0.0182], [0.0316, 0.0176], [0, 0.0176]], 0, 0, { ...chrome, color: [0.85, 0.85, 0.82], rs, sharp: true });
  latheZ(B, [[0.0352, -0.0112], [0.0432, -0.0112], [0.0442, -0.0136], [0.0438, -0.0172], [0.0408, -0.0194], [0.0364, -0.019], [0.0352, -0.0172]], 0, 0, { ...chrome, rs, sharp: true });
  latheZ(B, [[0, -0.0148], [0.0356, -0.0148], [0.0356, -0.0152], [0, -0.0152]], 0, 0, { region: WR.PLAIN, color: [0.93, 0.89, 0.76], mottle: 0.04, rs, sharp: true });
  // hour marks (long at 12, 3, 6, 9), a centre boss, the hands at ten past ten and the red alarm hand
  const dialZ = 0.0154;
  for (let h = 0; h < 12; h++) {
    const a = (h / 12) * PI * 2;
    const big = h % 3 === 0;
    const r0 = big ? 0.0262 : 0.0282;
    const c = [Math.sin(a) * (r0 + 0.0315) / 2, Math.cos(a) * (r0 + 0.0315) / 2, dialZ];
    B.box(0, c, [big ? 0.0026 : 0.0014, 0.0315 - r0, 0.0006], { ...dark, rot: [0, 0, -a] });
  }
  if (hi) for (let m = 0; m < 60; m++) if (m % 5) {
    const a = (m / 60) * PI * 2;
    B.box(0, [Math.sin(a) * 0.0305, Math.cos(a) * 0.0305, dialZ], [0.0006, 0.0018, 0.0004], { ...dark, rot: [0, 0, -a] });
  }
  const hand = (a, len, w, z, o) => B.box(0, [Math.sin(a) * len * 0.38, Math.cos(a) * len * 0.38, z], [w, len * 1.15, 0.0006], { ...o, rot: [0, 0, -a] });
  hand((10.17 / 12) * PI * 2, 0.019, 0.0024, dialZ + 0.0006, dark);
  hand((10 / 60) * PI * 2, 0.027, 0.0016, dialZ + 0.0012, dark);
  hand((7 / 12) * PI * 2, 0.016, 0.0012, dialZ + 0.0018, { region: WR.PLAIN, color: [0.75, 0.12, 0.08], mottle: 0.02 });
  latheZ(B, [[0, -dialZ - 0.0026], [0.0024, -dialZ - 0.0026], [0.0024, -dialZ], [0, -dialZ]], 0, 0, { ...chrome, rs: 10, sharp: true });
  // the bells: thin steel cups on posts at +-40 degrees from the top, their mouths toward the hammer
  const bellProf = [[0, 0.0178], [0.0088, 0.0156], [0.0148, 0.0102], [0.0178, 0.0036], [0.0186, 0.0004], [0.0204, 0.0], [0.0206, 0.0028], [0.0196, 0.0088], [0.0162, 0.0152], [0.0104, 0.0196], [0.0048, 0.0214], [0, 0.0216]];
  for (const s of [-1, 1]) {
    const a = s * 0.7;
    const dx = Math.sin(a), dy = Math.cos(a);
    const base = 0.0475;
    latheY(B, bellProf, 0, 0, { ...chrome, rs: R(hi, 24, 10), rot: [0, 0, -a], at: [dx * base, dy * base, -0.003] });
    B.seg(0, [dx * 0.04, dy * 0.04, -0.003], [dx * (base + 0.02), dy * (base + 0.02), -0.003], 0.0022, 0.0022, { ...chrome, rs: 6, hs: 1 });
    B.ellip(0, [dx * (base + 0.0222), dy * (base + 0.0222), -0.003], [0.0034, 0.0034, 0.0034], { ...chrome, ws: R(hi, 8, 6), hs: R(hi, 6, 4) });
  }
  // the hammer between the bells, on its spring arm out of the case top
  B.seg(0, [0, 0.0405, -0.004], [0, 0.0598, -0.004], 0.0013, 0.0011, { ...M.steel, color: [0.9, 0.88, 0.82], rs: 5, hs: 1 });
  B.ellip(0, [0, 0.0612, -0.004], [0.0042, 0.0036, 0.0036], { ...M.brass, ws: R(hi, 10, 6), hs: R(hi, 7, 4) });
  // carrying handle: a wire loop over the top, behind the hammer
  B.tube(0, [[-0.0255, 0.0352, -0.0125], [-0.0225, 0.0665, -0.0125], [0, 0.0805, -0.0125], [0.0225, 0.0665, -0.0125], [0.0255, 0.0352, -0.0125]], 0.0017, 0.0017, { ...chrome, rs: R(hi, 6, 4), ts: R(hi, 18, 9) });
  for (const s of [-1, 1]) B.ellip(0, [s * 0.0255, 0.0352, -0.0125], [0.0032, 0.0026, 0.0032], { ...chrome, ws: R(hi, 8, 6), hs: R(hi, 5, 4) });
  // splayed feet with ball ends
  for (const s of [-1, 1]) {
    const a = s * 0.62;
    B.seg(0, [Math.sin(a) * 0.036, -Math.cos(a) * 0.036, -0.002], [Math.sin(a) * 0.056, -Math.cos(a) * 0.056, -0.002], 0.0024, 0.0019, { ...chrome, rs: 6, hs: 1 });
    B.ellip(0, [Math.sin(a) * 0.0575, -Math.cos(a) * 0.0575, -0.002], [0.0052, 0.0052, 0.0052], { ...chrome, ws: R(hi, 10, 6), hs: R(hi, 7, 4) });
  }
  // on the back: the two winding keys (alarm and time), their stems out of the back plate, and the setting knob on top
  for (const s of [-1, 1]) {
    const x = s * 0.0158, y = -0.006;
    B.seg(0, [x, y, -0.0178], [x, y, -0.0262], 0.0018, 0.0018, { ...chrome, rs: 6, hs: 1 });
    profile(B, [[0.0262, -0.006], [0.0262, 0.006], [0.0288, 0.0105], [0.0318, 0.0105], [0.0322, 0.0], [0.0318, -0.0105], [0.0288, -0.0105]].map(([f, u]) => [f, u + y]), 0.0024, { ...chrome, bevel: 0.0004, curveSegs: 2, x });
  }
  B.seg(0, [0.0, 0.041, 0.0], [0.0, 0.0445, 0.0], 0.0034, 0.0034, { ...chrome, rs: 10, hs: 1 });
  P.meta.muzzle = null;
}

// Walkie-talkie (everyone's, weapon slot 6): a 13 cm olive handset held like a bottle (long axis +Y), the palm on its
// back (+X) and the fingers round its far edge (-Z), so its face (-X) - speaker grille, the little lit display - is
// turned to the eye. The push-to-talk key runs up its near edge (+Z) under the thumb; a stub antenna and the channel
// knob stand on top.
function buildWalkie(P) {
  const hi = P.hi;
  const B = P.get('body');
  const olive = { region: WR.PLAIN, color: [0.27, 0.31, 0.21], mottle: 0.08 };
  const rubber = { ...M.polyDark, color: [0.55, 0.55, 0.55] };
  const X0 = -0.015, X1 = 0.015, Y0 = -0.07, Y1 = 0.058, Z0 = -0.028, Z1 = 0.028;
  // the case, rounded at its edges, with the battery's seam round its lower third
  B.box(0, [0, (Y0 + Y1) / 2, 0], [X1 - X0, Y1 - Y0, Z1 - Z0], { ...olive, round: 0.22, seg: R(hi, 3, 2) });
  boxR(B, X0 - 0.0004, X1 + 0.0004, -0.03, -0.028, Z0 - 0.0004, Z1 + 0.0004, { ...olive, color: [0.15, 0.17, 0.12] });
  // the face: a recessed speaker grille (its slots), the display above it, and a strip of three keys between them
  const fx = X0 - 0.0006;
  boxR(B, fx, fx + 0.002, 0.004, 0.036, -0.021, 0.021, { ...rubber, color: [0.32, 0.32, 0.32] });
  for (let k = 0; k < (hi ? 7 : 4); k++) {
    const y = 0.008 + (k * 0.024) / (hi ? 6 : 3);
    boxR(B, fx - 0.0004, fx + 0.001, y - 0.0011, y + 0.0011, -0.018, 0.018, { region: WR.PLAIN, color: 0x0b0b0b, mottle: 0 });
  }
  boxR(B, fx, fx + 0.0016, 0.041, 0.053, -0.017, 0.013, { region: WR.PLAIN, color: [0.12, 0.13, 0.1], mottle: 0.02 });
  boxR(B, fx - 0.0005, fx + 0.001, 0.0425, 0.0515, -0.0155, 0.0115, { region: WR.PLAIN, color: [0.5, 0.66, 0.36], mottle: 0.04 });
  for (const z of [-0.012, 0, 0.012]) boxR(B, fx - 0.0012, fx + 0.001, 0.0375, 0.0395, z - 0.004, z + 0.004, rubber);
  // the push-to-talk key up the near edge (under the thumb), ribbed; the orange call key below it
  boxR(B, -0.0085, 0.0085, 0.006, 0.04, Z1 - 0.001, Z1 + 0.0035, { ...rubber, round: 0.3, seg: 2 });
  if (hi) for (let k = 0; k < 5; k++) boxR(B, -0.008, 0.008, 0.01 + k * 0.0066, 0.0114 + k * 0.0066, Z1 + 0.003, Z1 + 0.0042, rubber);
  boxR(B, -0.005, 0.005, -0.004, 0.002, Z1 - 0.001, Z1 + 0.003, { region: WR.PLAIN, color: [0.85, 0.42, 0.1], mottle: 0.04 });
  // on top: the stub antenna at the back corner (a collar, then the rubber whip with a ball tip), the ribbed channel
  // knob at the far one, and the red transmit lamp between them
  const rs = R(hi, 12, 7);
  latheY(B, [[0, Y1 - 0.002], [0.0072, Y1 - 0.002], [0.0072, Y1 + 0.008], [0.0055, Y1 + 0.012], [0, Y1 + 0.012]], 0.003, 0.016, { ...rubber, rs, sharp: true });
  latheY(B, [[0, Y1 + 0.011], [0.0048, Y1 + 0.011], [0.0042, Y1 + 0.06], [0.0034, Y1 + 0.076], [0, Y1 + 0.08]], 0.003, 0.016, { ...rubber, rs });
  latheY(B, [[0, Y1 - 0.002], [0.0068, Y1 - 0.002], [0.0068, Y1 + 0.011], [0.006, Y1 + 0.013], [0, Y1 + 0.013]], 0.0, -0.014, { ...rubber, rs: R(hi, 14, 8), sharp: true });
  if (hi) for (let k = 0; k < 10; k++) {
    const a = (k / 10) * PI * 2;
    B.box(0, [Math.cos(a) * 0.0069, Y1 + 0.0055, -0.014 + Math.sin(a) * 0.0069], [0.0012, 0.011, 0.0012], { ...rubber, rot: [0, -a, 0] });
  }
  B.ellip(0, [-0.004, Y1 + 0.001, 0.0005], [0.0022, 0.0018, 0.0022], { region: WR.PLAIN, color: [0.75, 0.08, 0.05], mottle: 0, ws: 8, hs: 5 });
  P.meta.muzzle = null;
}

const BUILDERS = {
  [ITEM.AK47]: buildAK,
  [ITEM.PISTOL]: buildPistol,
  [ITEM.FLARE_GUN]: buildFlareGun,
  [ITEM.SHOTGUN]: buildShotgun,
  [ITEM.HUNTING_RIFLE]: buildRifle,
  [ITEM.M4A1]: buildM4,
  [ITEM.MP5]: buildMP5,
  [ITEM.DB_SHOTGUN]: buildDoubleBarrel,
  [ITEM.CROSSBOW]: buildCrossbow,
  [ITEM.RPG]: buildRPG,
  [ITEM.FLAMETHROWER]: buildFlamethrower,
  [ITEM.AT_RIFLE]: buildATRifle,
  [ITEM.KNIFE]: buildKnife,
  [ITEM.BAT]: buildBat,
  [ITEM.SPIKED_BAT]: buildSpikedBat,
  [ITEM.MACHETE]: buildMachete,
  [ITEM.HAMMER]: buildHammer,
  [ITEM.NUNCHAKU]: buildNunchaku,
  [ITEM.MOLOTOV]: buildMolotov,
  [ITEM.PIPEBOMB]: buildPipebomb,
  [ITEM.FLARE]: buildFlare,
  [ITEM.GRENADE]: buildGrenade,
  [ITEM.DECOY]: buildDecoy,
  [ITEM.WALKIE]: buildWalkie,
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
  // pistol grip, fitted to the pistol's grip with the hand placed by VM[PISTOL].rGrip: the grip runs diagonally
  // across the palm, the middle, ring and little fingers close on the front strap, the index pad rests on the
  // trigger face, and the thumb (its base swung round behind the beavertail, tmcp) lies along the frame
  trigger: {
    curl: [[0.8, 0.35, 0.355], [0.95, 1.0, 0.675], [0.955, 0.9, 0.63], [0.85, 0.455, 0.96]],
    spreads: [-0.25, 0, 0, 0],
    thumb: [[-0.352, -0.843, -0.407], [-0.388, -0.848, -0.361]],
    tmcp: [-0.0474, -0.0267, -0.0328],
    tback: [-0.808, 0.511, -0.28],
    thumbL: [0.031, 0.026],
    center: [-0.041, -0.0755, -0.0123],
  },
  // pistol support hand (VM[PISTOL].lGrip), fitted the same way: the palm on the left of the grip, the fingers
  // closed over the gun hand's, the thumb forward along the frame under the gun hand's thumb
  cup: {
    curl: [[1.45, 0.315, 0.22], [1.55, 0.28, 0.35], [1.6, 0.045, 0.3], [1.65, 0.255, 0.175]],
    spread: 0.0,
    thumb: [[-0.242, -0.893, -0.379], [-0.217, -0.921, -0.323]],
    tmcp: [-0.0169, -0.0294, -0.031],
    tback: [0.9107, -0.0373, -0.373],
    thumbL: [0.031, 0.026],
    center: [-0.0475, -0.0447, -0.007],
  },
  support: { curl: [[0.95, 1.1, 0.7], [1.0, 1.15, 0.7], [1.05, 1.15, 0.7], [1.1, 1.1, 0.7]], spread: 0.02, thumb: [[-0.7, -0.45, -0.55], [-0.4, -0.9, 0.1]], center: [-0.042, -0.088, 0] },
  pinch: { curl: [[0.9, 1.2, 0.8], [1.1, 1.4, 0.9], [1.25, 1.45, 0.9], [1.35, 1.4, 0.9]], spread: 0.0, thumb: [[-0.55, -0.6, -0.55], [-0.2, -0.85, 0.45]], center: [-0.03, -0.1, -0.02] },
  // the walkie-talkie: the grip, its thumb up the near edge on the push-to-talk key instead of over the face
  radio: { curl: [[1.25, 1.45, 0.9], [1.3, 1.5, 0.9], [1.35, 1.5, 0.9], [1.4, 1.45, 0.9]], spread: 0.0, thumb: [[-0.3, -0.55, -0.78], [0, -0.75, -0.66]], center: [-0.034, -0.083, 0] },
  open: { curl: [[0.25, 0.3, 0.2], [0.2, 0.3, 0.2], [0.25, 0.3, 0.2], [0.3, 0.35, 0.25]], spread: 0.08, thumb: [[-0.4, -0.55, -0.73], [-0.1, -0.8, -0.6]], center: [-0.035, -0.095, 0] },
  claw: { curl: [[0.45, 0.55, 0.45], [0.4, 0.55, 0.45], [0.45, 0.6, 0.45], [0.55, 0.65, 0.5]], spread: 0.2, thumb: [[-0.55, -0.5, -0.67], [-0.35, -0.85, -0.3]], center: [-0.035, -0.11, 0] },
  // throwables, each closed round its own shape until the fingers touch (a fist made for a 3 cm handle buries its
  // fingers in anything thicker), with the palm seated on the surface: the center is as far out as the item's radius
  ball: { curl: [[0.87, 0.99, 0.69], [0.82, 0.94, 0.66], [0.76, 0.87, 0.6], [0.67, 0.77, 0.54]], spread: 0.0, thumb: [[-0.59, -0.26, -0.77], [-0.38, -0.92, -0.05]], center: [-0.0475, -0.075, 0] }, // frag grenade
  pipe: { curl: [[0.79, 0.97, 0.67], [0.81, 1.09, 0.76], [0.79, 1.0, 0.7], [0.68, 0.78, 0.54]], spread: 0.0, thumb: [[-0.56, -0.38, -0.73], [-0.96, 0.13, -0.26]], center: [-0.0415, -0.08, 0] }, // pipe bomb
  flare: { curl: [[0.8, 1.22, 0.85], [0.84, 1.33, 0.92], [0.81, 1.26, 0.88], [0.77, 0.94, 0.65]], spread: 0.0, thumb: [[-0.73, -0.61, -0.3], [-0.87, -0.5, 0]], center: [-0.0345, -0.083, 0] }, // road flare
  bottle: { curl: [[0.67, 0.77, 0.54], [0.7, 0.88, 0.61], [0.69, 0.79, 0.55], [0.56, 0.64, 0.45]], spread: 0.0, thumb: [[-0.79, -0.13, -0.6], [-0.71, 0, -0.71]], center: [-0.05, -0.08, 0] }, // molotov
  // noisemaker: the alarm clock's feet down on the palm, the fingers cupped up behind its case
  clock: { curl: [[0.6, 0.68, 0.48], [0.56, 0.64, 0.44], [0.54, 0.71, 0.49], [0.34, 0.64, 1.2]], spread: 0.0, thumb: [[-0.22, -0.77, -0.6], [-0.16, -0.8, -0.57]], center: [-0.0115, -0.085, 0] },
  // fitted to one item each against its own model (scratch grasp solver: the palm seated on the surface along its
  // normal, every finger closed until it touches, the thumb laid along it), so nothing of the hand is inside it.
  // support hands under a handguard / fore-end / the RPG's front grip
  akSupport: { curl: [[0.37, 0.42, 0.29], [0.46, 0.53, 0.37], [0.56, 0.64, 0.45], [0.56, 0.64, 0.45]], spread: 0.02, thumb: [[-0.46, -0.87, 0.19], [0.1, -0.97, -0.24]], center: [-0.0708, -0.088, 0] }, // AK-47
  m4Support: { curl: [[0.45, 0.52, 0.36], [0.62, 0.71, 0.64], [0.71, 0.82, 0.57], [0.72, 0.82, 0.57]], spread: 0.02, thumb: [[-0.48, -0.87, 0.13], [0.1, -0.92, -0.37]], center: [-0.0468, -0.088, 0] }, // M4A1
  mp5Support: { curl: [[0.42, 0.48, 0.33], [0.56, 0.64, 0.79], [0.65, 0.75, 0.78], [0.69, 0.79, 0.55]], spread: 0.02, thumb: [[-0.65, -0.71, 0.27], [-0.3, -0.79, -0.53]], center: [-0.0573, -0.088, 0] }, // MP5
  pumpSupport: { curl: [[0.45, 0.52, 0.36], [0.62, 0.71, 0.78], [0.74, 0.85, 0.65], [0.75, 0.86, 0.6]], spread: 0.02, thumb: [[-0.56, -0.79, 0.23], [0, -0.79, -0.61]], center: [-0.0443, -0.088, 0] }, // pump shotgun
  dbSupport: { curl: [[0.42, 0.48, 0.33], [0.56, 0.64, 0.44], [0.65, 0.75, 0.72], [0.68, 0.78, 0.54]], spread: 0.02, thumb: [[-0.46, -0.87, 0.19], [0.15, -0.92, -0.35]], center: [-0.0531, -0.088, 0] }, // double-barrel
  rifleSupport: { curl: [[0.46, 0.52, 0.36], [0.63, 0.72, 0.85], [0.76, 0.87, 0.74], [0.77, 0.89, 0.62]], spread: 0.02, thumb: [[-0.37, -0.92, 0.1], [0.13, -0.99, 0]], center: [-0.0438, -0.088, 0] }, // hunting rifle
  xbowSupport: { curl: [[0.48, 0.55, 0.38], [0.66, 0.75, 0.84], [0.79, 0.9, 0.63], [0.8, 0.92, 0.64]], spread: 0.02, thumb: [[-0.56, -0.79, 0.23], [-0.43, -0.79, -0.43]], center: [-0.0476, -0.088, 0] }, // crossbow
  flamerSupport: { curl: [[0.49, 0.56, 0.39], [0.63, 0.72, 0.5], [0.71, 0.81, 0.56], [0.72, 0.83, 0.58]], spread: 0.02, thumb: [[-0.65, -0.71, 0.27], [0.05, -0.99, -0.12]], center: [-0.0548, -0.088, 0] }, // flamethrower
  atSupport: { curl: [[0.37, 0.43, 0.3], [0.5, 0.57, 0.4], [0.58, 0.67, 0.56], [0.6, 0.68, 0.48]], spread: 0.02, thumb: [[-0.56, -0.79, 0.23], [0, -0.92, -0.38]], center: [-0.0389, -0.088, 0] }, // anti-tank rifle
  rpgSupport: { curl: [[0.33, 1.39, 0.97], [0.11, 1.48, 1.03], [0.09, 1.35, 0.94], [0.05, 0.92, 0.64]], spread: 0, thumb: [[-0.98, -0.13, 0.13], [-0.73, -0.61, -0.3]], center: [-0.0342, -0.083, 0] }, // RPG front grip
  // right hand on a pistol grip: lower on it than the old fist (its middle finger clears the trigger guard and the
  // magazine to wrap the front of the grip), the index laid straight along the side of the guard
  akGrip: { curl: [[0.1, 0.1, 0.08], [0.64, 1.2, 0.84], [0.64, 1.08, 0.76], [0.68, 0.72, 0.5]], spread: 0, thumb: [[0.03, -0.99, -0.13], [-0.09, -0.99, -0.09]], center: [-0.0394, -0.083, -0.025] }, // AK-47
  m4Grip: { curl: [[0.1, 0.1, 0.08], [0.56, 0.88, 0.62], [1, 1, 0.7], [1.08, 0.48, 0.34]], spread: 0, thumb: [[0.23, -0.79, -0.56], [-0.3, -0.92, -0.23]], center: [-0.043, -0.068, -0.025] }, // M4A1
  flamerGrip: { curl: [[0.1, 0.1, 0.08], [0.72, 1.08, 0.76], [0.72, 0.96, 0.67], [0.64, 0.68, 0.48]], spread: 0, thumb: [[0.18, -0.71, -0.68], [-0.25, -0.97, -0.07]], center: [-0.0432, -0.083, -0.025] }, // flamethrower
  mp5Grip: { curl: [[0.1, 0.1, 0.08], [0.8, 1.2, 0.84], [0.96, 1, 0.7], [0.92, 0.64, 0.45]], spread: 0, thumb: [[0.07, -0.87, -0.5], [-0.12, -0.99, -0.05]], center: [-0.0415, -0.068, -0.025] }, // MP5
  rpgGrip: { curl: [[0.1, 0.1, 0.08], [0.92, 1.36, 0.95], [0.96, 1.28, 0.9], [0.96, 0.92, 0.64]], spread: 0, thumb: [[0.33, -0.92, -0.19], [-0.27, -0.92, -0.27]], center: [-0.034, -0.068, -0.025] }, // RPG
  // right hand round a stock wrist or a rifle's grip
  wristGrip: { curl: [[0.14, 0.16, 0.4], [0.18, 0.2, 0.14], [0.31, 1.08, 0.75], [0.37, 0.72, 0.8]], spread: 0, thumb: [[-0.13, -0.87, -0.48], [0.37, -0.79, -0.48]], center: [-0.0378, -0.083, 0] }, // pump shotgun
  dbGrip: { curl: [[0.06, 0.07, 0.85], [0.11, 0.29, 0.2], [0.3, 0.34, 0.24], [0.37, 0.72, 0.8]], spread: 0, thumb: [[-0.56, -0.79, -0.23], [-0.3, -0.61, -0.73]], center: [-0.0378, -0.083, 0] }, // double-barrel
  xbowGrip: { curl: [[0.14, 0.16, 0.49], [0.17, 0.2, 0.14], [0.31, 1.06, 0.74], [0.37, 0.79, 0.74]], spread: 0, thumb: [[-0.71, -0.71, 0], [-0.21, -0.61, -0.77]], center: [-0.0378, -0.083, 0] }, // crossbow
  rifleGrip: { curl: [[0.41, 0.47, 0.86], [0.49, 1.02, 0.71], [0.48, 0.91, 0.64], [0.43, 0.49, 0.91]], spread: 0, thumb: [[0, -0.79, -0.61], [-0.07, -0.97, -0.25]], center: [-0.0415, -0.083, 0] }, // hunting rifle
  atGrip: { curl: [[0.25, 0.29, 0.2], [0.37, 0.43, 0.81], [0.62, 0.95, 0.66], [0.54, 0.62, 0.69]], spread: 0, thumb: [[-0.08, -0.79, -0.6], [-0.16, -0.97, -0.21]], center: [-0.0426, -0.083, 0] }, // anti-tank rifle
  flareGunR: { curl: [[0.42, 0.2, 0.19], [0.73, 1.23, 0.53], [0.68, 1.13, 0.47], [0.65, 0.62, 0.74]], spread: 0, thumb: [[0.15, -0.92, -0.35], [-0.23, -0.92, -0.3]], center: [-0.0404, -0.0755, -0.0123] }, // the flare gun's grip, the index on its trigger
  radioHold: { curl: [[0.31, 1.47, 0.22], [0.31, 1.58, 0.22], [0.38, 1.45, 0.26], [0.41, 1.04, 0.42]], spread: 0, thumb: [[0.18, -0.71, -0.68], [0, -0.71, -0.71]], center: [-0.0329, -0.083, 0] }, // the walkie-talkie, held by the case below the grille
  // melee handles (the bat and the spiked bat share one)
  batR: { curl: [[0.79, 1.32, 0.92], [0.82, 1.42, 0.99], [0.8, 1.35, 0.94], [0.75, 1.05, 0.73]], spread: 0, thumb: [[-0.69, -0.61, -0.4], [-0.77, -0.61, -0.21]], center: [-0.0319, -0.083, 0] },
  batL: { curl: [[0.87, 1.22, 0.85], [0.92, 1.35, 0.94], [0.89, 1.26, 0.88], [0.62, 0.96, 0.67]], spread: 0, thumb: [[-0.03, -0.97, -0.26], [0.38, -0.92, -0.05]], center: [-0.035, -0.083, 0] },
  macheteGrip: { curl: [[0.49, 1.41, 0.98], [0.5, 1.52, 1.06], [0.5, 1.45, 1.01], [0.48, 1.14, 0.79]], spread: 0, thumb: [[-0.79, -0.61, -0.1], [-0.7, -0.71, -0.09]], center: [-0.0294, -0.083, 0] },
  // nunchucks: a fist on the taped octagon (either hand: the handle is the same either way round), the same hand
  // eased open to take a catch, and loosened to let the handle turn in it through a spin
  nkGrip: { curl: [[0.79, 1.32, 0.92], [0.82, 1.42, 0.99], [0.8, 1.35, 0.94], [0.75, 1.05, 0.73]], spread: 0, thumb: [[-0.69, -0.61, -0.4], [-0.77, -0.61, -0.21]], center: [-0.0319, -0.083, 0] },
  nkHalf: { curl: [[0.5, 0.8, 0.5], [0.52, 0.85, 0.55], [0.5, 0.8, 0.5], [0.5, 0.7, 0.45]], spread: 0.03, thumb: [[-0.55, -0.6, -0.58], [-0.4, -0.75, -0.5]], center: [-0.0319, -0.083, 0] },
  nkSpin: { curl: [[0.79, 1.32, 0.92], [0.7, 1.2, 0.8], [0.6, 1.0, 0.7], [0.55, 0.85, 0.6]], spread: 0.01, thumb: [[-0.69, -0.61, -0.4], [-0.77, -0.61, -0.21]], center: [-0.0319, -0.083, 0] },
  hammerGrip: { curl: [[0.78, 1.45, 1.01], [0.82, 1.53, 1.06], [0.75, 1.48, 1.03], [0.71, 1.2, 0.83]], spread: 0, thumb: [[-0.61, -0.71, -0.35], [-0.77, -0.61, -0.21]], center: [-0.0289, -0.083, 0] },
  // a used item held in both hands, palms on its sides (the medkit, the tin and the can are the same either side)
  kitHold: { curl: [[0.36, 1.02, 0.71], [0.21, 1.24, 0.86], [0.37, 1.03, 0.72], [0.38, 0.44, 1.2]], spread: 0.02, thumb: [[0.07, -0.87, -0.5], [0.08, -0.99, 0.1]], center: [0.0075, -0.088, 0] },
  tinHold: { curl: [[0.42, 0.48, 0.76], [0.49, 0.68, 0.47], [0.51, 0.59, 0.51], [0.51, 0.59, 0.51]], spread: 0.02, thumb: [[-0.84, -0.5, -0.22], [-0.3, -0.92, -0.23]], center: [0.0075, -0.088, 0] },
  drinkHold: { curl: [[0.42, 0.67, 0.46], [0.43, 0.78, 0.54], [0.44, 0.69, 0.48], [0.41, 0.46, 0.4]], spread: 0.02, thumb: [[-0.92, -0.38, -0.12], [-0.96, -0.26, 0.13]], center: [0.0077, -0.088, 0] }, // (eased off the can by a fifth: round one this narrow the two hands' fingers met)
  meatR: { curl: [[0.56, 0.64, 0.5], [0.43, 0.83, 0.58], [0.59, 0.68, 0.47], [0.59, 0.68, 0.47]], spread: 0.02, thumb: [[-0.69, -0.61, -0.4], [-0.48, -0.87, -0.13]], center: [-0.006, -0.088, 0] },
  meatL: { curl: [[0.6, 1.31, 0.91], [0.62, 0.71, 0.5], [0.66, 0.76, 0.53], [0.66, 0.76, 0.53]], spread: 0.02, thumb: [[-0.48, -0.87, -0.13], [-0.56, -0.79, -0.23]], center: [-0.0577, -0.088, 0] },
  // reloads: the left hand on the magazine as it comes out (the flamethrower's fuel bottle), under the RPG's grenade
  akMag: { curl: [[0.89, 1.09, 0.76], [1, 1.2, 0.83], [0.91, 1.04, 0.72], [0.74, 0.85, 0.59]], spread: 0.02, thumb: [[-0.84, 0.26, -0.48], [-0.56, -0.71, -0.43]], center: [-0.022, -0.088, 0] },
  m4Mag: { curl: [[0.35, 0.4, 1.2], [0.45, 1.22, 0.85], [0.52, 0.94, 1.1], [0.49, 0.56, 0.96]], spread: 0.02, thumb: [[-0.86, -0.5, -0.11], [-0.7, -0.71, -0.09]], center: [-0.0142, -0.088, 0] },
  mp5Mag: { curl: [[0.4, 1.31, 0.91], [0.51, 1.46, 1.02], [0.58, 1.28, 0.89], [0.58, 0.66, 0.98]], spread: 0.02, thumb: [[-0.61, -0.71, -0.35], [-0.96, -0.26, 0.13]], center: [-0.0119, -0.088, 0] },
  fuelBottle: { curl: [[0.26, 0.71, 0.5], [0.38, 0.86, 0.6], [0.57, 0.65, 0.59], [0.54, 0.62, 0.43]], spread: 0.02, thumb: [[-0.8, -0.5, -0.33], [-0.84, -0.26, -0.48]], center: [-0.035, -0.088, 0] },
  rackPinch: { curl: [[0.4, 1.12, 0.78], [0.48, 1.36, 0.95], [0.68, 1.72, 1.2], [1.6, 1.72, 1.2]], spread: 0, thumb: [[-0.37, -0.92, 0.1], [-0.22, -0.5, 0.84]], center: [-0.0217, -0.1, -0.02] }, // the pistol's slide, racked
  pistolMag: { curl: [[0.91, 1.04, 0.72], [0.3, 1.48, 1.03], [0.21, 1.34, 0.93], [0.73, 0.84, 1.2]], spread: 0.02, thumb: [[-0.77, -0.61, -0.21], [0.03, -0.97, -0.26]], center: [-0.0135, -0.088, 0] }, // the pistol's new magazine
  xbowString: { curl: [[0.6, 0.56, 0.39], [0.56, 0.6, 0.42], [0.48, 0.6, 0.42], [1.08, 0.88, 0.62]], spread: 0, thumb: [[0.1, -0.97, -0.24], [-0.1, -0.92, 0.37]], center: [-0.0268, -0.1, -0.02] }, // the crossbow's string, hauled back to the latch
  rpgWarhead: { curl: [[0.42, 0.48, 0.34], [0.51, 0.59, 0.41], [0.56, 0.64, 0.45], [0.54, 0.62, 0.43]], spread: 0.02, thumb: [[-0.61, -0.71, -0.35], [0, -0.61, -0.79]], center: [-0.0418, -0.088, 0] },
};
// Knuckles sit on an arc (middle finger furthest out, pinky set back). r = proximal phalanx radius.
const FINGERS = [
  { z: -0.0285, y: -0.0875, L: [0.043, 0.026, 0.021], r: 0.0094 },
  { z: -0.0095, y: -0.089, L: [0.047, 0.029, 0.022], r: 0.0097 },
  { z: 0.0095, y: -0.0875, L: [0.044, 0.027, 0.021], r: 0.0092 },
  { z: 0.0275, y: -0.0845, L: [0.035, 0.021, 0.018], r: 0.0081 },
];
const PHALANX_R = [1.0, 0.9, 0.82];

/**
 * Finger curls (HAND_POSES format) that close the hand on an oval handle along the hand's Z axis, centred at
 * (cx, cy) with half-widths rx (palm to back) and ry: each joint bends until its phalanx, or the rest of the
 * finger beyond it (held slightly bent), sinks `squeeze` into the handle, the way a hand closes on a grip.
 * Phalanx sizes match getHandGeo's gloved fingers (radius on the palm side = r * sx).
 */
function wrapCurls(cx, cy, rx, ry, squeeze, slope = 0) {
  return FINGERS.map((F) => {
    // a handle laid diagonally across the palm (rising `slope` toward the wrist per unit of z) cuts this finger's
    // plane in a longer oval, further up the palm the nearer the little finger
    const fy = cy + slope * F.z, fry = ry * Math.hypot(1, slope);
    // approximate signed distance to the oval
    const sd = (x, y) => {
      const px = x - cx, py = y - fy;
      const k0 = Math.hypot(px / rx, py / fry), k1 = Math.hypot(px / (rx * rx), py / (fry * fry));
      return (k0 * (k0 - 1)) / k1;
    };
    const rad = [0, 1, 2].map((j) => F.r * PHALANX_R[j] * 1.06 * (j === 2 ? 0.84 : 0.9));
    // does the finger from joint j on touch, with joint j at absolute angle a and the joints past it bent by 0.25?
    const touches = (j, x, y, a) => {
      for (let k = j; k < 3; k++, a += 0.25) {
        const dx = -Math.sin(a) * F.L[k], dy = -Math.cos(a) * F.L[k];
        for (let s = 0; s <= 6; s++) if (sd(x + (dx * s) / 6, y + (dy * s) / 6) < rad[k] * (1 - 0.07 * (s / 6)) - squeeze) return true;
        x += dx;
        y += dy;
      }
      return false;
    };
    const curl = [];
    let x = 0, y = F.y, base = 0;
    for (let j = 0; j < 3; j++) {
      let a = base + 0.15;
      while (a < base + 1.9 && !touches(j, x, y, a)) a += 0.005;
      curl.push(a - base);
      x -= Math.sin(a) * F.L[j];
      y -= Math.cos(a) * F.L[j];
      base = a;
    }
    return curl;
  });
}
// knife: the handle laid diagonally across the palm (KNIFE_GRIP.tilt), from the heel of the hand to the base of the
// index finger, every finger closed on it and the thumb lying along its spine toward the guard
{
  const c = [-0.027, -0.078, 0];
  HAND_POSES.knife = { curl: wrapCurls(c[0], c[1], KNIFE_GRIP.rx, KNIFE_GRIP.ry, 0.0007, Math.tan(KNIFE_GRIP.tilt)), spread: 0.0, thumb: [[-0.4, -0.88, -0.22], [-0.45, -0.84, -0.3]], center: c };
}
// full-finger tactical gloves (tan synthetic, darker rubber knuckle guard / pads / strap) and an olive jacket
const HAND_MAT = {
  glove: { region: WR.GLOVE, color: [1.3, 1.12, 0.88], mottle: 0.06 },
  finger: { region: WR.GLOVE, color: [1.25, 1.08, 0.85], mottle: 0.05 },
  trim: { region: WR.GLOVE, color: [0.5, 0.45, 0.4], mottle: 0.04 },
  tip: { region: WR.GLOVE, color: [0.66, 0.52, 0.4], mottle: 0.05 }, // reinforced fingertips / thumb tip
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
 * One smooth tube through a chain of joints J[0..k] (a finger or the thumb): straight runs joined by rounded
 * fillets at the joints and a dome at each end, so a bent digit has no collar where its segments meet. r[i] / sx[i]:
 * radius and back-to-palm flattening at joint i; back[j]: the back of segment j; prof[j](t): radius multiplier
 * along segment j. u = 0 / 0.5 run down the digit's sides (where the glove texture's seams are). o.flank: contact
 * shadow on the sides facing the neighbouring digits (hand Z).
 */
function chainTube(mb, J, r, sx, back, prof, o = {}) {
  const k = J.length - 1;
  const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  const P = J.map(V3), D = [], Ls = [], S0 = [0];
  for (let j = 0; j < k; j++) {
    const d = P[j + 1].clone().sub(P[j]);
    Ls.push(d.length());
    D.push(d.normalize());
    S0.push(S0[j] + Ls[j]);
  }
  const f = [0];
  for (let i = 1; i < k; i++) f.push(Math.min(0.35 * Ls[i - 1], 0.35 * Ls[i], 0.9 * r[i]));
  f.push(0);
  // centreline samples: position, tangent, back vector, arc position s (on the straight segments)
  const smp = [];
  const push = (c, t, b, s) => smp.push({ c, t: t.clone().normalize(), b: b.clone(), s });
  const bk = back.map(V3);
  for (let j = 0; j < k; j++) {
    const a = P[j].clone().addScaledVector(D[j], f[j]), e = P[j + 1].clone().addScaledVector(D[j], -f[j + 1]);
    const n = Math.max(2, Math.ceil(a.distanceTo(e) / 0.005));
    for (let q = j === 0 ? 0 : 1; q <= n; q++) {
      const t = q / n;
      push(a.clone().lerp(e, t), D[j], bk[j], S0[j] + f[j] + (Ls[j] - f[j] - f[j + 1]) * t);
    }
    if (j < k - 1) {
      // quadratic fillet from e through the joint to the start of the next run
      const g = P[j + 1].clone().addScaledVector(D[j + 1], f[j + 1]);
      for (let q = 1; q < 5; q++) {
        const t = q / 5, m = 1 - t;
        const c = e.clone().multiplyScalar(m * m).addScaledVector(P[j + 1], 2 * m * t).addScaledVector(g, t * t);
        const tg = P[j + 1].clone().sub(e).multiplyScalar(2 * m).addScaledVector(g.clone().sub(P[j + 1]), 2 * t);
        push(c, tg, bk[j].clone().lerp(bk[j + 1], t), S0[j + 1] + f[j + 1] * (2 * t - 1));
      }
    }
  }
  // radius / flattening at an arc position
  const at = (s) => {
    let j = 0;
    while (j < k - 1 && s > S0[j + 1]) j++;
    const t = Math.min(1, Math.max(0, (s - S0[j]) / Ls[j]));
    return [(r[j] + (r[j + 1] - r[j]) * t) * (prof[j] ? prof[j](t) : 1), sx[j] + (sx[j + 1] - sx[j]) * t];
  };
  // o.tip = { from, color }: the last `from` metres of the digit in another colour, edged by two close rings
  const sEnd = S0[k];
  if (o.tip) {
    const sb = sEnd - o.tip.from;
    const i = smp.findIndex((p) => p.s > sb);
    if (i > 0) {
      const a = smp[i - 1], b = smp[i];
      const mk = (s) => {
        const t = (s - a.s) / (b.s - a.s);
        return { c: a.c.clone().lerp(b.c, t), t: a.t.clone().lerp(b.t, t).normalize(), b: a.b.clone().lerp(b.b, t), s };
      };
      smp.splice(i, 0, mk(sb - 0.0002), mk(sb + 0.0002));
    }
  }
  for (const p of smp) [p.r, p.sx] = at(p.s);
  // domes: rings closing over each end
  const cap = (p, dir, rings) => {
    const out = [];
    for (let q = 1; q <= rings; q++) {
      const a = (q / rings) * (PI / 2);
      out.push({ ...p, c: p.c.clone().addScaledVector(p.t, dir * Math.sin(a) * p.r * (o.capScale ?? 0.85)), r: p.r * Math.cos(a) });
    }
    return out;
  };
  const rings = [...cap(smp[0], -1, 3).reverse(), ...smp, ...cap(smp[smp.length - 1], 1, o.tipRings ?? 4)];
  for (const p of rings) {
    p.b.addScaledVector(p.t, -p.b.dot(p.t)).normalize();
    p.l = new THREE.Vector3().crossVectors(p.b, p.t); // side
  }
  const nv = rings.length - 1, nu = o.rs || 12;
  const joints = S0.slice(1, k);
  const tipMul = o.tip && o.tip.color.map((c, i) => c / (o.color ? o.color[i] : 1));
  let vi = 0; // the builder tints the loft's vertices in order, ring by ring
  const tint = (Pt, N, C) => {
    const best = rings[Math.min(nv, Math.floor(vi++ / (nu + 1)))];
    if (tipMul && best.s > sEnd - o.tip.from) {
      C.r *= tipMul[0];
      C.g *= tipMul[1];
      C.b *= tipMul[2];
    }
    const bdot = N.dot(best.b);
    C.multiplyScalar(1 - 0.2 * Math.max(0, -bdot) - (o.flank ?? 0) * N.z * N.z);
    let dj = Infinity;
    for (const s of joints) dj = Math.min(dj, Math.abs(best.s - s));
    const kc = (1 - sstep(0.002, 0.008, dj)) * Math.max(0, bdot); // creases across the back of each joint
    C.multiplyScalar(1 - 0.16 * kc);
    C.r *= 1 + 0.06 * kc;
  };
  return loft(
    mb,
    nv,
    nu,
    (v, u, out) => {
      const p = rings[Math.round(v * nv)];
      const ph = u * 2 * PI, cs = Math.cos(ph), sn = Math.sin(ph);
      out.copy(p.c).addScaledVector(p.l, cs * p.r).addScaledVector(p.b, sn * p.r * p.sx);
    },
    { ...o, tint }
  );
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
    const th = (u + 0.25) * 2 * PI, c = Math.cos(th), s = Math.sin(th); // u = 0 / 0.5 (the glove's seams) on the sides
    const back = c >= 0;
    const k = back ? 2 / 2.15 : 2 / 3.4;
    const ux = Math.sign(c) * Math.abs(c) ** k, uz = Math.sign(s) * Math.abs(s) ** k;
    let depth;
    if (back) {
      depth = S.xd0 + (S.xd1 - S.xd0) * v;
      if (S.tendon) {
        // the glove drapes over the four metacarpals: soft ridges fanning out from the wrist to the knuckles
        const z = uz * hz * e, w = sstep(0.2, 0.8, v) * (1 - sstep(0.92, 1, v));
        let rdg = 0;
        for (const F of FINGERS) rdg = Math.max(rdg, Math.exp(-(((z - F.z * (0.55 + 0.45 * v)) / 0.0058) ** 2)));
        depth += S.tendon * rdg * w * ux;
      }
    }
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
    16,
    claw ? 20 : 32,
    palmSurface({
      y0: 0.004, y1: -0.097, d0: 0.12, d1: 0.16, cx: -0.002, cz: -0.001,
      hz0: 0.026, hz1: claw ? 0.038 : 0.0405,
      xd0: claw ? 0.011 : 0.0135, xd1: claw ? 0.0085 : 0.0105,
      xp0: claw ? 0.013 : 0.016, xp1: claw ? 0.011 : 0.0135,
      thenar: claw ? 0.003 : 0.006, hypo: claw ? 0.0015 : 0.0035, tendon: claw ? 0 : 0.0014,
    }),
    { ...palmMat, tint: shade }
  );
  // knuckles (metacarpal heads)
  for (const F of FINGERS) {
    if (claw) mb.ellip(0, [0.001, F.y + 0.001, F.z], [0.0086, 0.0086, 0.009], { ...skin, color: [0.54, 0.57, 0.47], ws: 8, hs: 6, tint: shade });
    else mb.ellip(0, [0.003, F.y + 0.001, F.z], [0.0098, 0.0092, 0.0094], { ...palmMat, ws: 8, hs: 5, keepNormals: true, tint: shade });
  }
  // wrist: a rounded mass around the joint that keeps it filled however far the hand bends
  // (the sleeve / glove cuff belongs to the forearm, see getArmGeos)
  // (keepNormals: the sphere's own normals, so a pole the wrist bend uncovers shades smoothly instead of dimpling)
  mb.ellip(0, [-0.001, -0.003, 0], claw ? [0.0185, 0.02, 0.0235] : [0.021, 0.021, 0.0275], { ...palmMat, ws: 14, hs: 8, keepNormals: true, tint: shade });
  if (claw) {
    // tendons fanning out to the knuckles
    for (const F of FINGERS) {
      mb.seg(0, [0.009, -0.012, F.z * 0.45], [0.0105, F.y + 0.008, F.z * 0.95], 0.0026, 0.0022, { ...skin, color: [0.52, 0.56, 0.46], rs: 5, hs: 1, caps: 1, capScale: 0.5, tint: shade });
    }
  } else {
    // knuckle guard: one moulded strip along the knuckle arc, raised over each knuckle, domed at the ends
    const z0 = FINGERS[0].z - 0.011, z1 = FINGERS[3].z + 0.009;
    const knY = (z) => {
      // knuckle line height, linear between the knuckles and carried on past the end ones
      let i = 0;
      while (i < 2 && z > FINGERS[i + 1].z) i++;
      const a = FINGERS[i], b = FINGERS[i + 1];
      return a.y + ((b.y - a.y) * (z - a.z)) / (b.z - a.z) + 0.0015;
    };
    loft(
      mb,
      22,
      12,
      (v, u, out) => {
        const z = z0 + (z1 - z0) * v;
        const s = Math.abs(2 * v - 1);
        const e = s < 0.82 ? 1 : Math.sqrt(Math.max(0, 1 - ((s - 0.82) / 0.18) ** 2));
        let b = 0;
        for (const F of FINGERS) b = Math.max(b, Math.exp(-(((z - F.z) / 0.0058) ** 2)));
        const w = (2 * (z - z0)) / (z1 - z0) - 1;
        const th = u * 2 * PI, c = Math.cos(th), sn = Math.sin(th);
        const ux = Math.sign(c) * Math.abs(c) ** 0.6, uy = Math.sign(sn) * Math.abs(sn) ** 0.6;
        out.set(0.0108 + 0.0009 * b - 0.0035 * w * w + ux * (0.0024 + 0.0007 * b) * e, knY(z) + uy * (0.0064 + 0.0004 * b) * e, z);
      },
      { ...trim, tint: shade }
    );
  }

  // fingers: three phalanges each, curled toward the palm (-X) by the pose
  const rnd = mulberry32(side > 0 ? 11 : 12);
  for (let i = 0; i < 4; i++) {
    const F = FINGERS[i];
    const cz = pose.curl[i];
    const spread = pose.spreads ? pose.spreads[i] : (i - 1.5) * pose.spread;
    const L = claw ? F.L.map((l) => l * 1.22) : F.L;
    let p = [0.0, F.y, F.z];
    let ang = 0;
    const J = [p], backs = []; // glove: the joints, for one smooth tube down the finger (chainTube)
    for (let j = 0; j < 3; j++) {
      ang += cz[j] + (claw ? (rnd() - 0.5) * 0.15 : 0);
      const dl = Math.sqrt(1 + spread * spread);
      const d = [-Math.sin(ang) / dl, -Math.cos(ang) / dl, spread / dl];
      const n = [Math.cos(ang), -Math.sin(ang), 0]; // back of this phalanx
      const q = [p[0] + d[0] * L[j], p[1] + d[1] * L[j], p[2] + d[2] * L[j]];
      const r0 = F.r * PHALANX_R[j] * (claw ? 0.8 : 1.06);
      const r1 = r0 * (j === 2 ? 0.88 : 0.93);
      J.push(q);
      backs.push(n);
      if (claw) {
        limb(mb, p, q, r0, r1, n, {
          ...skin,
          rs: 8,
          hs: 2,
          cap1: j === 2 ? 3 : 2,
          sx: j === 2 ? 0.84 : 0.9,
          prof: (t) => 1 - 0.16 * Math.sin(PI * t), // joints stand out
          tint: handShade(n, [p, d, L[j]], 0),
        });
      }
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
    if (!claw) {
      // radii at the knuckle, the two finger joints (a little proud) and the tip
      const rr = PHALANX_R.map((k) => F.r * k * 1.06);
      chainTube(mb, J, [rr[0], rr[0] * 0.95, rr[1] * 0.95, rr[2] * 0.88], [0.9, 0.9, 0.87, 0.84], backs, [0, 1, 2].map(() => (t) => 1 - 0.04 * Math.sin(PI * t)), { ...skin, flank: 0.3, rs: 10, tipRings: 3, tip: { from: L[2] * 0.5, color: HAND_MAT.tip.color } }); // reinforced fingertip
    }
  }

  // thumb: metacarpal (with the thenar pad) from the heel of the hand to its MCP joint (pose.tmcp, THUMB_MCP by
  // default), then two phalanges; tb = the back of the thumb
  {
    const c0 = [-0.004, -0.004, -0.019];
    const tm = pose.tmcp || THUMB_MCP;
    const tb = pose.tback || [0.5, 0, -0.85];
    if (pose.tmcp) {
      // thumb swung round a grip: the thenar pad lies along the metacarpal on its palm side, poles buried in it
      _hy.set(tm[0] - c0[0], tm[1] - c0[1], tm[2] - c0[2]);
      const len = _hy.length();
      _hy.divideScalar(len);
      _hx.set(tb[0], tb[1], tb[2]);
      _hx.addScaledVector(_hy, -_hx.dot(_hy)).normalize();
      _hz.crossVectors(_hx, _hy);
      const q = new THREE.Quaternion().setFromRotationMatrix(_hm.makeBasis(_hx, _hy, _hz));
      const c = [0, 1, 2].map((k) => c0[k] + (tm[k] - c0[k]) * 0.42 - [_hx.x, _hx.y, _hx.z][k] * 0.004);
      mb.ellip(0, c, [0.0108, len * 0.42, 0.0128], { ...palmMat, ws: 12, hs: 8, q, keepNormals: true, tint: shade });
    } else mb.ellip(0, [-0.0145, -0.029, -0.017], [0.0095, 0.021, 0.0125], { ...palmMat, ws: 10, hs: 6, rot: [0.52, 0, 0], keepNormals: true, tint: shade });
    const L = claw ? [0.04, 0.034] : pose.thumbL || [0.036, 0.03];
    const tj = [tm];
    for (let j = 0; j < 2; j++) {
      const t = pose.thumb[j], l = Math.hypot(t[0], t[1], t[2]), p = tj[j];
      tj.push([p[0] + (t[0] / l) * L[j], p[1] + (t[1] / l) * L[j], p[2] + (t[2] / l) * L[j]]);
    }
    if (!claw) {
      // glove: metacarpal and both phalanges as one smooth tube; the tip segment swells over the pad, and its last
      // 60 % is the reinforced tip
      chainTube(mb, [c0, ...tj], [0.0136, 0.0115, 0.0108, 0.0096], [0.85, 0.88, 0.87, 0.84], [tb, tb, tb], [null, (s) => 1 - 0.04 * Math.sin(PI * s), (s) => 1 + 0.07 * Math.sin(PI * Math.min(1, s * 1.25))], { ...skin, rs: 12, tipRings: 4, tip: { from: L[1] * 0.6, color: HAND_MAT.tip.color } });
    } else {
      limb(mb, c0, tm, 0.0145, 0.0112, tb, { ...palmMat, rs: 10, hs: 1, sx: 0.85, tint: shade });
      const R = [
        [0.0118, 0.0108],
        [0.0108, 0.0096],
      ];
      for (let j = 0; j < 2; j++) {
        const p = tj[j], q = tj[j + 1];
        const d = [0, 1, 2].map((k) => (q[k] - p[k]) / L[j]);
        limb(mb, p, q, R[j][0] * 0.82, R[j][1] * 0.82, tb, { ...skin, rs: 8, hs: 2, cap1: j === 1 ? 3 : 2, sx: j === 1 ? 0.84 : 0.9, prof: (s) => 1 - 0.14 * Math.sin(PI * s), tint: handShade(tb, [p, d, L[j]]) });
        if (j === 1) mb.spike(0, q, [q[0] + d[0] * 0.03, q[1] + d[1] * 0.03, q[2] + d[2] * 0.03], 0.0065, { ...bone, color: [0.1, 0.085, 0.075], rs: 6 });
      }
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
    // gauntlet (X = back of the hand, see VMArm.orient); its rounded end tucks around the hand's wrist. Its cross-
    // section is set up from Z (n = [0, 0, 1], so sx is across the wrist and sz back to palm), which puts the glove
    // texture's seams on the back and palm sides rather than along the top the camera looks down at
    limb(fo, [0, W + 0.1, 0], [0, W - 0.002, 0], 0.031, 0.027, [0, 0, 1], { ...HAND_MAT.glove, rs: 14, hs: 3, sx: 1.06, sz: 0.84, cap0: 0, cap1: 3, capScale: 0.25, ao: false, tint: shade, prof: (t) => 1 + 0.03 * Math.sin(PI * t) });
    // velcro strap and tab around the cuff
    limb(fo, [0, W + 0.047, 0], [0, W + 0.027, 0], 0.0299, 0.0291, [0, 0, 1], { ...HAND_MAT.trim, rs: 14, hs: 1, sx: 1.07, sz: 0.85, cap0: 1, cap1: 1, capScale: 0.25, ao: false, tint: shade });
    fo.box(0, [0.0262, W + 0.037, 0.004], [0.0045, 0.02, 0.03], {
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
      this.sets[style] = { upper, fore, hands: {}, mat };
      for (const m of [upper, fore]) {
        m.frustumCulled = false;
        m.renderOrder = 1;
      }
      // the poses every item shares; the rest (fitted to one item each) are built the first time they are shown
      for (const p of style === 'claw' ? ['claw', 'open'] : ['grip', 'trigger', 'cup', 'support', 'pinch', 'open']) this.hand(style, p);
    }
    this.style = 'normal';
    this.pose = 'grip';
    this.visible = true;
    this.applyVis();
  }
  /** the mesh of a hand pose in a style, built on first use */
  hand(style, p) {
    const s = this.sets[style];
    let h = s.hands[p];
    if (!h && HAND_POSES[p]) {
      h = s.hands[p] = new THREE.Mesh(getHandGeo(p, style === 'claw' ? 'claw' : 'glove', this.side), s.mat);
      h.visible = false;
      h.frustumCulled = false;
      h.renderOrder = 1;
      this.wrist.add(h);
    }
    return h;
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
      if (on && style === 'normal') this.hand(style, this.pose);
      for (const p in s.hands) s.hands[p].visible = on && p === this.pose;
    }
    if (this.style === 'claw' && !this.sets.claw.hands[this.pose] && this.visible) this.sets.claw.hands.claw.visible = true;
  }
  gripCenter(out, poseName = this.pose) {
    const pose = HAND_POSES[this.style === 'claw' ? (poseName === 'open' ? 'open' : 'claw') : poseName] || HAND_POSES.grip;
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
// flare gun reload (ViewModel._animReload, breakPistol): the gun's pose change (pitch down, roll, yaw, x/y/z shift),
// how far the barrel tips open (rad), and the free hand pushing a shell into the open breech, set in camera space
// (fingers forward and a little up, palm to the right) so that the arm comes in from the lower left whatever the gun does
const FG_RELOAD = { pitch: 0.1, roll: 0.75, yaw: 0.05, x: 0.07, y: 0.06, z: 0.02, open: 0.55 };
FG_RELOAD.q = handQ(-1, [0.25, 0.12, -0.96], [1, -0.3, 0]);
// left support under a handguard: hand X -> weapon Y (palm up), fingers (-Y) -> weapon +X, tunnel Z along barrel
const supportGrip = (roll, yaw, pitch = 0) => {
  // mirrored left hand (palm = +X_hand): X_hand -> weapon +Y (palm up), -Y_hand (fingers) -> weapon +X, Z_hand -> weapon +Z
  const base = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), PI / 2);
  const tw = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
  return tw.multiply(base);
};

// kinds: rifle | shotgun | pistol | melee | throw | radio
// chargeFire: false = the charging handle stays put while firing; chargeQ: left-hand Euler on the charging handle;
// chargeTravel: how far the handle is pulled on reload (0 = the hand just slaps meta.chargeKnob, e.g. a bolt catch);
// breakAction: break-open shotgun (barrels part hinges down to reload)
// crossbow: limbs and string follow the cocked state (update() is told whether a bolt is loaded)
// adsZ: how far down the view axis the sight point sits when aimed. The three guns that pivot on a front bead
// (shotgun, double-barrel, crossbow) carry their grip a whole gun length behind it, so adsZ is set to bring that
// grip back to the eye plane: any further out and the right fist rises into the frame under the point of aim.
const VM = {
  [ITEM.AK47]: {
    kind: 'rifle', hip: [0.19, -0.19, -0.28, 0.03, 0.17, 0.0], ads: 0.2, adsZ: -0.2,
    rPose: 'akGrip', rGrip: { p: [0, 0, 0], q: gunGrip(0.15) }, lGrip: { q: supportGrip(-0.4, 0.6, 0.0), pose: 'akSupport' },
    magPose: 'akMag', recoil: { z: 0.028, rx: 0.045, ry: 0.01 }, sprint: [-0.03, -0.015, 0.0, -0.22, 0.5, 0.35],
  },
  [ITEM.SHOTGUN]: {
    kind: 'shotgun', hip: [0.2, -0.19, -0.2, 0.03, 0.17, 0.0], ads: 0.22, adsZ: -0.79, adsPitch: 0.1,
    rPose: 'wristGrip', rGrip: { p: [0, 0, 0], q: gunGrip(0.75) }, lGrip: { q: supportGrip(-0.4, 0.6, 0.0), pose: 'pumpSupport' },
    recoil: { z: 0.06, rx: 0.12, ry: 0.02 }, sprint: [-0.03, -0.015, 0.0, -0.22, 0.5, 0.35],
  },
  [ITEM.HUNTING_RIFLE]: {
    kind: 'rifle', bolt: true, scope: true, hip: [0.19, -0.205, -0.3, 0.03, 0.17, 0.0], ads: 0.22, adsZ: -0.085,
    rPose: 'rifleGrip', rGrip: { p: [0, 0, 0], q: gunGrip(0.35) }, lGrip: { q: supportGrip(-0.4, 0.6, 0.0), pose: 'rifleSupport' },
    recoil: { z: 0.05, rx: 0.1, ry: 0.015 }, sprint: [-0.03, -0.015, 0.0, -0.22, 0.5, 0.35],
  },
  [ITEM.M4A1]: {
    kind: 'rifle', hip: [0.18, -0.185, -0.27, 0.03, 0.17, 0.0], ads: 0.2, adsZ: -0.16, chargeFire: false, chargeTravel: 0, chargeQ: [1.3, 0.1, 0],
    rPose: 'm4Grip', rGrip: { p: [0, 0, 0], q: gunGrip(0.15) }, lGrip: { q: supportGrip(-0.4, 0.6, 0.0), pose: 'm4Support' },
    magPose: 'm4Mag', recoil: { z: 0.022, rx: 0.035, ry: 0.008 }, sprint: [-0.03, -0.015, 0.0, -0.22, 0.5, 0.35],
  },
  [ITEM.MP5]: {
    kind: 'rifle', hip: [0.17, -0.18, -0.3, 0.03, 0.15, 0.0], ads: 0.2, adsZ: -0.2, chargeFire: false, chargeQ: [1.6, -0.3, 0.4],
    rPose: 'mp5Grip', rGrip: { p: [0, 0, 0], q: gunGrip(0.2) }, lGrip: { q: supportGrip(-0.4, 0.6, 0.0), pose: 'mp5Support' },
    magPose: 'mp5Mag', recoil: { z: 0.016, rx: 0.026, ry: 0.008 }, sprint: [-0.03, -0.015, 0.0, -0.22, 0.5, 0.35],
  },
  [ITEM.DB_SHOTGUN]: {
    kind: 'shotgun', breakAction: true, hip: [0.2, -0.19, -0.2, 0.03, 0.17, 0.0], ads: 0.22, adsZ: -0.68, adsPitch: 0.1,
    rPose: 'dbGrip', rGrip: { p: [0, 0, 0], q: gunGrip(0.75) }, lGrip: { q: supportGrip(-0.4, 0.6, 0.0), pose: 'dbSupport' },
    recoil: { z: 0.07, rx: 0.14, ry: 0.025 }, sprint: [-0.03, -0.015, 0.0, -0.22, 0.5, 0.35],
  },
  [ITEM.CROSSBOW]: {
    kind: 'rifle', crossbow: true, hip: [0.2, -0.19, -0.2, 0.03, 0.17, 0.0], ads: 0.22, adsZ: -0.53, adsPitch: 0.1,
    rPose: 'xbowGrip', rGrip: { p: [0, 0, 0], q: gunGrip(0.75) }, lGrip: { q: supportGrip(-0.4, 0.6, 0.0), pose: 'xbowSupport' },
    recoil: { z: 0.018, rx: 0.03, ry: 0.01 }, sprint: [-0.03, -0.015, 0.0, -0.22, 0.5, 0.35],
  },
  [ITEM.RPG]: {
    // shouldered: the tube rests on the right shoulder and runs forward down the right of the screen, the right hand on
    // the pistol grip, the left round the front grip; aimed, the sight off the left of the tube comes up to the eye.
    // rpg: the grenade in the muzzle follows the loaded state like the crossbow's bolt, and the reload carries a new
    // one in (_animReloadRPG, the left hand under its bulb at holdQ). A heavy shove back, little climb
    kind: 'rifle', rpg: true, hip: [0.21, -0.21, -0.3, 0.03, 0.0, 0.0], ads: 0.22, adsZ: -0.38, adsPitch: 0.12,
    rPose: 'rpgGrip', rGrip: { p: [0, 0, 0], q: gunGrip(0.15) }, lGrip: { q: handQ(-1, [0.35, -0.2, -0.92], [1, 0, 0.35]), pose: 'rpgSupport' },
    holdQ: supportGrip(-0.3, 0.5, 0.0),
    recoil: { z: 0.08, rx: 0.03, ry: 0.012 }, sprint: [-0.03, -0.04, 0.02, -0.3, 0.35, 0.3],
  },
  [ITEM.FLAMETHROWER]: {
    // reloads like a rifle: the fuel bottle is the magazine, the gas valve the charging handle (the hand just opens it)
    kind: 'rifle', hip: [0.19, -0.19, -0.27, 0.03, 0.17, 0.0], ads: 0.2, adsZ: -0.2, chargeFire: false, chargeTravel: 0, chargeQ: [1.3, 0.1, 0],
    rPose: 'flamerGrip', rGrip: { p: [0, 0, 0], q: gunGrip(0.15) }, lGrip: { q: supportGrip(-0.4, 0.6, 0.0), pose: 'flamerSupport' },
    magPose: 'fuelBottle', recoil: { z: 0.004, rx: 0.004, ry: 0.006 }, sprint: [-0.03, -0.015, 0.0, -0.22, 0.5, 0.35],
  },
  [ITEM.AT_RIFLE]: {
    // single: one round at a time, fed by hand into the open port (_animReloadSingle); the bolt is only worked on the
    // reload (boltTravel: how far it comes back). Heavy: it sags off the shoulder and kicks hard
    kind: 'rifle', bolt: true, single: true, boltTravel: 0.06, hip: [0.21, -0.225, -0.37, 0.035, 0.1, 0.0], ads: 0.22, adsZ: -0.3,
    rPose: 'atGrip', rGrip: { p: [0, 0, 0], q: gunGrip(0.32) }, lGrip: { q: supportGrip(-0.4, 0.6, 0.0), pose: 'atSupport' },
    recoil: { z: 0.09, rx: 0.17, ry: 0.03 }, sprint: [-0.03, -0.015, 0.0, -0.22, 0.5, 0.35],
  },
  [ITEM.PISTOL]: {
    // CS-style: low on the right, angled in toward the crosshair. Thumbs-forward two-hand grip: the right palm turned
    // ~26 deg toward the muzzle so its wrist sits behind the backstrap, index pad on the trigger; the left palm on the
    // left of the grip, its fingers over the right hand's, both thumbs along the frame. rGrip / lGrip and the
    // 'trigger' / 'cup' poses were fitted together against this grip's outline (fingers resting on it, nothing inside)
    kind: 'pistol', hip: [0.11, -0.158, -0.29, 0.09, 0.18, -0.06], ads: 0.2, adsZ: -0.42,
    rPose: 'trigger', rGrip: { p: [0, 0, -0.007], q: handQ(1, [0.435, -0.325, -0.84], [-0.9, -0.157, -0.406]) },
    lGrip: { p: [0, -0.02, -0.007], q: handQ(-1, [-0.199, -0.354, -0.914], [0.98, -0.072, -0.185]), pose: 'cup' },
    poleR: new THREE.Vector3(0.5, -1, 0.2), poleL: new THREE.Vector3(-0.6, -0.9, 0.2), // elbows down
    recoil: { z: 0.03, rx: 0.1, ry: 0.01 }, sprint: [0.0, -0.015, 0.03, -0.3, 0.22, 0.28],
  },
  [ITEM.FLARE_GUN]: {
    // held as the pistol is (its grip and trigger sit where the pistol's do); breakPistol: the reload tips the barrel
    // down about its hinge pin, pulls the spent case, thumbs a fresh shell in, snaps it shut and cocks the hammer
    kind: 'pistol', breakPistol: true, hip: [0.11, -0.158, -0.29, 0.09, 0.18, -0.06], ads: 0.2, adsZ: -0.42,
    rPose: 'flareGunR', rGrip: { p: [0, -0.004, -0.006], q: handQ(1, [0, -0.36, -0.93], [-1, 0, 0]) },
    lGrip: { p: [0, -0.028, -0.03], q: handQ(-1, [0.05, -0.55, -0.83], [0.92, 0.3, 0.15]), pose: 'cup' },
    poleR: new THREE.Vector3(0.5, -1, 0.2), poleL: new THREE.Vector3(-0.6, -0.9, 0.2),
    recoil: { z: 0.045, rx: 0.17, ry: 0.02 }, sprint: [0.0, -0.015, 0.03, -0.3, 0.22, 0.28],
  },
  [ITEM.KNIFE]: {
    // held up the way a hand actually holds a knife: the wrist straight in line with the forearm (the elbow dropped,
    // poleR), the back of the hand toward the eye, the blade rising up and left out of the thumb side. The hip angles
    // were solved for that hand (a hammer grip can't point the blade along the forearm; this one used to need the
    // wrist bent ~95 degrees).
    kind: 'melee', hip: [0.18, -0.13, -0.34, 0.651, 1.414, 2.646], poleR: new THREE.Vector3(0.3, -0.9, 0.3),
    rPose: 'knife', rGrip: { p: [0, 0, 0], q: handQ(1, [0, -Math.cos(KNIFE_GRIP.tilt), -Math.sin(KNIFE_GRIP.tilt)], [-1, 0, 0]) }, sprint: [0.02, -0.05, 0.05, -0.3, 0.1, 0] },
  [ITEM.BAT]: { kind: 'melee', twoHand: true, hip: [0.17, -0.2, -0.3, 1.2, 0.3, 0.15], rPose: 'batR', rGrip: { p: [0, 0, 0], q: Q(0, 0, 0) }, lGrip: { q: Q(0, 0, 0), pose: 'batL' }, swingPoleL: new THREE.Vector3(0, -1, 0.5), sprint: [0.05, -0.05, 0.08, -0.4, 0.1, 0] },
  [ITEM.SPIKED_BAT]: { kind: 'melee', twoHand: true, hip: [0.17, -0.2, -0.3, 1.2, 0.3, 0.15], rPose: 'batR', rGrip: { p: [0, 0, 0], q: Q(0, 0, 0) }, lGrip: { q: Q(0, 0, 0), pose: 'batL' }, swingPoleL: new THREE.Vector3(0, -1, 0.5), sprint: [0.05, -0.05, 0.08, -0.4, 0.1, 0] },
  [ITEM.MACHETE]: { kind: 'melee', hip: [0.16, -0.19, -0.3, 0.95, 0.3, 0.1], rPose: 'macheteGrip', rGrip: { p: [0, 0, 0], q: Q(0, 0, 0) }, sprint: [0.03, -0.05, 0.06, -0.4, 0.1, 0] },
  // nunchucks: no one pose and no one swing. Both hands, a chain and a free handle that are simulated, and a moveset:
  // all of it is models/nunchaku.js (ViewModel._updateNunchaku puts its hands and handles where that says)
  [ITEM.NUNCHAKU]: { kind: 'melee', nunchaku: true, hip: [0.147, -0.262, -0.4, 0.9, 0.4, 0.0], rPose: 'nkGrip', rGrip: { p: [0, 0, 0], q: Q(0, 0, 0) }, lGrip: { p: [0, 0, 0], q: Q(0, 0, 0), pose: 'nkGrip' }, sprint: [0, 0, 0, 0, 0, 0] },
  [ITEM.HAMMER]: { kind: 'melee', hip: [0.16, -0.19, -0.3, 0.85, 0.25, 0.0], rPose: 'hammerGrip', rGrip: { p: [0, 0, 0], q: Q(0, 0, 0) }, sprint: [0.03, -0.05, 0.06, -0.4, 0.1, 0] },
  [ITEM.MOLOTOV]: { kind: 'throw', hip: [0.17, -0.235, -0.38, 0.12, 0.2, -0.2], rPose: 'bottle', rGrip: { p: [0, 0, 0], q: gunGrip(0.0) }, sprint: [0.0, -0.08, 0.05, -0.3, 0.1, 0] },
  [ITEM.PIPEBOMB]: { kind: 'throw', hip: [0.16, -0.2, -0.34, 0.1, 0.2, -0.2], rPose: 'pipe', rGrip: { p: [0, 0, 0], q: gunGrip(0.0) }, sprint: [0.0, -0.08, 0.05, -0.3, 0.1, 0] },
  [ITEM.FLARE]: { kind: 'throw', hip: [0.16, -0.2, -0.35, 0.12, 0.2, -0.25], rPose: 'flare', rGrip: { p: [0, 0, 0], q: gunGrip(0.0) }, sprint: [0.0, -0.08, 0.05, -0.3, 0.1, 0] },
  [ITEM.GRENADE]: { kind: 'throw', hip: [0.13, -0.12, -0.3, 0.3, 0.35, -0.12], rPose: 'ball', rGrip: { p: [0, 0, 0], q: gunGrip(0.0) }, sprint: [0.0, -0.08, 0.05, -0.3, 0.1, 0] },
  // the alarm clock sits on the palm, the fingers cupped round its feet, its dial turned to the eye
  [ITEM.DECOY]: { kind: 'throw', hip: [0.15, -0.115, -0.34, 0.15, 0.35, -0.1], rPose: 'clock', rGrip: { p: [0, -0.058, 0], q: handQ(1, [-0.71, 0, -0.71], [0, 1, 0]) }, sprint: [0.0, -0.08, 0.05, -0.3, 0.1, 0] },
  // the walkie-talkie up in front of the chest, its face to the eye; keyed (talk: added as the key goes down), it
  // comes up and in toward the mouth
  // (held low on the case, below the grille, so the fingers leave the face clear)
  [ITEM.WALKIE]: { kind: 'radio', hip: [0.12, -0.12, -0.3, 0.12, 0.7, 0.0], rPose: 'radioHold', rGrip: { p: [0, -0.04, 0], q: gunGrip(0.0) }, talk: [-0.04, 0.05, 0.06, 0.2, 0.15, 0], sprint: [0.0, -0.08, 0.05, -0.3, 0.1, 0] },
};

// melee swing keyframes: [t, px,py,pz, rx,ry,rz, ease] (absolute weapon pose, Euler YXZ); ease 0 smooth,1 linear,2 out,3 in
const SWINGS = {
  // knife keys, like its hip, were solved for a hand that stays in line with the forearm
  knife: { dur: 0.36, keys: [[0.28, 0.24, -0.04, -0.3, 0.901, 3.168, 2.304, 0], [0.55, -0.1, -0.22, -0.42, 0.084, 0.895, 2.987, 1], [0.7, -0.12, -0.25, -0.38, 0.045, 0.834, 3.166, 2]] },
  stab: { dur: 0.62, keys: [[0.3, 0.21, -0.2, -0.29, 0.466, 1.691, 2.32, 0], [0.48, 0.06, -0.19, -0.54, 0.318, 0.912, 2.116, 2], [0.66, 0.06, -0.19, -0.52, 0.385, 0.959, 2.145, 0]] },
  bat: { dur: 0.62, keys: [[0.3, 0.26, -0.13, -0.34, 0.5, -1.7, 0.4, 0], [0.47, 0.08, -0.19, -0.45, 0.1, 0.5, 0.1, 1], [0.64, -0.2, -0.17, -0.36, 0.2, 1.8, -0.3, 2]] },
  machete: { dur: 0.5, keys: [[0.32, 0.21, 0.06, -0.3, 1.6, -0.3, -0.4, 0], [0.52, -0.02, -0.15, -0.42, -0.3, 0.9, 0.6, 1], [0.66, -0.12, -0.23, -0.36, -0.8, 1.1, 0.8, 2]] },
  hammer: { dur: 0.5, keys: [[0.32, 0.2, 0.05, -0.3, 1.8, 0.1, 0.0, 0], [0.52, 0.06, -0.16, -0.45, -0.2, 0.2, 0.0, 1], [0.64, 0.05, -0.18, -0.43, -0.3, 0.2, 0.0, 2]] },
  shove: { dur: 0.5, keys: [[0.25, 0.14, -0.16, -0.24, 0.15, 0.45, 0.55, 0], [0.42, 0.0, -0.12, -0.44, 0.1, 0.55, 0.65, 2], [0.55, 0.0, -0.12, -0.42, 0.1, 0.55, 0.65, 0]] },
};

// claws: wrist frames (camera space): [t, px,py,pz, rx,ry,rz, ease] for the swinging (right) hand; mirrored for left
const CLAW_IDLE = [0.18, -0.15, -0.38, -0.55, -0.35, 0.85];
const CLAW_SWING = { dur: 0.5, keys: [[0.3, 0.3, 0.02, -0.22, 0.0, -0.9, 1.3, 0], [0.55, -0.16, -0.24, -0.44, -1.2, 0.5, -0.2, 1]] };

// the tuck off a wall (update): per kind, the most it moves the item [px,py,pz, rx,ry,rz]; it starts TUCK_GAP short of
// where the item's reach meets the wall and is all the way in TUCK_RANGE further
const TUCK = {
  rifle: [-0.03, -0.02, 0.13, 0.55, 0.3, 0.3], // high ready: the muzzle up and in, the gun back
  shotgun: [-0.03, -0.02, 0.13, 0.55, 0.3, 0.3],
  pistol: [-0.01, -0.03, 0.1, 0.65, 0.15, 0.1],
  melee: [0.02, -0.04, 0.1, 0.35, 0.15, 0.0], // back and up
  throw: [0.0, -0.05, 0.08, 0.2, 0.0, 0.0],
  radio: [0.0, -0.02, 0.06, 0.0, 0.0, 0.0],
};
const TUCK_GAP = 0.06, TUCK_RANGE = 0.32;

const THROW_RELEASE = 0.46; // (of the throw animation) the item leaves the hand

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
const _v4 = new THREE.Vector3();
const _v5 = new THREE.Vector3();
const _v6 = new THREE.Vector3();
const _v7 = new THREE.Vector3();
const _v8 = new THREE.Vector3();
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
const DB_LOAD_ARC = new THREE.Vector3(-0.12, 0.03, 0.03);
const DB_LOAD_POLE = new THREE.Vector3(-1, 0.5, 0.1);
const RIFLE_RELOAD_ARC = new THREE.Vector3(-0.03, -0.07, 0.0);
const SHOVE_POLE_R = new THREE.Vector3(1, -0.2, 0.2);
const XBOW_HAUL_POLE = new THREE.Vector3(-1, 0.4, 0.2);
const PISTOL_RACK_POLE = new THREE.Vector3(-1, -0.3, 0.3);
const PISTOL_RACK_ARC = new THREE.Vector3(-0.07, 0.02, 0.03);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const SWAY_PIVOT = new THREE.Vector3(0.1, -0.14, -0.32); // roughly between the hands
const IDLE_RATE = 1.35; // breathing, rad/s (~4.7 s per breath)
const softClamp = (x, m) => m * Math.tanh(x / m);

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const win = (u, a, b, c, d) => smoothstep(a, b, u) * (1 - smoothstep(c, d, u)); // rise a..b, fall c..d
// a drink at the mouth, on top of where a used item is held: up (m), towards the eye (m), tipped back (rad)
const DRINK_LIFT = [0.06, 0.17, 1.6];

// A damped spring, kicked through .v (recoil, landing dip, look lag). Its constants were tuned with one explicit
// step per frame at 60 fps (v += a * dt, x += v * dt), and that step is part of the feel: it takes c / 60 off a
// kick in its first frame. One such step per frame also made the motion depend on the frame time, and it is only
// stable for short steps: one 100 ms frame threw the kick forward instead of back, and 10 fps diverged.
// So the motion is defined as that 60 Hz step, a linear map M of (x, v), and a frame of any length applies
// M^(dt * 60) exactly: the old motion at 60 fps, the same curve at every other frame rate, and never further out
// than that curve however long the frame. (Exported for scripts/test-netsync.js, which holds it to this.)
const SPRING_HZ = 60;
export class Spring {
  constructor(k, c) {
    this.x = 0;
    this.v = 0;
    // a spring too stiff to be stepped at that rate (M would flip it over every step, which has no in-between)
    // gets a finer step
    let h = 1 / SPRING_HZ;
    while (c * h >= 1 || k * h * h + c * h >= 2) h /= 2;
    this.rate = 1 / h;
    this.m00 = 1 - k * h * h;
    this.m01 = (1 - c * h) * h;
    this.m10 = -k * h;
    this.m11 = 1 - c * h;
    // M's eigenvalues are r * e^(+-i * w) for a spring that rings, r * e^(+-w) for one that does not
    const r = Math.sqrt(this.m11); // det M = 1 - c * h
    const cw = (this.m00 + this.m11) / (2 * r);
    this.ring = cw < 1;
    this.w = Math.max(1e-6, this.ring ? Math.acos(cw) : Math.acosh(cw));
    this.lr = Math.log(r);
    this.ia = 1 / (this.ring ? Math.sin(this.w) : Math.sinh(this.w));
    this.ib = this.ia / r;
  }
  step(dt, target = 0) {
    // M^t = a * I + b * M (t = 1 gives a = 0, b = 1: the old step)
    const t = dt * this.rate, w = this.w, lr = this.lr;
    let s, s1; // r^t * sin(t * w) and r^t * sin((t - 1) * w), sinh for a spring that does not ring
    if (this.ring) {
      const rt = Math.exp(t * lr);
      s = rt * Math.sin(t * w);
      s1 = rt * Math.sin((t - 1) * w);
    } else {
      // from the two eigenvalues to the power t: both are below 1, so nothing overflows however long the frame
      const p = Math.exp(t * (lr + w)), q = Math.exp(t * (lr - w));
      s = (p - q) / 2;
      s1 = (p * Math.exp(-w) - q * Math.exp(w)) / 2;
    }
    const a = -s1 * this.ia, b = s * this.ib;
    const x = this.x - target, v = this.v;
    this.x = target + a * x + b * (this.m00 * x + this.m01 * v);
    this.v = a * v + b * (this.m10 * x + this.m11 * v);
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

// energy drink (drink "use" prop): a tall black can with a lime band, held in both hands and tipped up to the mouth
function makeDrink() {
  const mb = new MeshBuilder({ skinned: false, atlas: 'weapon' });
  const R = 0.03, H = 0.15;
  mb.seg(0, [0, -H / 2, 0], [0, -H / 2 + 0.007, 0], R * 0.84, R, { region: WR.PLAIN, color: 0xb4b6b2, rs: 14, hs: 1, caps: 1, capScale: 0.02 });
  mb.seg(0, [0, -H / 2 + 0.007, 0], [0, H * 0.42, 0], R, R, { region: WR.PLAIN, color: 0x141614, rs: 14, hs: 1, caps: 0 });
  mb.seg(0, [0, -H * 0.12, 0], [0, H * 0.18, 0], R + 0.0006, R + 0.0006, { region: WR.PLAIN, color: 0x6cc228, rs: 14, hs: 1, caps: 0 });
  mb.seg(0, [0, -H * 0.085, 0], [0, -H * 0.055, 0], R + 0.001, R + 0.001, { region: WR.PLAIN, color: 0xe6e6dc, rs: 14, hs: 1, caps: 0 });
  // the shoulder narrowing into the lid, and the ring-pull bent up off it
  mb.seg(0, [0, H * 0.42, 0], [0, H / 2, 0], R, R * 0.82, { region: WR.PLAIN, color: 0xb4b6b2, rs: 14, hs: 1, caps: 1, capScale: 0.02 });
  mb.box(0, [R * 0.3, H / 2 + 0.002, 0], [0.012, 0.0016, 0.008], { region: WR.PLAIN, color: 0xc8cac6 });
  return mb.build().geometry;
}

// a cut of venison on the bone (food "use" prop for meat): raw and red, or browned off the fire
function makeMeat(cooked) {
  const mb = new MeshBuilder({ skinned: false, atlas: 'weapon' });
  const flesh = cooked ? 0x6a3a1e : 0x9a2a26;
  mb.box(0, [0, 0, 0], [0.11, 0.05, 0.075], { region: WR.PLAIN, color: flesh, round: 0.75, seg: 3 });
  mb.box(0, [0.012, 0.012, 0.004], [0.075, 0.034, 0.06], { region: WR.PLAIN, color: cooked ? 0x8a5428 : 0xb8443c, round: 0.8, seg: 2 });
  mb.box(0, [-0.03, -0.004, 0], [0.04, 0.045, 0.07], { region: WR.PLAIN, color: cooked ? 0x4a2812 : 0xd8c4b4, round: 0.7, seg: 2 }); // seared edge, or the fat
  mb.seg(0, [-0.045, 0, 0], [-0.1, 0.006, 0], 0.011, 0.009, { region: WR.PLAIN, color: 0xe2d8c4, rs: 8, hs: 1, caps: 1, capScale: 0.6 });
  mb.seg(0, [-0.098, -0.008, 0], [-0.098, 0.02, 0], 0.012, 0.012, { region: WR.PLAIN, color: 0xe2d8c4, rs: 8, hs: 1, caps: 1, capScale: 0.6 });
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
    this.drinkGeo = makeDrink();
    this.meatGeo = [makeMeat(false), makeMeat(true)];
    this.drinking = false; // the use is a drink: the can goes up to the mouth and tips
    this.kitGrip = 0.1; // half the distance between the hands holding it
    this.usePose = ['kitHold', 'kitHold'];
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
    this.talkT = 0; // the walkie-talkie keyed: raised toward the mouth (cfg.talk)
    this.tuckT = 0; // pulled back off a wall, a car or a crate in front (update's s.wallDist)
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
    this.cocked = true; // crossbow: string latched with a bolt on the rail (RPG: a grenade in the muzzle)
    this.cockHold = 0; // ...and how long to trust our own fire / reload over the caller's `loaded`
    this.hammerDown = false; // flare gun: the hammer has fallen and the reload has not cocked it yet
    this._nock = new THREE.Vector3(); // where the middle of the string is (weapon space)
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
    this.cocked = true;
    this.cockHold = 0;
    this.hammerDown = false;
    this.talkT = 0;
    this.recZ.x = this.recX.x = this.recY.x = 0;
    this.recZ.v = this.recX.v = this.recY.v = 0;
    const style = claws ? 'claw' : 'normal';
    this.armR.setStyle(style);
    this.armL.setStyle(style);
    // (nunchucks move the shoulders to a matched pair: back where everything else has them)
    this.armR.shoulder.position.copy(SHOULDER_R);
    this.armL.shoulder.position.copy(SHOULDER_L);
    if (this.nk) this.nk.meshes.trail.visible = false;
    if (this.cur && this.cur.cfg.nunchaku) this._nkView(this.cur).core.draw();
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
    this.armR.setPose(claws ? 'claw' : (this.cur && this.cur.cfg.rPose) || 'grip'); // (builds an item's own hand pose now, not mid-update)
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
    if (this.cur.cfg.kind === 'shotgun' || (this.cur.cfg.bolt && !this.cur.cfg.single)) this.cycleT = 0; // (single: the reload works the bolt)
    if (this.cur.cfg.crossbow || this.cur.cfg.rpg) {
      this.cocked = false;
      this.cockHold = 0.3;
    }
    if (this.cur.cfg.breakPistol) this.hammerDown = true;
  }

  reload(duration = 2, perShell = false) {
    if (!this.cur || this.claws) return;
    const k = this.cur.cfg.kind;
    if (k !== 'rifle' && k !== 'shotgun' && k !== 'pistol') return;
    this.act = { type: 'reload', t: 0, dur: Math.max(0.2, duration), perShell: !!perShell };
  }

  /** Nunchucks: a move of the moveset begins (NK_MOVE, shared/nunchaku.js). */
  nkSwing(move) {
    if (this.cur && this.cur.cfg.nunchaku && !(this.act && this.act.type === 'use')) this._nkView(this.cur).core.swing(move);
  }
  /** Nunchucks: a blow landed. kind: 'flesh' | 'bone' | 'wood' | 'metal' | 'dirt'; n: the surface's normal, view space. */
  nkHit(kind, nx = 0, ny = 0, nz = 1, power = 1) {
    if (this.cur && this.cur.cfg.nunchaku) this._nkView(this.cur).core.hit(kind, nx, ny, nz, power);
  }
  /** Nunchucks: a flourish asked for. */
  nkFlourish() {
    return !!(this.cur && this.cur.cfg.nunchaku && !this.act && this._nkView(this.cur).core.flourish());
  }
  _nkView(cur) {
    if (!this.nk) {
      const nk = (this.nk = new NunchakuFP(getNunchakuGeo(true), getViewWeaponMaterial()));
      // the other handle and the links go beside the first handle (the clip check and the grip fitter measure what is
      // there); the streak behind them is no part of the item
      for (const m of [nk.meshes.handle, ...nk.meshes.links]) cur.root.add(m);
      this.sway.add(nk.meshes.trail);
    }
    return this.nk;
  }

  melee(heavy = false) {
    if (this.claws) {
      this.clawSide = -this.clawSide;
      this.act = { type: 'claw', t: 0, dur: CLAW_SWING.dur, side: this.clawSide };
      return;
    }
    if (!this.cur) return;
    if (this.cur.cfg.nunchaku) return void this.nkSwing(heavy ? 9 : 0); // (the game names the move: nkSwing)
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
    const meat = CONSUMABLES[item]?.meat || 0; // 1: a raw cut, 2: a cooked one
    this.drinking = !!CONSUMABLES[item]?.drink;
    this.kit.geometry = meat ? this.meatGeo[meat - 1] : food ? this.canGeo : this.drinking ? this.drinkGeo : this.kitGeo;
    this.kitGrip = food ? 0.068 : this.drinking ? 0.055 : 0.1;
    // the hand poses fitted to each prop's sides (left, right)
    this.usePose = meat ? ['meatL', 'meatR'] : food ? ['tinHold', 'tinHold'] : this.drinking ? ['drinkHold', 'drinkHold'] : ['kitHold', 'kitHold'];
    this.act = { type: 'use', t: 0, dur: Math.max(0.6, duration) + 0.35 };
  }

  /** the item is put away before it is used up: the weapon is drawn again straight away */
  cancelUse() {
    if (!this.act || this.act.type !== 'use') return;
    this.act = null;
    this.kit.visible = false;
    this.drawT = 0;
    if (this.cur) this.cur.root.visible = true;
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
        if (done.type === 'reload' && cur && (cur.cfg.crossbow || cur.cfg.rpg)) {
          this.cocked = true;
          this.cockHold = 0.3;
        }
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
    if (cfg.nunchaku) return this._updateNunchaku(dt, s, cur, wantSprint);

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
    if (cfg.talk) {
      this.talkT += ((s.talk ? 1 : 0) - this.talkT) * (1 - Math.exp(-dt * 11));
      const tk = ease(this.talkT, 2);
      if (tk > 0.001) for (let i = 0; i < 6; i++) P6[i] += cfg.talk[i] * tk;
    }
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
      if (act && act.type === 'reload' && cfg.single) {
        // opened as the reload starts, closed on the new round as it ends
        rOnBolt = win(u, 0.0, 0.035, 0.12, 0.17) + win(u, 0.8, 0.85, 0.975, 1.0);
        lift = smoothstep(0.035, 0.06, u) * (1 - smoothstep(0.93, 0.975, u));
        back = smoothstep(0.06, 0.1, u) * (1 - smoothstep(0.86, 0.92, u));
      } else if (act && act.type === 'reload') {
        rOnBolt = win(u, 0.0, 0.1, 0.86, 0.96);
        lift = smoothstep(0.08, 0.14, u) * (1 - smoothstep(0.78, 0.84, u));
        back = smoothstep(0.14, 0.22, u) * (1 - smoothstep(0.7, 0.78, u));
      }
      parts.bolt.rotation.z = lift * 1.2;
      parts.bolt.position.z = parts.bolt.userData.base.z + back * (cfg.boltTravel || 0.085);
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
    if (parts.barrel) parts.barrel.rotation.x = 0; // (the flare gun's: the same)
    if (parts.hammer) {
      // falls the instant it is fired (a short swing past rest and back), stays down until the reload cocks it
      let fall = this.hammerDown ? Math.min(1, this.fireT / 0.025) : 0;
      if (act && act.type === 'reload' && cfg.breakPistol) fall *= 1 - smoothstep(0.86, 0.93, u); // thumbed back
      parts.hammer.rotation.x = -0.62 * fall + (this.hammerDown && this.fireT < 0.08 ? -0.08 * Math.sin((this.fireT / 0.08) * PI) : 0);
    }
    if (cfg.crossbow) {
      const reloading = !!act && act.type === 'reload';
      // fire() and the end of the reload animation flip `cocked` themselves; otherwise follow the caller
      if (this.cockHold > 0) this.cockHold -= dt;
      else if (!reloading && s.loaded !== undefined) this.cocked = !!s.loaded;
      // draw: hauled back during the reload, snapping forward (and ringing) right after a shot
      const ft = this.fireT;
      const draw = reloading ? smoothstep(0.2, 0.46, u) : this.cocked ? 1 : Math.max(0, 1 - ft / 0.035);
      const ring = !reloading && !this.cocked && ft < 0.3 ? -0.014 * Math.sin(ft * 120) * Math.exp(-ft / 0.06) : 0;
      this._poseCrossbow(cur, draw, ring);
      parts.arrow.visible = this.cocked && !reloading;
      parts.arrow.position.copy(parts.arrow.userData.base);
    }
    if (cfg.rpg) {
      // the grenade in the muzzle: fire() takes it away at once and the reload carries a new one in (_animReloadRPG);
      // otherwise it follows the caller, like the crossbow's bolt
      const reloading = !!act && act.type === 'reload';
      if (this.cockHold > 0) this.cockHold -= dt;
      else if (!reloading && s.loaded !== undefined) this.cocked = !!s.loaded;
      const wh = parts.warhead;
      wh.visible = this.cocked && !reloading;
      wh.position.copy(wh.userData.base);
      wh.quaternion.identity();
      this._rpgFollow = false;
    }
    if (parts.mag) {
      parts.mag.position.copy(parts.mag.userData.base);
      parts.mag.quaternion.identity();
      parts.mag.visible = true;
    }

    this._atFollow = false;
    if (cfg.single) parts.round.visible = parts.case.visible = false; // (shown by the reload only)

    // ---- actions
    if (act) {
      if (act.type === 'reload') this._animReload(cur, u, P6, parts, meta);
      else if (act.type === 'melee') {
        evalSwing(act.swing, P6.slice ? P6 : P6, u, _pose6b);
        for (let i = 0; i < 6; i++) P6[i] = _pose6b[i];
      } else if (act.type === 'throw') {
        this._animThrow(u, P6, cur);
        // the fingers open as the item leaves the hand (it is hidden from 0.46), not before: opened round it, they
        // went straight through it
        if (u >= THROW_RELEASE && u < 0.72) rPose = 'open';
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

    // ---- tucked back off what is in front: the viewmodel is drawn over the world (its own pass, depth cleared), so
    // nothing cuts into it; but a muzzle or a blade reaching further than the wall the player stands at reads as gone
    // into it. s.wallDist (m, along the view; Game.weaponClearance) against how far the item reaches at the hip: the
    // gun comes up and back to high ready, a blade or a throwable back and down, by as much as it would go in
    if (cur.reach === undefined) cur.reach = this._itemReach(cur);
    const tuckTo = Math.min(1, Math.max(0, (cur.reach + TUCK_GAP - (s.wallDist ?? 99)) / TUCK_RANGE));
    this.tuckT += (tuckTo - this.tuckT) * (1 - Math.exp(-dt * 10));
    const tk = TUCK[kind];
    if (tk && this.tuckT > 0.001) {
      const w = ease(this.tuckT, 0) * (1 - 0.6 * this.adsT) * (act && act.type === 'melee' ? 0.35 : 1);
      for (let i = 0; i < 6; i++) P6[i] += tk[i] * w;
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
    this.armR.setPose(rPose);
    this.armR.setVisible(true);
    // (on the bolt the hand's grip center goes over to the pinch's with the blend, so the pose switch doesn't jump it)
    const rC = altR && altRw > 0 ? this._blendCenter(this.armR, cfg.rPose || 'grip', 'pinch', altRw) : cfg.kind === 'throw' ? cfg.rPose : undefined;
    // a long gun's butt swings across under the right forearm on a shove: the right elbow goes out to the side for it
    let poleR = cfg.poleR || POLE_R;
    if (act && act.type === 'melee' && (cfg.kind === 'rifle' || cfg.kind === 'shotgun')) poleR = _v8.copy(poleR).lerp(SHOVE_POLE_R, win(u, 0.0, 0.2, 0.7, 0.95));
    this._solveArm(this.armR, rp, rq, SHOULDER_R, poleR, rC);

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
        lq.copy(wq);
        if (parts.barrels) lq.multiply(parts.barrels.quaternion); // (the hand turns with the fore-end it holds, as it closes)
        lq.multiply(cur.lGrip.q);
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
        // (arc: an offset, weapon space, at the middle of the A to B move, to take the hand round something between)
        if (rs.arc) _v2.add(_v3.copy(rs.arc).applyQuaternion(wq).multiplyScalar(Math.sin(PI * rs.m)));
        lp.lerp(_v2, altLw);
        // ...and the same way round going back from B to the grip
        if (rs.arc && rs.m > 0) lp.add(_v3.copy(rs.arc).applyQuaternion(wq).multiplyScalar(Math.sin(PI * altLw) * rs.m));
        if (rs.aCam) _q1.copy(rs.qa);
        else _q1.copy(wq).multiply(rs.qa);
        if (rs.bCam) _q2.copy(rs.qb);
        else _q2.copy(wq).multiply(rs.qb);
        _q1.slerp(_q2, rs.m);
        lq.slerp(_q1, altLw);
      }
      this.armL.setPose(lPose);
      this.armL.setVisible(lVisible || altLw > 0.01);
      // the grip center blends from the grip's to the reload's (A to B by m) with the weight, as the pose switches
      let lC;
      if (rs && altLw > 0 && cur.lGrip) {
        const cr = this._blendCenter(this.armL, rs.poseA || rs.pose || lPose, rs.poseB || rs.pose || lPose, rs.m, _v4);
        lC = this.armL.gripCenter(_v5, cur.lGrip.pose).lerp(cr, altLw);
      }
      let poleL = cfg.poleL || POLE_L;
      // two hands on a bat: through the swing the left elbow drops and goes back, so the left forearm passes under the
      // right hand instead of through it
      if (cfg.swingPoleL && act && act.type === 'melee') poleL = _v7.copy(poleL).lerp(cfg.swingPoleL, win(u, 0.36, 0.46, 0.76, 0.88));
      if (rs && (rs.poleA || rs.poleB) && altLw > 0) {
        _v8.copy(rs.poleA || poleL).lerp(rs.poleB || poleL, rs.m);
        poleL = _v7.copy(poleL).lerp(_v8, altLw);
      }
      this._solveArm(this.armL, lp, lq, SHOULDER_L, poleL, lC);
      if (this._atFollow) {
        // the anti-tank round in the left hand: weapon space, held by its middle
        _q1.copy(wq).invert();
        const rd = parts.round;
        rd.position.copy(lp).sub(wp).applyQuaternion(_q1).sub(atHold(_v1, this._atTilt, this._atYaw));
      }
      if (cfg.rpg && this._rpgFollow) {
        // the RPG grenade in the left hand: weapon space, held under its bulb (its tilt set by _animReloadRPG)
        _q1.copy(wq).invert();
        const wh = parts.warhead;
        wh.position.copy(lp).sub(wp).applyQuaternion(_q1).sub(_v1.copy(meta.rpg.grab).applyQuaternion(wh.quaternion));
      }
    } else {
      this.armL.setVisible(false);
    }
  }

  // Nunchucks (models/nunchaku.js): the moves, both hands and the simulated chain are the core's; this puts the two
  // handles, the links and the arms where it has them. s.camQ: the camera's orientation in the world (so the chain
  // hangs down whichever way the eye looks, and swings when the view turns); s.acc: the eye's acceleration (view
  // space); s.nkWind: the heavy attack's wind-up clock.
  _updateNunchaku(dt, s, cur, sprint) {
    const nk = this._nkView(cur), core = nk.core, act = this.act;
    if (act && act.type === 'use') {
      // an item in the hands: the nunchucks are away, and come out again as from a draw
      cur.root.visible = false;
      nk.meshes.trail.visible = false;
      this._nkUse = true;
      this._animUse(act.t / act.dur, this.time);
      return;
    }
    if (this._nkUse) {
      this._nkUse = false;
      core.draw();
    }
    this.kit.visible = false;
    // off a wall in front: the whole of it, arms and all, comes back
    if (cur.reach === undefined) cur.reach = nk.reach;
    const tuckTo = Math.min(1, Math.max(0, (cur.reach + TUCK_GAP - (s.wallDist ?? 99)) / TUCK_RANGE));
    this.tuckT += (tuckTo - this.tuckT) * (1 - Math.exp(-dt * 10));
    this.sway.position.z += ease(this.tuckT, 0) * 0.12;
    this.sway.position.y -= ease(this.tuckT, 0) * 0.03;
    core.wind(s.nkWind || 0);
    core.update(dt, {
      qW: s.camQ ? _q1.copy(s.camQ).multiply(this.sway.quaternion) : this.sway.quaternion,
      acc: s.acc || null,
      stance: sprint ? 'carry' : s.crouch ? 'low' : 'guard',
      colliders: nk.colliders,
    });
    this.weaponRoot.position.set(0, 0, 0);
    this.weaponRoot.quaternion.identity();
    nk.meshes.place(core, cur.parts.body);
    nk.meshes.trail.visible = nk.meshes.trail.visible && cur.root.visible;
    this._wp.copy(core.stickP[core.anchor]);
    this._wq.copy(core.stickQ[core.anchor]);
    const hr = core.right, hl = core.left;
    this.armR.shoulder.position.copy(FP_SHOULDER_R);
    this.armL.shoulder.position.copy(FP_SHOULDER_L);
    this.armR.setPose(hr.pose);
    this.armL.setPose(hl.pose);
    this.armR.setVisible(true);
    this.armL.setVisible(true);
    this._solveArm(this.armR, hr.p, hr.q, FP_SHOULDER_R, hr.pole, 'nkGrip');
    this._solveArm(this.armL, hl.p, hl.q, FP_SHOULDER_L, hl.pole, 'nkGrip');
  }

  // crossbow limbs + string for a draw of 0 (loosed) .. 1 (latched); ring = the string's wobble along the rail (m).
  // The limbs are modelled latched, so they swing forward by whatever draw is missing. The string never
  // stretches: its middle sits as far behind the tips as its length allows. Leaves that point in this._nock.
  _poseCrossbow(cur, draw, ring) {
    const x = cur.meta.xbow, parts = cur.parts;
    const a = x.flex * (1 - draw), ca = Math.cos(a), sa = Math.sin(a);
    const tx = x.pivot.x + x.tip.x * ca + x.tip.z * sa; // right tip (the left one mirrors it)
    const tz = x.pivot.z - x.tip.x * sa + x.tip.z * ca;
    const nz = tz + Math.sqrt(Math.max(0, x.half * x.half - tx * tx)) + ring;
    const len = Math.hypot(tx, nz - tz), yaw = Math.atan2(tx, nz - tz);
    parts.limbR.rotation.y = a;
    parts.limbL.rotation.y = -a;
    parts.stringR.position.set(tx, x.pivot.y, tz);
    parts.stringR.rotation.y = -yaw;
    parts.stringR.scale.z = len;
    parts.stringL.position.set(-tx, x.pivot.y, tz);
    parts.stringL.rotation.y = yaw;
    parts.stringL.scale.z = len;
    this._nock.set(0, x.pivot.y, nz);
  }

  // RPG: the launcher comes down off the shoulder and swings its muzzle in toward the middle of the screen; the left
  // hand lets go of the front grip, goes down for a grenade (below the screen by u 0.16), brings it up under and ahead
  // of the muzzle (0.32..0.5), lifts it into line with the bore (0.5..0.6) and pushes it in tail first (seated at
  // 0.74), then goes back to the grip. Until it is seated the grenade rides in the left hand (update places it after
  // the arm is solved: this._rpgFollow).
  _animReloadRPG(u, P6, st, parts, meta) {
    const tilt = win(u, 0.0, 0.16, 0.84, 1.0);
    const seat = win(u, 0.72, 0.74, 0.76, 0.82); // the launcher nods back as the grenade bottoms out
    P6[0] -= tilt * 0.05;
    P6[1] -= tilt * 0.045;
    P6[2] += tilt * 0.1 + seat * 0.01;
    P6[3] += tilt * 0.1;
    P6[4] += tilt * 0.42;
    P6[5] += tilt * 0.2;
    const lift = smoothstep(0.5, 0.6, u);
    const push = smoothstep(0.6, 0.74, u);
    // the grenade relative to its seat: out along the bore by the stroke, and before it is lined up, lower, further
    // out and nose up (tail down), clear of the tube
    const wh = parts.warhead, g = meta.rpg, base = wh.userData.base;
    wh.quaternion.setFromAxisAngle(X_AXIS, 0.3 * (1 - lift));
    wh.position.set(base.x, base.y - 0.07 * (1 - lift), base.z - g.stroke * (1 - push) - 0.06 * (1 - lift));
    if (u >= 0.32) {
      wh.visible = true;
      this._rpgFollow = push < 1;
    }
    // left hand: front grip -> down for a grenade (A, below the screen) -> under the grenade's bulb (B, riding on it)
    st.a.set(-0.1, -0.55, -0.24);
    st.aCam = true;
    st.qa.setFromEuler(_e1.set(1.2, 0.0, 0.0, 'YXZ'));
    st.b.copy(g.grab).applyQuaternion(wh.quaternion).add(wh.position);
    st.qb.copy(wh.quaternion).multiply(this.cur.cfg.holdQ);
    st.m = smoothstep(0.32, 0.5, u);
    st.w = win(u, 0.04, 0.16, 0.8, 0.94);
    st.pose = 'rpgWarhead';
  }

  /** grip center of arm between poses a and b (weight k), into out */
  _blendCenter(arm, a, b, k, out = this._tmpP) {
    return arm.gripCenter(out, a).lerp(arm.gripCenter(_v6, b), k);
  }

  /** How far forward of the eye the item reaches at its hip pose (m): the furthest -z of its parts' bounds. */
  _itemReach(cur) {
    const h = cur.cfg.hip;
    _m1.compose(_v1.set(h[0], h[1], h[2]), _q1.setFromEuler(_e1.set(h[3], h[4], h[5], 'YXZ')), _v2.set(1, 1, 1));
    let reach = 0;
    for (const m of cur.root.children) {
      if (!m.isMesh) continue;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      const b = m.geometry.boundingBox;
      for (let i = 0; i < 8; i++) {
        _v3.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).add(m.userData.base).applyMatrix4(_m1);
        reach = Math.max(reach, -_v3.z);
      }
    }
    return reach;
  }

  _solveArm(arm, gripPos, handQ, shoulderPos, pole, centerPose) {
    // wrist = grip - handQ * gripCenter (centerPose: place the wrist as that pose would, e.g. a hand opening as it lets
    // go of a throwable stays where it held it)
    if (centerPose && centerPose.isVector3) _v3.copy(centerPose).applyQuaternion(handQ);
    else arm.gripCenter(_v3, centerPose).applyQuaternion(handQ);
    _v1.copy(gripPos).sub(_v3);
    ikTwoBone(shoulderPos, _v1, ARM_L1, ARM_L2, pole, _qU, _qL);
    arm.orient(_qU, _qL, handQ);
  }

  _animReload(cur, u, P6, parts, meta) {
    const kind = cur.cfg.kind;
    // left-hand override: blend weapon grip -> lerp(A, B, m) by weight w. A/B in weapon space unless *Cam.
    const st =
      this._rs ||
      (this._rs = { w: 0, m: 0, a: new THREE.Vector3(), b: new THREE.Vector3(), qa: new THREE.Quaternion(), qb: new THREE.Quaternion(), aCam: false, bCam: false, pose: null, poseA: null, poseB: null, poleA: null, poleB: null, arc: null });
    st.w = 0;
    st.m = 0;
    st.aCam = st.bCam = false;
    st.pose = null;
    st.poseA = st.poseB = null; // the poses at A and at B, when they differ (their grip centers are blended by m)
    st.poleA = st.poleB = null; // the left elbow's pole at A / B, when it isn't the grip's (blended by m and the weight)
    st.arc = null;
    this._reloadState = st;
    if (cur.cfg.single) return this._animReloadSingle(u, P6, st, parts, meta);
    if (cur.cfg.rpg) return this._animReloadRPG(u, P6, st, parts, meta);
    if (cur.cfg.breakPistol) {
      // flare gun: muzzle down and canted in, the barrel tips open about its pin and the extractor kicks the spent case
      // out; the free hand fetches a fresh shell from below, drops it into the breech and thumbs it home, then a flick
      // of the wrist snaps the barrel shut and the hammer is thumbed back (update() eases it)
      const tilt = win(u, 0.0, 0.12, 0.84, 0.98);
      P6[3] -= tilt * FG_RELOAD.pitch;
      P6[5] += tilt * FG_RELOAD.roll;
      P6[4] += tilt * FG_RELOAD.yaw;
      P6[0] -= tilt * FG_RELOAD.x;
      P6[1] += tilt * FG_RELOAD.y;
      P6[2] -= tilt * FG_RELOAD.z;
      const open = smoothstep(0.08, 0.18, u) * (1 - smoothstep(0.76, 0.82, u));
      const flick = win(u, 0.74, 0.79, 0.81, 0.88); // the wrist snaps up to close it
      P6[3] += flick * 0.16;
      P6[1] += flick * 0.012;
      const br = parts.barrel;
      br.rotation.x = -open * FG_RELOAD.open;
      // the chamber mouth and the way into it (toward the muzzle), with the barrel as it is now
      const ch = _v1.copy(meta.chamber).sub(br.userData.base).applyQuaternion(br.quaternion).add(br.position);
      const fwd = _v3.set(0, 0, -1).applyQuaternion(br.quaternion);
      const sh = parts.shell;
      if (u < 0.4) {
        // the spent case, kicked up out of the breech and off to the right
        const kick = smoothstep(0.17, 0.22, u);
        const fly = smoothstep(0.22, 0.36, u);
        sh.visible = kick > 0.01 && fly < 0.98;
        sh.position.copy(ch).addScaledVector(fwd, -0.05 * kick);
        sh.position.x += fly * 0.12;
        sh.position.y += fly * 0.05 - fly * fly * 0.22;
        sh.position.z += fly * 0.04;
        sh.quaternion.copy(br.quaternion);
        sh.rotateZ(fly * 2.2);
        sh.rotateX(fly * 1.6);
      } else {
        const push = smoothstep(0.56, 0.68, u); // dropped in, then thumbed home
        sh.visible = true;
        sh.position.copy(ch).addScaledVector(fwd, -(1 - push) * 0.085);
        sh.quaternion.copy(br.quaternion);
        sh.visible = smoothstep(0.38, 0.52, u) > 0.3 && push < 0.97;
      }
      // A: below the screen (camera space), B: pinching the fresh shell's head, fingers down the bore
      st.a.set(-0.03, -0.5, -0.32);
      st.aCam = true;
      st.qa.setFromEuler(_e1.set(1.2, 0.0, 0.0, 'YXZ'));
      st.b.copy(sh.position).addScaledVector(fwd, -0.012);
      st.qb.copy(_q1.setFromEuler(_e1.set(P6[3], P6[4], P6[5], 'YXZ')).invert()).multiply(FG_RELOAD.q); // (camera -> weapon space)
      st.m = smoothstep(0.38, 0.52, u);
      st.w = win(u, 0.26, 0.38, 0.7, 0.8);
      st.pose = 'pinch';
      if (u > 0.93) this.hammerDown = false;
    } else if (cur.cfg.crossbow) {
      // dip the nose, haul the string back to the latch (update() flexes the limbs to match), then fetch a
      // bolt from below, lay it in the groove and slide it back against the string
      const tilt = win(u, 0.0, 0.12, 0.9, 1.0);
      P6[0] -= tilt * 0.02;
      P6[1] += tilt * 0.035;
      P6[3] -= tilt * 0.2;
      P6[4] += tilt * 0.02;
      P6[5] += tilt * 0.12;
      const strain = win(u, 0.2, 0.3, 0.42, 0.5); // the stock digs in while the string comes back
      P6[2] += strain * 0.03;
      P6[3] -= strain * 0.05;
      const seat = smoothstep(0.82, 0.93, u);
      const ar = parts.arrow;
      if (u < 0.6) {
        // A: hooked over the string (follows it), B: below the screen (camera space)
        st.a.copy(this._nock);
        st.a.y += 0.012;
        st.qa.setFromEuler(_e1.set(-0.7, 0.3, -PI / 2, 'YXZ'));
        st.b.set(-0.02, -0.5, -0.32);
        st.bCam = true;
        st.qb.setFromEuler(_e1.set(1.2, 0.0, 0.0, 'YXZ'));
        st.m = smoothstep(0.49, 0.6, u);
      } else {
        // A: below the screen, B: the bolt, held over the rail and pressed home
        st.a.set(-0.02, -0.5, -0.32);
        st.aCam = true;
        st.qa.setFromEuler(_e1.set(1.2, 0.0, 0.0, 'YXZ'));
        st.b.copy(meta.xbow.rail);
        st.b.y += 0.02 + (1 - seat) * 0.03;
        st.b.z -= (1 - seat) * 0.06;
        st.qb.setFromEuler(_e1.set(-0.9, 0.3, -PI / 2, 'YXZ'));
        st.m = smoothstep(0.64, 0.78, u);
        ar.visible = st.m > 0.55;
        ar.position.set(ar.userData.base.x, ar.userData.base.y + (1 - seat) * 0.03, ar.userData.base.z - (1 - seat) * 0.06);
      }
      st.w = win(u, 0.08, 0.18, 0.93, 0.99);
      st.pose = u < 0.6 ? 'xbowString' : 'pinch';
      st.poleA = XBOW_HAUL_POLE; // the elbow up and out while it hauls the string, the forearm off the tiller
    } else if (kind === 'rifle' && !cur.cfg.bolt) {
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
      st.poseA = cur.cfg.magPose || 'support';
      st.poseB = travel ? 'pinch' : 'open';
      st.pose = st.m > 0.5 ? st.poseB : st.poseA;
      st.arc = RIFLE_RELOAD_ARC; // from the charging handle back to the handguard round under it, not through it
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
        st.pose = 'pistolMag';
      } else {
        // A: magazine, B: slide (overhand rack)
        st.a.copy(parts.mag.position).addScaledVector(ax, 0.1);
        st.a.x -= 0.02;
        st.qa.setFromEuler(_e1.set(0.3, 0.4, 0.5, 'YXZ'));
        st.b.set(0, meta.slideGrab.y + 0.02, meta.slideGrab.z + 0.01 + pull * 0.03);
        st.qb.setFromEuler(_e1.set(-0.3, -0.2, -PI / 2 - 0.2, 'YXZ'));
        st.m = smoothstep(0.7, 0.76, u);
        st.poseA = 'pistolMag';
        st.poseB = 'rackPinch';
        st.pose = st.m > 0.5 ? st.poseB : st.poseA;
        // the elbow out to the left and up for the rack, so the forearm comes over the gun from the side instead of
        // up through the right hand on the grip
        st.poleB = PISTOL_RACK_POLE;
        st.arc = PISTOL_RACK_ARC; // from the magazine up to the slide out round the left of the right hand
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
      st.b.copy(ch).addScaledVector(back, 0.07 + (1 - push) * 0.07);
      st.b.y += 0.02;
      st.qb.setFromEuler(_e1.set(-0.2 - open * 0.62, 0.5, -PI / 2 - 0.4, 'YXZ'));
      st.m = smoothstep(0.3, 0.48, u);
      st.w = win(u, 0.12, 0.24, 0.7, 0.8);
      st.pose = 'pinch';
      st.arc = DB_LOAD_ARC; // up from below round the left of the gun, not through it
      st.poleB = DB_LOAD_POLE; // the elbow up and out: the forearm comes over the open breech, clear of the barrels
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

  // Anti-tank rifle (cfg.single): one big round fed by hand. The right hand throws the bolt open (the bolt block in
  // update) and the spent case flies out; the left hand goes down to a pouch on the belt for a long beat, brings a
  // round up over the port, lays it in and presses it home (seated at u 0.62), and goes back to the handguard while
  // the right hand closes the bolt on it (0.86..0.98). Until it is laid in, the round rides in the left hand
  // (update places it after the arm is solved: this._atFollow).
  _animReloadSingle(u, P6, st, parts, meta) {
    // the gun cants left to turn the port up, and sags while the left hand is away from it
    const tilt = win(u, 0.0, 0.1, 0.86, 1.0);
    const sag = win(u, 0.12, 0.24, 0.62, 0.74);
    P6[5] += tilt * 0.32;
    P6[3] -= tilt * 0.05 + sag * 0.05;
    P6[1] -= tilt * 0.012 + sag * 0.025;
    P6[0] -= tilt * 0.025;
    const seat = meta.seat, travel = this.cur.cfg.boltTravel || 0.085;
    // the spent case: drawn back with the bolt face, then flung up and out to the right
    const c = parts.case;
    if (u > 0.06 && u < 0.15) {
      c.visible = true;
      const e = Math.max(0, (u - 0.095) / 0.055);
      c.position.set(seat.x + e * 0.28, seat.y + e * 0.4 - e * e * 0.6, seat.z + smoothstep(0.06, 0.1, u) * travel + e * 0.08);
      c.rotation.set(-e * 4, e * 2.5, e * 1.5);
    }
    // the new round: in the hand (follow), then from over the port down into it, nose first
    const rd = parts.round;
    const lay = smoothstep(0.57, 0.615, u);
    const press = win(u, 0.6, 0.62, 0.64, 0.665);
    const AT = this._atAbove || (this._atAbove = new THREE.Vector3());
    AT.set(seat.x + 0.014 * (1 - lay), seat.y + 0.07 * (1 - lay), seat.z + 0.03 * (1 - lay));
    this._atTilt = -0.35 * (1 - lay);
    this._atYaw = 1.35 * (1 - smoothstep(0.55, 0.6, u)); // carried crosswise in the fingers, turned to the bore over the port
    if (u >= 0.57) {
      rd.visible = u < 0.92;
      rd.position.copy(AT);
      rd.rotation.set(this._atTilt, this._atYaw, 0);
    } else if (u > 0.45) {
      rd.visible = true;
      rd.rotation.set(this._atTilt, this._atYaw, 0);
      this._atFollow = true;
    }
    // left hand: forend -> the pouch (A, below the screen) -> over the port with the round (B, riding on it) -> forend
    st.a.set(-0.06, -0.55, -0.22);
    st.aCam = true;
    st.qa.setFromEuler(_e1.set(1.2, 0.0, 0.0, 'YXZ'));
    atHold(st.b, this._atTilt, this._atYaw).add(AT);
    st.b.y -= press * 0.006;
    st.qb.setFromEuler(_e1.set(-0.9, 0.3, -PI / 2, 'YXZ'));
    st.m = smoothstep(0.5, 0.57, u);
    st.w = win(u, 0.1, 0.17, 0.66, 0.76);
    st.pose = 'pinch';
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
    cur.root.visible = u < THROW_RELEASE || u > 0.8;
    if (u > 0.8) {
      const r = smoothstep(0.8, 1.0, u);
      P6[1] -= (1 - r) * 0.1;
    }
  }

  _animUse(u, t) {
    // kit held in front with both hands on its sides; small fiddling motion while "using". A drink goes up instead,
    // its lid to the mouth under the eyes and tipped past level, so it is the side and the bottom that are seen
    const up = win(u, 0.05, 0.25, 0.78, 0.95);
    const sip = this.drinking ? win(u, 0.2, 0.42, 0.66, 0.84) : 0;
    const fid = up * (1 - sip);
    const kitPos = _v2.set(0.0, -0.13 - (1 - up) * 0.3 + sip * DRINK_LIFT[0] + Math.sin(t * 5.3) * 0.004 * fid, -0.38 + sip * DRINK_LIFT[1]);
    this.kit.visible = up > 0.02;
    this.kit.position.copy(kitPos);
    this.kit.quaternion.setFromEuler(_e1.set(0.35 - (1 - up) * 0.6 + sip * DRINK_LIFT[2], Math.sin(t * 3.1) * 0.12 * fid, Math.sin(t * 4.3) * 0.08 * fid, 'YXZ'));
    _q2.setFromAxisAngle(X_AXIS, PI / 2); // palm on the side, fingers forward, index up
    _q1.copy(this.kit.quaternion).multiply(_q2);
    for (let side = -1; side <= 1; side += 2) {
      const arm = side < 0 ? this.armL : this.armR;
      _v1.set(side * this.kitGrip, -0.012, 0.0).applyQuaternion(this.kit.quaternion).add(kitPos);
      arm.setVisible(up > 0.02);
      arm.setPose(this.usePose[side < 0 ? 0 : 1]);
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
export const VM_DEBUG = { VM, CLAW_IDLE, SWINGS, CLAW_SWING, HAND_POSES, HAND_MAT, handQ, FG_RELOAD, FINGERS, PHALANX_R, THUMB_MCP };
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
  for (const p of ['grip', 'support', 'pinch', 'open', 'claw', 'knife']) {
    const g = getHandGeo(p, p === 'claw' ? 'claw' : 'glove', 1);
    n = Math.max(n, g.index.count / 3);
  }
  return n;
}
