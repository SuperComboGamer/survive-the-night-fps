// Custom survivors' models (the character creator), built a little at a time while playing. A player who joins as one
// is drawn as the roster survivor most like them (their player list character) until both their models, alive and
// turned, are built (Game.lookOf); then their body is made again as themselves (Entities.survivorView, by the change).
// A model takes 6-20 ms to build: one at a time, MIN_GAP apart, and not on a frame slower than this machine's usual
// (unless it has waited MAX_WAIT for one).
import { warmLook, lookWarm } from '../render/models/characters.js';

const MIN_GAP = 0.3; // s between two
const MAX_WAIT = 3; // s: then on the next frame, slow or not

export class LookWarmer {
  constructor() {
    this.queue = [];
    this.gap = 0;
    this.waited = 0;
    this.avg = 1 / 60; // the usual frame here
  }

  /** A look's key to have built (shared/appearance.js lookKey). */
  want(key) {
    if (key && !lookWarm(key) && !this.queue.includes(key)) this.queue.push(key);
  }

  /** Every frame: builds one model of the first look waiting, when it is time to. */
  tick(dt) {
    const slow = dt > this.avg * 1.6;
    this.avg += (Math.min(dt, 0.25) - this.avg) * 0.05;
    if (!this.queue.length) return;
    this.gap -= dt;
    this.waited += dt;
    if (this.gap > 0 || (slow && this.waited < MAX_WAIT)) return;
    const key = this.queue[0];
    if (warmLook(key)) {
      this.gap = MIN_GAP;
      this.waited = 0;
    }
    if (lookWarm(key)) this.queue.shift();
  }
}
