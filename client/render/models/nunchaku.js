// Nunchucks: the moves, and the two views of them (first person: NunchakuFP, used by weapons.js's ViewModel; third
// person: NunchakuTP, used by characters.js's SurvivorInstance). The rules - which move, when its blows land, what
// they do - are shared/nunchaku.js and playersim.js; nothing here decides anything. This is what it looks like.
//
// One handle is in a hand (the driver's) and goes where that hand's track takes it; the other is on the end of the
// chain and is simulated (shared/nunchaku.js: ChainSim) - until a hand, or an arm, catches it, and from then until it
// is let go it is held. A move is a clip: where the driver's hand goes and which way its handle points, where the
// other hand goes, and when the free handle is caught and by what. Clips start from wherever the hands are, so a combo
// runs on from the last move's follow-through, and when no clip is running the hands settle to the stance's rest pose
// and the free handle is caught there. A pass from hand to hand ends a clip with both hands on it and swaps which is
// the driver: the next clip is then played mirrored.
//
// A hand's key is where its grip is and which way its handle points (grip -> chain end). The arm is worked out from
// those: the elbow swings out and up as far as it takes to bring the forearm square to the handle (the way an arm
// does when it strikes), and the fist is turned so that the forearm runs straight into the back of the hand. What is
// left for the wrist is its sideways cock, which is kept to what a wrist has.
// Everything is in "rig space": the first-person view's own space (x right, y up, -z ahead of the eye), or the
// survivor's chest (the same axes).
import * as THREE from 'three';
import { ChainSim, NK_GEOM, NK_CHAIN, NK_MOVE, NK_MOVES, NK, NK_JOINTS, NK_COL } from '../../../shared/nunchaku.js';

const PI = Math.PI;
const EYE = NK_GEOM.grip + NK_GEOM.eye; // from a hand's grip to its handle's eye
const HAND_Y = 0.083, HAND_X = 0.032; // from the wrist to the middle of the grip: along the hand, and into the palm
const COCK = 0.62, COCK_SIN = Math.sin(COCK), COCK_COS = Math.cos(COCK); // how far a wrist cocks sideways (rad)
const LOOSE_SIN = Math.sin(1.0); // ...and how far a handle tips in a hand that has loosened on it to let it turn (the whirl)
const EL_MIN = -0.25, EL_MAX = 1.9; // how far the elbow swings out and up from where it hangs (rad)

// ---------------------------------------------------------------- small maths
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
const _g = new THREE.Vector3(), _h = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _qi = new THREE.Quaternion();
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
// how a track gets from one key to the next: 0 ease in and out, 1 steady, 2 fast then settling, 3 gathering speed,
// 4 a snap (very fast, then settling), 5 a wind-up (slow, then very fast), 6 past the mark and back
function ease(u, e) {
  switch (e) {
    case 1:
      return u;
    case 2:
      return 1 - (1 - u) * (1 - u);
    case 3:
      return u * u;
    case 4:
      return 1 - (1 - u) ** 3;
    case 5:
      return u * u * u;
    case 6: {
      const s = 1.9, v = u - 1;
      return 1 + v * v * ((s + 1) * v + s);
    }
    default:
      return u * u * (3 - 2 * u);
  }
}

/** Where the elbow of an arm is: shoulder S, wrist W, the arm's two lengths, bent toward `pole` swung `el` round. */
function elbowOf(S, W, L1, L2, pole, el, out, poleOut) {
  _a.subVectors(W, S);
  let dist = _a.length();
  if (dist < 1e-5) _a.set(0, -1, 0);
  else _a.multiplyScalar(1 / dist);
  dist = clamp(dist, Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-4);
  _b.copy(pole).addScaledVector(_a, -pole.dot(_a));
  if (_b.lengthSq() < 1e-8) _b.set(0, 0, -1).addScaledVector(_a, _a.z);
  _b.normalize();
  if (el) {
    // round the line from the shoulder to the wrist: out and up for a right arm
    _c.crossVectors(_a, _b);
    _b.multiplyScalar(Math.cos(el)).addScaledVector(_c, -Math.sin(el));
  }
  if (poleOut) poleOut.copy(_b);
  const ang = Math.acos(clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1));
  return out.copy(S).addScaledVector(_a, Math.cos(ang) * L1).addScaledVector(_b, Math.sin(ang) * L1);
}
/** The frame of a handle in a hand: its chain end along d, the back of the fist turned the way the forearm lies. */
function holdQuat(d, f, out) {
  _c.copy(d).negate(); // z
  _b.copy(f).addScaledVector(_c, -f.dot(_c)); // y: toward the elbow, square to the handle
  if (_b.lengthSq() < 1e-6) _b.set(0, 1, 0).addScaledVector(_c, -_c.y);
  _b.normalize();
  _a.crossVectors(_b, _c); // x
  return out.setFromRotationMatrix(_m.makeBasis(_a, _b, _c));
}
/** The frame of a handle nobody holds: its chain end along d, rolled so that its x is as near `side` as it can be. */
function freeQuat(d, side, out) {
  _c.copy(d).negate();
  _a.copy(side).addScaledVector(_c, -side.dot(_c));
  if (_a.lengthSq() < 1e-8) _a.set(1, 0, 0).addScaledVector(_c, -_c.x);
  _a.normalize();
  _b.crossVectors(_c, _a);
  return out.setFromRotationMatrix(_m.makeBasis(_a, _b, _c));
}

// ---------------------------------------------------------------- tracks
// A key: [t, x, y, z, dx, dy, dz, ease]. The track runs from where the hand is when the clip starts through its keys:
// positions on a curve through them, directions turned from one to the next, each stretch timed by its key's ease.
function evalTrack(keys, t, start, out) {
  const n = keys.length;
  let i = 0;
  while (i < n - 1 && t > keys[i][0]) i++;
  const k2 = keys[i];
  const k1 = i > 0 ? keys[i - 1] : start;
  const t1 = i > 0 ? k1[0] : 0;
  const u = k2[0] > t1 ? clamp((t - t1) / (k2[0] - t1), 0, 1) : 1;
  const w = ease(u, k2[7]);
  const k0 = i > 1 ? keys[i - 2] : i === 1 ? start : null;
  const k3 = i < n - 1 ? keys[i + 1] : null;
  const w2 = w * w, w3 = w2 * w;
  for (let c = 1; c <= 3; c++) {
    const p1 = k1[c], p2 = k2[c];
    const p0 = k0 ? k0[c] : p1 - (p2 - p1), p3 = k3 ? k3[c] : p2 + (p2 - p1);
    // (tangents short of the neighbours' span, so a tight turn between far-apart keys does not swing wide)
    const m1 = (p2 - p0) * 0.35, m2 = (p3 - p1) * 0.35;
    out[c] = (2 * w3 - 3 * w2 + 1) * p1 + (w3 - 2 * w2 + w) * m1 + (-2 * w3 + 3 * w2) * p2 + (w3 - w2) * m2;
  }
  // the direction: round the great circle from one key's to the next's
  let ax = k1[4], ay = k1[5], az = k1[6];
  let bx = k2[4], by = k2[5], bz = k2[6];
  const la = Math.hypot(ax, ay, az) || 1, lb = Math.hypot(bx, by, bz) || 1;
  ax /= la;
  ay /= la;
  az /= la;
  bx /= lb;
  by /= lb;
  bz /= lb;
  const dot = clamp(ax * bx + ay * by + az * bz, -1, 1), th = Math.acos(dot);
  if (th < 1e-3) {
    out[4] = bx;
    out[5] = by;
    out[6] = bz;
  } else {
    const s = Math.sin(th), wa = Math.sin((1 - w) * th) / s, wb = Math.sin(w * th) / s;
    out[4] = ax * wa + bx * wb;
    out[5] = ay * wa + by * wb;
    out[6] = az * wa + bz * wb;
  }
  return out;
}

