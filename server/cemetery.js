// The dead come up out of the ground at St. Agnes Cemetery (shared/cemetery.js builds the place and names its
// graves: world.cemetery.graves).
//
// By night: when a wave starts with a survivor within CEMETERY.NEAR of the cemetery, a share of that wave's walkers
// and runners is taken out of its queue and comes up out of the graves instead, a few seconds apart - inside
// whatever the survivors have walled off round the chapel. The horde is no bigger for it: only where part of it
// arrives changes. Specials and bosses still come from the treeline.
// By day: a few graves are restless (drawn at every sunrise), and each gives up one walker to the first survivor
// who comes within CEMETERY.WAKE of it.
//
// A rise is fair warning: the earth of the grave heaves and is heard (EVT.GRAVE) CEMETERY.STIR before anything
// shows, and the zombie then takes CEMETERY.RISE to climb out (ZANIM.RISE). It does nothing until it is out, and it
// is an ordinary zombie from the moment it spawns: its feet start under the ground and come up, so the terrain hides
// what is not out yet from the eye and from bullets, and a head above the grass can be shot like any other.
import { PHASE } from '../shared/constants.js';
import { ZTYPE, ZANIM, EVT, NOTIFY } from '../shared/defs.js';
import { CEMETERY, riseDepth } from '../shared/cemetery.js';
import { mulberry32 } from '../shared/rng.js';
import { groundAt } from '../shared/collision.js';

const MAX_ALIVE = 120; // (MAX_ZOMBIES_ALIVE in game.js: the cap on the dead holds for what comes up here too)

export class Cemetery {
  constructor(game) {
    this.g = game;
    this.rng = mulberry32(1); // its own stream (reset): the game's is not drawn from to pick a grave
    this.pending = []; // rises on their way: { grave (-1: picked when it stirs), type, horde, owed (one of this.share), t, stirred }
    this.restless = []; // the graves that hold a walker today
    this.quiet = new Float64Array(0); // per grave: the game time until which it gives up nothing more
    this.share = null; // tonight's share of the horde still under the ground, as a wave of its own (see wave)
    this.woke = false; // the survivors have been told tonight
    this.risen = 0; // how many have come up this run
  }

  // a new run (Game.startGame, the world chosen)
  reset() {
    const cem = this.g.world.cemetery;
    this.rng = mulberry32(this.g.seed ^ 0x9a7e5);
    this.pending.length = 0;
    this.quiet = new Float64Array(cem ? cem.graves.length : 0);
    this.share = null;
    this.woke = false;
    this.risen = 0;
    this.draw();
  }

  // sunrise (Game.startDay): what had not stirred yet stays down, and other graves are restless today
  dawn() {
    this.pending = this.pending.filter((p) => p.stirred);
    this.share = null;
    this.woke = false;
    this.draw();
  }

  // today's restless graves: not one a survivor is standing next to as it is drawn
  draw() {
    const g = this.g;
    const cem = g.world.cemetery;
    this.restless.length = 0;
    if (!cem) return;
    const humans = g.humans();
    const free = [];
    cem.graves.forEach((gr, i) => {
      if (!humans.some((h) => Math.hypot(h.state.x - gr.x, h.state.z - gr.z) < CEMETERY.WAKE * 2)) free.push(i);
    });
    for (let n = 0; n < CEMETERY.RESTLESS && free.length; n++) this.restless.push(free.splice(Math.floor(this.rng() * free.length), 1)[0]);
  }

  // A wave of the night starts (Game.updatePhase). With a survivor near the cemetery, CEMETERY.SHARE of its walkers
  // and runners leave its queue for the graves. They wait in a wave of their own that never starts by the clock
  // (this.share), so the horde the HUD counts is the same size as ever. Returns how many it took.
  wave(wv) {
    const g = this.g;
    const cem = g.world.cemetery;
    if (!cem || !cem.graves.length) return 0;
    const near = g.humans().filter((h) => Math.hypot(h.state.x - cem.x, h.state.z - cem.z) < CEMETERY.NEAR);
    if (!near.length) return 0;
    const rank = [];
    wv.queue.forEach((t, i) => {
      if (t === ZTYPE.WALKER || t === ZTYPE.RUNNER) rank.push(i);
    });
    const n = Math.round(rank.length * CEMETERY.SHARE);
    if (!n) return 0;
    const take = [];
    for (let k = 0; k < n; k++) take.push(rank.splice(Math.floor(this.rng() * rank.length), 1)[0]);
    take.sort((a, b) => b - a);
    if (!this.share || !g.waves.includes(this.share)) g.waves.push((this.share = { start: Infinity, queue: [], started: false, spawnT: 0, interval: 0 }));
    for (const i of take) {
      const type = wv.queue.splice(i, 1)[0];
      this.share.queue.push(type);
      this.pending.push({ grave: -1, type, horde: true, owed: true, t: this.rng() * CEMETERY.SPREAD, stirred: false });
    }
    if (!this.woke) {
      this.woke = true;
      for (const h of near) g.notify(NOTIFY.GRAVES, 0, h.id);
    }
    return n;
  }

