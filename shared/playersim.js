// Deterministic player simulation: movement, stamina and weapon state machine.
// The client runs this for prediction (and replays unacknowledged commands on reconciliation);
// the server runs the exact same code as the authority.
import {
  BTN,
  CMD_DT,
  MAP_HALF,
  PLAYER_RADIUS,
  PLAYER_HEIGHT,
  PLAYER_CROUCH_HEIGHT,
  EYE_HEIGHT,
  EYE_HEIGHT_CROUCH,
  WALK_SPEED,
  SPRINT_SPEED,
  CROUCH_SPEED,
  ZOMBIE_PLAYER_SPEED,
  GRAVITY,
  JUMP_VELOCITY,
  GROUND_ACCEL,
  AIR_ACCEL,
  FRICTION,
  STAMINA_MAX,
  STAMINA_DRAIN,
  STAMINA_REGEN,
  STAMINA_REGEN_DELAY,
  STAMINA_JUMP_COST,
  STAMINA_UNLOCK,
  SLOT_THROW,
  SLOT_BUILD,
  SLOT_MELEE,
  SLOT_PRIMARY,
  SLOT_PISTOL,
  DOWN_CRAWL_SPEED,
  EYE_HEIGHT_DOWNED,
} from './constants.js';
import { ITEM, WEAPONS, CLAWS, AMMO, AMMO_ITEMS } from './defs.js';
import { groundAt, resolveBody, deepWaterAt } from './collision.js';
import { mulberry32 } from './rng.js';

export function createPlayerState() {
  return {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0,
    pitch: 0,
    onGround: 1,
    crouch: 0,
    stamina: STAMINA_MAX,
    exhausted: 0,
    staminaDelay: 0,
    sprinting: 0,
    // weapons
    slot: SLOT_MELEE,
    weapons: [0, ITEM.PISTOL, ITEM.KNIFE, 0, 0],
    mags: [0, 12],
    ammo: AMMO_ITEMS.map((_, i) => (i === AMMO.P9 ? 24 : 0)),
    throwCount: 0,
    switchT: 0,
    cooldown: 0,
    reloadT: 0,
    recoil: 0,
    // status
    zombie: 0,
    leapCd: 0,
    pulled: 0,
    pullX: 0,
    pullY: 0,
    pullZ: 0,
    pinned: 0,
    stunT: 0,
    downed: 0, // incapacitated: crawl, pistol only, waiting for a teammate to revive
    lastBtn: 0,
    fireCount: 0,
  };
}

// copies the fields that participate in simulation (used for reconciliation snapshots)
export function copyPlayerState(dst, src) {
  dst.x = src.x;
  dst.y = src.y;
  dst.z = src.z;
  dst.vx = src.vx;
  dst.vy = src.vy;
  dst.vz = src.vz;
  dst.yaw = src.yaw;
  dst.pitch = src.pitch;
  dst.onGround = src.onGround;
  dst.crouch = src.crouch;
  dst.stamina = src.stamina;
  dst.exhausted = src.exhausted;
  dst.staminaDelay = src.staminaDelay;
  dst.sprinting = src.sprinting;
  dst.slot = src.slot;
  for (let i = 0; i < 5; i++) dst.weapons[i] = src.weapons[i];
  dst.mags[0] = src.mags[0];
  dst.mags[1] = src.mags[1];
  for (let i = 0; i < AMMO_ITEMS.length; i++) dst.ammo[i] = src.ammo[i];
  dst.throwCount = src.throwCount;
  dst.switchT = src.switchT;
  dst.cooldown = src.cooldown;
  dst.reloadT = src.reloadT;
  dst.recoil = src.recoil;
  dst.zombie = src.zombie;
  dst.leapCd = src.leapCd;
  dst.pulled = src.pulled;
  dst.pullX = src.pullX;
  dst.pullY = src.pullY;
  dst.pullZ = src.pullZ;
  dst.pinned = src.pinned;
  dst.stunT = src.stunT;
  dst.downed = src.downed;
  dst.lastBtn = src.lastBtn;
  dst.fireCount = src.fireCount;
  return dst;
}