// ---------------------------------------------------------------- the moves
// All for a right-handed driver; a left-handed one plays them mirrored. In a clip:
//   d      the driver's hand: keys [t, x, y, z, dx, dy, dz, ease]
//   o      the other hand while it holds nothing (the same keys, written where a left hand goes: x negative)
//   oc     the other hand once it has the free handle
//   release  when the free handle is let go (0: as the clip starts)
//   catch  [t0, t1, who]: the free handle drawn to `who` from t0 and held from t1 - 'o' the other hand, 'arm'
//          clamped under the driver's arm, 'fold' against the driver's own handle
//   swap   the clip ends with the hands changed over (it must end with the other hand holding)
//   kick   [[t, pitch, yaw, roll], ...]: the view is jolted (first person)
//   body   the trunk and the legs (third person): keys [t, twist, lean, bend, drop, step, ease]
//   then   the clip that follows by itself
//
// These are the first-person clips: what reads from behind the eyes. The third person has its own (TP), the same
// moves on the same clocks, made to be seen from outside.
const N3 = (x, y, z) => {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
};
const K = (t, x, y, z, dx, dy, dz, e = 0) => [t, x, y, z, ...N3(dx, dy, dz), e];
const P6 = (x, y, z, dx, dy, dz) => [x, y, z, ...N3(dx, dy, dz)];
// (a first-person key written as where on the screen the fist is: sx, sy -1..1 across the view, and how far out)
const FP_TAN = [Math.tan((34 * PI) / 180) * (16 / 9), Math.tan((34 * PI) / 180)];
const KS = (t, sx, sy, z, dx, dy, dz, e = 0) => K(t, sx * FP_TAN[0] * -z, sy * FP_TAN[1] * -z, z, dx, dy, dz, e);
const PS = (sx, sy, z, dx, dy, dz) => P6(sx * FP_TAN[0] * -z, sy * FP_TAN[1] * -z, z, dx, dy, dz);

// Where a first-person fist is on the screen is what matters, so these keys are written that way (KS, PS: across,
// up, how far out). The guard: each fist low at the edge of the view, the handles leaning in to a taut chain.
const G_D = PS(0.34, -0.86, -0.41, -0.4, 0.86, -0.3), G_O = PS(-0.34, -0.86, -0.41, 0.4, 0.86, -0.3);
const FREE_O = PS(-0.5, -0.95, -0.3, 0.3, 0.75, -0.55); // the other hand with nothing in it: a loose guard, low on its side
const END_L = [-0.3, -0.6, -0.42, -0.7, 0.3, 0.4], END_R = [0.6, -0.42, -0.36, 0.5, 0.6, 0.6]; // where a stroke to the left / right ends
const fo = (t) => K(t, ...FREE_O, 0);
export const FP = {
  L1: 0.34, L2: 0.3,
  shoulder: [0.2, -0.29, 0.1],
  pole: [0.75, -0.65, 0.15],
  // rest poses: the driver's hold [x, y, z, dx, dy, dz], the other hand's (oc: holding, o: not), who has the free handle
  rest: {
    guard: { d: G_D, oc: G_O, o: FREE_O, who: 'o' },
    carry: { d: PS(0.62, -0.95, -0.3, 0.1, 0.25, -0.96), o: PS(-0.7, -1.4, -0.2, 0.2, 0.6, -0.7), who: 'arm' },
    low: { d: PS(0.3, -0.8, -0.45, -0.4, 0.84, -0.36), oc: PS(-0.3, -0.8, -0.45, 0.4, 0.84, -0.36), o: FREE_O, who: 'o' },
  },
  arm: [0.24, -0.36, -0.04, ...N3(0.1, -0.25, 0.96)], // clamped under the driver's arm: the free handle's eye, and its direction
  // the heavy wind-up's whirl: the middle of the fist's circle, its radius, the whirl's axis (leaning forward: the
  // free handle passes low across the view in front and clear over the head behind), how far the fist's own handle
  // leans out, where the elbow stays, the other hand, and the turns a second it is taken up to at each tier
  spin: { d: PS(0.67, 0.15, -0.3, 0, 1, 0), r: 0.03, n: [-0.05, 1, -0.3], tilt: 0.6, el: 0.7, o: FREE_O, rate: [2.6, 3.8, 5.0] },
  clips: {},
};
{
  const C = FP.clips;
  C.draw = {
    dur: 0.42, from: { d: PS(0.5, -1.5, -0.3, 0.1, 0.5, -0.85), o: PS(-0.7, -1.6, -0.25, 0.3, 0.75, -0.55), who: 'fold' },
    d: [KS(0.12, 0.55, -0.7, -0.34, 0.5, 0.3, -0.8, 2), KS(0.2, 0.45, -0.35, -0.42, -0.2, 0.9, -0.3, 4), K(0.42, ...G_D, 0)],
    o: [KS(0.2, -0.6, -1.2, -0.3, 0.3, 0.75, -0.55, 0), KS(0.42, -0.4, -0.9, -0.38, 0.4, 0.8, -0.4, 2)],
    release: 0.1, kick: [[0.2, -0.008, 0.004, 0.006]],
  };
  // ---- the light chain. Each is the fist's handle swept round like a flail's haft, the free handle strung out
  // beyond it: cocked back, through the upright, down across the front, and on round to where the next begins
  C.whip = {
    dur: 0.36,
    d: [KS(0.05, 0.8, -0.15, -0.28, 0.2, 0.5, 0.85, 2), KS(0.09, 0.5, -0.2, -0.38, 0, 1, 0, 3), KS(0.13, 0.15, -0.35, -0.46, -0.3, 0.4, -0.87, 1), KS(0.17, -0.15, -0.55, -0.45, -0.6, -0.25, -0.75, 1), KS(0.24, -0.3, -0.6, -0.42, -0.8, -0.5, 0.1, 2), KS(0.36, ...END_L, 0)],
    o: [fo(0.36)],
    release: 0, kick: [[0.13, -0.012, -0.012, -0.014]],
  };
  C.backhand = {
    dur: 0.34,
    d: [KS(0.04, -0.42, -0.45, -0.36, -0.8, 0.2, 0.55, 2), KS(0.08, -0.15, -0.4, -0.44, -0.5, 0.8, -0.2, 3), KS(0.12, 0.15, -0.38, -0.47, 0.3, 0.5, -0.8, 1), KS(0.16, 0.45, -0.42, -0.44, 0.8, 0.2, -0.55, 1), KS(0.22, 0.62, -0.45, -0.38, 0.8, 0.3, 0.5, 2), KS(0.34, ...END_R, 0)],
    o: [fo(0.34)],
    release: 0, kick: [[0.12, 0.004, 0.016, 0.012]],
  };
  C.eight = {
    dur: 0.48,
    d: [KS(0.05, 0.75, -0.15, -0.3, 0.3, 0.6, 0.75, 2), KS(0.085, 0.45, -0.22, -0.4, 0, 1, 0, 3), KS(0.12, 0.1, -0.4, -0.47, -0.4, 0.3, -0.85, 1), KS(0.155, -0.25, -0.6, -0.44, -0.8, -0.4, -0.3, 1), KS(0.2, -0.4, -0.3, -0.38, -0.6, 0.6, 0.5, 1), KS(0.24, -0.1, -0.3, -0.46, 0, 0.7, -0.7, 1), KS(0.275, 0.25, -0.5, -0.46, 0.7, -0.1, -0.7, 1), KS(0.33, 0.55, -0.6, -0.4, 0.8, -0.4, 0.3, 2), KS(0.48, ...END_R, 0)],
    o: [fo(0.48)],
    release: 0, kick: [[0.12, -0.008, -0.012, -0.012], [0.26, -0.008, 0.012, 0.012]],
  };
  C.smash = {
    dur: 0.66,
    d: [KS(0.11, 0.55, 0.25, -0.28, 0.1, 0.45, 0.88, 2), KS(0.15, 0.35, 0.05, -0.4, 0, 1, -0.1, 3), KS(0.19, 0.2, -0.3, -0.48, -0.05, 0.35, -0.93, 1), KS(0.24, 0.15, -0.68, -0.46, -0.05, -0.4, -0.9, 2), KS(0.5, 0.2, -0.7, -0.42, -0.2, 0.5, -0.8, 0), KS(0.66, 0.3, -0.8, -0.41, -0.35, 0.8, -0.45, 0)],
    o: [KS(0.11, -0.45, -0.6, -0.32, 0.3, 0.75, -0.55, 2), KS(0.24, -0.5, -1.0, -0.3, 0.3, 0.75, -0.55, 2), fo(0.66)],
    release: 0, kick: [[0.19, -0.03, 0, 0.004]],
  };
  // ---- openers
  C.lunge = {
    dur: 0.46,
    d: [KS(0.07, 0.8, -0.5, -0.22, 0.5, 0.4, 0.75, 2), KS(0.11, 0.45, -0.35, -0.4, 0.1, 0.9, 0.3, 3), KS(0.15, 0.1, -0.3, -0.5, -0.3, 0.4, -0.85, 1), KS(0.2, -0.2, -0.5, -0.47, -0.7, -0.2, -0.65, 1), KS(0.28, -0.32, -0.6, -0.42, -0.8, -0.4, 0.2, 2), KS(0.46, ...END_L, 0)],
    o: [fo(0.46)],
    release: 0, kick: [[0.15, -0.014, -0.016, -0.02]],
  };
  C.sweep = {
    dur: 0.42,
    d: [KS(0.06, 0.85, -0.6, -0.28, 0.85, 0, 0.5, 2), KS(0.1, 0.5, -0.62, -0.4, 0.6, 0.1, -0.75, 3), KS(0.14, 0.1, -0.65, -0.48, -0.1, 0, -1, 1), KS(0.18, -0.25, -0.65, -0.45, -0.8, 0, -0.6, 1), KS(0.25, -0.4, -0.6, -0.4, -0.8, 0.2, 0.5, 2), KS(0.42, ...END_L, 0)],
    o: [fo(0.42)],
    release: 0, kick: [[0.14, 0.006, -0.02, -0.016]],
  };
  C.retreat = {
    dur: 0.38,
    d: [KS(0.04, -0.42, -0.45, -0.32, -0.8, 0.2, 0.55, 2), KS(0.08, -0.15, -0.4, -0.4, -0.5, 0.8, -0.2, 3), KS(0.12, 0.15, -0.38, -0.43, 0.3, 0.5, -0.8, 1), KS(0.16, 0.45, -0.42, -0.4, 0.8, 0.2, -0.55, 1), KS(0.22, 0.62, -0.45, -0.34, 0.8, 0.3, 0.5, 2), KS(0.38, ...END_R, 0)],
    o: [fo(0.38)],
    release: 0, kick: [[0.12, 0.006, 0.014, 0.01]],
  };
  // ---- the heavy attack: the wind-up is not a clip but a whirl (Core._spin); this is the strike it is let go as
  C.heavy = {
    dur: 0.74,
    d: [KS(0.06, 0.7, 0.1, -0.3, 0.3, 0.6, 0.75, 2), KS(0.1, 0.45, -0.1, -0.4, 0, 1, 0, 3), KS(0.14, 0.1, -0.35, -0.5, -0.35, 0.3, -0.88, 1), KS(0.185, -0.2, -0.6, -0.46, -0.7, -0.35, -0.6, 1), KS(0.26, -0.35, -0.62, -0.42, -0.8, -0.5, 0.2, 2), KS(0.74, ...END_L, 0)],
    o: [fo(0.74)],
    release: 0, kick: [[0.14, -0.022, -0.018, -0.022]],
  };
}

