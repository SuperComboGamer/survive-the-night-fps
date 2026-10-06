// Nunchucks (ITEM.NUNCHAKU): the rules both ends run, and the simulation of the chain and the free handle that both
// views draw. No DOM, no three.js: the server reads the first half, the client and scripts/test-nunchucks.js both.
//
// THE RULES. Every other melee weapon lands its blow on the command that swings it. Nunchucks are a moveset: a move
// is started by a command (`nk_swing`), its blows land a set time into it (`melee`, with the move and which of its
// hits), and a press inside the window after a move continues the combo with the move that follows it. All of it is
// simulatePlayer's, so the client predicts it and the server is the authority, command for command.
//
// It adds no field to the simulated state, and so nothing to the wire. With nunchucks in hand three fields that a
// melee weapon never used carry it (playersim.js):
//   s.recoil    the move under way or last made, + 1 (0: no combo). A gun's count of shots in a row, a combo's count
//               of moves in a row.
//   s.cooldown  runs down from the move's `rate` to 0 as for any weapon, and then on down to -NK.window: the time
//               since the move ended. Past the window the combo is over (recoil back to 0, cooldown to 0).
//   s.reloadT   the heavy attack's wind-up clock: it counts UP while the secondary button is held, and is 0 again the
//               moment the strike is let go. (So PFLAG.RELOADING, which the snapshot sets from reloadT > 0, says
//               "winding up" of a survivor holding nunchucks: that is how others see the spin.)
import { BTN, STAMINA_REGEN_DELAY } from './constants.js';

// The moves. damage: of each hit; hits: when they land (s after the move starts); rate: until the next move can
// start; stamina: what starting it costs; knock: the shove (3 and up staggers); targets: how many it can strike;
// reach: added to the weapon's range; next: the move a press inside the window goes on to. (The hit times are when
// the simulated free handle comes round to the front in each move's animation - models/nunchaku.js - so that what
// lands is what is seen to land; they were read off the animation, the animation does not read them.)
export const NK_MOVE = { WHIP: 0, BACKHAND: 1, EIGHT: 2, SMASH: 3, LUNGE: 4, SWEEP: 5, RETREAT: 6, HEAVY1: 7, HEAVY2: 8, HEAVY3: 9 };
export const NK_MOVES = [
  // the light chain: forward whip, backhand, a figure-eight that lands twice, an overhead smash
  { name: 'whip', damage: 28, hits: [0.14], rate: 0.32, stamina: 5, knock: 0.6, targets: 1, reach: 0, next: 1 },
  { name: 'backhand', damage: 30, hits: [0.14], rate: 0.3, stamina: 5, knock: 0.6, targets: 1, reach: 0, next: 2 },
  { name: 'eight', damage: 24, hits: [0.14, 0.27], rate: 0.44, stamina: 7, knock: 0.4, targets: 1, reach: 0, next: 3 },
  { name: 'smash', damage: 92, hits: [0.21], rate: 0.62, stamina: 10, knock: 4, targets: 1, reach: 0, next: 0 },
  // openers, by how the survivor is moving: at a sprint, crouched, backing away. Each goes on to the backhand
  { name: 'lunge', damage: 44, hits: [0.15], rate: 0.42, stamina: 8, knock: 2.5, targets: 1, reach: 0.5, next: 1 },
  { name: 'sweep', damage: 30, hits: [0.13], rate: 0.38, stamina: 6, knock: 1.5, targets: 2, reach: 0, next: 1 },
  { name: 'retreat', damage: 26, hits: [0.14], rate: 0.34, stamina: 5, knock: 3.5, targets: 1, reach: 0, next: 1 },
  // the heavy attack let go after a short, a middling and a full wind-up (NK.tiers)
  { name: 'heavy', damage: 70, hits: [0.14], rate: 0.7, stamina: 6, knock: 3, targets: 1, reach: 0.1, next: 0, heavy: 1 },
  { name: 'heavy2', damage: 115, hits: [0.14], rate: 0.75, stamina: 6, knock: 5, targets: 2, reach: 0.2, next: 0, heavy: 2 },
  { name: 'heavy3', damage: 165, hits: [0.14], rate: 0.8, stamina: 6, knock: 7, targets: 2, reach: 0.3, next: 0, heavy: 3 },
];
export const NK = {
  window: 0.45, // s after a move's `rate` has run out in which the next press continues the combo
  tiers: [0.4, 0.95], // wind-up (s) at which the heavy attack becomes heavy2, heavy3
  windMax: 2.5, // the clock stops here (the spin can be held on, at its cost)
  windDrain: 11, // stamina a second while winding up
  tired: 0.7, // damage x this from a survivor who is exhausted, and no combo: only the opener
};

/** The move a wind-up of `t` seconds lets go. */
export const heavyMove = (t) => (t >= NK.tiers[1] ? NK_MOVE.HEAVY3 : t >= NK.tiers[0] ? NK_MOVE.HEAVY2 : NK_MOVE.HEAVY1);
/** The move under way or last made (null: none), from the simulated state. */
export const nkMove = (s) => (s.recoil > 0 ? NK_MOVES[Math.round(s.recoil) - 1] || null : null);
/** How far into the heavy wind-up they are: 0 (not winding), or the tier 1..3 it would let go now. */
export const nkWind = (s) => (s.reloadT > 0 ? NK_MOVES[heavyMove(s.reloadT)].heavy : 0);
/** The opener for how they are moving (b: the command's buttons). */
export function nkOpener(s, b) {
  if (s.sprinting) return NK_MOVE.LUNGE;
  if (s.crouch) return NK_MOVE.SWEEP;
  if (b & BTN.BACK && !(b & BTN.FWD)) return NK_MOVE.RETREAT;
  return NK_MOVE.WHIP;
}

/**
 * One command of the weapon's state machine (simulatePlayer's melee branch, with nunchucks in hand).
 * b: the buttons; cd0: s.cooldown before this command ran it down; events: where { type: 'nk_swing' | 'nk_wind' |
 * 'melee' | 'exhausted' } go (may be null).
 */
