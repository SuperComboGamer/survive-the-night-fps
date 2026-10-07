// Deterministic player simulation: movement, stamina and weapon state machine.
// The client runs this for prediction (and replays unacknowledged commands on reconciliation);
// the server runs the exact same code as the authority.
import {
  BTN,
  CMD_DT,
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
  SHOVE_PRESS,
  SHOVE_HOLD,
  SHOVE_SLIP,
  SLOT_THROW,
  SLOT_BUILD,
  SLOT_MELEE,
  SLOT_PRIMARY,
  SLOT_PISTOL,
  SLOT_RADIO,
  NUM_SLOTS,
  DOWN_CRAWL_SPEED,
  EYE_HEIGHT_DOWNED,
  GUN_CARRY_SPEED,
} from './constants.js';
import { ITEM, WEAPONS, CLAWS, AMMO, AMMO_ITEMS } from './defs.js';
import { groundAt, resolveBody, deepWaterAt } from './collision.js';
import { mulberry32 } from './rng.js';
import { rideStep, rideCarry } from './fair.js';
import { cartStep, cartCarry, CART_PUMP, LEVER_HANDS } from './handcar.js';
import { driveStep, DRIVE_HANDS } from './vehicles.js';
import { swimming, waterFloor, wadeDepth, SWIM_HANDS, SWIM_SPEED, SWIM_FAST, SWIM_DOWNED, SWIM_ACCEL, SWIM_DRAG, SWIM_TREAD, SWIM_DRAIN, WADE_FROM, WADE_SLOW, CROUCH_WADE, SWIM_DEPTH } from './swim.js';
import { perkMods } from './progress.js';
import { simNunchaku } from './nunchaku.js';

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
    shove: 0, // pinned by a leaper: how far they have shoved it off (SHOVE_*), 0-1
    stunT: 0,
    downed: 0, // incapacitated: crawl, pistol only, waiting for a teammate to revive
    using: 0, // an item in the hands being used (a medkit, a tin: Game.useItem): set by the server, put away here
    lastBtn: 0,
    fireCount: 0,
    // on a ride at the fair (fair.js): the seat + 1, the ride clock as this player has it (commands), whether it turns
    ride: 0,
    rideT: 0,
    rideGo: 0,
    // on a handcar on the railway (handcar.js): the car + 1, where it is on the line (a point of rail.main), its speed
    cart: 0,
    cartS: 0,
    cartV: 0,
    // carrying the mounted gun (mountedgun.js): both arms full, half pace, and a weapon switch drops it
    hmg: 0,
    // at the wheel of a vehicle (vehicles.js): its entity id and kind, where it points, its steering, its tank, whether
    // it has broken down. Then x / y / z and vx / vz are the vehicle's. Or carried in one: its id and the seat
    drive: 0,
    driveK: 0,
    dyaw: 0,
    dsteer: 0,
    dfuel: 0,
    ddead: 0,
    pass: 0,
    passN: 0,
    // the perks they picked (progress.js: a bitmask of perk ids), set by the server. What they do here is perkMods
    perks: 0,
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
  dst.shove = src.shove;
  dst.stunT = src.stunT;
  dst.downed = src.downed;
  dst.using = src.using;
  dst.lastBtn = src.lastBtn;
  dst.fireCount = src.fireCount;
  dst.ride = src.ride;
  dst.rideT = src.rideT;
  dst.rideGo = src.rideGo;
  dst.cart = src.cart;
  dst.cartS = src.cartS;
  dst.cartV = src.cartV;
  dst.hmg = src.hmg;
  dst.drive = src.drive;
  dst.driveK = src.driveK;
  dst.dyaw = src.dyaw;
  dst.dsteer = src.dsteer;
  dst.dfuel = src.dfuel;
  dst.ddead = src.ddead;
  dst.pass = src.pass;
  dst.passN = src.passN;
  dst.perks = src.perks;
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
  if (a.pullX !== b.pullX || a.pullY !== b.pullY || a.pullZ !== b.pullZ || a.stunT !== b.stunT || a.shove !== b.shove) return false;
  if (a.hmg !== b.hmg || a.perks !== b.perks) return false;
  if (a.ride !== b.ride || a.rideT !== b.rideT || a.rideGo !== b.rideGo) return false;
  if (a.cart !== b.cart || a.cartS !== b.cartS || a.cartV !== b.cartV) return false;
  if (a.drive !== b.drive || a.driveK !== b.driveK || a.dyaw !== b.dyaw || a.dsteer !== b.dsteer || a.dfuel !== b.dfuel || a.ddead !== b.ddead || a.pass !== b.pass || a.passN !== b.passN) return false;
  return a.downed === b.downed && a.using === b.using && a.lastBtn === b.lastBtn && a.fireCount === b.fireCount;
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
  s.shove = fr(s.shove);
  s.pullX = fr(s.pullX);
  s.pullY = fr(s.pullY);
  s.pullZ = fr(s.pullZ);
  s.cartS = fr(s.cartS);
  s.cartV = fr(s.cartV);
  s.dyaw = fr(s.dyaw);
  s.dsteer = fr(s.dsteer);
  s.dfuel = fr(s.dfuel);
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
  // (carried in a vehicle, where they are is the seat's: the server puts them there, and their own copy stands still)
  if (!s.pass) {
    mix(Math.round(s.x * 512));
    mix(Math.round(s.y * 512));
    mix(Math.round(s.z * 512));
  }
  mix(Math.round(s.vx * 128));
  mix(Math.round(s.vy * 128));
  mix(Math.round(s.vz * 128));
  mix((s.onGround ? 1 : 0) | (s.crouch ? 2 : 0) | (s.exhausted ? 4 : 0) | (s.sprinting ? 8 : 0) | (s.zombie ? 16 : 0) | (s.pulled ? 32 : 0) | (s.pinned ? 64 : 0) | (s.downed ? 128 : 0) | (s.using ? 256 : 0));
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
  if (s.pinned) mix(Math.round(s.shove * 512));
  if (s.pulled) {
    mix(Math.round(s.pullX * 64));
    mix(Math.round(s.pullY * 64));
    mix(Math.round(s.pullZ * 64));
  }
  mix(s.lastBtn | (s.fireCount << 16));
  if (s.ride) {
    mix(s.ride | (s.rideGo << 8));
    mix(s.rideT | 0);
  }
  if (s.cart) {
    mix(s.cart);
    mix(Math.round(s.cartS * 512));
    mix(Math.round(s.cartV * 128));
  }
  if (s.drive) {
    mix(s.drive | (s.driveK << 16) | (s.ddead << 20));
    mix(Math.round(s.dyaw * 2048));
    mix(Math.round(s.dsteer * 2048));
    mix(Math.round(s.dfuel * 64));
  }
  if (s.pass) mix(s.pass | (s.passN << 16) | 0x70000000);
  if (s.hmg) mix(0x686d67);
  if (s.perks) mix(s.perks);
  return (h ^ (h >>> 8) ^ (h >>> 16) ^ (h >>> 24)) & 255;
}