// ---------------------------------------------------------------- the core
class Hand {
  constructor() {
    this.k = [0, 0, 0, 0, 0, 1, 0, 0]; // its track's value now: [-, x, y, z, dx, dy, dz, -], in the clip's terms
    this.start = this.k.slice();
    this.p = new THREE.Vector3(); // the grip, rig space
    this.d = new THREE.Vector3(0, 1, 0); // its handle's direction
    this.f = new THREE.Vector3(0, 0, 1); // its forearm's (wrist -> elbow)
    this.q = new THREE.Quaternion(); // its handle's frame (and the hand's)
    this.wrist = new THREE.Vector3();
    this.elbow = new THREE.Vector3();
    this.pole = new THREE.Vector3(); // which way its elbow points (for the view's own arm solve)
    this.el = 0; // how far the elbow is swung out
    this.elLock = null;
    this.loose = false;
    this.cock = 0; // the wrist's sideways cock (rad; + = the handle tipped away from the elbow)
    this.holds = false;
    this.pose = 'nkGrip';
  }
}

const TRAIL_N = 40;
export const NK_TRAIL_N = TRAIL_N;
const MOVE_CLIP = ['whip', 'backhand', 'eight', 'smash', 'lunge', 'sweep', 'retreat', 'heavy', 'heavy', 'heavy'];

/**
 * The moves, the hands and the chain, in rig space, for either view. body: { L1, L2, shoulder, pole, rest, arm, spin,
 * clips } as FP above (shoulder, pole: the right arm's; the left is its mirror).
 */
export class NunchakuCore {
  constructor(body) {
    this.body = body;
    this.sim = new ChainSim(16);
    this.side = 1; // which hand drives: 1 right, -1 left
    this.dr = new Hand(); // the driver's hand
    this.ot = new Hand(); // the other
    this.S = new THREE.Vector3(...body.shoulder);
    this.pole = new THREE.Vector3(...body.pole);
    this.clip = null;
    this.clipName = '';
    this.t = 0;
    this.stance = 'guard';
    this.who = ''; // who has the free handle: '' nobody, 'o' the other hand, 'arm', 'fold'
    this.pinW = 0;
    this.catchT = 0; // how long the settling catch has been closing
    this.restT = 9; // how long the hands have been settling
    this.idleT = 0;
    this.spin = 0; // the heavy wind-up: how far the hand is into it, 0..1
    this.spinPh = 0; // ...where round its circle the fist is
    this.spinRate = 0; // ...how fast the free handle is going round (rad/s)
    this.spinAt = 0;
    this.spinC = [0, 0, 0];
    this.spinDir = 0;
    this.spinSeen = false;
    this.windT = 0;
    this.stop = 0; // hit-stop left (s of real time)
    this.time = 0;
    this.qW = new THREE.Quaternion(); // rig -> the space gravity is down in
    this.kick = new THREE.Vector3(); // the view's jolt: pitch, yaw, roll (rad), sprung
    this.kickV = new THREE.Vector3();
    this.give = new THREE.Vector3(); // the hands' give under a blow or a catch (m), sprung
    this.giveV = new THREE.Vector3();
    this.bodyK = [0, 0, 0, 0, 0, 0, 0]; // the trunk and legs' track value now: [-, twist, lean, bend, drop, step, -]
    this.bodyStart = this.bodyK.slice();
    this.events = []; // what happened this frame, for the sounds: { type, v, kind }
    this.kicks = 0; // (how many of the clip's kicks have been given)
    // what the views draw: the two handles' frames, the chain's joints (rig space)
    this.stickP = [new THREE.Vector3(), new THREE.Vector3()]; // the grip origin of handle 0 / 1
    this.stickQ = [new THREE.Quaternion(), new THREE.Quaternion()];
    this.anchor = 0; // which handle the driver holds
    this.joints = new Float32Array(NK_JOINTS * 3);
    this.tipSpeed = 0;
    this.trail = new Float32Array(TRAIL_N * 6); // the free handle's two ends over the last steps (rig space), newest last
    this.trailN = 0;
    this._side = new THREE.Vector3(1, 0, 0);
    this.freeD = new THREE.Vector3(0, 1, 0); // the free handle: its direction, its eye, its grip (rig space)
    this.freeTop = new THREE.Vector3();
    this.freeGrip = new THREE.Vector3();
    this.noIdle = false;
    this.fast = false;
    this.setRest('guard');
  }

