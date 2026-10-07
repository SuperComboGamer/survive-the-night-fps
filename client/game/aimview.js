// A shot in the view: how the camera is lifted by the gun's climb and punched by each round, and how wide the
// crosshair stands. No three.js and no DOM in here: Game owns the numbers and calls these each frame, and
// scripts/test-spread.js runs them against the simulation to hold the view to where the rounds go.
//
// The gun's climb (shared/playersim.js shotClimb: how far over the aim the next round goes) lifts the view itself,
// eased in at CLIMB_UP a second as the rounds go and out at CLIMB_DOWN as the gun settles, so the sights and the
// crosshair are on what the next round strikes, and pulling the view down holds a burst on its mark.
// On top of it each round punches the view up and lets it back: PUNCH x the gun's recoil (an automatic's is small,
// its climb is its kick; a gun fired a round at a time has no climb to speak of and the punch is all of it), halved
// behind the sights, and gone before the next round can go - it lasts PUNCH_TIME of the gun's cycle, PUNCH_MAX s at
// the most - so it never comes between the sights and that round. It rises for the first PUNCH_RISE of its time and
// eases back for the rest.
export const CLIMB_UP = 45, CLIMB_DOWN = 16;
export const PUNCH_AUTO = 0.5, PUNCH_SINGLE = 1.4, PUNCH_AIMED = 0.5, PUNCH_TIME = 0.9, PUNCH_MAX = 0.3, PUNCH_RISE = 0.15;

// the view's climb a frame of dt later, on its way to `target` (shotClimb of the predicted state)
export function stepClimb(cur, target, dt) {
  const next = cur + (target - cur) * (1 - Math.exp(-dt * (target > cur ? CLIMB_UP : CLIMB_DOWN)));
  return !target && Math.abs(next) < 1e-6 ? 0 : next;
}

// a round's punch: how high (rad) and for how long (s)
export function punchOf(def, aiming) {
  return { amp: def.recoil * (def.auto ? PUNCH_AUTO : PUNCH_SINGLE) * (aiming ? PUNCH_AIMED : 1), len: Math.min(def.rate * PUNCH_TIME, PUNCH_MAX) };
}

// ...and how much of it is left u of the way through (0 before it and after)
export function punchAt(u) {
  return u <= 0 || u >= 1 ? 0 : u < PUNCH_RISE ? u / PUNCH_RISE : ((1 - u) / (1 - PUNCH_RISE)) ** 2;
}

// The crosshair's gap: px from the middle of the screen to the inner end of a tick, for a cone of half-angle `ang`
// (shotSpread) in a view `fov` degrees high on a screen `height` px high. The ticks stand on the edge of the cone:
// what is inside them can be struck, what is outside cannot.
export const CROSSHAIR_MIN = 3, CROSSHAIR_MAX = 200;
export function crosshairGap(ang, fov, height) {
  return Math.min(CROSSHAIR_MAX, Math.max(CROSSHAIR_MIN, (Math.tan(ang) / Math.tan((fov * Math.PI) / 360)) * height * 0.5));
}