// true when two states are identical in every field copyPlayerState carries
export function samePlayerState(a, b) {
  if (a.x !== b.x || a.y !== b.y || a.z !== b.z || a.vx !== b.vx || a.vy !== b.vy || a.vz !== b.vz) return false;
  if (a.yaw !== b.yaw || a.pitch !== b.pitch || a.onGround !== b.onGround || a.crouch !== b.crouch) return false;
  if (a.stamina !== b.stamina || a.exhausted !== b.exhausted || a.staminaDelay !== b.staminaDelay || a.sprinting !== b.sprinting) return false;
  if (a.slot !== b.slot || a.mags[0] !== b.mags[0] || a.mags[1] !== b.mags[1] || a.throwCount !== b.throwCount) return false;
  for (let i = 0; i < 5; i++) if (a.weapons[i] !== b.weapons[i]) return false;
  for (let i = 0; i < AMMO_ITEMS.length; i++) if (a.ammo[i] !== b.ammo[i]) return false;
  if (a.switchT !== b.switchT || a.cooldown !== b.cooldown || a.reloadT !== b.reloadT || a.recoil !== b.recoil) return false;
  if (a.zombie !== b.zombie || a.leapCd !== b.leapCd || a.pulled !== b.pulled || a.pinned !== b.pinned) return false;
  if (a.pullX !== b.pullX || a.pullY !== b.pullY || a.pullZ !== b.pullZ || a.stunT !== b.stunT) return false;
  return a.downed === b.downed && a.lastBtn === b.lastBtn && a.fireCount === b.fireCount;
}

// Rounds every float of the state to float32, which is how the server puts it on the wire: after the server has
// snapped its state and the client has taken it over, both simulate on from bit-identical numbers.
const fr = Math.fround;
export function snapPlayerState(s) {
  s.x = fr(s.x);
  s.y = fr(s.y);
  s.z = fr(s.z);
  s.vx = fr(s.vx);
  s.vy = fr(s.vy);
  s.vz = fr(s.vz);
  s.stamina = fr(s.stamina);
  s.staminaDelay = fr(s.staminaDelay);
  s.switchT = fr(s.switchT);
  s.cooldown = fr(s.cooldown);
  s.reloadT = fr(s.reloadT);
  s.recoil = fr(s.recoil);
  s.leapCd = fr(s.leapCd);
  s.stunT = fr(s.stunT);
  s.pullX = fr(s.pullX);
  s.pullY = fr(s.pullY);
  s.pullZ = fr(s.pullZ);
  return s;
}

// 8-bit fingerprint of the simulated state (the view angles aside: those come with every command). The client sends
// the fingerprint of its prediction with its commands and the server compares it with its own state after the same
// command: as long as they agree the state itself never has to be sent. Floats go in rounded (millimetres,
// milliseconds), so the last-bit differences between JS engines' Math.sin / hypot don't count as a mismatch; a real
// divergence that small is harmless, and it gets caught as soon as it grows.
export function hashPlayerState(s) {
  let h = 0x811c9dc5;
  const mix = (v) => {
    h = Math.imul(h ^ v, 0x01000193);
    h ^= h >>> 15;
  };
  mix(Math.round(s.x * 512));
  mix(Math.round(s.y * 512));
  mix(Math.round(s.z * 512));
  mix(Math.round(s.vx * 128));
  mix(Math.round(s.vy * 128));
  mix(Math.round(s.vz * 128));
  mix((s.onGround ? 1 : 0) | (s.crouch ? 2 : 0) | (s.exhausted ? 4 : 0) | (s.sprinting ? 8 : 0) | (s.zombie ? 16 : 0) | (s.pulled ? 32 : 0) | (s.pinned ? 64 : 0) | (s.downed ? 128 : 0));
  mix(Math.round(s.stamina * 64));
  mix(Math.round(s.staminaDelay * 512));
  mix(s.slot | (s.mags[0] << 8) | (s.mags[1] << 16) | (s.throwCount << 24));
  for (let i = 0; i < 5; i++) mix(s.weapons[i]);
  for (let i = 0; i < AMMO_ITEMS.length; i++) mix(s.ammo[i]);
  mix(Math.round(s.switchT * 512));
  mix(Math.round(s.cooldown * 512));
  mix(Math.round(s.reloadT * 512));
  mix(Math.round(s.recoil * 256));
  mix(Math.round(s.leapCd * 512));
  mix(Math.round(s.stunT * 512));
  if (s.pulled) {
    mix(Math.round(s.pullX * 64));
    mix(Math.round(s.pullY * 64));
    mix(Math.round(s.pullZ * 64));
  }
  mix(s.lastBtn | (s.fireCount << 16));
  return (h ^ (h >>> 8) ^ (h >>> 16) ^ (h >>> 24)) & 255;
}