export function simNunchaku(s, b, cd0, weapon, events, dt) {
  const attack = b & BTN.ATTACK;
  const alt = b & BTN.ALT;
  // the blows of the move under way: each lands on the command in which the move's clock passes its time
  const mv = nkMove(s);
  if (mv && cd0 > 0) {
    const was = mv.rate - cd0, now = was + dt;
    for (let i = 0; i < mv.hits.length; i++) {
      if (was < mv.hits[i] && mv.hits[i] <= now && events) events.push({ type: 'melee', weapon, heavy: !!mv.heavy, move: Math.round(s.recoil) - 1, hit: i });
    }
  }
  // the window after it: the cooldown runs on below zero, and the combo is over when it has run out
  if (cd0 <= 0 && s.recoil > 0) {
    s.cooldown = cd0 - dt;
    if (s.cooldown < -NK.window) {
      s.cooldown = 0;
      s.recoil = 0;
    }
  }
  const ready = s.cooldown <= 0 && s.switchT <= 0;
  const start = (m) => {
    const d = NK_MOVES[m];
    s.recoil = m + 1;
    s.cooldown = d.rate;
    s.fireCount = (s.fireCount + 1) & 255;
    spend(s, d.stamina, events);
    if (events) events.push({ type: 'nk_swing', weapon, move: m });
  };
  if (s.reloadT > 0) {
    // winding up: held, it spins on (the clock stops at windMax) and costs stamina; let go, or with the primary
    // button pressed, or out of breath, it is struck
    if (alt && !attack && !s.exhausted) {
      s.reloadT = Math.min(NK.windMax, s.reloadT + dt);
      spend(s, NK.windDrain * dt, events);
    }
    if (!alt || attack || s.exhausted) {
      const m = heavyMove(s.reloadT);
      s.reloadT = 0;
      start(m);
    }
  } else if (ready && alt && !attack) {
    s.reloadT = dt;
    s.recoil = 0;
    s.cooldown = 0;
    if (events) events.push({ type: 'nk_wind', weapon });
  } else if (ready && attack) {
    start(mv && !s.exhausted ? mv.next : nkOpener(s, b));
  }
}

function spend(s, n, events) {
  if (s.exhausted) return;
  s.stamina -= n;
  s.staminaDelay = STAMINA_REGEN_DELAY;
  if (s.stamina <= 0) {
    s.stamina = 0;
    s.exhausted = 1;
    if (events) events.push({ type: 'exhausted' });
  }
}

// =================================================================================================================
// THE CHAIN. One handle is in a hand (the anchor: its end of the chain goes where the hand takes it). The other is a
// rigid rod on the end of the chain, with gravity, momentum, drag and whatever it strikes. This drives both views:
// the first-person hands and the survivor others see hold the anchor, and draw the rest from here. It never decides
// whether a blow lands (the rules above do, from the aim).
//
// The rod is two point masses at its radius of gyration either side of its middle (so it turns as a uniform stick
// does, not as a dumbbell), held a fixed distance apart; the chain's far eye is a point on their line beyond the
// nearer one. The chain is a rope constraint: that eye is never further than the chain's length from the anchor's
// eye. A chain of rigid links this short is straight when it is taut and hangs slack otherwise, and its links weigh
// nothing next to the handle, so its joints are drawn by a second, cosmetic pass between the two eyes (verlet for
// the sag and the lag, then FABRIK so that every link keeps its length exactly). A heavy mass on the end of a chain of
// light particles is the case position-based dynamics stretch on; this never stretches.
//
// Fixed steps of 1 / NK_SIM.hz however long the frame, the hand and everything it can strike moved across the frame's
// steps, so the motion is the same at any frame rate. Units: metres, seconds; any frame the caller likes (it sets
// gravity in it).
export const NK_GEOM = {
  handle: 0.3, // the wood, end to end
  eye: 0.014, // from the wood's chain end to the middle of its swivel's eye
  links: 6,
  link: 0.019, // one link's pitch: the chain is links * link from eye to eye
  rTop: 0.0122, // the wood's radius at the chain end...
  rButt: 0.0158, // ...and at the butt
  grip: 0.2, // from the wood's chain end to the middle of the hand that holds it
};
export const NK_CHAIN = NK_GEOM.links * NK_GEOM.link;
export const NK_SIM = { hz: 960, maxSteps: 160, iters: 6, drag: 0.5, maxSpeed: 45, mu: 0.4, bounce: 0.25, easeOut: 0.4 };

const GYR = NK_GEOM.handle / (2 * Math.sqrt(3)); // a uniform rod's radius of gyration about its middle
const X1 = NK_GEOM.eye + NK_GEOM.handle / 2 - GYR; // the two masses, measured from the eye down the rod
const X2 = NK_GEOM.eye + NK_GEOM.handle / 2 + GYR;
const ROD = X2 - X1;
const TOP_A = 1 + X1 / ROD, TOP_B = -X1 / ROD; // the eye = TOP_A * g1 + TOP_B * g2
const X_WOOD0 = NK_GEOM.eye, X_WOOD1 = NK_GEOM.eye + NK_GEOM.handle; // the wood's two ends, from the eye
const ROD_R = 0.0145; // the rod's radius for what it strikes
const NJ = NK_GEOM.links + 1; // chain joints, eye to eye

// collider layout (Float64Array, STRIDE numbers each): a capsule from a to b with radius r; mask bit 1: the rod
// strikes it, bit 2: the chain does
const STRIDE = 8;
export const NK_COL = { ROD: 1, CHAIN: 2, ALL: 3 };

const _c = { s: 0, t: 0, d2: 0 };
/** Closest points of segments p1-q1 and p2-q2 (as arrays + offsets): _c.s, _c.t in 0..1 along each, _c.d2. */
function segSeg(p1x, p1y, p1z, q1x, q1y, q1z, p2x, p2y, p2z, q2x, q2y, q2z) {
  const d1x = q1x - p1x, d1y = q1y - p1y, d1z = q1z - p1z;
  const d2x = q2x - p2x, d2y = q2y - p2y, d2z = q2z - p2z;
  const rx = p1x - p2x, ry = p1y - p2y, rz = p1z - p2z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z, e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  let s, t;
  if (a <= 1e-12 && e <= 1e-12) s = t = 0;
  else if (a <= 1e-12) {
    s = 0;
    t = Math.min(1, Math.max(0, f / e));
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= 1e-12) {
      t = 0;
      s = Math.min(1, Math.max(0, -c / a));
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const den = a * e - b * b;
      s = den > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }
  const cx = p1x + d1x * s - (p2x + d2x * t), cy = p1y + d1y * s - (p2y + d2y * t), cz = p1z + d1z * s - (p2z + d2z * t);
  _c.s = s;
  _c.t = t;
  _c.d2 = cx * cx + cy * cy + cz * cz;
  return _c;
}

