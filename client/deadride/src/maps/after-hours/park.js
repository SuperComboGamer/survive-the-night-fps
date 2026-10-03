// AFTER HOURS — shared runtime state between the route scenery (rides) and the vehicle: the track table and per-frame animators.
// The route has no update hook of its own in the world loop, so its animators are ticked from Monorail.update (always running).
import { buildTrack } from './track.js';
export const PARK = {
  track: buildTrack(),
  animators: [],
  reset() { this.animators.length = 0; },
  tick(dt, t) { for (const f of this.animators) f(dt, t); },
};