export function eyeHeight(s) {
  return s.downed ? EYE_HEIGHT_DOWNED : s.crouch ? EYE_HEIGHT_CROUCH : EYE_HEIGHT;
}

export function currentWeapon(s) {
  if (s.zombie) return 0;
  return s.weapons[s.slot] || 0;
}

export function canSelectSlot(s, slot) {
  if (s.zombie) return slot === SLOT_MELEE;
  if (s.downed) return slot === SLOT_PISTOL && s.weapons[SLOT_PISTOL] !== 0;
  if (slot === SLOT_THROW) return s.weapons[SLOT_THROW] !== 0 && s.throwCount > 0;
  if (slot === SLOT_BUILD) return true; // build mode works with bare hands too (hammer optional)
  return s.weapons[slot] !== 0;
}

const _pos = { x: 0, y: 0, z: 0 };

// spread for the next shot (radians)
export function shotSpread(s, def, aiming) {
  const sp = Math.hypot(s.vx, s.vz);
  let spread = def.spread + def.moveSpread * Math.min(1, sp / WALK_SPEED) + Math.min(s.recoil, 10) * def.spread * 0.35;
  if (!s.onGround) spread += 0.05;
  if (s.crouch) spread *= 0.7;
  if (aiming) spread *= 0.35;
  return spread;
}

// Deterministic pellet directions. Writes [dx,dy,dz,...] into out, returns pellet count.
export function shotDirections(yaw, pitch, recoilPitch, spread, pellets, seed, out) {
  const rnd = mulberry32(seed * 2654435761);
  const p0 = pitch + recoilPitch;
  for (let i = 0; i < pellets; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * spread;
    const yw = yaw + Math.cos(a) * r;
    const pt = p0 + Math.sin(a) * r;
    const cp = Math.cos(pt);
    out[i * 3] = -Math.sin(yw) * cp;
    out[i * 3 + 1] = Math.sin(pt);
    out[i * 3 + 2] = -Math.cos(yw) * cp;
  }
  return pellets;
}