export class ChainSim {
  constructor(maxColliders = 16) {
    // the anchor: the eye of the handle in the hand, and which way that handle points (butt -> chain end)
    this.a = new Float64Array(6); // x y z dx dy dz, at the end of this frame
    this.a0 = new Float64Array(6); // ...at the end of the last
    this.as = new Float64Array(6); // ...at the step being run
    // the rod's two masses and where they were a step ago
    this.g = new Float64Array(6);
    this.h = new Float64Array(6);
    // the chain's joints for drawing (0: the anchor's eye .. NJ - 1: the rod's eye), and a step ago
    this.j = new Float64Array(NJ * 3);
    this.jh = new Float64Array(NJ * 3);
    this.chord = new Float64Array([0, -1, 0]); // the line from eye to eye, as it last was
    this.sag = new Float64Array([0, -1, 0]); // which way a slack chain bows (following gravity and its own lag)
    this.bow = new Float64Array(3); // ...square to its line, as drawn
    this.mid = new Float64Array(3);
    this.midOn = false;
    this.grav = new Float64Array([0, -9.81, 0]);
    this.acc = new Float64Array(3); // an acceleration of the frame everything is in (the carrier speeding up: it lags)
    this.col = new Float64Array(maxColliders * STRIDE);
    this.col0 = new Float64Array(maxColliders * STRIDE);
    this.cols = new Float64Array(maxColliders * STRIDE);
    this.nCol = 0;
    this.nCol0 = 0;
    this.maxCol = maxColliders;
    // the catch: pin.w 0 free .. 1 held. Its target: where the rod's eye and its direction (butt -> eye) are held
    this.aw = new Float64Array(6);
    this.grace = 0; // s left in which what it lies inside only eases it out
    this.pin = { w: 0, p: new Float64Array(6), p0: new Float64Array(6), ps: new Float64Array(6), pv: new Float64Array(6), had: false };
    this.left = 0; // time not yet stepped
    this.time = 0;
    this.steps = 0;
    // what the views and the sounds read after a step
    this.top = new Float64Array(3); // the rod's eye
    this.u = new Float64Array([0, 1, 0]); // the rod's direction, butt -> eye
    this.side = new Float64Array([1, 0, 0]); // carried round with it: its roll
    this.butt = new Float64Array(3);
    this.tipSpeed = 0; // m/s of the rod's butt (the whoosh)
    this.taut = 0; // 0..1, how hard the chain was pulled up short this frame (the rattle, the snap)
    this.knock = 0; // m/s the rod lost against something this frame (the clack of wood on wood, the slap)
    this.knockAt = -1; // ...the collider it was
    this.touched = false;
    // where the rod's wood was after each step of the last frame (its chain end, its butt: 6 numbers a step), for a
    // streak drawn behind it
    this.trail = new Float32Array(NK_SIM.maxSteps * 6);
    this._tb = new Float64Array(3);
    this.reset();
  }

  /** Hanging at rest from the anchor. */
  reset() {
    const a = this.a, g = this.g, G = this.grav;
    const gl = Math.hypot(G[0], G[1], G[2]) || 1;
    const dx = G[0] / gl, dy = G[1] / gl, dz = G[2] / gl;
    for (let k = 0; k < 3; k++) {
      const d = k === 0 ? dx : k === 1 ? dy : dz;
      g[k] = a[k] + d * (NK_CHAIN + X1);
      g[3 + k] = a[k] + d * (NK_CHAIN + X2);
    }
    this.h.set(g);
    for (let i = 0; i < NJ; i++) {
      const f = (i / (NJ - 1)) * NK_CHAIN;
      this.j[i * 3] = a[0] + dx * f;
      this.j[i * 3 + 1] = a[1] + dy * f;
      this.j[i * 3 + 2] = a[2] + dz * f;
    }
    this.jh.set(this.j);
    this.aw.set(a);
    this.midOn = false;
    this.bow.fill(0);
    this.sag[0] = dx;
    this.sag[1] = dy;
    this.sag[2] = dz;
    this.a0.set(a);
    this.left = 0;
    this.pin.w = 0;
    this.pin.had = false;
    this._out(1 / NK_SIM.hz);
  }

  /** Where the hand has the anchor at the end of this frame: its eye, and its handle's direction (butt -> eye). */
  setAnchor(x, y, z, dx, dy, dz) {
    const a = this.a;
    a[0] = x;
    a[1] = y;
    a[2] = z;
    const l = Math.hypot(dx, dy, dz) || 1;
    a[3] = dx / l;
    a[4] = dy / l;
    a[5] = dz / l;
  }

  /** The frame's colliders: call clearColliders, then addCollider for each (the same ones in the same order every frame). */
  clearColliders() {
    this.nCol = 0;
  }
  addCollider(ax, ay, az, bx, by, bz, r, mask = NK_COL.ALL) {
    if (this.nCol >= this.maxCol) return;
    const o = this.nCol++ * STRIDE, c = this.col;
    c[o] = ax;
    c[o + 1] = ay;
    c[o + 2] = az;
    c[o + 3] = bx;
    c[o + 4] = by;
    c[o + 5] = bz;
    c[o + 6] = r;
    c[o + 7] = mask;
  }

  /** The catch: w 0 lets the rod go, 0..1 draws it to the target, 1 holds it there (its eye at x,y,z, pointing d). */
  setPin(w, x = 0, y = 0, z = 0, dx = 0, dy = 1, dz = 0) {
    const p = this.pin.p;
    if (w <= 0 && this.pin.w > 0.04) this.grace = 0.3; // (let go: see _collide)
    this.pin.w = w;
    if (w <= 0) return;
    const l = Math.hypot(dx, dy, dz) || 1;
    p[0] = x;
    p[1] = y;
    p[2] = z;
    p[3] = dx / l;
    p[4] = dy / l;
    p[5] = dz / l;
  }

