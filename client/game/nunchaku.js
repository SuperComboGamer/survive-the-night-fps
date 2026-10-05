// Nunchucks, client side: what their own motion sounds like, and what a blow of them meets - for how it looks and
// sounds only. Which move it is, when it lands and what it hurts are the simulation's and the server's
// (shared/nunchaku.js, server/combat.js); the moves themselves are render/models/nunchaku.js.
import { ITEM, WEAPONS, ZOMBIE_DEFS, STRUCT_DEFS } from '../../shared/defs.js';
import { NK_MOVES } from '../../shared/nunchaku.js';
import { ENT, PFLAG } from '../../shared/protocol.js';
import { eyeHeight } from '../../shared/playersim.js';
import { raycastWorld, COL } from '../../shared/collision.js';

const _ray = { t: -1, col: null, terrain: false };
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

/**
 * Play what a rig's core did since it was last asked (core.events), and forget it. at: where in the world the
 * survivor is ({ x, y, z }), or null for our own hands (not placed: in the head). st: that rig's own { rattleT }.
 * The whoosh is one recording, played faster the faster the free handle is going: a lazy flourish is a breath, a
 * strike is a whip-crack, and a whirl wound up to speed climbs as it goes.
 */
export function nkSounds(audio, core, at, st, now) {
  const evs = core.events;
  if (!evs.length) return;
  const pos = at ? { x: at.x, y: at.y, z: at.z, cat: 'fx' } : {};
  const far = at ? 0.8 : 1;
  for (const e of evs) {
    switch (e.type) {
      case 'whoosh':
        audio.playBank('nk_whoosh', { ...pos, volume: clamp(e.v / 38, 0.3, 1) * 0.55 * far, rate: clamp(0.62 + e.v / 48, 0.75, 1.55) });
        break;
      case 'whirl': {
        // (rad/s round: 2.5 turns a second is a low whup, 5 a hum with an edge on it)
        const rev = e.v / (Math.PI * 2);
        audio.playBank('nk_whoosh', { ...pos, volume: clamp(0.2 + rev * 0.09, 0.2, 0.6) * far, rate: clamp(0.5 + rev * 0.17, 0.6, 1.45) });
        break;
      }
      case 'rattle':
        if (now - (st.rattleT || 0) > 0.07) {
          st.rattleT = now;
          audio.playBank('nk_rattle', { ...pos, volume: clamp(e.v, 0.25, 1) * 0.3 * far, rate: 0.9 + Math.random() * 0.25 });
        }
        break;
      case 'knock':
        if (e.kind === 'wood') audio.playBank('nk_clack', { ...pos, volume: clamp(e.v / 14, 0.15, 0.8) * far, rate: 0.92 + Math.random() * 0.16 });
        else if (e.v > 5) audio.playBank('nk_catch', { ...pos, volume: clamp(e.v / 25, 0.1, 0.4) * far, rate: 0.8 });
        break;
      case 'catch':
        audio.playBank('nk_catch', { ...pos, volume: (e.kind === 'o' ? 0.75 : 0.4) * far, rate: e.kind === 'o' ? 1 : 0.85 });
        break;
      case 'pass':
        audio.playBank('nk_catch', { ...pos, volume: 0.5 * far, rate: 1.08 });
        break;
      case 'release':
        audio.playBank('nk_rattle', { ...pos, volume: 0.16 * far, rate: 1.1 });
        break;
      case 'draw':
        audio.playBank('nk_draw', { ...pos, volume: 0.7 * far });
        break;
      case 'hit':
        audio.playBank('nk_hit_' + (HIT_BANK[e.kind] || 'dirt'), { ...pos, volume: clamp(0.6 + 0.3 * e.v, 0.5, 1) * far, rate: 0.95 + Math.random() * 0.1 });
        break;
    }
  }
  evs.length = 0;
}
const HIT_BANK = { flesh: 'flesh', bone: 'bone', wood: 'wood', metal: 'metal', dirt: 'dirt' };