  // ---- what the game tells it
  /** Brought out: from below, folded in the one hand, snapped open. */
  draw() {
    this.side = 1;
    this.anchor = 0;
    this.windT = 0;
    this.stop = 0;
    this.setRest(this.body.clips.draw.from);
    this.play('draw');
    this.event('draw');
  }
  /** A move of the moveset begins (NK_MOVE). */
  swing(move) {
    this.windT = 0;
    this.heavy = move >= NK_MOVE.HEAVY1 ? move - NK_MOVE.HEAVY1 + 1 : 0;
    this.play(MOVE_CLIP[move] || 'whip');
    this.event('swing', move);
  }
  /** The heavy attack being wound up: t seconds so far (0: not). */
  wind(t) {
    if (t > 0 && this.windT <= 0) {
      this.clip = null;
      this.clipName = 'wind';
      this.spinC = [this.dr.k[1], this.dr.k[2], this.dr.k[3]];
      this.spinSeen = false;
      this.spinRate = 0;
      this.spinDir = 0;
      this.release();
      this.event('wind', 0);
    }
    this.windT = t;
  }
  /** A blow landed on something. n: the surface's normal, rig space (toward the striker); kind: what it was. */
  hit(kind, nx, ny, nz, power = 1) {
    if (this.who) return;
    _a.set(nx, ny, nz).applyQuaternion(this.qW);
    this.sim.bounce(_a.x, _a.y, _a.z, kind === 'metal' ? 0.6 : kind === 'wood' ? 0.5 : 0.35, 2.5 * power);
    this.stop = 0.045 + 0.03 * power;
    this.kickV.x += 0.5 * power;
    this.kickV.z += this.side * 0.3 * power;
    this.giveV.z += 1.4 * power;
    this.giveV.y += 0.5 * power;
    this.event('hit', power, kind);
  }
  /** A flourish asked for: the long one, with its passes from hand to hand. */
  flourish() {
    if ((this.clip && !this.clip.idle) || this.windT > 0 || !this.body.clips.show1) return false;
    this.play('show1');
    return true;
  }

  event(type, v = 0, kind = '') {
    this.events.push({ type, v, kind });
  }

  play(name) {
    const def = this.body.clips[name];
    if (!def) return;
    this.clip = def;
    this.clipName = name;
    this.t = 0;
    this.kicks = 0;
    this.restT = 0;
    this.idleT = 0;
    this.catchT = 0;
    this.dr.start = this.dr.k.slice();
    this.ot.start = this.ot.k.slice();
    this.bodyStart = this.bodyK.slice();
    this.released = false;
    if (def.release === 0) this.release();
  }

  release() {
    if (this.who) this.event('release', 0);
    this.who = '';
    this.pinW = 0;
    this.catchT = 0;
    this.sim.setPin(0);
    this.ot.holds = false;
  }

  /** Put the hands at a rest pose at once (r: its name, or a pose). */
  setRest(r) {
    const rest = typeof r === 'string' ? this.body.rest[r] : r;
    for (let i = 0; i < 6; i++) {
      this.dr.k[i + 1] = rest.d[i];
      this.ot.k[i + 1] = (rest.who === 'o' ? rest.oc : rest.o)[i];
    }
    this.who = rest.who;
    this.pinW = 1;
    this.ot.holds = rest.who === 'o';
    this.clip = null;
    this.clipName = '';
    this._snap = true;
  }

  // ---- a frame
  /**
   * dt: seconds. env: { qW: rig space's orientation in the world (so gravity, and the view or the body turning, reach
   * the chain), acc: the carrier's acceleration (rig space, m/s^2), stance: 'guard' | 'carry' | 'low', colliders(core):
   * adds the body's (rig space) through core.col }.
   */
  update(dt, env = {}) {
    if (this.events.length > 48) this.events.length = 0; // (nobody is listening)
    dt = Math.min(0.1, Math.max(0, dt));
    // hit-stop: for a moment after a blow lands everything all but stands still
    let scale = 1;
    if (this.stop > 0) {
      this.stop -= dt;
      scale = 0.06;
    }
    const d = dt * scale;
    this.time += d;
    if (env.qW) this.qW.copy(env.qW);
    else this.qW.identity();
    this.stance = env.stance || 'guard';
    const B = this.body, rest = B.rest[this.stance] || B.rest.guard;
    const dr = this.dr, ot = this.ot;

    // ---- the clip, the spin, or settling to rest
    let clip = this.clip;
    if (clip) {
      this.t += d;
      if (this.t >= clip.dur) {
        if (clip.swap && this.who === 'o' && this.pinW >= 1) this._swap();
        const then = clip.then;
        this.clip = clip = null;
        this.clipName = '';
        if (then) {
          this.play(then);
          clip = this.clip;
        }
      }
    }
    if (this.windT > 0) this._spin(d);
    else if (clip) this._clip(clip);
    else this._settle(d, rest);
    if (!(this.windT > 0)) this.spin = Math.max(0, this.spin - d * 6);

    // ---- the hands: from their tracks to grips, handles, forearms and elbows
    spring(this.give, this.giveV, 220, 22, dt);
    spring(this.kick, this.kickV, 150, 17, dt);
    this._pose(dr, this.side);
    dr.p.add(this.give);
    this._pose(ot, -this.side);
    if (this.who === 'o') {
      // in (or coming into) the other hand: its eye is never further from the driver's than the chain is long
      _c.copy(ot.p).addScaledVector(ot.d, EYE);
      _d.copy(dr.p).addScaledVector(dr.d, EYE);
      _e.subVectors(_c, _d);
      const l = _e.length();
      if (l > NK_CHAIN * 0.999) ot.p.addScaledVector(_e, -(l - NK_CHAIN * 0.999) / l);
    }
    this._arm(dr, this.side, d);
    this._arm(ot, -this.side, d);

    // ---- the chain
    const sim = this.sim, qW = this.qW;
    _qi.copy(qW).invert();
    sim.grav[0] = 0;
    sim.grav[1] = -9.81;
    sim.grav[2] = 0;
    if (env.acc) {
      _b.copy(env.acc).applyQuaternion(qW);
      sim.acc[0] = clamp(_b.x, -30, 30);
      sim.acc[1] = clamp(_b.y, -30, 30);
      sim.acc[2] = clamp(_b.z, -30, 30);
    } else sim.acc[0] = sim.acc[1] = sim.acc[2] = 0;
    _a.copy(dr.p).addScaledVector(dr.d, EYE).applyQuaternion(qW);
    _b.copy(dr.d).applyQuaternion(qW);
    sim.setAnchor(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z);
    const pw = this.pinW;
    if (this.who === 'o') {
      _c.copy(ot.p).addScaledVector(ot.d, EYE).applyQuaternion(qW);
      _b.copy(ot.d).applyQuaternion(qW);
      sim.setPin(pw, _c.x, _c.y, _c.z, _b.x, _b.y, _b.z);
    } else if (this.who === 'arm') {
      const a = B.arm;
      _c.set(a[0] * this.side, a[1], a[2]).applyQuaternion(qW);
      _b.set(a[3] * this.side, a[4], a[5]).applyQuaternion(qW);
      sim.setPin(pw, _c.x, _c.y, _c.z, _b.x, _b.y, _b.z);
    } else if (this.who === 'fold') {
      // against the driver's own handle, a finger's width off it on the thumb's side
      holdQuat(dr.d, dr.f, _q);
      _e.set(0.036 * this.side, 0, 0).applyQuaternion(_q);
      _c.copy(dr.p).addScaledVector(dr.d, EYE).add(_e).applyQuaternion(qW);
      _b.copy(dr.d).applyQuaternion(qW);
      sim.setPin(pw, _c.x, _c.y, _c.z, _b.x, _b.y, _b.z);
    } else sim.setPin(0);
    sim.clearColliders();
    this._armColliders();
    if (env.colliders) env.colliders(this);
    if (this._snap) {
      // put there, not moved there: the chain starts at rest in the pose
      this._snap = false;
      sim.a0.set(sim.a);
      sim.reset();
      sim.pin.w = pw;
      for (let i = 0; i < 4; i++) sim.step(1 / 240);
      this.trailN = 0;
    }
    const n = sim.step(d);
    if (sim.taut > 0.25) this.event('rattle', sim.taut);
    if (sim.knock > 1.5) this.event('knock', sim.knock, sim.knockAt < 0 ? 'wood' : 'body');
    this.tipSpeed = sim.tipSpeed;
    // the free handle through the air: heard each time it gets up to speed (and, whirled, each time round: _spin)
    if (!this.fast && sim.tipSpeed > 15 && !(this.windT > 0)) {
      this.fast = true;
      this.event('whoosh', sim.tipSpeed);
    } else if (this.fast && sim.tipSpeed < 8) this.fast = false;

    // ---- out: the handles, the chain, the trail (rig space)
    const A = this.anchor, F = 1 - A;
    this.stickP[A].copy(dr.p);
    this.stickQ[A].copy(dr.q);
    const fd = this.freeD.set(sim.u[0], sim.u[1], sim.u[2]).applyQuaternion(_qi);
    const ft = this.freeTop.set(sim.top[0], sim.top[1], sim.top[2]).applyQuaternion(_qi);
    const fg = this.freeGrip.copy(ft).addScaledVector(fd, -EYE);
    if (this.who === 'o') {
      // the other hand, reaching for or holding the free handle: on its grip, turned to it
      const reach = pw >= 1 ? 1 : smooth(clamp(pw * 1.6, 0, 1));
      ot.p.lerp(fg, reach);
      ot.d.lerp(fd, reach).normalize();
      this._arm(ot, -this.side, 0);
      ot.pose = pw >= 1 ? 'nkGrip' : pw > 0.6 ? 'nkHalf' : 'open';
    } else ot.pose = 'nkHalf';
    dr.pose = this.spin > 0.3 ? 'nkSpin' : 'nkGrip';
    if (this.who === 'o' && pw >= 1) {
      this.stickQ[F].copy(ot.q);
      this.stickP[F].copy(ot.p);
    } else {
      this._side.set(sim.side[0], sim.side[1], sim.side[2]).applyQuaternion(_qi);
      freeQuat(fd, this._side, this.stickQ[F]);
      this.stickP[F].copy(fg);
    }
    const J = this.joints, sj = sim.j;
    for (let i = 0; i < NK_JOINTS; i++) {
      _c.set(sj[i * 3], sj[i * 3 + 1], sj[i * 3 + 2]).applyQuaternion(_qi);
      J[i * 3] = _c.x;
      J[i * 3 + 1] = _c.y;
      J[i * 3 + 2] = _c.z;
    }
    // the trail: where the free handle's ends were over the last steps
    if (n > 0) {
      const T = this.trail, tr = sim.trail, m = Math.min(n, TRAIL_N);
      if (m < TRAIL_N) T.copyWithin(0, m * 6);
      for (let i = 0; i < m; i++) {
        const src = (n - m + i) * 6, dst = (TRAIL_N - m + i) * 6;
        for (let k = 0; k < 6; k += 3) {
          _c.set(tr[src + k], tr[src + k + 1], tr[src + k + 2]).applyQuaternion(_qi);
          T[dst + k] = _c.x;
          T[dst + k + 1] = _c.y;
          T[dst + k + 2] = _c.z;
        }
      }
      this.trailN = Math.min(TRAIL_N, this.trailN + m);
    }
  }