  /**
   * The hands change over: the rod (held, pinned at 1) becomes the anchor and the handle that was the anchor is let
   * go as the rod, moving as the hand that had it was moving.
   */
  swap() {
    const a = this.a, a0 = this.a0, g = this.g, h = this.h, p = this.pin;
    // the old anchor's handle, now and a step before now (aw: where the hand had it a step before the last frame
    // ended - a0 is where it had it AT the end, by now)
    const aw = this.aw;
    for (let k = 0; k < 3; k++) {
      const now1 = a[k] - a[3 + k] * X1, now2 = a[k] - a[3 + k] * X2;
      g[k] = now1;
      g[3 + k] = now2;
      h[k] = aw[k] - aw[3 + k] * X1;
      h[3 + k] = aw[k] - aw[3 + k] * X2;
    }
    this.grace = 0.3;
    this.nCol0 = -1; // (whoever gives the colliders gives them the other way round from here: none of them "moved" there)
    // the rod that was: the anchor from here on
    a.set(p.p);
    a0.set(p.had ? p.p0 : p.p);
    p.w = 0;
    p.had = false;
    // the chain's joints run the other way
    for (let i = 0, k = NJ - 1; i < k; i++, k--) {
      for (let c = 0; c < 3; c++) {
        let t = this.j[i * 3 + c];
        this.j[i * 3 + c] = this.j[k * 3 + c];
        this.j[k * 3 + c] = t;
        t = this.jh[i * 3 + c];
        this.jh[i * 3 + c] = this.jh[k * 3 + c];
        this.jh[k * 3 + c] = t;
      }
    }
    this._out(1 / NK_SIM.hz);
  }

  /**
   * The rod has struck something: it comes off it. n: the surface's normal (toward the rod); e: how much of its
   * speed into the surface it keeps going out (0 dead .. 1); spin: m/s of twist put on it across the normal.
   */
  bounce(nx, ny, nz, e = 0.45, spin = 0) {
    const g = this.g, h = this.h;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const hz = NK_SIM.hz;
    for (let i = 0; i < 2; i++) {
      const o = i * 3;
      let vx = (g[o] - h[o]) * hz, vy = (g[o + 1] - h[o + 1]) * hz, vz = (g[o + 2] - h[o + 2]) * hz;
      const vn = vx * nx + vy * ny + vz * nz;
      if (vn < 0) {
        vx -= (1 + e) * vn * nx;
        vy -= (1 + e) * vn * ny;
        vz -= (1 + e) * vn * nz;
      }
      // what it struck took most of the rest of its speed too
      vx *= 0.55;
      vy *= 0.55;
      vz *= 0.55;
      const sp = i ? spin : -spin * 0.4;
      vx += nx * sp;
      vy += ny * sp;
      vz += nz * sp;
      h[o] = g[o] - vx / hz;
      h[o + 1] = g[o + 1] - vy / hz;
      h[o + 2] = g[o + 2] - vz / hz;
    }
  }

  /** Run the frame: dt seconds, in fixed steps. Returns how many steps it took. */
  step(dt) {
    if (!(dt > 0)) return 0;
    const hz = NK_SIM.hz;
    this.left += Math.min(dt, NK_SIM.maxSteps / hz);
    let n = Math.floor(this.left * hz + 1e-6);
    if (n > NK_SIM.maxSteps) n = NK_SIM.maxSteps;
    this.taut = 0;
    this.knock = 0;
    this.knockAt = -1;
    if (n <= 0) {
      // a frame shorter than a step: nothing moves but the anchor, and the chain is drawn from where it is now
      this._still = true;
      this._out(1 / hz, true);
      this._still = false;
      return 0;
    }
    this.left -= n / hz;
    this._lastN = n;
    if (this.grace > 0) this.grace -= n / hz;
    const a = this.a, a0 = this.a0, as = this.as, pin = this.pin;
    const same = this.nCol === this.nCol0;
    if (!pin.had && pin.w > 0) pin.p0.set(pin.p);
    if (pin.w > 0) for (let k = 0; k < 6; k++) pin.pv[k] = (pin.p[k] - pin.p0[k]) / n; // (the hand's move in one step)
    for (let i = 1; i <= n; i++) {
      const f = i / n;
      for (let k = 0; k < 3; k++) as[k] = a0[k] + (a[k] - a0[k]) * f;
      let dx = a0[3] + (a[3] - a0[3]) * f, dy = a0[4] + (a[4] - a0[4]) * f, dz = a0[5] + (a[5] - a0[5]) * f;
      const dl = Math.hypot(dx, dy, dz);
      if (dl > 1e-6) {
        dx /= dl;
        dy /= dl;
        dz /= dl;
      } else {
        dx = a[3];
        dy = a[4];
        dz = a[5];
      }
      as[3] = dx;
      as[4] = dy;
      as[5] = dz;
      const m = this.nCol * STRIDE;
      if (same) for (let k = 0; k < m; k++) this.cols[k] = this.col0[k] + (this.col[k] - this.col0[k]) * f;
      else this.cols.set(this.col.subarray(0, m));
      if (pin.w > 0) for (let k = 0; k < 6; k++) pin.ps[k] = pin.p0[k] + (pin.p[k] - pin.p0[k]) * f;
      this._sub(1 / hz, same ? 1 / n : 0);
      this._rec((i - 1) * 6);
    }
    // (where the anchor was one step before the end of this frame: the speed its handle is let go with at a pass)
    for (let k = 0; k < 6; k++) this.aw[k] = a[k] - (a[k] - a0[k]) / n;
    a0.set(a);
    this.col0.set(this.col.subarray(0, this.nCol * STRIDE));
    this.nCol0 = this.nCol;
    pin.had = pin.w > 0;
    if (pin.had) pin.p0.set(pin.p);
    this.time += n / hz;
    this.steps += n;
    this._out(1 / hz, true);
    return n;
  }

  _rec(o) {
    const g = this.g, T = this.trail;
    for (let k = 0; k < 3; k++) {
      const u = (g[k] - g[3 + k]) / ROD;
      T[o + k] = g[k] + u * (X1 - X_WOOD0);
      T[o + 3 + k] = g[k] + u * (X1 - X_WOOD1);
    }
  }