export function eyeHeight(s) {
  return s.downed ? EYE_HEIGHT_DOWNED : s.crouch ? EYE_HEIGHT_CROUCH : EYE_HEIGHT;
}

// the item in hand (ITEM.WALKIE for the walkie-talkie slot, which holds nothing of its own)
export function currentWeapon(s) {
  if (s.zombie) return 0;
  if (s.slot === SLOT_RADIO) return ITEM.WALKIE;
  return s.weapons[s.slot] || 0;
}

export function canSelectSlot(s, slot) {
  if (s.zombie) return slot === SLOT_MELEE;
  if (slot === SLOT_RADIO) return true; // every survivor's walkie-talkie: down, it is how you call for help
  if (s.downed) return slot === SLOT_PISTOL && s.weapons[SLOT_PISTOL] !== 0;
  if (slot === SLOT_THROW) return s.weapons[SLOT_THROW] !== 0 && s.throwCount > 0;
  if (slot === SLOT_BUILD) return true; // build mode works with bare hands too (hammer optional)
  return s.weapons[slot] !== 0;
}

// Keying the walkie-talkie: it in hand and the fire button held (not while both arms are round the mounted gun, nor
// with an item being used in the hands). Voice then goes out to every survivor at any distance (the server lists
// who is on the air, PLF.ON_AIR), and they hear the static of it.
export function radioKeyed(s) {
  return !s.zombie && !s.hmg && !s.using && s.slot === SLOT_RADIO && (s.lastBtn & BTN.ATTACK) !== 0;
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

export const DRAW_TIME = 0.42; // a weapon being brought out, before it can be used

// The item being used goes away unfinished, and the weapon in hand comes back out as from a switch
function putAwayItem(s, events) {
  s.using = 0;
  s.switchT = DRAW_TIME;
  if (events) events.push({ type: 'use_cancel' });
}

// Simulate one command (fixed CMD_DT). events: array to push {type,...} into (may be null).
// cmd = { seq, buttons, yaw, pitch, slot (255 = no change) }
export function simulatePlayer(s, cmd, world, events, dt = CMD_DT) {
  let b = cmd.buttons;
  let pressed = b & ~s.lastBtn;
  s.yaw = cmd.yaw;
  s.pitch = cmd.pitch;

  // ------------------------------------------------ slot switching
  // (asking for a weapon puts away the item being used)
  if (s.using && cmd.slot !== 255) putAwayItem(s, events);
  if (cmd.slot !== 255 && cmd.slot !== s.slot && cmd.slot < NUM_SLOTS && canSelectSlot(s, cmd.slot)) {
    s.slot = cmd.slot;
    s.switchT = s.zombie ? 0.1 : DRAW_TIME;
    s.reloadT = 0;
    s.recoil = 0;
    if (events) events.push({ type: 'switch', slot: s.slot });
  }
  // carrying the mounted gun: reaching for any weapon lets go of it, and it drops where they stand (the server puts
  // it there: the event). The switch above goes ahead
  if (s.hmg && cmd.slot !== 255 && cmd.slot < NUM_SLOTS) {
    s.hmg = 0;
    if (events) events.push({ type: 'gun_drop' });
  }
  if (s.zombie) s.slot = SLOT_MELEE;
  if (s.downed && s.slot !== SLOT_PISTOL && s.slot !== SLOT_RADIO && s.weapons[SLOT_PISTOL]) {
    s.slot = SLOT_PISTOL;
    s.switchT = 0.3;
    s.reloadT = 0;
  }
  // lost the item in the active slot (dropped / used up)
  if (!s.zombie && !s.downed && s.slot !== SLOT_BUILD && !canSelectSlot(s, s.slot)) {
    s.slot = s.weapons[SLOT_PRIMARY] ? SLOT_PRIMARY : s.weapons[SLOT_PISTOL] ? SLOT_PISTOL : SLOT_MELEE;
    s.switchT = DRAW_TIME;
    s.reloadT = 0;
  }

  // ------------------------------------------------ movement
  // in a seat of a ride the body goes where the seat does (fair.js): nothing below moves it, and it is put there
  // once the command is through
  const riding = s.ride !== 0 && rideStep(s, pressed, world, events);
  // ...and on a handcar where the car does (handcar.js). Working its lever takes both hands: the weapon in them
  // does nothing while they do
  const carted = s.cart !== 0 ? cartStep(s, b, pressed, world, events, dt) : 0;
  if (carted === CART_PUMP) {
    b &= ~LEVER_HANDS;
    pressed &= ~LEVER_HANDS;
  }
  // at the wheel of a vehicle (vehicles.js): the command drives it, and the body is where it is. Both hands are on
  // the bars or the wheel
  if (s.drive !== 0 && driveStep(s, b, world, events, dt)) {
    if (s.using) putAwayItem(s, events);
    s.reloadT = 0;
    s.recoil = 0;
    if (s.stunT > 0) s.stunT -= dt;
    if (s.leapCd > 0) s.leapCd -= dt;
    if (s.switchT > 0) s.switchT -= dt;
    if (s.cooldown > 0) s.cooldown -= dt;
    s.shove = 0;
    s.lastBtn = cmd.buttons & ~DRIVE_HANDS;
    return s;
  }
  // carried in one: the seat has them (the server puts them in it, wherever it goes). Their hands are their own
  const seated = s.pass !== 0 && !s.zombie && !s.downed && !s.pulled && !s.pinned;
  if (s.pass !== 0 && !seated) s.pass = s.passN = 0; // (pulled out of it, or down: the server puts the body beside it)
  const sx0 = s.x;
  const sy0 = s.y;
  const sz0 = s.z;
  // afloat in the lake or a pond (swim.js): both hands are swimming, and nothing in them works
  const swim = !riding && !carted && !seated && swimming(world, s);
  if (swim) {
    b &= ~SWIM_HANDS;
    pressed &= ~SWIM_HANDS;
  }
  const wade = swim || s.zombie ? 0 : wadeDepth(world, s.x, s.y, s.z);
  const disabled = s.pinned || s.stunT > 0 || riding || carted || seated;
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
  s.crouch = !s.zombie && (s.downed || (b & BTN.CROUCH && !disabled && !swim && wade < CROUCH_WADE)) ? 1 : 0; // (never ducking the eyes under the water)
  const weapon = currentWeapon(s);
  const wdef = WEAPONS[weapon];
  const aiming = !s.hmg && !!(b & BTN.ALT) && wdef && !wdef.melee && s.reloadT <= 0 && s.switchT <= 0;
  const moving = wl > 0;
  const pm = perkMods(s.zombie ? 0 : s.perks);
  let sprint = 0;
  if (s.zombie) {
    s.stamina = STAMINA_MAX;
    s.exhausted = 0;
  } else if (swim) {
    // in deep water stamina only goes: treading water, swimming, hard strokes at the sprinting rate. Run out and the
    // survivor is exhausted and drowning (the server: Game.updatePlayers) until their feet find the bottom again
    sprint = b & BTN.SPRINT && fwd > 0 && !s.exhausted && s.stamina > 0 && !s.downed ? 1 : 0;
    s.stamina -= (sprint && moving ? STAMINA_DRAIN * pm.staminaDrain : (moving ? SWIM_DRAIN : SWIM_TREAD) * pm.swimDrain) * dt;
    s.staminaDelay = STAMINA_REGEN_DELAY;
    if (s.stamina <= 0) {
      s.stamina = 0;
      if (!s.exhausted && events) events.push({ type: 'exhausted' });
      s.exhausted = 1;
    }
  } else {
    sprint = b & BTN.SPRINT && fwd > 0 && !s.crouch && !s.exhausted && s.stamina > 0 && !aiming && !s.downed ? 1 : 0;
    if (sprint && moving) {
      s.stamina -= STAMINA_DRAIN * pm.staminaDrain * dt;
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
  let wishSpeed = s.zombie ? ZOMBIE_PLAYER_SPEED : s.downed ? DOWN_CRAWL_SPEED : sprint ? SPRINT_SPEED * pm.sprint : s.crouch ? CROUCH_SPEED : WALK_SPEED;
  if (swim) wishSpeed = s.downed ? SWIM_DOWNED : (sprint ? SWIM_FAST : SWIM_SPEED) * pm.swim;
  else if (wade > WADE_FROM) wishSpeed *= 1 - WADE_SLOW * Math.min(1, (wade - WADE_FROM) / (SWIM_DEPTH - WADE_FROM)); // wading in deeper
  if (aiming) wishSpeed *= 0.62;
  if (s.hmg) wishSpeed *= GUN_CARRY_SPEED;
  if (!moving) wishSpeed = 0;

  if (s.stunT > 0) s.stunT -= dt;
  if (s.leapCd > 0) s.leapCd -= dt;

  // pinned by a leaper: both hands on it, shoving (SHOVE_*). Every press counts at once (the event: the client's early
  // presses go into the first command they act in, inputbuffer.js); full, the server throws it off (Zombies.throwOff)
  const pinned = s.pinned && !s.zombie;
  if (pinned) {
    if (cmd.buttons & BTN.JUMP & ~s.lastBtn) {
      s.shove = Math.min(1, s.shove + SHOVE_PRESS);
      if (events) events.push({ type: 'shove', v: s.shove });
    } else if (cmd.buttons & BTN.JUMP) s.shove = Math.min(1, s.shove + SHOVE_HOLD * dt);
    else s.shove = Math.max(0, s.shove - SHOVE_SLIP * dt);
  } else s.shove = 0;

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
      const drop = Math.max(sp, 1.6) * (swim ? SWIM_DRAG : FRICTION) * dt;
      const ns = Math.max(0, sp - drop);
      s.vx *= ns / sp;
      s.vz *= ns / sp;
    }
    const cur = s.vx * wx + s.vz * wz;
    const add = wishSpeed - cur;
    if (add > 0 && moving) {
      const acc = Math.min((swim ? SWIM_ACCEL : GROUND_ACCEL) * dt * wishSpeed, add);
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

  // jumping / zombie leap (not afloat: there is nothing to push off)
  if (!disabled && s.onGround && !s.pulled && !s.downed && !swim) {
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
  // a survivor swims where the water is deep (below); a turned one, like the rest of the dead, stops at its edge, and
  // so does one carrying the mounted gun, which nobody swims with (they wade as far as their feet keep the bottom)
  if ((!human && deepWaterAt(world, _pos.x, _pos.z, s.y, PLAYER_RADIUS * 0.7, human)) || (s.hmg && waterFloor(world, s, _pos.x, _pos.z) > groundAt(world, _pos.x, _pos.z, s.y, PLAYER_RADIUS * 0.7, human))) {
    _pos.x = ox;
    _pos.z = oz;
    s.vx = 0;
    s.vz = 0;
  }
  const lim = world.half - 3; // (the world being played: the mainland is twice the island across)
  if (_pos.x < -lim) _pos.x = -lim;
  if (_pos.x > lim) _pos.x = lim;
  if (_pos.z < -lim) _pos.z = -lim;
  if (_pos.z > lim) _pos.z = lim;
  if (hit && s.onGround) {
    s.vx = (_pos.x - ox) / dt;
    s.vz = (_pos.z - oz) / dt;
  }
  let ground = groundAt(world, _pos.x, _pos.z, s.y, PLAYER_RADIUS * 0.7, human);
  // ...and where the water is deeper than they stand it holds them up (swim.js): a floor at the float height
  const water = human && !riding && !carted ? waterFloor(world, s, _pos.x, _pos.z) : -Infinity;
  const afloat = water > ground;
  if (afloat) ground = water;
  let ny = s.y + s.vy * dt;
  const wasGround = s.onGround;
  if (ny <= ground) {
    if (!wasGround && afloat) {
      if (s.vy < -3 && events) events.push({ type: 'splash', v: -s.vy }); // into the water: no fall hurts there
    } else if (!wasGround && s.vy < -9 && events) events.push({ type: 'land', v: -s.vy });
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
  if (riding) rideCarry(s, world);
  else if (carted) cartCarry(s, world);
  else if (seated) {
    s.x = sx0;
    s.y = sy0;
    s.z = sz0;
    s.vx = s.vy = s.vz = 0;
    s.onGround = 1;
  }

  // both hands on the leaper (pinned): an item in them is put away and a reload let go of
  if (pinned) {
    if (s.using) putAwayItem(s, events);
    s.reloadT = 0;
    s.recoil = 0;
  }
  // both arms round the mounted gun, or both hands shoving a leaper off: no weapon goes off, reloads, throws or swings
  // (the clocks run on)
  if (s.hmg || pinned) {
    if (s.switchT > 0) s.switchT -= dt;
    if (s.cooldown > 0) s.cooldown -= dt;
    s.lastBtn = cmd.buttons;
    return s;
  }

  // ------------------------------------------------ weapons
  if (s.switchT > 0) s.switchT -= dt;
  const cd0 = s.cooldown;
  if (s.cooldown > 0) s.cooldown -= dt;
  const attack = b & BTN.ATTACK;
  const attackPressed = pressed & BTN.ATTACK;

  if (s.using) {
    // The hands are busy with an item (Game.useItem) and nothing in them goes off: no shot, swing, throw or reload.
    // A click puts the item away and brings the weapon back out instead, and that click is not a shot. A button
    // held down since before the item came out is not a click.
    s.reloadT = 0;
    s.recoil = 0;
    if (attackPressed) putAwayItem(s, events);
  } else if (s.zombie) {
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
  } else if (wdef && wdef.nunchaku) {
    // a moveset: combos, blows that land a set time into a move, a heavy attack that is wound up (shared/nunchaku.js).
    // Its combo step, its window and its wind-up ride in recoil, cooldown (below zero) and reloadT
    simNunchaku(s, b, cd0, weapon, events, dt);
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
              s.reloadT = wdef.reload * pm.reload;
              if (events) events.push({ type: 'reload', each: true, time: s.reloadT });
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
      s.reloadT = wdef.reload * pm.reload;
      s.recoil = 0;
      if (events) events.push({ type: 'reload', each: !!wdef.reloadEach, time: s.reloadT });
    } else if ((wdef.auto ? attack : attackPressed) && s.cooldown <= 0 && s.switchT <= 0 && s.reloadT <= 0) {
      if (s.mags[mi] > 0) {
        s.mags[mi]--;
        s.cooldown = wdef.rate;
        const spread = shotSpread(s, wdef, aiming);
        const recoilPitch = Math.min(s.recoil, 8) * wdef.recoil * 0.45;
        s.recoil += pm.recoil;
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

  s.lastBtn = cmd.buttons; // (as held: hands that come off the lever onto a trigger held down have not clicked it)
  return s;
}