/**
 * What a blow of ours meets, as this client sees the world: { kind, power, nx, ny, nz } (the surface's normal in the
 * view's own space), or null for a miss. The same reach and arc as the server's rule (Combat.melee), on what is drawn
 * - so the free handle comes off a skull the moment the blow lands and not a round trip later. It hurts nothing.
 */
export function nkStrike(game, s, ev) {
  const mv = NK_MOVES[ev.move];
  if (!mv) return null;
  const range = (WEAPONS[ITEM.NUNCHAKU].range + mv.reach) * (game.diff?.melee || 1);
  const ox = s.x, oy = s.y + eyeHeight(s), oz = s.z;
  const cp = Math.cos(s.pitch);
  const fx = -Math.sin(s.yaw) * cp, fy = Math.sin(s.pitch), fz = -Math.cos(s.yaw) * cp;
  const hx = -Math.sin(s.yaw), hz = -Math.cos(s.yaw);
  const power = mv.heavy ? 1 + 0.15 * mv.heavy : mv.damage > 60 ? 1.25 : 0.8;
  let best = null, bestScore = Infinity;
  for (const e of game.entities.ents.values()) {
    let r, top;
    if (e.kind === ENT.ZOMBIE) {
      if (e.dead) continue;
      const d = ZOMBIE_DEFS[e.ztype];
      r = d.radius;
      top = d.headY;
    } else if (e.kind === ENT.DEER) {
      r = 0.5;
      top = 1.1;
    } else if (e.kind === ENT.PLAYER) {
      if (e.id === game.myId || !(e.q[5] & PFLAG.ZOMBIE) || e.q[5] & PFLAG.DEAD) continue;
      r = 0.35;
      top = 1.6;
    } else continue;
    const dx = e.rx - ox, dz = e.rz - oz;
    const l = Math.hypot(dx, dz) || 1, dist = l - r;
    if (dist > range) continue;
    const ty = Math.max(e.ry + 0.2, Math.min(e.ry + top, oy));
    if (Math.abs(ty - oy) > 2.2) continue;
    const dot = (dx / l) * hx + (dz / l) * hz;
    if (dot < 0.45 && dist > 0.3) continue;
    if (dist - dot < bestScore) {
      bestScore = dist - dot;
      // (aimed at about the height of its head: bone)
      const headAt = e.ry + top - oy;
      best = { kind: Math.abs(oy + fy * l - (oy + headAt)) < 0.22 && e.kind === ENT.ZOMBIE ? 'bone' : 'flesh', power };
    }
  }
  if (!best) {
    raycastWorld(game.world, ox, oy, oz, fx, fy, fz, range + 0.3, _ray);
    if (_ray.t < 0) return null;
    const col = _ray.col;
    let kind = 'dirt';
    if (col) {
      if (col.flags & COL.TREE) kind = 'wood';
      else if (col.flags & COL.SALVAGE) kind = 'metal';
      else if (col.flags & COL.STRUCT) kind = STRUCT_DEFS[game.entities.ents.get(col.id)?.stype]?.metal ? 'metal' : 'wood';
    }
    best = { kind, power: power * 0.9 };
  }
  // the surface it came off: square on to the view, a little off to the side it was struck from
  best.nx = (Math.random() - 0.5) * 0.5;
  best.ny = 0.15;
  best.nz = 1;
  return best;
}

/**
 * Somebody's blow landed (the server's SOUND.MELEE_HIT, at their eye and a step ahead): if it is a survivor with
 * nunchucks we can see, their free handle comes off what it struck. Nothing on the wire says whose blow it was;
 * the nearest holder within a step of the sound is taken to be it.
 */
export function nkRemoteHit(game, x, y, z) {
  let who = null, best = 1.8 * 1.8;
  for (const e of game.entities.ents.values()) {
    if (e.kind !== ENT.PLAYER || e.weapon !== ITEM.NUNCHAKU || !e.view) continue;
    const d = (e.rx - x) ** 2 + (e.rz - z) ** 2;
    if (d < best) {
      best = d;
      who = e;
    }
  }
  if (who) who.view.nkHit?.('flesh', 0.9);
}
