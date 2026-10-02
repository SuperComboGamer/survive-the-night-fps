// The shapes a shot is judged against: a body cylinder with a head sphere on it (ahead of the body on what goes on four
// legs, or crawls). The server tests every shot against them (Combat.fire); the client tests its own shots against the
// same shapes, where it has the targets drawn, to show what they strike at once (Game.predictPellet).
import { CRAWL_HEIGHT, CRAWL_HEAD_Y, CRAWL_HEAD_FWD, CRAWL_RADIUS } from './constants.js';
import { rayCylinder, raySphere } from './collision.js';

// a player, survivor or zombie, standing or crouched
export function playerHitbox(zombie, crouch) {
  return { r: zombie ? 0.42 : 0.38, top: crouch ? 1.0 : 1.42, headY: crouch ? 1.12 : 1.6, headR: 0.2, hx: 0, hz: 0 };
}

// a zombie of ZOMBIE_DEFS entry `def` facing `yaw`. legs: the legs shot off it (bit 0 the left, bit 1 the right);
// low: it is in the air or down on a survivor it has pinned, and its head with it
export function zombieHitbox(def, yaw, legs, low) {
  if (def.flying) return { r: 0.45, top: 0.5, headY: 0.1, headR: 0.3, hx: 0, hz: 0, flying: true };
  // both legs gone: it lies on the ground, its head ahead of its body
  if (legs === 3) return { r: CRAWL_RADIUS, top: CRAWL_HEIGHT, headY: CRAWL_HEAD_Y, headR: def.headR * 1.2, hx: -Math.sin(yaw) * CRAWL_HEAD_FWD, hz: -Math.cos(yaw) * CRAWL_HEAD_FWD };
  let headY = def.headY;
  let top = def.bodyTop ?? def.headY - def.headR;
  if (!def.headFwd && low) {
    headY *= 0.7;
    top *= 0.7;
  }
  const f = def.headFwd || 0;
  return { r: def.radius * 0.88, top, headY, headR: def.headR * 1.2, hx: -Math.sin(yaw) * f, hz: -Math.cos(yaw) * f };
}

// Ray against a hitbox standing at pos: distance to the hit or -1, headHit = it took the head.
export let headHit = false;
export function rayHitbox(pos, hb, ox, oy, oz, dx, dy, dz, maxT) {
  const ht = raySphere(pos.x + hb.hx, pos.y + hb.headY, pos.z + hb.hz, hb.headR, ox, oy, oz, dx, dy, dz, maxT);
  const bt = hb.flying ? raySphere(pos.x, pos.y + 0.15, pos.z, 0.5, ox, oy, oz, dx, dy, dz, maxT) : rayCylinder(pos.x, pos.z, pos.y, pos.y + hb.top, hb.r, ox, oy, oz, dx, dy, dz, maxT);
  headHit = ht >= 0 && !hb.flying && (bt < 0 || ht <= bt + 0.05);
  return headHit ? ht : bt;
}
