// The wards of Mercy Clinic (shared/clinic.js), as the dead know them: who lives in the dark there and how they keep
// to it. That it is dark in there at noon is the world's business (world.darkAt): Zombies.isLit and Game.startDay
// ask it themselves, the way they ask whether something is down the mine.
import { ZTYPE } from '../shared/defs.js';
import { mulberry32 } from '../shared/rng.js';

export const WARD_DARK = 0.5; // world.darkAt from which a spot counts as in the dark (Zombies.inDark)
const HOME = 'wards'; // the dwellers' flow field on the valley's grid: the way back to the middle of the hall (nav.js)
const SHADE_DAY = 2; // the Shade of the isolation ward is there from this day on

export class Wards {
  constructor(game, zm) {
    this.g = game;
    this.zm = zm;
    this.seed = null;
    this.rng = null;
  }

  // the wards' own luck: the game's stream does not move for them
  luck() {
    if (this.seed !== this.g.seed) {
      this.seed = this.g.seed;
      this.rng = mulberry32(this.seed ^ 0xd3e11);
    }
    return this.rng;
  }

  // The dead that live in the wards: one to a den (world.clinic.dens), topped up at every sunrise as the mine's
  // are. Not while a survivor is in the dark to see them appear.
  stock(humans) {
    const g = this.g;
    const c = g.world.clinic;
    if (!c || humans.some((h) => g.world.darkAt(h.state.x, h.state.y + 1, h.state.z) > 0)) return 0;
    const own = g.rng;
    g.rng = this.luck(); // (Zombies.spawn rolls a body's looks and timers from the game's)
    let n = 0;
    for (const d of c.dens) {
      if (d.kind === 2 && g.day < SHADE_DAY) continue;
      // (its dweller is still about, and not one the sunrise has just caught outside)
      if (g.zombies.some((z) => z.ward && !z.dead && z.burning <= 0 && !z.onFire && Math.hypot(z.homeX - d.x, z.homeZ - d.z) < 0.5)) continue;
      // (given with its floor, as a spot down the mine is: from above, the ground here is the roof)
      const z = this.zm.spawn(d.kind === 2 ? ZTYPE.SHADE : ZTYPE.WALKER, d.x, d.z, { y: d.y, hpMul: 1.1 + 0.05 * g.day });
      if (!z) continue;
      z.ward = true; // it lives in the wards: it keeps to them (steer), and is not one of the day's wanderers
      z.under = false;
      // (a crawler from the start: both legs gone, as Combat.hitLeg leaves them)
      if (d.kind === 1 && z.legHp) {
        z.legs = 3;
        z.legHp = [0, 0];
      }
      n++;
    }
    g.rng = own;
    return n;
  }

  // Where a dweller with nobody to chase and nothing to listen for goes: about the wards from one standing spot to
  // another it has a clear walk to, or, led out into the day and left there, back by the valley's flow field to the
  // hall. Writes the way into out ({ x, z }, both 0: it stays put); false on a map without the clinic.
  steer(z, out) {
    const g = this.g;
    const c = g.world.clinic;
    if (!c) return false;
    out.x = out.z = 0;
    const inside = g.world.darkAt(z.x, z.y + 1, z.z) >= WARD_DARK;
    if (!inside) z.wardBack = true;
    if (z.wardBack) {
      const dx = c.home.x - z.x;
      const dz = c.home.z - z.z;
      if (inside && dx * dx + dz * dz < 4) z.wardBack = false;
      else {
        g.nav.computeField(HOME, c.home.x, c.home.z); // (the field already there, unless something was built since)
        if (!g.nav.flowDir(HOME, z.x, z.z, out, z.y)) {
          out.x = dx;
          out.z = dz;
        }
        return true;
      }
    }
    const rng = this.luck();
    if (!(g.time < z.wardT)) {
      z.wardT = g.time + 6 + rng() * 10;
      z.wardGo = false;
      for (let tries = 0; tries < 4 && !z.wardGo; tries++) {
        const s = c.roam[Math.floor(rng() * c.roam.length)];
        if (Math.hypot(s.x - z.x, s.z - z.z) < 1 || !g.nav.segClear(z.x, z.z, s.x, s.z)) continue;
        z.wardX = s.x;
        z.wardZ = s.z;
        z.wardGo = true;
      }
    }
    if (z.wardGo) {
      out.x = z.wardX - z.x;
      out.z = z.wardZ - z.z;
      if (out.x * out.x + out.z * out.z < 0.5) {
        z.wardGo = false;
        out.x = out.z = 0;
      }
    }
    return true;
  }
}