// Simulate one command (fixed CMD_DT). events: array to push {type,...} into (may be null).
// cmd = { seq, buttons, yaw, pitch, slot (255 = no change) }
export function simulatePlayer(s, cmd, world, events, dt = CMD_DT) {
  const b = cmd.buttons;
  const pressed = b & ~s.lastBtn;
  s.yaw = cmd.yaw;
  s.pitch = cmd.pitch;

  // ------------------------------------------------ slot switching
  if (cmd.slot !== 255 && cmd.slot !== s.slot && cmd.slot < 5 && canSelectSlot(s, cmd.slot)) {
    s.slot = cmd.slot;
    s.switchT = s.zombie ? 0.1 : 0.42;
    s.reloadT = 0;
    s.recoil = 0;
    if (events) events.push({ type: 'switch', slot: s.slot });
  }
  if (s.zombie) s.slot = SLOT_MELEE;
  if (s.downed && s.slot !== SLOT_PISTOL && s.weapons[SLOT_PISTOL]) {
    s.slot = SLOT_PISTOL;
    s.switchT = 0.3;
    s.reloadT = 0;
  }
  // lost the item in the active slot (dropped / used up)
  if (!s.zombie && !s.downed && s.slot !== SLOT_BUILD && !canSelectSlot(s, s.slot)) {
    s.slot = s.weapons[SLOT_PRIMARY] ? SLOT_PRIMARY : s.weapons[SLOT_PISTOL] ? SLOT_PISTOL : SLOT_MELEE;
    s.switchT = 0.42;
    s.reloadT = 0;
  }

  // ------------------------------------------------ movement
  const disabled = s.pinned || s.stunT > 0;
  let fwd = 0;
  let right = 0;
  if (!disabled) {
    if (b & BTN.FWD) fwd += 1;
    if (b & BTN.BACK) fwd -= 1;
    if (b & BTN.RIGHT) right += 1;
    if (b & BTN.LEFT) right -= 1;
  }
  const sy = Math.sin(s.yaw);
  const cy = Math.cos(s.yaw);
  let wx = -sy * fwd + cy * right;
  let wz = -cy * fwd - sy * right;
  const wl = Math.hypot(wx, wz);
  if (wl > 0) {
    wx /= wl;
    wz /= wl;
  }
  s.crouch = !s.zombie && (s.downed || (b & BTN.CROUCH && !disabled)) ? 1 : 0;
  const weapon = currentWeapon(s);
  const wdef = WEAPONS[weapon];
  const aiming = !!(b & BTN.ALT) && wdef && !wdef.melee && s.reloadT <= 0 && s.switchT <= 0;
  const moving = wl > 0;
  let sprint = 0;
  if (s.zombie) {
    s.stamina = STAMINA_MAX;
    s.exhausted = 0;
  } else {
    sprint = b & BTN.SPRINT && fwd > 0 && !s.crouch && !s.exhausted && s.stamina > 0 && !aiming && !s.downed ? 1 : 0;
    if (sprint && moving) {
      s.stamina -= STAMINA_DRAIN * dt;
      s.staminaDelay = STAMINA_REGEN_DELAY;
      if (s.stamina <= 0) {
        s.stamina = 0;
        s.exhausted = 1;
        if (events) events.push({ type: 'exhausted' });
      }
    } else {
      if (s.staminaDelay > 0) s.staminaDelay -= dt;
      else s.stamina = Math.min(STAMINA_MAX, s.stamina + STAMINA_REGEN * dt);
      if (s.exhausted && s.stamina >= STAMINA_UNLOCK) s.exhausted = 0;
    }
  }
  s.sprinting = sprint && moving ? 1 : 0;
  let wishSpeed = s.zombie ? ZOMBIE_PLAYER_SPEED : s.downed ? DOWN_CRAWL_SPEED : sprint ? SPRINT_SPEED : s.crouch ? CROUCH_SPEED : WALK_SPEED;
  if (aiming) wishSpeed *= 0.62;
  if (!moving) wishSpeed = 0;

  if (s.stunT > 0) s.stunT -= dt;
  if (s.leapCd > 0) s.leapCd -= dt;

  if (s.pulled) {
    const dx = s.pullX - s.x;
    const dz = s.pullZ - s.z;
    const d = Math.hypot(dx, dz);
    if (d > 1.3) {
      s.vx = (dx / d) * 4.4;
      s.vz = (dz / d) * 4.4;
    } else {
      s.vx = 0;
      s.vz = 0;
    }
  } else if (s.onGround) {
    const sp = Math.hypot(s.vx, s.vz);
    if (sp > 0) {
      const drop = Math.max(sp, 1.6) * FRICTION * dt;
      const ns = Math.max(0, sp - drop);
      s.vx *= ns / sp;
      s.vz *= ns / sp;
    }
    const cur = s.vx * wx + s.vz * wz;
    const add = wishSpeed - cur;
    if (add > 0 && moving) {
      const acc = Math.min(GROUND_ACCEL * dt * wishSpeed, add);
      s.vx += acc * wx;
      s.vz += acc * wz;
    }
  } else if (moving) {
    const cur = s.vx * wx + s.vz * wz;
    const add = wishSpeed - cur;
    if (add > 0) {
      const acc = Math.min(AIR_ACCEL * dt * wishSpeed, add);
      s.vx += acc * wx;
      s.vz += acc * wz;
    }
  }

  // jumping / zombie leap
  if (!disabled && s.onGround && !s.pulled && !s.downed) {
    if (s.zombie && b & BTN.ALT && s.leapCd <= 0) {
      const cp = Math.cos(Math.max(-0.2, s.pitch));
      s.vx = -sy * CLAWS.leapSpeed * cp;
      s.vz = -cy * CLAWS.leapSpeed * cp;
      s.vy = CLAWS.leapUp;
      s.onGround = 0;
      s.leapCd = CLAWS.leapCooldown;
      if (events) events.push({ type: 'leap' });
    } else if (pressed & BTN.JUMP && (s.zombie || s.stamina >= STAMINA_JUMP_COST)) {
      s.vy = JUMP_VELOCITY * (s.zombie ? 1.15 : 1);
      if (!s.zombie) {
        s.stamina -= STAMINA_JUMP_COST;
        s.staminaDelay = STAMINA_REGEN_DELAY;
      }
      s.onGround = 0;
      if (events) events.push({ type: 'jump' });
    }
  }

  s.vy -= GRAVITY * dt;
  const ox = s.x;
  const oz = s.z;
  const height = s.crouch ? PLAYER_CROUCH_HEIGHT : PLAYER_HEIGHT;
  _pos.x = s.x + s.vx * dt;
  _pos.y = s.y;
  _pos.z = s.z + s.vz * dt;
  const human = !s.zombie;
  const hit = resolveBody(world, _pos, PLAYER_RADIUS, height, human);
  if (deepWaterAt(world, _pos.x, _pos.z, s.y, PLAYER_RADIUS * 0.7, human)) {
    _pos.x = ox;
    _pos.z = oz;
    s.vx = 0;
    s.vz = 0;
  }
  const lim = MAP_HALF - 3;
  if (_pos.x < -lim) _pos.x = -lim;
  if (_pos.x > lim) _pos.x = lim;
  if (_pos.z < -lim) _pos.z = -lim;
  if (_pos.z > lim) _pos.z = lim;
  if (hit && s.onGround) {
    s.vx = (_pos.x - ox) / dt;
    s.vz = (_pos.z - oz) / dt;
  }
  const ground = groundAt(world, _pos.x, _pos.z, s.y, PLAYER_RADIUS * 0.7, human);
  let ny = s.y + s.vy * dt;
  const wasGround = s.onGround;
  if (ny <= ground) {
    if (!wasGround && s.vy < -9 && events) events.push({ type: 'land', v: -s.vy });
    ny = ground;
    s.vy = 0;
    s.onGround = 1;
  } else if (wasGround && s.vy <= 0 && ny - ground < 0.4) {
    ny = ground;
    s.vy = 0;
    s.onGround = 1;
  } else {
    s.onGround = 0;
  }
  s.x = _pos.x;
  s.y = ny;
  s.z = _pos.z;

  // ------------------------------------------------ weapons
  if (s.switchT > 0) s.switchT -= dt;
  if (s.cooldown > 0) s.cooldown -= dt;
  const attack = b & BTN.ATTACK;
  const attackPressed = pressed & BTN.ATTACK;

  if (s.zombie) {
    if ((attack || attackPressed) && s.cooldown <= 0 && s.switchT <= 0) {
      s.cooldown = CLAWS.rate;
      s.fireCount = (s.fireCount + 1) & 255;
      if (events) events.push({ type: 'melee', weapon: 0, heavy: false });
    }
  } else if (s.downed && s.slot !== SLOT_PISTOL) {
    // downed without a pistol: nothing to do but wait
  } else if (s.slot === SLOT_BUILD) {
    // build mode: placement is a discrete action
  } else if (s.slot === SLOT_THROW) {
    if (attackPressed && s.cooldown <= 0 && s.switchT <= 0 && s.throwCount > 0) {
      s.cooldown = 1.1;
      s.throwCount--;
      s.fireCount = (s.fireCount + 1) & 255;
      if (events) events.push({ type: 'throw', item: s.weapons[SLOT_THROW] });
    }
  } else if (wdef && wdef.melee) {
    const alt = b & BTN.ALT;
    if ((attack || alt) && s.cooldown <= 0 && s.switchT <= 0) {
      const heavy = !attack && !!alt;
      s.cooldown = heavy ? wdef.altRate : wdef.rate;
      s.fireCount = (s.fireCount + 1) & 255;
      if (events) events.push({ type: 'melee', weapon, heavy });
    }
  } else if (wdef) {
    const mi = s.slot === SLOT_PRIMARY ? 0 : 1;
    // reload progress
    if (s.reloadT > 0) {
      if (wdef.reloadEach && attackPressed && s.mags[mi] > 0) {
        s.reloadT = 0; // interrupt shotgun reload to shoot
      } else {
        s.reloadT -= dt;
        if (s.reloadT <= 0) {
          s.reloadT = 0;
          const reserve = s.ammo[wdef.ammo];
          if (wdef.reloadEach) {
            if (reserve > 0 && s.mags[mi] < wdef.mag) {
              s.mags[mi]++;
              s.ammo[wdef.ammo]--;
              if (events) events.push({ type: 'shell' });
            }
            if (s.mags[mi] < wdef.mag && s.ammo[wdef.ammo] > 0) {
              s.reloadT = wdef.reload;
              if (events) events.push({ type: 'reload', each: true, time: wdef.reload });
            } else if (events) events.push({ type: 'reload_done' });
          } else {
            const take = Math.min(wdef.mag - s.mags[mi], reserve);
            s.mags[mi] += take;
            s.ammo[wdef.ammo] -= take;
            if (events) events.push({ type: 'reload_done' });
          }
        }
      }
    }
    // an empty magazine reloads on the next trigger pull; autoReload weapons (crossbow) re-cock on their own
    const wantReload = (pressed & BTN.RELOAD) || (s.mags[mi] === 0 && (attackPressed || (wdef.autoReload && s.cooldown <= 0)));
    if (wantReload && s.reloadT <= 0 && s.switchT <= 0 && s.mags[mi] < wdef.mag && s.ammo[wdef.ammo] > 0) {
      s.reloadT = wdef.reload;
      s.recoil = 0;
      if (events) events.push({ type: 'reload', each: !!wdef.reloadEach, time: wdef.reload });
    } else if ((wdef.auto ? attack : attackPressed) && s.cooldown <= 0 && s.switchT <= 0 && s.reloadT <= 0) {
      if (s.mags[mi] > 0) {
        s.mags[mi]--;
        s.cooldown = wdef.rate;
        const spread = shotSpread(s, wdef, aiming);
        const recoilPitch = Math.min(s.recoil, 8) * wdef.recoil * 0.45;
        s.recoil += 1;
        s.fireCount = (s.fireCount + 1) & 255;
        if (events) {
          events.push({
            type: 'fire',
            weapon,
            seed: ((cmd.seq * 7919) ^ (s.fireCount * 131)) & 0xffff,
            spread,
            recoilPitch,
            x: s.x,
            y: s.y + eyeHeight(s),
            z: s.z,
            yaw: s.yaw,
            pitch: s.pitch,
            aiming,
          });
        }
      } else if (attackPressed) {
        s.cooldown = 0.25;
        if (events) events.push({ type: 'dry' });
      }
    }
    if (!attack && s.recoil > 0) s.recoil = Math.max(0, s.recoil - dt * 9);
  }

  s.lastBtn = b;
  return s;
}