  // one fixed step
  _sub(dt, colF) {
    const g = this.g, h = this.h, as = this.as, pin = this.pin, S = NK_SIM;
    const held = pin.w >= 1;
    const dt2 = dt * dt;
    const damp = Math.exp(-S.drag * dt);
    const vmax = S.maxSpeed * dt;
    const ax = (this.grav[0] - this.acc[0]) * dt2, ay = (this.grav[1] - this.acc[1]) * dt2, az = (this.grav[2] - this.acc[2]) * dt2;
    if (held) {
      // in a hand: it goes where the hand does
      const p = pin.ps;
      for (let k = 0; k < 3; k++) {
        h[k] = g[k];
        h[3 + k] = g[3 + k];
        g[k] = p[k] - p[3 + k] * X1;
        g[3 + k] = p[k] - p[3 + k] * X2;
      }
    } else {
      for (let o = 0; o < 6; o += 3) {
        let vx = (g[o] - h[o]) * damp, vy = (g[o + 1] - h[o + 1]) * damp, vz = (g[o + 2] - h[o + 2]) * damp;
        const v = Math.hypot(vx, vy, vz);
        if (v > vmax) {
          const k = vmax / v;
          vx *= k;
          vy *= k;
          vz *= k;
        }
        h[o] = g[o];
        h[o + 1] = g[o + 1];
        h[o + 2] = g[o + 2];
        g[o] += vx + ax;
        g[o + 1] += vy + ay;
        g[o + 2] += vz + az;
      }
      if (pin.w > 0) {
        // being caught: drawn to where the hand will hold it, harder the nearer the catch is
        const p = pin.ps, pv = pin.pv;
        // (and over the last half of the catch whatever is still between them is closed: it is in the hand, to the
        // hair, at the moment the hand has it - a catch never ends with the handle put there)
        const near = pin.w <= 0.5 ? 0 : ((pin.w - 0.5) / 0.5) ** 4;
        const k = 1 - Math.exp(-pin.w * pin.w * 120 * dt) * (1 - near);
        for (let c = 0; c < 3; c++) {
          const t1 = p[c] - p[3 + c] * X1, t2 = p[c] - p[3 + c] * X2;
          // its place goes to the hand's, and its speed to the hand's: it arrives with the hand, not through it
          const v1 = (g[c] - h[c]) * (1 - k) + (pv[c] - pv[3 + c] * X1) * k;
          const v2 = (g[3 + c] - h[3 + c]) * (1 - k) + (pv[c] - pv[3 + c] * X2) * k;
          g[c] += (t1 - g[c]) * k;
          g[3 + c] += (t2 - g[3 + c]) * k;
          h[c] = g[c] - v1;
          h[3 + c] = g[3 + c] - v2;
        }
      }
      for (let it = 0; it < S.iters; it++) {
        this._rod();
        this._rope(it === 0);
        // (most of the way into a hand or under an arm, it is that hand's: what it is caught against does not push it off)
        if (pin.w < 0.5) this._collide(dt, colF, it === S.iters - 1);
      }
      this._rod();
      // pulled up by the chain against something it lies on: a few more turns of the two, so that it ends both clear
      // of what it touches and within the chain's reach where it can be both
      if (pin.w < 0.5 && this.touched) {
        for (let it = 0; it < 4; it++) {
          this._rope(false);
          this._collide(dt, 0, false);
          this._rod();
        }
      }
    }
    // the chain is never longer than itself: whatever is left over, the rod is brought in whole (its length is kept)
    {
      const tx = TOP_A * g[0] + TOP_B * g[3] - as[0], ty = TOP_A * g[1] + TOP_B * g[4] - as[1], tz = TOP_A * g[2] + TOP_B * g[5] - as[2];
      const d = Math.hypot(tx, ty, tz);
      // (in a hand too: a hand that holds it further off than that is brought in with it - the views put the hand
      // where the handle is, so two hands can never be shown pulling the chain longer)
      if (d > NK_CHAIN) {
        const k = (d - NK_CHAIN) / d;
        for (let o = 0; o < 6; o += 3) {
          g[o] -= tx * k;
          g[o + 1] -= ty * k;
          g[o + 2] -= tz * k;
        }
      }
    }
    if (!held) {
      // what it was pushed out of or pulled up by may have moved it further in the step than anything flies: its
      // speed is kept to what a handle can have (a step's worth and a half), so one bad frame is never a launch
      const lim = vmax * 1.5;
      for (let o = 0; o < 6; o += 3) {
        const vx = g[o] - h[o], vy = g[o + 1] - h[o + 1], vz = g[o + 2] - h[o + 2];
        const v = Math.hypot(vx, vy, vz);
        if (v > lim) {
          const k = lim / v;
          h[o] = g[o] - vx * k;
          h[o + 1] = g[o + 1] - vy * k;
          h[o + 2] = g[o + 2] - vz * k;
        }
      }
    }
    if (!(g[0] === g[0] && g[1] === g[1] && g[2] === g[2] && g[3] === g[3] && g[4] === g[4] && g[5] === g[5]) || Math.abs(g[0]) > 1e6) {
      // (never: but a rod that is nowhere hangs from the hand again rather than poisoning every frame after)
      this.a.set(as);
      this.reset();
      return;
    }
  }

