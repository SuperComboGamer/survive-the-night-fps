// Combat: lag-compensated hitscan, melee, thrown/lobbed projectiles, explosions, damage areas.
import { SERVER_TICK_RATE, MAX_REWIND, HISTORY_TICKS, PLAYER_RADIUS, PLAYER_HEIGHT, PLAYER_CROUCH_HEIGHT, EYE_HEIGHT, PHASE, NOISE } from '../shared/constants.js';
import { LEG_ZONE, LEG_BODY_DAMAGE, STUMBLE_TIME } from '../shared/constants.js';
import { SOUND as _SOUND } from '../shared/defs.js';
import {
  ITEM,
  WEAPONS,
  CLAWS,
  THROWABLES,
  ZTYPE,
  ZOMBIE_DEFS,
  ZANIM,
  SOUND,
  EVT,
  IMPACT,
  KILLER,
  PROJ,
  AREA,
  ZOMBIE_LOOT,
  SPECIAL_LOOT,
  STRUCT,
  STRUCT_DEFS,
  GIB,
  BURN,
} from '../shared/defs.js';
import { ENT, qpos, qangle16, qpitch } from '../shared/protocol.js';
import { shotDirections, eyeHeight } from '../shared/playersim.js';
import { raycastWorld, raySphere, groundAt, footprintContains, canReach, COL } from '../shared/collision.js';
import { playerHitbox, zombieHitbox, rayHitbox, headHit } from '../shared/hitbox.js';
import { deerHitbox } from '../shared/deer.js';

const _ray = { t: -1, col: null, terrain: false };
const _dirs = new Float32Array(3 * 16);
const _hits = [];
const _bp = { x: 0, y: 0, z: 0 };

// buckshot loses its punch with distance
const pelletFalloff = (t) => Math.max(0.25, Math.min(1, 1 - (t - 8) / 30));

export class Combat {
  constructor(game) {
    this.g = game;
  }

  // absolute (fractional) tick the shooter was looking at when it fired
  rewindTime(p) {
    const g = this.g;
    const back = (g.tick - p.renderTick) & 0xffff;
    let t = g.tick - back + p.renderFrac;
    const minT = g.tick - MAX_REWIND * SERVER_TICK_RATE;
    if (t < minT) t = minT;
    if (t > g.tick) t = g.tick;
    return t;
  }

  histPos(e, t, out) {
    const g = this.g;
    const t0 = Math.floor(t);
    const f = t - t0;
    if (t0 >= g.tick) {
      out.x = e.x;
      out.y = e.y;
      out.z = e.z;
      return out;
    }
    const a = t0 & (HISTORY_TICKS - 1);
    const b = (t0 + 1) & (HISTORY_TICKS - 1);
    const bx = t0 + 1 >= g.tick ? e.x : e.hx[b];
    const by = t0 + 1 >= g.tick ? e.y : e.hy[b];
    const bz = t0 + 1 >= g.tick ? e.z : e.hz[b];
    out.x = e.hx[a] + (bx - e.hx[a]) * f;
    out.y = e.hy[a] + (by - e.hy[a]) * f;
    out.z = e.hz[a] + (bz - e.hz[a]) * f;
    return out;
  }

  // targets a player can damage (friendly fire off)
  forTargets(p, fn) {
    const g = this.g;
    if (p.zombie) {
      for (const h of g.players.values()) if (h.alive && !h.zombie && h !== p) fn(h, true);
      return;
    }
    for (const z of g.zombies) if (!z.dead) fn(z, false);
    for (const d of g.deer) if (!d.dead) fn(d, false); // (deer.js: a survivor can hunt them; damageZombie hands the hit on)
    for (const h of g.players.values()) if (h.alive && h.zombie) fn(h, true);
  }

  // hitbox params for a target: a body cylinder plus a head sphere (hx/hz ahead of it on quadrupeds). The shapes
  // are in shared/hitbox.js: the client judges its own shots against them too, to show what they strike at once
  hitbox(e, isPlayer) {
    if (isPlayer) return playerHitbox(e.zombie, e.state.crouch);
    if (e.kind === ENT.DEER) return deerHitbox(e.yaw, e.anim);
    return zombieHitbox(e.def, e.yaw, e.legs, e.anim === ZANIM.AIRBORNE || e.state === 3);
  }

