// The stray cat: ambient wildlife that pads around the broken-down car, naps in the sun, wanders over
// to survivors who stand still and bolts from anything dead. Zombies ignore it and nothing can hurt it.
import { PLAYER_RADIUS } from '../shared/constants.js';
import { CANIM } from '../shared/defs.js';
import { ENT } from '../shared/protocol.js';
import { resolveBody, groundAt } from '../shared/collision.js';

const GRAV = 16;
const RADIUS = 0.16;
const HEIGHT = 0.3;
const WALK_SPEED = 0.8;
const APPROACH_SPEED = 1.05;
const RUN_SPEED = 5.4;
const HOME_RADIUS = 28; // wanders stay around the car
const SCARE_RADIUS = 7; // the dead (or a zombie player) this close sends it running
const NOTICE_RADIUS = 13; // survivors this close may get a visit
const VISIT_COOLDOWN = 25; // seconds between visits
const COAT_COUNT = 5; // client coat patterns (variant % COAT_COUNT)
const TAU = Math.PI * 2;
const _pos = { x: 0, y: 0, z: 0 };

// mode: what it is doing; anim (CANIM) is what clients see
const MODE = { IDLE: 0, SIT: 1, WANDER: 2, VISIT: 3, FLEE: 4 };

function turn(a, b, max) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + Math.max(-max, Math.min(max, d));
}

export class Cats {
  constructor(game) {
    this.g = game;
  }

  spawn(x, z, homeX = x, homeZ = z) {
    const g = this.g;
    const e = {
      kind: ENT.CAT,
      variant: Math.floor(g.rng() * COAT_COUNT),
      x,
      y: groundAt(g.world, x, z, 200, RADIUS),
      z,
      yaw: g.rng() * TAU,
      vx: 0,
      vy: 0,
      vz: 0,
      anim: CANIM.SIT,
      mode: MODE.SIT,
      modeT: 3 + g.rng() * 4,
      homeX,
      homeZ,
      tx: x,
      tz: z,
      visit: 0,
      visitCd: 0,
      visitD: 0,
      detourT: 0,
      detourX: 0,
      detourZ: 0,
      threatX: 0,
      threatZ: 0,
      stuckT: 0,
    };
    if (!g.spawnEntity(e)) return null;
    g.cats.push(e);
    return e;
  }

  // one cat, lounging a few steps from the car where everyone starts
  spawnInitial() {
    const g = this.g;
    const w = g.world;
    const car = w.car;
    for (let tries = 0; tries < 20; tries++) {
      const a = g.rng() * TAU;
      const d = 4 + g.rng() * 5;
      const x = car.x + Math.sin(a) * d;
      const z = car.z + Math.cos(a) * d;
      if (w.isDeepWater(x, z) || g.nav.isBlocked(x, z)) continue;
      return this.spawn(x, z, car.x, car.z);
    }
    return this.spawn(car.x + 3, car.z + 3, car.x, car.z);
  }

  update(dt) {
    const g = this.g;
    if (!g.cats.length) return;
    const humans = g.humans();
    for (const c of g.cats) this.updateOne(c, dt, humans);
  }

  // nearest thing it's afraid of: a zombie, or a survivor who has turned
  nearestThreat(c) {
    const g = this.g;
    const r = c.mode === MODE.FLEE ? SCARE_RADIUS * 1.6 : SCARE_RADIUS;
    let best = null;
    let bd = r * r;
    for (const z of g.zombies) {
      if (z.dead) continue;
      const d = (z.x - c.x) ** 2 + (z.z - c.z) ** 2;
      if (d < bd) {
        bd = d;
        best = z;
      }
    }
    for (const p of g.players.values()) {
      if (!p.alive || !p.zombie) continue;
      const d = (p.state.x - c.x) ** 2 + (p.state.z - c.z) ** 2;
      if (d < bd) {
        bd = d;
        best = p.state;
      }
    }
    return best;
  }