  // a clip's frame: the hands along their tracks, the free handle let go and caught on the clip's clock
  _clip(clip) {
    const t = this.t, dr = this.dr, ot = this.ot;
    evalTrack(clip.d, t, dr.start, dr.k);
    if (clip.release > 0 && !this.released && t >= clip.release) {
      this.released = true;
      this.release();
    }
    const c = clip.catch;
    if (c && t >= c[0]) {
      if (this.who !== c[2]) {
        this.who = c[2];
        this.pinW = 0;
        ot.startC = ot.k.slice();
        ot.startC[0] = c[0];
      }
      const w = clamp((t - c[0]) / Math.max(1e-3, c[1] - c[0]), 0, 1);
      if (w >= 1 && this.pinW < 1) this._caught();
      this.pinW = w;
    }
    if (this.who === 'o' && clip.oc) evalTrack(clip.oc, t, ot.startC || ot.start, ot.k);
    else if (clip.o) evalTrack(clip.o, t, ot.start, ot.k);
    if (clip.body) evalBody(clip.body, t, this.bodyStart, this.bodyK);
    else for (let i = 1; i <= 5; i++) this.bodyK[i] *= 0.9;
    while (clip.kick && this.kicks < clip.kick.length && t >= clip.kick[this.kicks][0]) {
      const k = clip.kick[this.kicks++];
      this.kickV.x += k[1] * 60;
      this.kickV.y += k[2] * 60 * this.side;
      this.kickV.z += k[3] * 60 * this.side;
    }
  }

  // no clip: the hands ease to the stance's rest pose, and the free handle is caught there
  _settle(d, rest) {
    const dr = this.dr, ot = this.ot;
    this.restT += d;
    const k = 1 - Math.exp(-d * (this.restT < 0.1 ? 8 : 14));
    for (let i = 0; i < 6; i++) dr.k[i + 1] += (rest.d[i] - dr.k[i + 1]) * k;
    for (let i = 1; i <= 5; i++) this.bodyK[i] += (0 - this.bodyK[i]) * k;
    if (this.who !== rest.who) {
      // (a moment for the hands to come round first, then the catch closes)
      if (this.who) this.release();
      if (this.restT > 0.06) {
        this.who = rest.who;
        this.pinW = 0;
        this.catchT = 0;
      }
    }
    if (this.who && this.pinW < 1) {
      this.catchT += d;
      const w = clamp(this.catchT / 0.2, 0, 1);
      if (w >= 1) this._caught();
      this.pinW = w;
    }
    const to = this.who === 'o' ? rest.oc : rest.o;
    for (let i = 0; i < 6; i++) ot.k[i + 1] += (to[i] - ot.k[i + 1]) * k;
    // at rest: alive in the hands. A breath in the chain, and now and then a flourish
    if (this.pinW >= 1 && this.stance === 'guard') {
      this.idleT += d;
      const br = Math.sin(this.time * 1.9) * 0.004;
      dr.k[1] += br * 0.5;
      ot.k[1] -= br * 0.5;
      const clips = this.body.clips;
      if (this.idleT > 3.4 && !this.noIdle && clips.fig8) {
        this.flip = !this.flip;
        this.play(this.flip || !clips.rest1 ? 'fig8' : 'rest1');
        this.clip = { ...this.clip, idle: true };
      }
    } else this.idleT = 0;
  }