  // ---------------------------------------------------------------- guns
  fire(p, ev) {
    const g = this.g;
    const def = ev.def || WEAPONS[ev.weapon]; // (ev.def: a gun that is no item brings its own row, the mounted gun)
    if (!def) return;
    const n = shotDirections(ev.yaw, ev.pitch, ev.recoilPitch, ev.spread, def.pellets, ev.seed, _dirs);
    const ox = ev.x;
    const oy = ev.y;
    const oz = ev.z;
    // broadcast the shot to everyone else (tracers, muzzle flash, sound)
    g.emit(
      (w) => {
        // no origin: the client takes the shooter's replicated position (it only draws tracers from this)
        w.u8(EVT.SHOT);
        w.u16(p.id);
        w.u8(ev.weapon);
        w.u16(qangle16(ev.yaw));
        w.i16(qpitch(ev.pitch));
        w.u16(ev.seed);
        w.u8(Math.min(255, Math.round(ev.spread * 500)));
        w.u8(Math.min(255, Math.round(ev.recoilPitch * 500)));
      },
      { except: p.id, x: ox, z: oz, r: 320 },
    );
    // the dead come to the noise
    g.zm.noise(ox, oz, def.noise || NOISE.GUNSHOT, p.state.y);
    if (def.flame) return this.flame(p, ev, def);
    const t = this.rewindTime(p);
    let hitFlags = 0;
    const tmp = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < n; i++) {
      const dx = _dirs[i * 3];
      const dy = _dirs[i * 3 + 1];
      const dz = _dirs[i * 3 + 2];
      raycastWorld(g.world, ox, oy, oz, dx, dy, dz, def.range, _ray);
      const wallT = _ray.t >= 0 ? _ray.t : def.range;
      const wallCol = _ray.col;
      const wallTerrain = _ray.terrain;
      _hits.length = 0;
      this.forTargets(p, (e, isPlayer) => {
        const pos = this.histPos(e, t, tmp);
        const hb = this.hitbox(e, isPlayer);
        // broad reject by distance from ray
        const rx = pos.x - ox;
        const ry = pos.y + hb.headY * 0.5 - oy;
        const rz = pos.z - oz;
        const along = rx * dx + ry * dy + rz * dz;
        if (along < -1 || along > wallT + 2) return;
        const px = rx - dx * along;
        const py = ry - dy * along;
        const pz = rz - dz * along;
        const lim = hb.r + hb.headY + 0.5;
        if (px * px + py * py + pz * pz > lim * lim) return;
        const tt = rayHitbox(pos, hb, ox, oy, oz, dx, dy, dz, wallT);
        if (tt < 0) return;
        // below the hip it is in a leg: the left or the right by which side of the body it struck
        let leg = 0;
        if (!isPlayer && !headHit && this.legZone(e, pos.y, oy + dy * tt)) leg = (ox + dx * tt - pos.x) * Math.cos(e.yaw) - (oz + dz * tt - pos.z) * Math.sin(e.yaw) < 0 ? 1 : 2;
        _hits.push({ e, isPlayer, t: tt, head: headHit, leg });
      });
      _hits.sort((a, b) => a.t - b.t);
      const maxPierce = def.pierce || 1;
      let pierced = 0;
      let dmg = def.damage;
      for (const h of _hits) {
        if (pierced >= maxPierce) break;
        let d = dmg;
        if (def.pellets > 1) d *= pelletFalloff(h.t);
        const headMul = h.head ? (h.isPlayer ? 2 : h.e.boss ? 1.6 : def.headMul) : 1;
        d *= headMul;
        const hx = ox + dx * h.t;
        const hy = oy + dy * h.t;
        const hz = oz + dz * h.t;
        const green = !h.isPlayer && (h.e.ztype === ZTYPE.SPITTER || h.e.ztype === ZTYPE.BOOMER || h.e.ztype === ZTYPE.BOSS_HIVEQUEEN);
        // a shade frozen by light is hard as stone: bullets chip it instead of drawing blood
        g.impact(h.e.lit ? IMPACT.DIRT : green ? IMPACT.GREEN_BLOOD : IMPACT.BLOOD, hx, hy, hz, -dx, -dy, -dz);
        let killed;
        if (h.isPlayer) {
          g.damagePlayer(h.e, d, { kind: KILLER.PLAYER, id: p.id, weapon: ev.weapon, headshot: h.head, x: ox, z: oz });
          killed = !h.e.alive;
        } else {
          // a shot in the leg wears the leg down (hitLeg), and only a share of it is the body's
          if (h.leg) {
            this.hitLeg(h.e, d, h.leg, dx, dz);
            d *= LEG_BODY_DAMAGE;
          }
          // a blast kills with its first few pellets: the blow is all of them, the ones still to come are the overkill
          const lethal = def.pellets > 1 && d >= h.e.hp;
          const blow = lethal ? this.blastDamage(h.e, t, def, 0, n, ox, oy, oz) : d;
          const rest = lethal ? this.blastDamage(h.e, t, def, i + 1, n, ox, oy, oz) : 0;
          killed = this.damageZombie(h.e, d, p, { weapon: ev.weapon, headshot: h.head, leg: !!h.leg, dirX: dx, dirZ: dz, blow, rest });
        }
        hitFlags |= 8 | (h.head ? 1 : 0) | (killed ? 2 : 0);
        pierced++;
        dmg *= 0.7;
      }
      if (pierced < maxPierce || _hits.length === 0) {
        if (_hits.length === 0 && _ray.t >= 0) {
          const hx = ox + dx * wallT;
          const hy = oy + dy * wallT;
          const hz = oz + dz * wallT;
          let kind = IMPACT.DIRT;
          if (wallCol && !wallTerrain) {
            if (wallCol.flags & COL.TREE) kind = IMPACT.WOOD;
            else if (wallCol.flags & COL.STRUCT) kind = this.g.ents[wallCol.id]?.stype === STRUCT.METAL_WALL ? IMPACT.METAL : IMPACT.WOOD;
            else kind = IMPACT.SPARK;
          }
          // only a few impacts for shotgun spreads to save bandwidth
          if (def.pellets === 1 || i % 3 === 0) g.impact(kind, hx, hy, hz, -dx, -dy, -dz);
        }
      }
    }
    if (hitFlags) {
      g.emit(
        (w) => {
          w.u8(EVT.HITMARK);
          w.u8(hitFlags);
        },
        { to: p.id },
      );
    }
  }

  // What a blast's pellets from index `from` on put into a zombie, were it to stand through all of them. It dies to
  // the first few and the rest fly on through the corpse, but they are what makes a point-blank blast overkill.
  // Cover in the way is not checked.
  blastDamage(z, t, def, from, n, ox, oy, oz) {
    const pos = this.histPos(z, t, _bp);
    const hb = this.hitbox(z, false);
    let sum = 0;
    for (let j = from; j < n; j++) {
      const tt = rayHitbox(pos, hb, ox, oy, oz, _dirs[j * 3], _dirs[j * 3 + 1], _dirs[j * 3 + 2], def.range);
      if (tt < 0) continue;
      const leg = !headHit && this.legZone(z, pos.y, oy + _dirs[j * 3 + 1] * tt);
      sum += def.damage * pelletFalloff(tt) * (headHit ? (z.boss ? 1.6 : def.headMul) : leg ? LEG_BODY_DAMAGE : 1);
    }
    return sum;
  }

  // ---------------------------------------------------------------- legs
  // Does a bullet that struck this zombie's body at height y (its feet at feetY) go into a leg? Only what walks on two
  // (ZOMBIE_DEFS[t].legs) and still has one: below the hip is leg, and a crawler has none left to hit.
  legZone(z, feetY, y) {
    return z.kind === ENT.ZOMBIE && !!z.def.legs && z.legs !== 3 && y < feetY + z.def.height * LEG_ZONE;
  }

  // A bullet in a leg (bit: 1 the left, 2 the right; with that one gone already the other takes it). The leg takes
  // all of it, and worn down to nothing it is blown off (EVT.ZOMBIE_LEG, replicated as ZF.LEGS): on one leg the
  // zombie hobbles, on none it crawls (Zombies.updateOne), for good. Any hit trips it (ZANIM.STUMBLE) and costs it
  // the swing it had started, unless it is in the middle of a special. A shade pinned by light is as hard in the
  // leg as anywhere else, and does not trip. Returns the bit of the leg this hit took off.
  hitLeg(z, amount, bit, dirX = 0, dirZ = 0) {
    const g = this.g;
    if (z.dead || !z.legHp || z.legs === 3) return 0;
    const solid = z.lit && !z.onFire;
    if (solid) amount *= z.def.litResist;
    if (z.legs & bit) bit ^= 3;
    const i = bit >> 1;
    z.legHp[i] -= amount;
    let off = 0;
    if (z.legHp[i] <= 0) {
      off = bit;
      z.legs |= bit;
      const yaw = Math.atan2(-dirX, -dirZ);
      g.emit(
        (w) => {
          w.u8(EVT.ZOMBIE_LEG);
          w.u16(z.id);
          w.u8(off);
          w.u8(Math.round(((yaw % (Math.PI * 2)) / (Math.PI * 2)) * 256) & 255);
        },
        { x: z.x, z: z.z, r: 130 },
      );
    }
    if (z.state === 0 && !solid) {
      z.stumbleT = STUMBLE_TIME;
      z.anim = ZANIM.STUMBLE;
      z.animT = STUMBLE_TIME;
      z.pendingHit = 0;
      z.attackCd = Math.max(z.attackCd, STUMBLE_TIME);
    }
    return off;
  }

  // ---------------------------------------------------------------- flamethrower
  // One puff of the stream: everything in a cone ahead of the nozzle that no wall shields is scorched and set alight.
  flame(p, ev, def) {
    const g = this.g;
    const ox = ev.x;
    const oy = ev.y;
    const oz = ev.z;
    const cp = Math.cos(ev.pitch);
    const dx = -Math.sin(ev.yaw) * cp;
    const dy = Math.sin(ev.pitch);
    const dz = -Math.cos(ev.yaw) * cp;
    const widen = Math.tan(def.flame.cone);
    const t = this.rewindTime(p);
    const tmp = { x: 0, y: 0, z: 0 };
    _hits.length = 0;
    this.forTargets(p, (e, isPlayer) => {
      const pos = this.histPos(e, t, tmp);
      const hb = this.hitbox(e, isPlayer);
      const rx = pos.x - ox;
      const rz = pos.z - oz;
      const flat = Math.hypot(rx, rz);
      if (flat > def.range + hb.r) return;
      // the point of the body nearest the stream: at the height the stream passes it, kept between feet and head
      const lo = pos.y + (hb.flying ? -0.1 : 0.15);
      const hi = pos.y + (hb.flying ? 0.4 : hb.top + hb.headR);
      const ry = Math.max(lo, Math.min(hi, oy + (dy / Math.max(cp, 0.2)) * flat)) - oy;
      const along = rx * dx + ry * dy + rz * dz;
      if (along < -hb.r || along > def.range + hb.r) return;
      const off = Math.hypot(rx - dx * along, ry - dy * along, rz - dz * along);
      if (off > hb.r + 0.15 + Math.max(0, along) * widen) return;
      // nothing solid in between
      const l = Math.hypot(rx, ry, rz);
      if (l > hb.r + 0.3) {
        raycastWorld(g.world, ox, oy, oz, rx / l, ry / l, rz / l, l, _ray);
        if (_ray.t >= 0 && _ray.t < l - hb.r - 0.3) return;
      }
      _hits.push({ e, isPlayer, t: along });
    });
    let hitFlags = 0;
    for (const h of _hits) {
      // the far third of the stream is thinner
      const d = def.damage * (1 - 0.6 * Math.max(0, Math.min(1, (h.t / def.range - 0.65) / 0.35)));
      let killed;
      if (h.isPlayer) {
        g.damagePlayer(h.e, d, { kind: KILLER.PLAYER, id: p.id, weapon: ev.weapon, x: ox, z: oz });
        killed = !h.e.alive;
      } else {
        killed = this.damageZombie(h.e, d, p, { weapon: ev.weapon, fire: true, dot: true, dirX: dx, dirZ: dz });
        this.ignite(h.e, p, ev.weapon);
      }
      hitFlags |= 8 | (killed ? 2 : 0);
    }
    // a stream is many puffs a second: tick the hit marker a few times a second, and for every kill
    if (hitFlags && (hitFlags & 2 || g.tick - (p.flameMarkTick || 0) >= 4)) {
      p.flameMarkTick = g.tick;
      g.emit(
        (w) => {
          w.u8(EVT.HITMARK);
          w.u8(hitFlags);
        },
        { to: p.id },
      );
    }
  }

  // Set a zombie alight (the BURN status): it burns for `time` seconds, the damage and the kill going to whoever
  // lit it. Fire on something already burning tops the time back up; it does not stack.
  ignite(z, attacker, weapon = 0, time = BURN.time) {
    if (z.dead) return;
    if (time > z.burnT) z.burnT = time;
    if (attacker && attacker.kind === ENT.PLAYER) {
      z.burnBy = attacker.id;
      z.burnWeapon = weapon;
    }
  }

  // ---------------------------------------------------------------- melee
  melee(p, ev) {
    const g = this.g;
    const s = p.state;
    const claws = p.zombie;
    const def = claws ? CLAWS : WEAPONS[ev.weapon];
    if (!def) return;
    const range = def.range;
    const ox = s.x;
    const oy = s.y + eyeHeight(s);
    const oz = s.z;
    const cp = Math.cos(s.pitch);
    const fx = -Math.sin(s.yaw) * cp;
    const fy = Math.sin(s.pitch);
    const fz = -Math.cos(s.yaw) * cp;
    const t = this.rewindTime(p);
    const tmp = { x: 0, y: 0, z: 0 };
    let best = null;
    let bestScore = Infinity;
    const heavy = ev.heavy;
    const maxTargets = ev.weapon === ITEM.BAT || ev.weapon === ITEM.SPIKED_BAT || ev.weapon === ITEM.MACHETE ? 2 : 1;
    const cands = [];
    this.forTargets(p, (e, isPlayer) => {
      const pos = this.histPos(e, t, tmp);
      const hb = this.hitbox(e, isPlayer);
      const dx = pos.x - ox;
      const dz = pos.z - oz;
      const dist = Math.hypot(dx, dz) - hb.r;
      if (dist > range) return;
      const ty = Math.max(pos.y + 0.2, Math.min(pos.y + hb.headY, oy));
      if (Math.abs(ty - oy) > 2.2) return;
      const l = Math.hypot(dx, dz) || 1;
      const dot = (dx / l) * (-Math.sin(s.yaw)) + (dz / l) * -Math.cos(s.yaw);
      if (dot < 0.45 && dist > 0.3) return;
      // head if aiming at head height
      const hd = raySphere(pos.x + hb.hx, pos.y + hb.headY, pos.z + hb.hz, hb.headR * 1.4, ox, oy, oz, fx, fy, fz, range + hb.r);
      cands.push({ e, isPlayer, score: dist - dot, head: hd >= 0 && !hb.flying, x: pos.x, y: pos.y + Math.min(hb.headY, 1.3), z: pos.z, feet: pos.y, r: hb.r });
    });
    cands.sort((a, b) => a.score - b.score);
    let hitAny = false;
    let hitFlags = 0;
    // the nearest ones with nothing solid in the way (tested best first, so a swing costs a ray or two, not one per zombie in reach)
    for (let i = 0, n = 0; i < cands.length && n < maxTargets; i++) {
      const c = cands[i];
      if (!this.meleeClear(p, c, ox, oy, oz)) continue;
      n++;
      let dmg = claws ? CLAWS.damage : heavy ? def.altDamage : def.damage;
      if (c.head) dmg *= def.headMul;
      hitAny = true;
      g.impact(c.e.lit ? IMPACT.DIRT : IMPACT.BLOOD, c.x, c.y, c.z, -fx, 0, -fz);
      let killed;
      if (c.isPlayer) {
        g.damagePlayer(c.e, dmg, { kind: KILLER.PLAYER, id: p.id, weapon: claws ? 0 : ev.weapon, headshot: c.head, x: ox, z: oz });
        killed = !c.e.alive;
      } else {
        killed = this.damageZombie(c.e, dmg, p, { weapon: ev.weapon, headshot: c.head, melee: true, dirX: fx, dirZ: fz, knock: def.knock || 0 });
      }
      hitFlags |= 8 | (c.head ? 1 : 0) | (killed ? 2 : 0);
    }
    if (hitAny) {
      g.sound(SOUND.MELEE_HIT, ox + fx, oy, oz + fz, 25);
      g.emit(
        (w) => {
          w.u8(EVT.HITMARK);
          w.u8(hitFlags);
        },
        { to: p.id },
      );
    } else {
      // hit a structure/world surface? trees give sticks & planks, wrecks give scrap
      raycastWorld(g.world, ox, oy, oz, fx, fy, fz, range + 0.3, _ray);
      if (_ray.t >= 0) {
        const col = _ray.col;
        const hx = ox + fx * _ray.t;
        const hy = oy + fy * _ray.t;
        const hz = oz + fz * _ray.t;
        const tree = col && col.flags & COL.TREE;
        const wreck = col && col.flags & COL.SALVAGE;
        g.impact(tree ? IMPACT.WOOD : wreck ? IMPACT.SPARK : col && col.flags & COL.STRUCT ? IMPACT.WOOD : IMPACT.DIRT, hx, hy, hz, -fx, -fy, -fz);
        if (!claws && (tree || wreck)) g.gatherHit(p, col, hx, hy, hz, ev.weapon);
      }
    }
    g.sound(claws ? SOUND.ZPLAYER_GROWL : SOUND.MELEE_SWING, ox, oy, oz, 20, p.id);
  }

  // Is a swing's line to a target (a candidate of Combat.melee) open? No swing goes through a wall.
  // A survivor strikes from the eye at the upper body, by the rule their hands already follow (canReach): over what
  // stands no higher than eye height above the lower of the two - barricades, sills, fences, car hoods - and through
  // what survivors walk through (gates, door boards). Measured from the lower one, so a jump does not clear a wall.
  // A player-zombie's claws get the rule of the AI dead (Zombies.canReach): chest to chest, stopped by anything
  // solid, barricades included, and by door boards and gates unless the victim is standing in them.
  meleeClear(p, c, ox, oy, oz) {
    const g = this.g;
    const s = p.state;
    // (the line stops at the body's near side, but never more than 0.6 m short of its centre: the big ones are held
    // 0.65 m off a wall and are wider than that, so a tank or a boss leaning on the far side would be in reach)
    if (!p.zombie) return canReach(g.world, ox, oy, oz, c.x, c.y, c.z, Math.min(s.y, c.feet) + EYE_HEIGHT, Math.min(c.r, 0.6));
    const vs = c.e.state;
    const cy = s.y + (s.crouch ? PLAYER_CROUCH_HEIGHT : PLAYER_HEIGHT) * 0.55;
    let dx = c.x - ox;
    let dy = c.feet + (vs.downed ? 0.3 : vs.crouch ? 0.6 : 0.9) - cy;
    let dz = c.z - oz;
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l;
    dy /= l;
    dz /= l;
    raycastWorld(g.world, ox, cy, oz, dx, dy, dz, l, _ray);
    const col = _ray.col;
    return !col || !!(col.flags & COL.HUMANPASS && footprintContains(col, c.x, c.z));
  }

  // ---------------------------------------------------------------- damage
  // returns true if killed
  damageZombie(z, amount, attacker, opts = {}) {
    const g = this.g;
    if (z.dead) return false;
    if (z.kind === ENT.DEER) return g.dm.damage(z, amount, attacker, opts); // not one of the dead: nothing below is for it
    // a shade pinned by light shrugs off most of what hits it and cannot be shoved (the dawn sun still burns it)
    const solid = z.lit && !z.onFire;
    if (solid) amount *= z.def.litResist;
    z.hp -= amount;
    if (z.link) {
      z.linkDmg += amount;
      if (opts.melee && z.ztype === ZTYPE.LEAPER) g.zm.releaseLink(z);
    }
    if (attacker) {
      z.aggroId = attacker.id;
      z.aggroT = 15;
      if (!z.target) {
        z.target = attacker.id;
        if (z.pack && !attacker.zombie) g.zm.alertPack(z); // shoot one dog and the whole pack comes
      }
    }
    if (solid) {
      // stone still: no knockback, no stagger
    } else if (opts.knock && !z.boss && z.ztype !== ZTYPE.TANK) {
      z.kx += (opts.dirX || 0) * opts.knock * 1.6;
      z.kz += (opts.dirZ || 0) * opts.knock * 1.6;
      if (opts.knock >= 3 && z.state === 0) {
        z.anim = ZANIM.STAGGER;
        z.animT = 0.45;
        z.pendingHit = 0;
      }
    } else if (!z.boss && z.ztype !== ZTYPE.TANK && !opts.leg && amount > 40 && z.state === 0 && g.rng() < 0.4) {
      z.anim = ZANIM.STAGGER;
      z.animT = 0.3;
    }
    if (z.hp <= 0) {
      // overkill (GIB): one heavy blow that drives it far below zero blows the body apart. Blades and clubs don't.
      // opts.blow / opts.rest: for a blast, whose pellets land one by one - all of it, and what was still to come
      const rest = opts.rest || 0;
      const gib = !solid && !opts.melee && (opts.blow || amount) >= GIB.minHit && rest - z.hp >= z.maxHp * GIB.overkill;
      this.killZombie(z, attacker, gib ? { ...opts, gib } : opts);
      return true;
    }
    // (a burn or a flame stream is many small hits a second: it cries out as often as it would for one)
    if (g.rng() < (opts.dot ? 0.02 : 0.15)) g.sound(z.ztype === ZTYPE.DOG ? SOUND.DOG_YELP : SOUND.ZOMBIE_PAIN, z.x, z.y + z.def.headY, z.z, 30);
    return false;
  }

  killZombie(z, attacker, opts = {}) {
    const g = this.g;
    if (z.dead) return;
    z.dead = true;
    z.hp = 0;
    z.deadT = 0;
    z.anim = ZANIM.DEAD;
    z.vx = z.vz = 0;
    g.zm.releaseLink(z);
    z.link = 0;
    const flags = (opts.headshot ? 1 : 0) | (opts.fire ? 2 : 0) | (opts.explode || z.ztype === ZTYPE.BOOMER ? 4 : 0) | (opts.gib ? 8 : 0);
    const yaw = Math.atan2(-(opts.dirX || 0), -(opts.dirZ || 0));
    g.emit(
      (w) => {
        w.u8(EVT.ZOMBIE_DIE);
        w.u16(z.id);
        w.u8(Math.round(((yaw % (Math.PI * 2)) / (Math.PI * 2)) * 256) & 255);
        w.u8(flags);
      },
      { x: z.x, z: z.z, r: 130 },
    );
    if (!opts.fire && !opts.gib) g.sound(z.boss ? SOUND.BOSS_ROAR : z.ztype === ZTYPE.DOG ? SOUND.DOG_YELP : SOUND.ZOMBIE_DEATH, z.x, z.y + Math.min(1.5, z.def.height), z.z, z.boss ? 150 : 35);
    if (g.phase === PHASE.NIGHT || g.escape?.active) g.nightStats.kills++;
    // a boss still standing when the dawn sun sets it alight is the sun's kill, whoever lands the last blow: what it
    // carried burns with it. Its loot is for the team that brings it down before sunrise (a molotov or the
    // flamethrower is burnT, not onFire: that still pays out)
    const sunKill = z.boss && z.onFire;
    if (attacker && attacker.kind === ENT.PLAYER) {
      attacker.zkills++;
      g.credit([attacker], 'kills');
      if (!z.def.common && !sunKill) {
        g.killfeed(KILLER.PLAYER, attacker.id, 0x8000 | z.ztype, opts.weapon || 0, opts.headshot ? 1 : 0);
      }
      g.playersDirty = g.playersDirty || g.tick % 10 === 0;
    }
    if (sunKill) g.killfeed(KILLER.WORLD, 0, 0x8000 | z.ztype, 0, 0); // the feed says the sun got it
    // loot
    if ((!opts.fire || z.boss) && !sunKill) {
      if (z.boss) {
        for (let i = 0; i < 8; i++) {
          const [item, n] = g.rollTable(SPECIAL_LOOT);
          g.dropItem(item, n, z.x, z.y, z.z, { spread: 2 + g.rng() * 2, life: 400 });
        }
      } else if (g.rng() < z.def.loot) {
        const [item, n] = g.rollTable(z.def.common ? ZOMBIE_LOOT : SPECIAL_LOOT);
        g.dropItem(item, n, z.x, z.y, z.z, { spread: 0.5, life: 150 });
      }
    }
    if (z.ztype === ZTYPE.BOOMER || opts.explode) {
      this.explode(z.x, z.y + 1, z.z, ZOMBIE_DEFS[ZTYPE.BOOMER].blastRadius, { humans: ZOMBIE_DEFS[ZTYPE.BOOMER].blastDmg, zombies: 80, structures: 260, kind: 2, source: z });
    }
  }

  explode(x, y, z, radius, opts) {
    const g = this.g;
    g.emit(
      (w) => {
        w.u8(EVT.EXPLOSION);
        w.i16(qpos(x));
        w.i16(qpos(y));
        w.i16(qpos(z));
        w.u8(Math.min(255, Math.round(radius * 10)));
        w.u8(opts.kind || 0);
      },
      { x, z, r: 260 },
    );
    g.sound(SOUND.EXPLOSION, x, y, z, 260);
    if (opts.humans) {
      for (const h of g.players.values()) {
        if (!h.alive || h.zombie) continue;
        const s = h.state;
        const d = Math.hypot(s.x - x, s.y + 1 - y, s.z - z);
        if (d > radius) continue;
        const f = 1 - d / radius;
        g.damagePlayer(h, opts.humans * (0.3 + 0.7 * f), { kind: KILLER.ZOMBIE, ztype: opts.source ? opts.source.ztype : ZTYPE.BOOMER, x, z });
        g.zm.knock(h, x, z, 9 * f, 4 * f, 0.3 * f);
      }
    }
    if (opts.zombies) {
      g.zm.forNear(x, z, radius, (zz) => {
        if (zz.dead || zz === opts.source) return;
        const d = Math.hypot(zz.x - x, zz.y + 1 - y, zz.z - z);
        if (d > radius) return;
        const f = 1 - d / radius;
        const dl = Math.hypot(zz.x - x, zz.z - z) || 1;
        this.damageZombie(zz, opts.zombies * (0.35 + 0.65 * f), opts.owner || null, { weapon: opts.weapon, knock: 6 * f, dirX: (zz.x - x) / dl, dirZ: (zz.z - z) / dl });
      });
      g.dm.blast(x, y, z, radius, opts.zombies, opts.owner, opts.weapon);
      for (const h of g.players.values()) {
        if (!h.alive || !h.zombie || !opts.owner) continue;
        const d = Math.hypot(h.state.x - x, h.state.z - z);
        if (d < radius) g.damagePlayer(h, opts.zombies * (1 - d / radius), { kind: KILLER.PLAYER, id: opts.owner.id, weapon: opts.weapon || 0, x, z });
      }
    }
    if (opts.structures) {
      for (const s of [...g.structures]) {
        const d = Math.hypot(s.x - x, s.z - z);
        if (d < radius) g.damageStructure(s, opts.structures * (1 - d / radius));
      }
    }
    // the loudest thing in the valley: whatever it did not kill comes running
    g.zm.noise(x, z, NOISE.EXPLOSION, y);
  }

  // ---------------------------------------------------------------- projectiles
  spawnProjectile(ptype, owner, x, y, z, vx, vy, vz, extra = {}) {
    const g = this.g;
    const e = { kind: ENT.PROJECTILE, ptype, owner: owner ? owner.id : 0, ownerRef: owner, x, y, z, vx, vy, vz, t: 0, grav: extra.grav ?? 16, fuse: extra.fuse ?? 0, target: extra.target || 0, range: extra.range || 0, sx: x, sz: z, bounces: 0 };
    if (!g.spawnEntity(e)) return null;
    g.projectiles.push(e);
    return e;
  }

  throwProjectile(p, item) {
    const s = p.state;
    const def = THROWABLES[item];
    const pitch = s.pitch + 0.12;
    const cp = Math.cos(pitch);
    const dx = -Math.sin(s.yaw) * cp;
    const dy = Math.sin(pitch);
    const dz = -Math.cos(s.yaw) * cp;
    const ox = s.x + dx * 0.5;
    const oy = s.y + eyeHeight(s) - 0.1;
    const oz = s.z + dz * 0.5;
    const ptype = item === ITEM.MOLOTOV ? PROJ.MOLOTOV : item === ITEM.FLARE ? PROJ.FLARE : PROJ.PIPEBOMB;
    const e = this.spawnProjectile(ptype, p, ox, oy, oz, dx * def.speed + s.vx * 0.5, dy * def.speed + 1.5, dz * def.speed + s.vz * 0.5, { fuse: def.fuse || 0 });
    if (e) this.g.sound(SOUND.THROW, ox, oy, oz, 20, p.id);
    return e; // null: the entity registry is full, nothing was thrown
  }

  // ballistic lob from (x,y,z) to land at (tx,ty,tz) after T seconds
  lob(ptype, owner, x, y, z, tx, ty, tz, T, grav) {
    const vx = (tx - x) / T;
    const vz = (tz - z) / T;
    const vy = (ty - y + 0.5 * grav * T * T) / T;
    return this.spawnProjectile(ptype, owner, x, y, z, vx, vy, vz, { grav });
  }

  rope(z, tx, ty, tz, targetId) {
    const ox = z.x;
    const oy = z.y + z.def.headY - 0.1;
    const oz = z.z;
    let dx = tx - ox;
    let dy = ty - oy;
    let dz = tz - oz;
    const l = Math.hypot(dx, dy, dz) || 1;
    const sp = 30;
    this.spawnProjectile(PROJ.ROPE, z, ox, oy, oz, (dx / l) * sp, (dy / l) * sp, (dz / l) * sp, { grav: 0, target: targetId, range: z.def.ropeRange + 3 });
  }

  updateProjectiles(dt) {
    const g = this.g;
    const list = g.projectiles;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      e.t += dt;
      const ox = e.x;
      const oy = e.y;
      const oz = e.z;
      e.vy -= e.grav * dt;
      const nx = e.x + e.vx * dt;
      const ny = e.y + e.vy * dt;
      const nz = e.z + e.vz * dt;
      let dx = nx - ox;
      let dy = ny - oy;
      let dz = nz - oz;
      const len = Math.hypot(dx, dy, dz) || 1e-6;
      dx /= len;
      dy /= len;
      dz /= len;
      raycastWorld(g.world, ox, oy, oz, dx, dy, dz, len, _ray, COL.NOBLOCK | COL.NOBULLET);
      let hitWorld = _ray.t >= 0;
      const hx = hitWorld ? ox + dx * _ray.t : nx;
      const hy = hitWorld ? oy + dy * _ray.t : ny;
      const hz = hitWorld ? oz + dz * _ray.t : nz;
      let done = false;
      switch (e.ptype) {
        case PROJ.ROPE: {
          const tp = g.players.get(e.target);
          const roper = e.ownerRef;
          if (!roper || roper.dead || roper.removed) {
            done = true;
            break;
          }
          if (tp && tp.alive && !tp.zombie) {
            const s = tp.state;
            // segment-point distance to the target's chest
            const cx = s.x - ox;
            const cy = s.y + 1.1 - oy;
            const cz = s.z - oz;
            let tt = cx * dx + cy * dy + cz * dz;
            tt = Math.max(0, Math.min(len, tt));
            const ddx = ox + dx * tt - s.x;
            const ddy = oy + dy * tt - (s.y + 1.1);
            const ddz = oz + dz * tt - s.z;
            if (ddx * ddx + ddy * ddy + ddz * ddz < 1.1 * 1.1 && !s.pinned && !s.pulled) {
              roper.state = 5;
              roper.link = tp.id;
              roper.linkDmg = 0;
              roper.linkT = 0;
              s.pulled = 1;
              s.pullX = roper.x;
              s.pullY = roper.y;
              s.pullZ = roper.z;
              tp.ropedBy = roper.id;
              g.sound(SOUND.ROPER_SHOOT, s.x, s.y + 1, s.z, 30);
              done = true;
              break;
            }
          }
          if (hitWorld || Math.hypot(nx - e.sx, nz - e.sz) > e.range) {
            done = true;
            if (roper.state === 4) roper.state = 0;
          }
          break;
        }
        case PROJ.ACID:
        case PROJ.ROCK: {
          // direct human hit
          let hitHuman = null;
          for (const h of g.players.values()) {
            if (!h.alive || h.zombie) continue;
            const s = h.state;
            if (Math.hypot(s.x - nx, s.z - nz) < (e.ptype === PROJ.ROCK ? 1.2 : 0.7) && ny > s.y - 0.2 && ny < s.y + 1.9) {
              hitHuman = h;
              break;
            }
          }
          if (hitHuman || hitWorld || ny < g.world.floorAt(nx, nz, oy) - 0.1) {
            const px = hitHuman ? hitHuman.state.x : hx;
            const pz = hitHuman ? hitHuman.state.z : hz;
            const py = g.world.floorAt(px, pz, hitHuman ? hitHuman.state.y + 0.5 : oy); // (down in the mine: the floor of the drift)
            const src = e.ownerRef;
            if (e.ptype === PROJ.ACID) {
              if (hitHuman) g.damagePlayer(hitHuman, 10, { kind: KILLER.ZOMBIE, ztype: src ? src.ztype : ZTYPE.SPITTER, x: e.x, z: e.z });
              this.spawnArea(AREA.ACID, px, groundAt(g.world, px, pz, (hitHuman ? hitHuman.state.y : hy) + 0.5, 0.2), pz, 2.4, 7, src);
              g.impact(IMPACT.ACID, px, py + 0.2, pz);
              g.sound(SOUND.ACID_SIZZLE, px, py, pz, 30);
            } else {
              for (const h of g.players.values()) {
                if (!h.alive || h.zombie) continue;
                const d = Math.hypot(h.state.x - px, h.state.z - pz);
                if (d < 3.2) {
                  g.damagePlayer(h, 50 * (1 - d / 4), { kind: KILLER.ZOMBIE, ztype: ZTYPE.BOSS_ABOMINATION, x: px, z: pz });
                  g.zm.knock(h, px, pz, 8, 4, 0.4);
                }
              }
              for (const s of [...g.structures]) if (Math.hypot(s.x - px, s.z - pz) < 3.5) g.damageStructure(s, 350);
              g.emit(
                (w) => {
                  w.u8(EVT.EXPLOSION);
                  w.i16(qpos(px));
                  w.i16(qpos(py));
                  w.i16(qpos(pz));
                  w.u8(35);
                  w.u8(3);
                },
                { x: px, z: pz, r: 200 },
              );
              g.sound(SOUND.SLAM, px, py, pz, 120);
            }
            done = true;
          }
          break;
        }
        case PROJ.MOLOTOV: {
          let hitZ = false;
          g.zm.forNear(nx, nz, 2, (z) => {
            if (!z.dead && Math.hypot(z.x - nx, z.z - nz) < z.def.radius + 0.3 && ny > z.y && ny < z.y + z.def.height) hitZ = true;
          });
          if (hitWorld || hitZ || ny < g.world.floorAt(nx, nz, oy)) {
            const px = hitZ ? nx : hx;
            const pz = hitZ ? nz : hz;
            const py = groundAt(g.world, px, pz, (hitZ ? ny : hy) + 0.3, 0.2);
            this.spawnArea(AREA.FIRE, px, py, pz, THROWABLES[ITEM.MOLOTOV].radius, THROWABLES[ITEM.MOLOTOV].burnTime, e.ownerRef, THROWABLES[ITEM.MOLOTOV].dps);
            g.sound(SOUND.GLASS_BREAK, px, py, pz, 60);
            g.sound(SOUND.FIRE_WHOOSH, px, py, pz, 80);
            g.zm.noise(px, pz, NOISE.MOLOTOV, py);
            done = true;
          }
          break;
        }
        case PROJ.FLARE:
        case PROJ.PIPEBOMB: {
          e.fuse -= dt;
          const flare = e.ptype === PROJ.FLARE;
          if (flare && g.tick % 60 === 0) g.sound(_SOUND.FLARE_BURN, e.x, e.y, e.z, 40);
          // a pipe bomb lures zombies (a flare only gives light)
          if (!flare && g.tick % 5 === 0) {
            // (not through the rock between the mine and the ground above it)
            const lu = !!g.mineNav && g.mineNav.under(e);
            g.zm.forNear(e.x, e.z, 40, (z) => {
              if (!z.boss && !z.dead && z.under === lu) {
                z.lureX = e.x;
                z.lureZ = e.z;
                z.lureT = 1;
              }
            });
          }
          if (hitWorld || ny < g.world.floorAt(nx, nz, oy)) {
            // bounce
            e.x = hx - dx * 0.05;
            e.y = Math.max(hy, g.world.floorAt(hx, hz, oy)) + 0.08;
            e.z = hz - dz * 0.05;
            const gh = g.world.floorAt(e.x, e.z, e.y);
            if (e.y - gh < 0.3) {
              e.vy = Math.abs(e.vy) * 0.3;
              e.vx *= 0.5;
              e.vz *= 0.5;
            } else {
              e.vx *= -0.4;
              e.vz *= -0.4;
            }
            if (Math.abs(e.vy) < 1) {
              e.vy = 0;
              e.grav = 0;
              e.vx = e.vz = 0;
              e.y = gh + 0.08;
            }
            if (e.fuse <= 0) done = true;
            else continue;
          }
          if (e.fuse <= 0) {
            done = true;
          }
          if (done && !flare) {
            const def = THROWABLES[ITEM.PIPEBOMB];
            this.explode(e.x, e.y + 0.3, e.z, def.radius, { zombies: def.damage, kind: 0, owner: e.ownerRef, weapon: ITEM.PIPEBOMB });
          }
          break;
        }
      }
      if (e.t > (e.ptype === PROJ.FLARE ? 45 : 12)) done = true;
      if (done) {
        list.splice(i, 1);
        g.removeEntity(e);
        continue;
      }
      e.x = nx;
      e.y = ny;
      e.z = nz;
    }
  }

  spawnArea(atype, x, y, z, radius, life, owner, dps) {
    const g = this.g;
    const e = { kind: ENT.AREA, atype, x, y, z, radius, until: g.time + life, owner: owner || null, dps: dps || 9 };
    if (!g.spawnEntity(e)) return;
    g.areas.push(e);
  }

  updateAreas(dt) {
    const g = this.g;
    const list = g.areas;
    for (let i = list.length - 1; i >= 0; i--) {
      const a = list[i];
      if (g.time > a.until) {
        list.splice(i, 1);
        g.removeEntity(a);
        continue;
      }
      if (a.atype === AREA.FIRE) {
        g.zm.forNear(a.x, a.z, a.radius, (z) => {
          if (z.dead || z.def.flying) return;
          if (Math.hypot(z.x - a.x, z.z - a.z) < a.radius && Math.abs(z.y - a.y) < 2) {
            const owner = a.owner && a.owner.kind === ENT.PLAYER ? a.owner : null;
            this.damageZombie(z, a.dps * dt, owner, { weapon: ITEM.MOLOTOV, fire: true });
            this.ignite(z, owner, ITEM.MOLOTOV); // whatever walks out of the fire walks out burning
            z.trapSlow = Math.min(z.trapSlow, 0.75);
          }
        });
        g.dm.scorch(a, dt);
        for (const h of g.players.values()) {
          if (!h.alive || !h.zombie) continue;
          if (Math.hypot(h.state.x - a.x, h.state.z - a.z) < a.radius) g.damagePlayer(h, a.dps * dt, { kind: KILLER.PLAYER, id: a.owner ? a.owner.id : 0, weapon: ITEM.MOLOTOV, x: a.x, z: a.z });
        }
      } else if (a.atype === AREA.ACID) {
        for (const h of g.players.values()) {
          if (!h.alive || h.zombie) continue;
          const s = h.state;
          if (Math.hypot(s.x - a.x, s.z - a.z) < a.radius && Math.abs(s.y - a.y) < 1.2) g.damagePlayer(h, a.dps * dt, { kind: KILLER.ZOMBIE, ztype: ZTYPE.SPITTER, x: a.x, z: a.z });
        }
      }
    }
    // traps
    for (let si = g.structures.length - 1; si >= 0; si--) {
      const s = g.structures[si];
      if (!s) continue;
      const def = STRUCT_DEFS[s.stype];
      if (!def.trap) continue;
      const col = s.collider;
      g.zm.forNear(s.x, s.z, col.r + 1, (z) => {
        if (z.dead || z.def.flying) return;
        if (!footprintContains(col, z.x, z.z, z.def.radius * 0.5)) return;
        if (Math.abs(z.y - s.y) > 1.2) return;
        this.damageZombie(z, def.dps * dt, null, { trap: true });
        z.trapSlow = Math.min(z.trapSlow, def.slow);
        s.hp -= s.stype === STRUCT.SPIKES ? dt * 2.2 : dt * 3;
        if (g.tick % 8 === 0) g.impact(IMPACT.BLOOD, z.x, z.y + 0.4, z.z);
      });
      if (s.hp <= 0) g.destroyStructure(s, true);
    }
  }
}

export { PHASE, PLAYER_RADIUS };