  updateOne(c, dt, humans) {
    const g = this.g;
    c.modeT -= dt;
    c.visitCd -= dt;
    c.detourT -= dt;

    const threat = this.nearestThreat(c);
    if (threat) {
      c.threatX = threat.x;
      c.threatZ = threat.z;
      if (c.mode !== MODE.FLEE) {
        c.mode = MODE.FLEE;
        c.modeT = 1.8 + g.rng() * 1.2;
      } else c.modeT = Math.max(c.modeT, 0.8);
    }
    if (c.modeT <= 0) this.decide(c, humans);

    // desired velocity
    let dx = 0;
    let dz = 0;
    let speed = 0;
    let face = null; // yaw to turn toward while standing
    switch (c.mode) {
      case MODE.FLEE: {
        dx = c.x - c.threatX;
        dz = c.z - c.threatZ;
        // veer back toward home when it would run off into the wilds
        const hx = c.homeX - c.x;
        const hz = c.homeZ - c.z;
        const hd = Math.hypot(hx, hz);
        if (hd > HOME_RADIUS * 1.5) {
          const l = Math.hypot(dx, dz) || 1;
          dx = dx / l + (hx / hd) * 0.6;
          dz = dz / l + (hz / hd) * 0.6;
        }
        speed = RUN_SPEED;
        break;
      }
      case MODE.WANDER:
        dx = c.tx - c.x;
        dz = c.tz - c.z;
        speed = WALK_SPEED;
        if (Math.hypot(dx, dz) < 0.4) c.modeT = 0;
        break;
      case MODE.VISIT: {
        const p = g.players.get(c.visit);
        if (!p || !p.alive || p.zombie) {
          c.modeT = 0;
          break;
        }
        dx = p.state.x - c.x;
        dz = p.state.z - c.z;
        const d = Math.hypot(dx, dz);
        c.visitD = d;
        if (d > NOTICE_RADIUS * 1.6) c.modeT = 0; // they wandered off
        else if (d < 1.1) {
          this.arrive(c);
          face = Math.atan2(-dx, -dz);
          dx = dz = 0;
        } else {
          speed = d > 4 ? APPROACH_SPEED * 1.3 : APPROACH_SPEED;
          if (c.detourT > 0) {
            dx = c.detourX;
            dz = c.detourZ;
          }
        }
        break;
      }
      case MODE.SIT:
      case MODE.IDLE: {
        // keep an eye on a survivor it came to see
        const p = c.visit ? g.players.get(c.visit) : null;
        if (p && p.alive && !p.zombie && Math.hypot(p.state.x - c.x, p.state.z - c.z) < 4) face = Math.atan2(-(p.state.x - c.x), -(p.state.z - c.z));
        break;
      }
    }
    const len = Math.hypot(dx, dz);
    if (len > 1e-4) {
      dx /= len;
      dz /= len;
    } else speed = 0;
    this.integrate(c, dt, dx * speed, dz * speed, humans);

    // stuck on a wall, fence or the car
    if (speed > 0) {
      const sp = Math.hypot(c.vx, c.vz);
      if (sp < speed * 0.25) c.stuckT += dt;
      else c.stuckT = Math.max(0, c.stuckT - dt);
      if (c.stuckT > 1.2) {
        c.stuckT = 0;
        if (c.mode === MODE.FLEE) {
          // cornered: dart sideways
          const a = Math.atan2(c.x - c.threatX, c.z - c.threatZ) + (g.rng() < 0.5 ? 1.3 : -1.3);
          c.threatX = c.x - Math.sin(a) * 3;
          c.threatZ = c.z - Math.cos(a) * 3;
        } else if (c.mode === MODE.VISIT && c.visitD < 2.6) {
          // they're up against a wall or the car: close enough, sit here
          this.arrive(c);
        } else if (c.mode === MODE.VISIT) {
          // something in the way: step around it for a moment
          const side = g.rng() < 0.5 ? 1 : -1;
          c.detourT = 0.8 + g.rng() * 0.8;
          c.detourX = -dz * side + dx * 0.25;
          c.detourZ = dx * side + dz * 0.25;
        } else c.modeT = 0;
      }
    }

    // facing + animation
    const sp = Math.hypot(c.vx, c.vz);
    if (sp > 0.15) c.yaw = turn(c.yaw, Math.atan2(-c.vx, -c.vz), dt * (c.mode === MODE.FLEE ? 10 : 5));
    else if (face !== null) c.yaw = turn(c.yaw, face, dt * 2.5);
    c.anim = sp > 2.4 ? CANIM.RUN : sp > 0.12 ? CANIM.WALK : c.mode === MODE.SIT ? CANIM.SIT : CANIM.IDLE;
  }

  // reached the survivor it came to see: sit at their feet for a while (facing them, see SIT above)
  arrive(c) {
    c.visitCd = VISIT_COOLDOWN;
    c.mode = MODE.SIT;
    c.modeT = 5 + this.g.rng() * 8;
  }