  // A grave for one of the horde to come up from: much the likeliest near the survivors (one 5 m from them is
  // picked eight times as often as one 20 m off - about three in four come up in the churchyard for a team in
  // the chapel, the rest in the cemetery behind it), never one a survivor is standing at, never one that has only
  // just given up its dead. -1: none will do right now.
  pick(humans) {
    const g = this.g;
    const graves = g.world.cemetery.graves;
    let total = 0;
    const w = [];
    for (let i = 0; i < graves.length; i++) {
      let d = Infinity;
      for (const h of humans) d = Math.min(d, Math.hypot(h.state.x - graves[i].x, h.state.z - graves[i].z));
      w[i] = d < CEMETERY.KEEP_OFF || d === Infinity || this.quiet[i] > g.time ? 0 : 1 / (1 + d / 6) ** 3;
      total += w[i];
    }
    if (!total) return -1;
    let r = this.rng() * total;
    for (let i = 0; i < graves.length; i++) {
      r -= w[i];
      if (w[i] > 0 && r <= 0) return i;
    }
    return w.findLastIndex((v) => v > 0);
  }

  // grave i stirs now: everyone near sees and hears it, and CEMETERY.STIR later p.type comes up
  stir(p, i) {
    const g = this.g;
    const gr = g.world.cemetery.graves[i];
    p.grave = i;
    p.stirred = true;
    p.t = CEMETERY.STIR;
    this.quiet[i] = g.time + CEMETERY.STIR + CEMETERY.RISE + CEMETERY.REST;
    g.emit(
      (w) => {
        w.u8(EVT.GRAVE);
        w.u8(i);
      },
      { x: gr.x, z: gr.z, r: 110 },
    );
  }

  // one of tonight's share is accounted for: it has come up, or it never will
  settle(p) {
    if (!p.owed || !this.share) return;
    const k = this.share.queue.indexOf(p.type);
    if (k >= 0) this.share.queue.splice(k, 1);
  }

  update(dt) {
    const g = this.g;
    const cem = g.world.cemetery;
    if (!cem) return;
    // by day: a restless grave wakes for the first survivor to come close
    if (g.phase === PHASE.DAY && !g.escape.active && this.restless.length && g.tick % 4 === 0) {
      const humans = g.humans();
      for (let k = this.restless.length - 1; k >= 0; k--) {
        const i = this.restless[k];
        const gr = cem.graves[i];
        if (!humans.some((h) => Math.hypot(h.state.x - gr.x, h.state.z - gr.z) < CEMETERY.WAKE && Math.abs(h.state.y - gr.y) < 3)) continue;
        this.restless.splice(k, 1);
        const p = { grave: i, type: ZTYPE.WALKER, horde: false, owed: false, t: 0, stirred: false };
        this.pending.push(p);
        this.stir(p, i);
      }
    }
    if (!this.pending.length) return;
    let humans = null;
    for (let k = this.pending.length - 1; k >= 0; k--) {
      const p = this.pending[k];
      p.t -= dt;
      if (p.t > 0) continue;
      if (!p.stirred) {
        // its turn: a grave near the survivors, once there is room among the dead for one more
        humans ||= g.humans();
        const i = p.grave >= 0 ? p.grave : g.zombies.length < MAX_ALIVE ? this.pick(humans) : -1;
        if (i < 0) p.t = 0.5;
        else this.stir(p, i);
        continue;
      }
      this.pending.splice(k, 1);
      this.settle(p);
      this.rise(p.grave, p.type, p.horde);
    }
  }

  // one of the dead starts up out of grave i: an ordinary zombie, its feet a body's height under the grass (climb).
  // (one of the horde that stirred as the sun came up is no longer the horde's: nothing would burn it)
  rise(i, type, horde) {
    const g = this.g;
    const gr = g.world.cemetery.graves[i];
    horde = horde && g.phase === PHASE.NIGHT;
    const z = g.zm.spawn(type, gr.x, gr.z, { horde, hpMul: horde ? g.hordeHpMul : 1 });
    if (!z) return null;
    z.riseT = CEMETERY.RISE;
    z.riseY = z.y;
    z.y -= z.def.height;
    z.yaw = gr.yaw;
    z.anim = ZANIM.RISE;
    g.fillHistory(z);
    this.risen++;
    if (horde) g.globalDirty = true;
    return z;
  }

  // A zombie on its way up (Zombies.updateOne hands it over while z.riseT > 0). It only climbs: its feet come up
  // from a body's height under the grass to the grass in two heaves (riseDepth).
  climb(z, dt) {
    z.riseT -= dt;
    z.vx = z.vy = z.vz = 0;
    if (z.riseT <= 0) {
      z.riseT = 0;
      z.y = z.riseY;
      z.anim = ZANIM.IDLE;
      return;
    }
    z.y = z.riseY - z.def.height * riseDepth(1 - z.riseT / CEMETERY.RISE);
    z.anim = ZANIM.RISE;
    z.animT = 0;
  }

  // /cemetery: to the gate. /cemetery rise [n]: the n graves nearest (and not underfoot) give up a walker now
  debug(p, args) {
    const g = this.g;
    const cem = g.world.cemetery;
    const s = p.state;
    if (!cem) return g.systemChat('this valley has no chapel, and no cemetery');
    if (args[1] !== 'rise') {
      s.x = cem.gate.x;
      s.z = cem.gate.z;
      s.y = groundAt(g.world, s.x, s.z, 200, 0.3);
      s.vx = s.vy = s.vz = 0;
      g.fillHistory(p);
      return;
    }
    const d = (i) => Math.hypot(cem.graves[i].x - s.x, cem.graves[i].z - s.z);
    const order = cem.graves.map((_, i) => i).filter((i) => d(i) > 2.5 && this.quiet[i] <= g.time).sort((a, b) => d(a) - d(b));
    for (const i of order.slice(0, Math.max(1, Math.min(20, +args[2] || 1)))) {
      const rise = { grave: i, type: ZTYPE.WALKER, horde: g.phase === PHASE.NIGHT, owed: false, t: 0, stirred: false };
      this.pending.push(rise);
      this.stir(rise, i);
    }
  }
}