  // the rod's two masses, their distance apart
  _rod() {
    const g = this.g;
    const dx = g[0] - g[3], dy = g[1] - g[4], dz = g[2] - g[5];
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-9) {
      g[1] += ROD;
      return;
    }
    const k = (0.5 * (d - ROD)) / d;
    g[0] -= dx * k;
    g[1] -= dy * k;
    g[2] -= dz * k;
    g[3] += dx * k;
    g[4] += dy * k;
    g[5] += dz * k;
  }

  // the chain pulled taut: the rod's eye no further than the chain from the anchor's
  _rope(note) {
    const g = this.g, as = this.as;
    const tx = TOP_A * g[0] + TOP_B * g[3] - as[0], ty = TOP_A * g[1] + TOP_B * g[4] - as[1], tz = TOP_A * g[2] + TOP_B * g[5] - as[2];
    const d = Math.hypot(tx, ty, tz);
    if (d <= NK_CHAIN) return;
    const c = d - NK_CHAIN;
    if (note) this.taut = Math.max(this.taut, Math.min(1, c * 400));
    const lam = c / (d * (TOP_A * TOP_A + TOP_B * TOP_B));
    g[0] -= tx * lam * TOP_A;
    g[1] -= ty * lam * TOP_A;
    g[2] -= tz * lam * TOP_A;
    g[3] -= tx * lam * TOP_B;
    g[4] -= ty * lam * TOP_B;
    g[5] -= tz * lam * TOP_B;
  }

  // the rod against the frame's colliders and the handle in the hand
  _collide(dt, colF, last) {
    const g = this.g, h = this.h, as = this.as, S = NK_SIM;
    const ux = (g[0] - g[3]) / ROD, uy = (g[1] - g[4]) / ROD, uz = (g[2] - g[5]) / ROD;
    // the wood, end to end (from the eye: X_WOOD0 .. X_WOOD1 down the rod; g1 is at X1)
    const w0x = g[0] + ux * (X1 - X_WOOD0), w0y = g[1] + uy * (X1 - X_WOOD0), w0z = g[2] + uz * (X1 - X_WOOD0);
    const w1x = g[0] + ux * (X1 - X_WOOD1), w1y = g[1] + uy * (X1 - X_WOOD1), w1z = g[2] + uz * (X1 - X_WOOD1);
    const n = this.nCol;
    if (last) this.touched = false;
    for (let i = -1; i < n; i++) {
      let cax, cay, caz, cbx, cby, cbz, cr, o = 0;
      if (i < 0) {
        // the anchor's handle: its wood
        cax = as[0] - as[3] * X_WOOD0;
        cay = as[1] - as[4] * X_WOOD0;
        caz = as[2] - as[5] * X_WOOD0;
        cbx = as[0] - as[3] * X_WOOD1;
        cby = as[1] - as[4] * X_WOOD1;
        cbz = as[2] - as[5] * X_WOOD1;
        cr = ROD_R;
      } else {
        o = i * STRIDE;
        const c = this.cols;
        if (!(c[o + 7] & NK_COL.ROD)) continue;
        cax = c[o];
        cay = c[o + 1];
        caz = c[o + 2];
        cbx = c[o + 3];
        cby = c[o + 4];
        cbz = c[o + 5];
        cr = c[o + 6];
      }
      const R = cr + ROD_R;
      const r = segSeg(w0x, w0y, w0z, w1x, w1y, w1z, cax, cay, caz, cbx, cby, cbz);
      if (r.d2 >= R * R) continue;
      const s = r.s, t = r.t;
      const px = w0x + (w1x - w0x) * s, py = w0y + (w1y - w0y) * s, pz = w0z + (w1z - w0z) * s;
      const qx = cax + (cbx - cax) * t, qy = cay + (cby - cay) * t, qz = caz + (cbz - caz) * t;
      let nx = px - qx, ny = py - qy, nz = pz - qz;
      let d = Math.sqrt(r.d2);
      if (d < 1e-7) {
        // dead centre: out the way it came
        nx = h[0] - g[0];
        ny = h[1] - g[1];
        nz = h[2] - g[2];
        d = Math.hypot(nx, ny, nz);
        if (d < 1e-9) {
          nx = 0;
          ny = 1;
          nz = 0;
          d = 1;
        }
        nx /= d;
        ny /= d;
        nz /= d;
        d = 0;
      } else {
        nx /= d;
        ny /= d;
        nz /= d;
      }
      const depth = R - d;
      this.touched = true;
      // the struck point as a mix of the two masses
      const x = X_WOOD0 + (X_WOOD1 - X_WOOD0) * s;
      const c2 = (x - X1) / ROD, c1 = 1 - c2;
      const w = 1 / (c1 * c1 + c2 * c2);
      // how fast that point was closing on the collider (which moves too)
      let mvx = 0, mvy = 0, mvz = 0;
      if (i >= 0 && colF > 0) {
        const c = this.col, c0 = this.col0;
        mvx = (c[o] - c0[o] + (c[o + 3] - c0[o + 3] - (c[o] - c0[o])) * t) * colF;
        mvy = (c[o + 1] - c0[o + 1] + (c[o + 4] - c0[o + 4] - (c[o + 1] - c0[o + 1])) * t) * colF;
        mvz = (c[o + 2] - c0[o + 2] + (c[o + 5] - c0[o + 5] - (c[o + 2] - c0[o + 2])) * t) * colF;
      }
      const rvx = c1 * (g[0] - h[0]) + c2 * (g[3] - h[3]) - mvx;
      const rvy = c1 * (g[1] - h[1]) + c2 * (g[4] - h[4]) - mvy;
      const rvz = c1 * (g[2] - h[2]) + c2 * (g[5] - h[5]) - mvz;
      const vn = rvx * nx + rvy * ny + rvz * nz;
      // Out of it: at once, all the way - except for a moment after a hand has let it go (grace). It is inside that
      // hand then, without having gone in, and the hand is solid to it again: put out in one step it leaves at the
      // speed of a blow, from nothing. So then it is eased out, at walking pace, unless it is really struck
      // (and for a moment after a hand lets it go it is still in that hand, which is moving: only a real blow
      // counts as one then)
      // (...and the handle beside it, in the same pair of hands, is not one: the strike that follows the letting go
      // swings the held handle through where the other still hangs, and it is the chain that takes it away)
      const out = !(this.grace > 0) || vn < -(i < 0 ? 1e9 : 8) * dt ? depth : Math.min(depth, S.easeOut * dt);
      const k1 = out * c1 * w, k2 = out * c2 * w;
      g[0] += nx * k1;
      g[1] += ny * k1;
      g[2] += nz * k1;
      g[3] += nx * k2;
      g[4] += ny * k2;
      g[5] += nz * k2;
      if (out < depth) {
        // (eased out: moved, not pushed - where it was a step ago goes with it, or every step of easing would be
        // speed gained, and it would leave at a run after all)
        h[0] += nx * k1;
        h[1] += ny * k1;
        h[2] += nz * k1;
        h[3] += nx * k2;
        h[4] += ny * k2;
        h[5] += nz * k2;
      }
      // it drags along the surface, and comes off it with a little of the speed it went in with
      if (!last) continue;
      const tx = rvx - vn * nx, ty = rvy - vn * ny, tz = rvz - vn * nz;
      const f1 = S.mu * c1 * w, f2 = S.mu * c2 * w;
      g[0] -= tx * f1;
      g[1] -= ty * f1;
      g[2] -= tz * f1;
      g[3] -= tx * f2;
      g[4] -= ty * f2;
      g[5] -= tz * f2;
      if (vn < 0) {
        const b = -vn * S.bounce;
        h[0] -= nx * b * c1 * w;
        h[1] -= ny * b * c1 * w;
        h[2] -= nz * b * c1 * w;
        h[3] -= nx * b * c2 * w;
        h[4] -= ny * b * c2 * w;
        h[5] -= nz * b * c2 * w;
        const sp = -vn / dt;
        if (sp > this.knock) {
          this.knock = sp;
          this.knockAt = i;
        }
      }
    }
  }

  // The joints between the two eyes, for drawing: an arc. Every link is a chord of one circle, so every link is its
  // length exactly, whatever the slack - taut it is a straight line, slack it bows, with no slack at all between the
  // eyes it closes into a ring. Which way it bows (sag) follows gravity and trails the way the chain is being moved,
  // and comes round the chain's own line to there: it never flips from one side to the other.
  // (It was a verlet chain made exact by FABRIK. Thrown slack and pulled taut again inside three frames, that
  // crumpled into a zigzag and shook itself straight: the chain is 11 cm long and weighs nothing next to the handle
  // on its end - what it does between two eyes is drawn, not simulated.)
  _arc(sx, sy, sz, ex, ey, ez, dt) {
    const j = this.j, L = NK_GEOM.link, n = NJ - 1;
    let cx = ex - sx, cy = ey - sy, cz = ez - sz;
    const c = Math.hypot(cx, cy, cz);
    const ch = this.chord;
    if (c > 1e-6) {
      ch[0] = cx / c;
      ch[1] = cy / c;
      ch[2] = cz / c;
    }
    cx = ch[0];
    cy = ch[1];
    cz = ch[2];
    // which way it bows: toward where gravity (less the carrier's own acceleration) and its lag behind the motion
    // of its middle would take it
    const sag = this.sag, bow = this.bow, m0 = this.mid;
    const mx = (sx + ex) / 2, my = (sy + ey) / 2, mz = (sz + ez) / 2;
    if (dt > 0) {
      let tx = this.grav[0] - this.acc[0], ty = this.grav[1] - this.acc[1], tz = this.grav[2] - this.acc[2];
      const tl = Math.hypot(tx, ty, tz) || 1;
      const vx = this.midOn ? (mx - m0[0]) / dt : 0, vy = this.midOn ? (my - m0[1]) / dt : 0, vz = this.midOn ? (mz - m0[2]) / dt : 0;
      tx = tx / tl - vx * 0.03;
      ty = ty / tl - vy * 0.03;
      tz = tz / tl - vz * 0.03;
      const k = 1 - Math.exp(-18 * dt);
      sag[0] += (tx - sag[0]) * k;
      sag[1] += (ty - sag[1]) * k;
      sag[2] += (tz - sag[2]) * k;
    }
    m0[0] = mx;
    m0[1] = my;
    m0[2] = mz;
    this.midOn = true;
    // square to the chain's line: where it bowed last (carried to the line as it now is), turned toward the sag
    let d = bow[0] * cx + bow[1] * cy + bow[2] * cz;
    let bx = bow[0] - cx * d, by = bow[1] - cy * d, bz = bow[2] - cz * d;
    let bl = Math.hypot(bx, by, bz);
    d = sag[0] * cx + sag[1] * cy + sag[2] * cz;
    let wx = sag[0] - cx * d, wy = sag[1] - cy * d, wz = sag[2] - cz * d;
    const wl = Math.hypot(wx, wy, wz);
    if (bl < 1e-6) {
      // (never bowed yet, or last bowed straight along where the chain now lies: the sag's side, or any)
      if (wl > 1e-6) {
        bx = wx / wl;
        by = wy / wl;
        bz = wz / wl;
      } else {
        bx = Math.abs(cy) < 0.9 ? 0 : 1;
        by = Math.abs(cy) < 0.9 ? 1 : 0;
        bz = 0;
        d = bx * cx + by * cy + bz * cz;
        bx -= cx * d;
        by -= cy * d;
        bz -= cz * d;
        bl = Math.hypot(bx, by, bz) || 1;
        bx /= bl;
        by /= bl;
        bz /= bl;
      }
    } else {
      bx /= bl;
      by /= bl;
      bz /= bl;
      if (wl > 1e-4 && dt > 0) {
        wx /= wl;
        wy /= wl;
        wz /= wl;
        // round the line, by a part of the angle between them (less of it the less the sag says: wl)
        const sn = (by * wz - bz * wy) * cx + (bz * wx - bx * wz) * cy + (bx * wy - by * wx) * cz, cs = bx * wx + by * wy + bz * wz;
        // (and of that, less the tauter the chain: pulled straight there is no bow to see, only the links' roll,
        // and a chain whose links spin on a straight line is all that turning it then would show)
        const slack = Math.min(1, Math.max(0.03, (1 - c / (L * n)) / 0.12));
        const ang = Math.atan2(sn, cs) * (1 - Math.exp(-14 * dt * Math.min(1, wl * 2) * slack));
        const ca = Math.cos(ang), sa = Math.sin(ang);
        // (Rodrigues, about the chain's line: b is square to it)
        const rx = bx * ca + (cy * bz - cz * by) * sa, ry = by * ca + (cz * bx - cx * bz) * sa, rz = bz * ca + (cx * by - cy * bx) * sa;
        bx = rx;
        by = ry;
        bz = rz;
      }
    }
    bow[0] = bx;
    bow[1] = by;
    bow[2] = bz;
    // the angle each link turns from the last: sin(n phi / 2) / sin(phi / 2) = c / L (n links of L between eyes c apart)
    const want = Math.min(n, c / L);
    let phi = 0;
    if (want < n - 1e-7) {
      let lo = 0, hi = (2 * Math.PI) / n;
      for (let i = 0; i < 40; i++) {
        phi = (lo + hi) / 2;
        if (Math.sin((n * phi) / 2) / Math.sin(phi / 2) > want) lo = phi;
        else hi = phi;
      }
    }
    j[0] = sx;
    j[1] = sy;
    j[2] = sz;
    for (let k = 0; k < n; k++) {
      const th = ((n - 1) / 2 - k) * phi, co = Math.cos(th) * L, si = Math.sin(th) * L, o = k * 3;
      j[o + 3] = j[o] + cx * co + bx * si;
      j[o + 4] = j[o + 1] + cy * co + by * si;
      j[o + 5] = j[o + 2] + cz * co + bz * si;
    }
    // (the last joint is the rod's eye to within rounding: put on it)
    j[n * 3] = ex;
    j[n * 3 + 1] = ey;
    j[n * 3 + 2] = ez;
  }


  // what the views read: the rod as an eye, a direction and a roll; the chain from the anchor as it is NOW
  _out(dt, snap) {
    const g = this.g, h = this.h, a = this.a, u = this.u, sd = this.side;
    if (snap) {
      // the anchor drawn is the frame's own, not the last step's: the rod comes with the chain if it must
      const tx = TOP_A * g[0] + TOP_B * g[3] - a[0], ty = TOP_A * g[1] + TOP_B * g[4] - a[1], tz = TOP_A * g[2] + TOP_B * g[5] - a[2];
      const d = Math.hypot(tx, ty, tz);
      if (d > NK_CHAIN) {
        const k = (d - NK_CHAIN) / d;
        for (let o = 0; o < 6; o += 3) {
          g[o] -= tx * k;
          g[o + 1] -= ty * k;
          g[o + 2] -= tz * k;
          h[o] -= tx * k;
          h[o + 1] -= ty * k;
          h[o + 2] -= tz * k;
        }
      }
    }
    let ux = g[0] - g[3], uy = g[1] - g[4], uz = g[2] - g[5];
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul;
    uy /= ul;
    uz /= ul;
    u[0] = ux;
    u[1] = uy;
    u[2] = uz;
    const top = this.top;
    top[0] = g[0] + ux * X1;
    top[1] = g[1] + uy * X1;
    top[2] = g[2] + uz * X1;
    const b = this.butt, tb = this._tb;
    const bx = top[0] - ux * X_WOOD1, by = top[1] - uy * X_WOOD1, bz = top[2] - uz * X_WOOD1;
    // (the butt's speed: from the two masses' own, a step's worth)
    const c2 = (X_WOOD1 - X1) / ROD, c1 = 1 - c2;
    this.tipSpeed = Math.hypot(c1 * (g[0] - h[0]) + c2 * (g[3] - h[3]), c1 * (g[1] - h[1]) + c2 * (g[4] - h[4]), c1 * (g[2] - h[2]) + c2 * (g[5] - h[5])) / dt;
    b[0] = bx;
    b[1] = by;
    b[2] = bz;
    void tb;
    // its roll: the side vector carried along, kept square to the rod
    let k = sd[0] * ux + sd[1] * uy + sd[2] * uz;
    let sx = sd[0] - ux * k, sy = sd[1] - uy * k, sz = sd[2] - uz * k;
    let sl = Math.hypot(sx, sy, sz);
    if (sl < 1e-6) {
      // (pointing straight along where its side was: any side will do)
      sx = Math.abs(ux) < 0.9 ? 1 : 0;
      sy = Math.abs(ux) < 0.9 ? 0 : 1;
      sz = 0;
      k = sx * ux + sy * uy + sz * uz;
      sx -= ux * k;
      sy -= uy * k;
      sz -= uz * k;
      sl = Math.hypot(sx, sy, sz) || 1;
    }
    sd[0] = sx / sl;
    sd[1] = sy / sl;
    sd[2] = sz / sl;
    if (snap) this._arc(a[0], a[1], a[2], top[0], top[1], top[2], this._lastN > 0 && !this._still ? this._lastN / NK_SIM.hz : 0);
  }

  /** The anchor handle's wood as a segment (out: 6 numbers, chain end then butt), for whoever draws or tests it. */
  anchorWood(out) {
    const a = this.a;
    for (let k = 0; k < 3; k++) {
      out[k] = a[k] - a[3 + k] * X_WOOD0;
      out[3 + k] = a[k] - a[3 + k] * X_WOOD1;
    }
    return out;
  }
  /** The rod's wood as a segment (chain end, then butt). */
  rodWood(out) {
    const t = this.top, u = this.u;
    for (let k = 0; k < 3; k++) {
      out[k] = t[k] - u[k] * X_WOOD0;
      out[3 + k] = t[k] - u[k] * X_WOOD1;
    }
    return out;
  }
  /** How far the rod's wood is from a capsule's surface (m; negative: inside it). */
  rodClearance(ax, ay, az, bx, by, bz, r) {
    const w = this.rodWood(_w6);
    return Math.sqrt(segSeg(w[0], w[1], w[2], w[3], w[4], w[5], ax, ay, az, bx, by, bz).d2) - r - ROD_R;
  }
  /** The longest and the shortest of the chain's links now, as a fraction of a link (1 = exact), and eye to eye. */
  chainError() {
    const j = this.j;
    let lo = Infinity, hi = 0;
    for (let o = 3; o < NJ * 3; o += 3) {
      const d = Math.hypot(j[o] - j[o - 3], j[o + 1] - j[o - 2], j[o + 2] - j[o - 1]) / NK_GEOM.link;
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
    const g = this.g;
    const e = (NJ - 1) * 3;
    const gap = Math.hypot(j[e] - this.top[0], j[e + 1] - this.top[1], j[e + 2] - this.top[2]);
    return { lo, hi, gap, rod: Math.hypot(g[0] - g[3], g[1] - g[4], g[2] - g[5]) / ROD, span: Math.hypot(this.top[0] - this.a[0], this.top[1] - this.a[1], this.top[2] - this.a[2]) / NK_CHAIN };
  }
}
const _w6 = new Float64Array(6);
export const NK_JOINTS = NJ;
export const NK_ROD = { X1, X2, ROD, ROD_R, X_WOOD0, X_WOOD1 };