  // The heavy attack wound up: the free handle whirled round on the chain, faster the longer it is held. Nothing
  // plays it: the hand feels for where the handle is on its way round and leads it, the way a hand does - its fist
  // going round a small circle and its own handle leaning out ahead of the free one, by more while the whirl is slower
  // than it should be and by less once it is up to speed. (Driven blind at a set rate the handle just hangs: above
  // its own swing's rate a pendulum stays in the middle.) sp.n: the whirl's axis; sp.d: the middle of the fist's circle.
  _spin(d) {
    const dr = this.dr, ot = this.ot, sp = this.body.spin;
    this.restT = 0;
    this.spin = Math.min(1, this.spin + d * 6);
    const tier = this.windT >= 0.95 ? 2 : this.windT >= 0.4 ? 1 : 0;
    const want = sp.rate[tier] * PI * 2;
    // the whirl's plane (in the clip's own, right-handed terms: the free handle is mirrored into them)
    const n = _g.set(sp.n[0], sp.n[1], sp.n[2]).normalize();
    const e1 = _h.set(1, 0, 0).addScaledVector(n, -n.x).normalize();
    const e2 = _e.crossVectors(n, e1);
    // where the free handle is round the whirl's middle (over the middle of the fist's circle)
    const ct = Math.cos(sp.tilt), st = Math.sin(sp.tilt), to = sp.d;
    _a.copy(this.freeGrip);
    _a.x *= this.side;
    _a.x -= to[0] + n.x * EYE * ct;
    _a.y -= to[1] + n.y * EYE * ct;
    _a.z -= to[2] + n.z * EYE * ct;
    const x = _a.dot(e1), y = _a.dot(e2), r = Math.hypot(x, y);
    if (r > 0.05 && d > 0) {
      const at = Math.atan2(y, x);
      let dp = at - this.spinAt;
      dp -= Math.round(dp / (PI * 2)) * PI * 2;
      if (this.spinSeen) this.spinRate += (clamp(dp / d, -80, 80) - this.spinRate) * (1 - Math.exp(-d * 14));
      // (each time it comes round the front)
      if (this.spinSeen && Math.abs(dp) < 2 && Math.sign(at + 1.6) !== Math.sign(this.spinAt + 1.6) && Math.abs(at + 1.6) < 1.5) this.event('whirl', Math.abs(this.spinRate));
      this.spinAt = at;
      this.spinSeen = true;
      // (it goes round the way the handle was already going when the wind-up began)
      if (this.spinDir === 0 && this.spin > 0.5) this.spinDir = this.spinRate < -4 ? -1 : 1;
      // lead it: well ahead pulls it round faster; nearly in line with it only keeps it out there
      const dir = this.spinDir || 1, rate = this.spinRate * dir;
      const lead = clamp(0.25 + (2.2 * (want - rate)) / want, 0.1, 1.4);
      let step = (at + lead * dir - this.spinPh) * dir;
      step -= Math.round(step / (PI * 2)) * PI * 2;
      // (the fist never stops going round, and never runs away from the handle it is leading)
      this.spinPh += dir * clamp(step, d * Math.max(5, 0.5 * rate), d * (Math.max(0, rate) + 30));
    } else {
      // hanging in the middle: start it going, at about its own swing's pace
      this.spinSeen = false;
      this.spinPh += d * 6;
    }
    const c = Math.cos(this.spinPh), s = Math.sin(this.spinPh);
    dr.elLock = sp.el;
    dr.loose = true;
    const ox = e1.x * c + e2.x * s, oy = e1.y * c + e2.y * s, oz = e1.z * c + e2.z * s; // out from the middle, toward the lead
    // the middle of the fist's circle comes up from wherever the hand was; round it the fist is where the lead is, now
    // (a hand that lagged its own circle would be leading by less than it means to)
    const C = this.spinC, kc = 1 - Math.exp(-d * 16);
    C[0] += (to[0] - C[0]) * kc;
    C[1] += (to[1] - C[1]) * kc;
    C[2] += (to[2] - C[2]) * kc;
    const w = this.spin;
    dr.k[1] = C[0] + ox * sp.r * w;
    dr.k[2] = C[1] + oy * sp.r * w;
    dr.k[3] = C[2] + oz * sp.r * w;
    const k = 1 - Math.exp(-d * (10 + 50 * w));
    const dx = n.x * ct + ox * st, dy = n.y * ct + oy * st, dz = n.z * ct + oz * st;
    dr.k[4] += (dx - dr.k[4]) * k;
    dr.k[5] += (dy - dr.k[5]) * k;
    dr.k[6] += (dz - dr.k[6]) * k;
    const ko = 1 - Math.exp(-d * 12);
    for (let i = 0; i < 6; i++) ot.k[i + 1] += (sp.o[i] - ot.k[i + 1]) * ko;
    if (sp.body) for (let i = 1; i <= 5; i++) this.bodyK[i] += (sp.body[i - 1] - this.bodyK[i]) * ko;
    if (this.who) this.release();
  }

  _caught() {
    this.event('catch', this.sim.tipSpeed, this.who);
    if (this.who === 'o') {
      this.ot.holds = true;
      this.giveV.x -= 0.5 * this.side;
      this.giveV.y -= 0.3;
    }
  }

  // the hands change over: the other hand's handle is the anchor from here, and the clips play mirrored
  _swap() {
    const dr = this.dr, ot = this.ot;
    this.sim.swap();
    this.anchor = 1 - this.anchor;
    this.side = -this.side;
    // each hand's track value becomes the other's, in the mirrored terms (a track is written with the driver's x to
    // the right and the other hand's to the left: both turn round)
    const a = dr.k.slice(), b = ot.k.slice();
    a[1] = -a[1];
    a[4] = -a[4];
    b[1] = -b[1];
    b[4] = -b[4];
    dr.k = b;
    ot.k = a;
    const e = dr.el;
    dr.el = ot.el;
    ot.el = e;
    this.who = '';
    this.pinW = 0;
    ot.holds = false;
    this.event('pass', 0);
  }

  // a hand's track value to its grip and its handle's direction, on the side it is really on (rig space). Tracks are
  // written for a right-handed driver: the driver's x to the right, the other hand's to the left
  _pose(h, side) {
    const k = h.k, s = this.side;
    h.p.set(k[1] * s, k[2], k[3]);
    h.d.set(k[4] * s, k[5], k[6]).normalize();
    void side;
  }

  // a hand's arm: the elbow swung out as far as brings the forearm square to the handle, the fist's frame, the wrist
  _arm(h, side, d) {
    const B = this.body, S = _g.copy(this.S), P = _h.copy(this.pole);
    if (side < 0) {
      S.x = -S.x;
      P.x = -P.x;
    }
    // (a left arm's elbow swings the other way round)
    const sgn = side;
    const cost = (el) => {
      this._wrist(h, side);
      elbowOf(S, h.wrist, B.L1, B.L2, P, el * sgn, h.elbow, h.pole);
      h.f.subVectors(h.elbow, h.wrist).normalize();
      const c = h.d.dot(h.f);
      return c * c + 0.015 * el * el;
    };
    // from where it was: a few steps downhill, so it never jumps from one way of holding to another
    let el = h.el, step = 0.2, best = cost(el);
    if (h.elLock !== null) {
      // (a move that keeps the elbow where it is: the whirl)
      el = h.elLock;
      h.elLock = null;
      step = 0;
    }
    for (let i = 0; i < 6 && step > 0; i++) {
      const up = el + step <= EL_MAX ? cost(el + step) : Infinity;
      const dn = el - step >= EL_MIN ? cost(el - step) : Infinity;
      if (up < best && up <= dn) {
        best = up;
        el += step;
      } else if (dn < best) {
        best = dn;
        el -= step;
      } else step *= 0.5;
    }
    // (and no faster than an elbow goes)
    if (d > 0) el = h.el + clamp(el - h.el, -d * 14, d * 14);
    h.el = el;
    // settle the wrist and the forearm on each other; and a wrist only cocks so far: past that the handle gives way
    // (it leans back toward square to the forearm, which is what a real grip does at the end of its reach)
    for (let i = 0; i < 3; i++) {
      cost(el);
      const c = -h.d.dot(h.f), lim = h.loose ? LOOSE_SIN : COCK_SIN;
      if (Math.abs(c) > lim) {
        _c.copy(h.d).addScaledVector(h.f, c);
        if (_c.lengthSq() > 1e-8) h.d.copy(_c.normalize().multiplyScalar(Math.sqrt(1 - lim * lim))).addScaledVector(h.f, -lim * Math.sign(c));
      }
    }
    h.loose = false;
    holdQuat(h.d, h.f, h.q);
    this._wrist(h, side);
    h.cock = Math.asin(clamp(-h.d.dot(h.f), -1, 1));
  }
  // the wrist of a hand whose grip, handle and forearm are known: a hand's length up the forearm, and out of the palm
  _wrist(h, side) {
    holdQuat(h.d, h.f, h.q);
    h.wrist.set(HAND_X * side, HAND_Y, 0).applyQuaternion(h.q).add(h.p);
  }

  // the arms as what the free handle can strike: both fists, both forearms
  _armColliders() {
    const dr = this.dr, ot = this.ot, sim = this.sim, qW = this.qW;
    const catching = this.who === 'o' && this.pinW > 0.05;
    const cap = (a, b, r, mask) => {
      _a.copy(a).applyQuaternion(qW);
      _b.copy(b).applyQuaternion(qW);
      sim.addCollider(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z, r, mask);
    };
    cap(dr.p, dr.wrist, 0.046, NK_COL.ROD);
    cap(dr.wrist, dr.elbow, 0.04, NK_COL.ALL);
    cap(ot.p, ot.wrist, 0.046, catching ? 0 : NK_COL.ROD);
    cap(ot.wrist, ot.elbow, 0.04, catching ? 0 : NK_COL.ALL);
  }
  /** For a view's colliders (env.colliders): a capsule in rig space. */
  col(ax, ay, az, bx, by, bz, r, mask = NK_COL.ALL) {
    const qW = this.qW;
    _a.set(ax, ay, az).applyQuaternion(qW);
    _b.set(bx, by, bz).applyQuaternion(qW);
    this.sim.addCollider(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z, r, mask);
  }
  /** The hand on the right, and the one on the left. */
  get right() {
    return this.side > 0 ? this.dr : this.ot;
  }
  get left() {
    return this.side > 0 ? this.ot : this.dr;
  }
}

