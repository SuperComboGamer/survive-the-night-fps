// RPG grenades of our own in flight. Everyone else's is the server's projectile (PROJ.ROCKET), drawn where it is
// replicated (entities.js). Ours is flown here from the moment it is fired, the way the server flies it
// (Combat.launch, updateProjectiles: from the eye, along the aim, at the same speed and with the same drop), so it
// leaves the tube at once and not a round trip later; the server's copy of it is not drawn. It is drawn leaving the
// muzzle and closing onto the line it really flies along within its first few metres. It ends where it strikes the
// world or one of the dead as they are drawn, or where the server says it burst (burst), whichever comes first. The
// blast itself is always the server's (EVT.EXPLOSION).
import { ENT, PFLAG } from '../../shared/protocol.js';
import { PROJ, ZANIM, ZOMBIE_DEFS } from '../../shared/defs.js';
import { rocketStrikesWorld } from '../../shared/rocket.js';
import { zombieHitbox, playerHitbox, rayHitbox } from '../../shared/hitbox.js';
import { deerHitbox } from '../../shared/deer.js';
import { createProjectile } from '../render/models/misc.js';

const _ray = { t: -1, col: null, terrain: false };
const _pos = { x: 0, y: 0, z: 0 };
const CLOSE = 0.12; // s: how fast the drawn grenade closes from the muzzle onto its line of flight
// a blast the server reports this close to the line one of ours is flying along (m), and no more than this far ahead
// of it or behind it, is that one going off
const BURST_OFF = 3;
const BURST_AHEAD = 25;
const BURST_BEHIND = 4;

export class RocketsClient {
  constructor(game) {
    this.g = game;
    this.list = [];
  }

  // Fired: from the eye (x,y,z) along (dx,dy,dz), with the weapon's rocket speed and drop; (mx,my,mz) is the muzzle
  // as drawn
  fire(def, x, y, z, dx, dy, dz, mx, my, mz) {
    const g = this.g;
    const r = def.rocket;
    const obj = createProjectile(PROJ.ROCKET);
    obj.position.set(mx, my, mz);
    obj.lookAt(mx + dx, my + dy, mz + dz);
    g.scene.add(obj);
    this.list.push({
      x,
      y,
      z,
      vx: dx * r.speed,
      vy: dy * r.speed,
      vz: dz * r.speed,
      grav: r.grav,
      sx: x, // where it was fired from
      sy: y,
      sz: z,
      range: def.range,
      t: 0,
      ox: mx - x, // the muzzle's offset from the eye, closed over CLOSE
      oy: my - y,
      oz: mz - z,
      obj,
      loop: g.audio.createLoop?.('rocket', mx, my, mz),
    });
  }

  // The server says a blast went off at (x,y,z): a grenade of ours flying at it is the one that went off. It may not
  // quite be there yet (a link that jitters is drawn further behind) or have gone past what it struck: its trail is
  // drawn on to the blast
  burst(x, y, z) {
    let best = -1;
    let bd = Infinity;
    this.list.forEach((k, i) => {
      const v = Math.hypot(k.vx, k.vy, k.vz) || 1;
      const rx = x - k.x;
      const ry = y - k.y;
      const rz = z - k.z;
      const along = (rx * k.vx + ry * k.vy + rz * k.vz) / v;
      const off = Math.sqrt(Math.max(0, rx * rx + ry * ry + rz * rz - along * along));
      if (off < BURST_OFF && along > -BURST_BEHIND && along < BURST_AHEAD && Math.abs(along) < bd) {
        bd = Math.abs(along);
        best = i;
      }
    });
    if (best < 0) return;
    const k = this.list[best];
    const o = k.obj.position;
    if (bd > 0.5) this.g.effects.rocketTrail(o.x, o.y, o.z, x, y, z, k.sx, k.sy, k.sz);
    this.end(best);
  }

  update(dt) {
    const g = this.g;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const k = this.list[i];
      k.t += dt;
      const ox = k.x;
      const oy = k.y;
      const oz = k.z;
      k.vy -= k.grav * dt;
      const nx = ox + k.vx * dt;
      const ny = oy + k.vy * dt;
      const nz = oz + k.vz * dt;
      const len = Math.hypot(nx - ox, ny - oy, nz - oz) || 1e-6;
      const dx = (nx - ox) / len;
      const dy = (ny - oy) / len;
      const dz = (nz - oz) / len;
      const wt = rocketStrikesWorld(g.world, ox, oy, oz, dx, dy, dz, len, _ray);
      const tHit = this.strike(ox, oy, oz, dx, dy, dz, wt >= 0 ? wt : len);
      k.x = ox + dx * tHit;
      k.y = oy + dy * tHit;
      k.z = oz + dz * tHit;
      // drawn: off the muzzle and onto the line of flight; its nose along the way it went this frame
      const f = Math.exp(-k.t / CLOSE);
      const px = k.x + k.ox * f;
      const py = k.y + k.oy * f;
      const pz = k.z + k.oz * f;
      const o = k.obj.position;
      if (Math.hypot(px - o.x, py - o.y, pz - o.z) > 1e-4) {
        g.effects.rocketTrail(o.x, o.y, o.z, px, py, pz, k.sx, k.sy, k.sz);
        k.obj.lookAt(px * 2 - o.x, py * 2 - o.y, pz * 2 - o.z);
      }
      o.set(px, py, pz);
      k.loop?.setPosition(px, py, pz);
      if (wt >= 0 || tHit < len || Math.hypot(k.x - k.sx, k.z - k.sz) > k.range) this.end(i);
    }
  }

  // How far along the segment from (ox,oy,oz) the grenade strikes one of the dead (a deer, a survivor turned) where
  // they are drawn, short of tHit; tHit if it strikes none. (The targets are the ones predictPellet judges a shot by)
  strike(ox, oy, oz, dx, dy, dz, tHit) {
    const g = this.g;
    for (const e of g.entities.ents.values()) {
      const zdef = e.kind === ENT.ZOMBIE ? ZOMBIE_DEFS[e.ztype] : null;
      const deer = e.kind === ENT.DEER;
      if (zdef || deer ? e.dead : e.kind !== ENT.PLAYER || e.id === g.myId || (e.q[5] & (PFLAG.ZOMBIE | PFLAG.DEAD)) !== PFLAG.ZOMBIE) continue;
      const rx = e.rx - ox;
      const rz = e.rz - oz;
      if (rx * rx + rz * rz > (tHit + 4) * (tHit + 4)) continue;
      const hb = deer ? deerHitbox(e.ryaw, e.q[4]) : zdef ? zombieHitbox(zdef, e.ryaw, e.q[7], e.q[4] === ZANIM.AIRBORNE) : playerHitbox(true, !!(e.q[5] & PFLAG.CROUCH));
      _pos.x = e.rx;
      _pos.y = e.ry;
      _pos.z = e.rz;
      const t = rayHitbox(_pos, hb, ox, oy, oz, dx, dy, dz, tHit);
      if (t >= 0 && t < tHit) tHit = t;
    }
    return tHit;
  }

  end(i) {
    const k = this.list[i];
    this.g.scene.remove(k.obj);
    k.loop?.stop();
    this.list.splice(i, 1);
  }

  clear() {
    while (this.list.length) this.end(this.list.length - 1);
  }
}