  decide(c, humans) {
    const g = this.g;
    const prev = c.mode;
    c.stuckT = 0;
    // after a scare it stops and looks around before doing anything else
    if (prev === MODE.FLEE) {
      c.mode = MODE.IDLE;
      c.modeT = 1.5 + g.rng() * 2;
      c.visit = 0;
      return;
    }
    // curious about survivors nearby
    let near = null;
    let nd = NOTICE_RADIUS;
    for (const h of humans) {
      const d = Math.hypot(h.state.x - c.x, h.state.z - c.z);
      if (d < nd) {
        nd = d;
        near = h;
      }
    }
    const r = g.rng();
    if (near && prev !== MODE.VISIT && c.visitCd <= 0 && r < 0.6) {
      c.mode = MODE.VISIT;
      c.visit = near.id;
      c.modeT = 14;
      return;
    }
    c.visit = 0;
    if (prev !== MODE.SIT && r < 0.3) {
      c.mode = MODE.SIT;
      c.modeT = 5 + g.rng() * 9;
    } else if (prev !== MODE.IDLE && r < 0.5) {
      c.mode = MODE.IDLE;
      c.modeT = 2 + g.rng() * 3;
    } else if (this.pickWanderTarget(c)) {
      c.mode = MODE.WANDER;
      c.modeT = 16;
    } else {
      c.mode = MODE.IDLE;
      c.modeT = 1 + g.rng() * 2;
    }
  }

  // a spot a few meters away, pulled back toward home when it has strayed
  pickWanderTarget(c) {
    const g = this.g;
    const w = g.world;
    const lim = g.world.half - 6;
    const hd = Math.hypot(c.homeX - c.x, c.homeZ - c.z);
    for (let tries = 0; tries < 8; tries++) {
      let a = g.rng() * TAU;
      if (hd > HOME_RADIUS) a = Math.atan2(c.homeX - c.x, c.homeZ - c.z) + (g.rng() - 0.5) * 1.6;
      const d = 3 + g.rng() * 9;
      const x = c.x + Math.sin(a) * d;
      const z = c.z + Math.cos(a) * d;
      if (Math.abs(x) > lim || Math.abs(z) > lim) continue;
      if (w.isDeepWater(x, z) || g.nav.isBlocked(x, z)) continue;
      c.tx = x;
      c.tz = z;
      return true;
    }
    return false;
  }

  integrate(c, dt, dvx, dvz, humans) {
    const g = this.g;
    const accel = Math.min(1, dt * (Math.hypot(dvx, dvz) > 3 ? 9 : 6));
    c.vx += (dvx - c.vx) * accel;
    c.vz += (dvz - c.vz) * accel;
    if (Math.abs(c.vx) < 1e-3 && Math.abs(c.vz) < 1e-3) c.vx = c.vz = 0;
    const ox = c.x;
    const oz = c.z;
    _pos.x = c.x + c.vx * dt;
    _pos.y = c.y;
    _pos.z = c.z + c.vz * dt;
    // step around survivors (players are never pushed - keeps client prediction exact)
    for (const h of humans) {
      const ddx = _pos.x - h.state.x;
      const ddz = _pos.z - h.state.z;
      const min = RADIUS + PLAYER_RADIUS + 0.1;
      const d2 = ddx * ddx + ddz * ddz;
      if (d2 < min * min && Math.abs(h.state.y - c.y) < 1.8) {
        const d = Math.sqrt(d2) || 0.01;
        _pos.x = h.state.x + (ddx / d) * min;
        _pos.z = h.state.z + (ddz / d) * min;
      }
    }
    resolveBody(g.world, _pos, RADIUS, HEIGHT);
    if (g.world.isDeepWater(_pos.x, _pos.z)) {
      _pos.x = ox;
      _pos.z = oz;
    }
    const lim = g.world.half - 4;
    c.x = Math.max(-lim, Math.min(lim, _pos.x));
    c.z = Math.max(-lim, Math.min(lim, _pos.z));
    // actual velocity (after collisions) drives the animation and stuck detection
    c.vx = (c.x - ox) / dt;
    c.vz = (c.z - oz) / dt;
    const gy = groundAt(g.world, c.x, c.z, c.y, RADIUS);
    if (c.y > gy + 0.05) {
      c.vy -= GRAV * dt;
      c.y = Math.max(gy, c.y + c.vy * dt);
      if (c.y <= gy) c.vy = 0;
    } else {
      c.y = gy;
      c.vy = 0;
    }
  }
}