// the trunk's track: [t, twist, lean, bend, drop, step, ease], each eased from key to key
function evalBody(keys, t, start, out) {
  const n = keys.length;
  let i = 0;
  while (i < n - 1 && t > keys[i][0]) i++;
  const k2 = keys[i], k1 = i > 0 ? keys[i - 1] : start;
  const t1 = i > 0 ? k1[0] : 0;
  const w = ease(k2[0] > t1 ? clamp((t - t1) / (k2[0] - t1), 0, 1) : 1, k2[6]);
  for (let c = 1; c <= 5; c++) out[c] = k1[c] + (k2[c] - k1[c]) * w;
  return out;
}

function spring(x, v, k, c, dt) {
  // (stepped finely enough to be the same curve at any frame rate)
  let n = Math.max(1, Math.ceil(dt * 240));
  const h = dt / n;
  while (n--) {
    v.x += (-k * x.x - c * v.x) * h;
    v.y += (-k * x.y - c * v.y) * h;
    v.z += (-k * x.z - c * v.z) * h;
    x.x += v.x * h;
    x.y += v.y * h;
    x.z += v.z * h;
  }
}

// ---------------------------------------------------------------- the simulated half, drawn
const _z = new THREE.Vector3(0, 0, 1);

/** The other handle, the chain's links and the streak behind them as meshes, placed from a core in its rig space. */
export class ChainMeshes {
  constructor(geo, material, trail = true) {
    this.handle = new THREE.Mesh(geo.handle, material);
    this.handle.frustumCulled = false;
    this.handle.name = 'nunchakuHandle';
    this.links = [];
    for (let i = 0; i < NK_GEOM.links; i++) {
      const m = new THREE.Mesh(geo.link, material);
      m.frustumCulled = false;
      m.name = 'nunchakuLink';
      this.links.push(m);
    }
    this.trail = null;
    if (trail) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 6), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 8), 4));
      const idx = [];
      for (let i = 0; i < TRAIL_N - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
      g.setIndex(idx);
      this.trail = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      this.trail.frustumCulled = false;
      this.trail.renderOrder = 3;
      this.trail.name = 'nunchakuTrail';
      this.trail.visible = false;
    }
  }
  /** handle0: the mesh of handle 0 (the one the weapon's own model is). gain: how strong the streak is. */
  place(core, handle0, gain = 1) {
    handle0.position.copy(core.stickP[0]);
    handle0.quaternion.copy(core.stickQ[0]);
    this.handle.position.copy(core.stickP[1]);
    this.handle.quaternion.copy(core.stickQ[1]);
    // each link lies a quarter turn round from the last; the first lies through the eye it hangs in (the eye's hole
    // is across its handle's x). Carried along the chain link by link, so no link rolls about by itself
    const J = core.joints;
    _e.set(1, 0, 0).applyQuaternion(core.stickQ[core.anchor]);
    for (let i = 0; i < this.links.length; i++) {
      const m = this.links[i], o = i * 3;
      _a.set(J[o], J[o + 1], J[o + 2]);
      _b.set(J[o + 3], J[o + 4], J[o + 5]);
      m.position.addVectors(_a, _b).multiplyScalar(0.5);
      _c.subVectors(_b, _a).normalize(); // z: along the link
      _d.copy(_e).addScaledVector(_c, -_e.dot(_c)); // y: the link's flat
      if (_d.lengthSq() < 1e-6) _d.set(0, 1, 0).addScaledVector(_c, -_c.y);
      _d.normalize();
      _e.crossVectors(_d, _c); // x; and the next link's flat
      m.quaternion.setFromRotationMatrix(_m.makeBasis(_e, _d, _c));
    }
    if (this.trail) this._trail(core, gain);
  }
  // a faint streak behind the free handle while it is moving fast: what a real one is to the eye, a blur
  _trail(core, gain) {
    const n = core.trailN, T = core.trail, g = this.trail.geometry;
    const pos = g.attributes.position.array, col = g.attributes.color.array;
    const v = clamp((core.tipSpeed - 9) / 20, 0, 1) * gain;
    this.trail.visible = v > 0.02 && n > 4;
    if (!this.trail.visible) return;
    const first = (TRAIL_N - n) * 6;
    for (let i = 0; i < TRAIL_N; i++) {
      const o = i * 6, live = i >= TRAIL_N - n, s = live ? o : first;
      // from the handle's middle to its butt: the fast end
      for (let k = 0; k < 3; k++) {
        pos[o + k] = T[s + k] * 0.45 + T[s + 3 + k] * 0.55;
        pos[o + 3 + k] = T[s + 3 + k];
      }
      const age = i / (TRAIL_N - 1);
      const a = live ? v * 0.17 * age * age : 0;
      for (let k = 0; k < 2; k++) {
        const c = i * 8 + k * 4;
        col[c] = 0.92;
        col[c + 1] = 0.8;
        col[c + 2] = 0.6;
        col[c + 3] = k ? a : a * 0.35;
      }
    }
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- first person
export const FP_SHOULDER_R = new THREE.Vector3(0.2, -0.29, 0.1); // (the arms are a matched pair here: either may drive)
export const FP_SHOULDER_L = new THREE.Vector3(-0.2, -0.29, 0.1);

export class NunchakuFP {
  constructor(geo, material) {
    this.core = new NunchakuCore(FP);
    this.meshes = new ChainMeshes(geo, material, true);
    this.reach = 0.62; // how far ahead of the eye it reaches at rest (the tuck off a wall)
  }
  /** What the free handle can strike besides the arms: the head the eye is in, the trunk below it, the upper arms. */
  colliders(core) {
    core.col(0, -0.02, 0.07, 0, -0.02, 0.07, 0.19);
    core.col(0, -0.3, 0.14, 0, -0.8, 0.14, 0.19);
    for (const s of [1, -1]) {
      const h = s > 0 ? core.right : core.left;
      core.col(0.2 * s, -0.29, 0.1, h.elbow.x, h.elbow.y, h.elbow.z, 0.05, NK_COL.ROD);
    }
  }
}
export const NK_AUTHOR = { K, P6, KS, PS };

// ---------------------------------------------------------------- third person
// The same moves on a survivor's body, seen from outside. The hands' tracks are the first person's own, carried from
// the eye's space to the chest's: the first-person shoulders (FP.shoulder) put on this body's, the reach scaled to
// its arms, and all of it a hand lower (a first-person view holds its hands up into the frame; a body seen from
// outside holds them at the chest). So what a survivor does with their hands is what they see themselves do. What
// the first person has no use for is added here: the trunk winding up and following through, the knees, the feet.
const TP_DROP = 0.12;
// [t, twist (the trunk turned to its left, rad), lean (forward), bend (to its right), drop (m, the knees), step (the
// right foot forward, the left back; negative the other way), ease]
const TP_BODY = {
  draw: [[0.12, -0.15, 0.06, 0, 0.02, 0, 2], [0.24, 0.1, 0, 0, 0, 0, 2], [0.42, 0, 0, 0, 0, 0, 0]],
  whip: [[0.06, -0.5, -0.06, -0.08, 0.02, -0.25, 2], [0.14, 0.5, 0.22, 0.1, 0.08, 0.5, 5], [0.36, 0.3, 0.12, 0.06, 0.05, 0.4, 0]],
  backhand: [[0.05, 0.6, 0.1, 0.1, 0.05, 0.4, 2], [0.14, -0.45, 0.1, -0.1, 0.06, 0.5, 5], [0.34, -0.3, 0.05, -0.05, 0.04, 0.45, 0]],
  eight: [[0.05, -0.4, 0, -0.06, 0.03, 0.3, 2], [0.14, 0.45, 0.16, 0.08, 0.07, 0.4, 5], [0.21, 0.5, 0.05, 0.1, 0.04, 0.3, 1], [0.28, -0.4, 0.16, -0.08, 0.07, 0.4, 5], [0.48, -0.25, 0.05, -0.04, 0.04, 0.3, 0]],
  smash: [[0.12, -0.15, -0.22, 0, -0.02, 0.1, 2], [0.21, 0.1, 0.5, 0, 0.16, 0.6, 5], [0.5, 0.05, 0.3, 0, 0.12, 0.5, 0], [0.66, 0, 0.1, 0, 0.04, 0.2, 0]],
  lunge: [[0.07, -0.5, 0.1, -0.05, 0.06, 0.3, 2], [0.15, 0.55, 0.4, 0.1, 0.18, 1, 5], [0.46, 0.3, 0.2, 0.05, 0.1, 0.7, 0]],
  sweep: [[0.06, -0.6, 0.2, -0.1, 0.1, 0.2, 2], [0.13, 0.5, 0.35, 0.12, 0.16, 0.5, 5], [0.42, 0.3, 0.25, 0.06, 0.12, 0.4, 0]],
  retreat: [[0.05, 0.5, -0.05, 0.08, 0.02, -0.3, 2], [0.14, -0.4, -0.1, -0.08, 0.03, -0.6, 5], [0.38, -0.25, -0.05, -0.04, 0.02, -0.45, 0]],
  heavy: [[0.07, -0.6, -0.1, -0.1, 0.02, -0.2, 2], [0.14, 0.65, 0.35, 0.14, 0.14, 0.8, 5], [0.3, 0.5, 0.25, 0.1, 0.12, 0.7, 2], [0.74, 0.2, 0.1, 0.04, 0.05, 0.4, 0]],
};
/** The body's own clips, rest poses and whirl: FP's, carried to a chest with these proportions (P: characters.js humanP). */
export function tpBody(P) {
  const k = (P.uarmLen + P.farmLen) / (FP.L1 + FP.L2);
  const cy = P.shoulderY - P.chestY;
  const map = (v, o = 0) => {
    const r = v.slice();
    r[o] = v[o] * k;
    r[o + 1] = (v[o + 1] - FP.shoulder[1]) * k + cy - TP_DROP;
    r[o + 2] = (v[o + 2] - FP.shoulder[2]) * k;
    return r;
  };
  const keys = (ks) => ks && ks.map((key) => map(key, 1));
  const rest = (r) => ({ d: map(r.d), o: map(r.o), oc: r.oc && map(r.oc), who: r.who });
  const clips = {};
  for (const name in FP.clips) {
    const c = FP.clips[name];
    clips[name] = { ...c, d: keys(c.d), o: keys(c.o), oc: keys(c.oc), from: c.from && rest(c.from), body: TP_BODY[name] || c.body || null, kick: null };
  }
  const R = {};
  for (const name in FP.rest) R[name] = rest(FP.rest[name]);
  // under the arm: the handle clamped between the upper arm and the ribs, its butt out behind
  const arm = [P.shoulderW + 0.035, cy - 0.2, -0.05, ...N3(0.05, -0.2, 0.98)];
  // carried at a run: the fist at the hip, its handle forward
  R.carry = { d: P6(P.shoulderW + 0.05, cy - 0.3, -0.26, 0.05, 0.2, -0.97), o: P6(-P.shoulderW - 0.06, cy - 0.45, -0.1, 0.1, 0.3, -0.95), who: 'arm' };
  return {
    L1: P.uarmLen, L2: P.farmLen,
    shoulder: [P.shoulderW, cy, 0],
    pole: [0.7, -1, 0.35],
    rest: R, arm,
    spin: { ...FP.spin, d: map(FP.spin.d), o: map(FP.spin.o), body: [-0.25, -0.05, -0.05, 0.03, -0.2] },
    clips,
    cy,
  };
}

const _qc = new THREE.Quaternion(), _pc = new THREE.Vector3(), _sc = new THREE.Vector3();
export class NunchakuTP {
  /** geo: { handle, link } (weapons.js getNunchakuGeo(false)); P: the body's proportions. */
  constructor(geo, material, P) {
    this.body = tpBody(P);
    this.core = new NunchakuCore(this.body);
    this.core.noIdle = false;
    this.meshes = new ChainMeshes(geo, material, true);
    this.handle0 = new THREE.Mesh(geo.handle, material);
    this.handle0.name = 'nunchakuHandle';
    this.group = new THREE.Group(); // goes on the chest bone: its space is the rig's
    this.group.name = 'nunchaku';
    this.group.add(this.handle0, this.meshes.handle, ...this.meshes.links, this.meshes.trail);
    for (const m of this.group.children) m.frustumCulled = false;
    this.P = P;
    this.time = 0;
    this.windT = 0; // how long they have been winding up (seen as PFLAG.RELOADING)
    this.woundAt = -9; // when the wind-up last ended, and how long it had been
    this.wound = 0;
    this.last = -1; // the last move, and when it began
    this.lastAt = -9;
  }
  /** The meshes of the item (for the clip check). */
  parts() {
    return [this.handle0, this.meshes.handle, ...this.meshes.links];
  }
  /** A move begins. move: which (NK_MOVE), when it is known - ours; else worked out the way the rules would (others'). */
  swing(move, s = {}) {
    const now = this.time;
    if (move === undefined || move < 0) {
      if (this.windT > 0 || now - this.woundAt < 0.25) {
        const t = this.windT > 0 ? this.windT : this.wound;
        move = t >= NK.tiers[1] ? NK_MOVE.HEAVY3 : t >= NK.tiers[0] ? NK_MOVE.HEAVY2 : NK_MOVE.HEAVY1;
      } else if (this.last >= 0 && now - this.lastAt < NK_MOVES[this.last].rate + NK.window + 0.12) move = NK_MOVES[this.last].next;
      else move = s.sprint ? NK_MOVE.LUNGE : s.crouch ? NK_MOVE.SWEEP : NK_MOVE.WHIP;
    }
    this.last = move;
    this.lastAt = now;
    this.windT = 0;
    this.core.swing(move);
    return move;
  }
  /**
   * A frame. s: the survivor's state (speed, sprint, crouch, reloading: winding up); chest: the chest bone (its world
   * matrix current). After it: core.right / core.left are the hands, in chest space.
   */
  update(dt, s, chest) {
    this.time += dt;
    const core = this.core;
    if (s.wind !== undefined) this.windT = s.wind;
    else if (s.reloading) this.windT += dt;
    else if (this.windT > 0) {
      this.woundAt = this.time;
      this.wound = this.windT;
      this.windT = 0;
    }
    core.wind(this.windT);
    chest.matrixWorld.decompose(_pc, _qc, _sc);
    const B = this.body, P = this.P;
    core.update(dt, {
      qW: _qc,
      stance: s.sprint && (s.speed || 0) > 4 ? 'carry' : s.crouch ? 'low' : 'guard',
      colliders: (c) => {
        const cy = B.cy;
        c.col(0, cy + 0.2, -0.02, 0, cy + 0.24, -0.02, 0.125); // the head
        c.col(0, cy - 0.04, 0.01, 0, -0.22, 0.01, 0.155); // the trunk
        c.col(0, -0.3, 0.01, 0, -0.42, 0.01, 0.16); // the hips
        for (const sd of [1, -1]) {
          const h = sd > 0 ? c.right : c.left;
          c.col(P.shoulderW * sd, cy, 0, h.elbow.x, h.elbow.y, h.elbow.z, 0.05, NK_COL.ROD);
          c.col(0.1 * sd, -0.45, 0, 0.1 * sd, -1.15, 0.02, 0.085, NK_COL.ROD); // a leg
        }
      },
    });
    this.meshes.place(core, this.handle0, 1.3);
  }
}
