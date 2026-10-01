// Snapshot / message decoding. Pure JS (no DOM, no three.js) so it also runs in Node test bots.
import { ENT, POS_DELTA_BIT, dqpos, dqangle16, dqangle8, dqpitch } from '../../shared/protocol.js';
import { EVT, AMMO_ITEMS } from '../../shared/defs.js';

const FIELD_COUNT = { [ENT.PLAYER]: 9, [ENT.ZOMBIE]: 7, [ENT.ITEM]: 4, [ENT.STRUCTURE]: 5, [ENT.PROJECTILE]: 3, [ENT.CRATE]: 4, [ENT.AREA]: 3, [ENT.CACHE]: 4, [ENT.CAT]: 5 };
const BIT_SLOTS = {
  [ENT.PLAYER]: [[0, 3], [3, 5], [5, 6], [6, 7], [7, 8], [8, 9]],
  [ENT.ZOMBIE]: [[0, 3], [3, 4], [4, 5], [5, 6], [6, 7]],
  [ENT.ITEM]: [[0, 3], [3, 4]],
  [ENT.STRUCTURE]: [[0, 3], [3, 4], [4, 5]],
  [ENT.PROJECTILE]: [[0, 3]],
  [ENT.CRATE]: [[0, 3], [3, 4]],
  [ENT.AREA]: [[0, 3]],
  [ENT.CACHE]: [[0, 3], [3, 4]],
  [ENT.CAT]: [[0, 3], [3, 4], [4, 5]],
};

function readField(r, kind, s) {
  if (s < 3) return r.i16();
  switch (kind) {
    case ENT.PLAYER:
      if (s === 3 || s === 5) return r.u16();
      if (s === 4) return r.i16();
      return r.u8();
    case ENT.ZOMBIE:
      if (s === 6) return r.u16();
      return r.u8();
    case ENT.ITEM:
      return r.u16();
    default:
      return r.u8();
  }
}

export function readGlobal(r) {
  const g = {
    phase: r.u8(),
    day: r.u8(),
    timeLeft: r.u16() / 10,
    hordeLeft: (() => {
      const v = r.u16();
      return v === 0xffff ? -1 : v;
    })(),
    bossId: r.u16(),
    supplies: [r.u8(), r.u8(), r.u8(), r.u8(), r.u8()],
    hints: [r.u8(), r.u8(), r.u8(), r.u8(), r.u8(), r.u8(), r.u8()],
    unlocked: r.u8(),
    wave: r.u8(),
    waves: r.u8(),
    escapeT: r.u16() / 10,
    flags: r.u8(),
    humansAlive: r.u8(),
    playersTotal: r.u8(),
    restartT: r.f32(),
    phaseLen: r.u16(),
  };
  g.finale = !!(g.flags & 1);
  g.suppliesDone = !!(g.flags & 2);
  g.escapeReady = !!(g.flags & 4);
  return g;
}

// Self state arrives as change-masked chunks; `out` keeps the previous values of absent chunks.
export function readSelf(r, out) {
  const mask = r.u8();
  if (!out.weapons) out.weapons = [0, 0, 0, 0, 0];
  if (!out.mags) out.mags = [0, 0];
  if (!out.ammo) out.ammo = AMMO_ITEMS.map(() => 0);
  if (mask & 1) {
    out.x = r.f32();
    out.y = r.f32();
    out.z = r.f32();
    out.vx = r.f32();
    out.vy = r.f32();
    out.vz = r.f32();
  }
  if (mask & 2) {
    const f = r.u16();
    out.onGround = f & 1 ? 1 : 0;
    out.crouch = f & 2 ? 1 : 0;
    out.exhausted = f & 4 ? 1 : 0;
    out.zombie = f & 8 ? 1 : 0;
    out.pulled = f & 16 ? 1 : 0;
    out.pinned = f & 32 ? 1 : 0;
    out.sprinting = f & 64 ? 1 : 0;
    out.alive = f & 128 ? 1 : 0;
    out.flashlight = f & 256 ? 1 : 0;
    out.downed = f & 512 ? 1 : 0;
    out.stamina = r.u16() / 100;
    out.staminaDelay = r.u16() / 1000;
  }
  if (mask & 4) {
    out.slot = r.u8();
    out.switchT = r.u16() / 1000;
    out.cooldown = r.u16() / 1000;
    out.reloadT = r.u16() / 1000;
    out.recoil = r.u16() / 1000;
    out.lastBtn = r.u16();
    out.fireCount = r.u8();
  }
  if (mask & 8) {
    for (let i = 0; i < 5; i++) out.weapons[i] = r.u8();
    out.mags[0] = r.u8();
    out.mags[1] = r.u8();
    for (let i = 0; i < AMMO_ITEMS.length; i++) out.ammo[i] = r.u16();
    out.throwCount = r.u8();
  }
  if (mask & 16) {
    out.leapCd = r.u16() / 1000;
    out.stunT = r.u16() / 1000;
    if (out.pulled) {
      out.pullX = r.f32();
      out.pullY = r.f32();
      out.pullZ = r.f32();
    } else out.pullX = out.pullY = out.pullZ = 0;
  }
  if (mask & 32) {
    out.hp = r.u16();
    out.maxHp = r.u16();
    out.armor = r.u8();
    out.armorMax = r.u8();
    out.battery = r.u8();
    out.useItem = r.u8();
    out.useProgress = r.u8() / 255;
    out.respawnT = r.f32();
    out.holdKind = r.u8();
    out.holdProgress = r.u8() / 255;
    out.bleed = r.u8() / 4;
    out.beingRevived = r.u8();
  }
  return out;
}

// store: { ents: Map, onCreate(e), onRemove(e), onUpdate(e, mask) }
// entity record: { id, kind, q: Int32Array(9), ...static attrs }
export function readEntities(r, store, tick) {
  const nRem = r.u16();
  for (let i = 0; i < nRem; i++) {
    const id = r.u16();
    const e = store.ents.get(id);
    if (e) {
      store.ents.delete(id);
      store.onRemove(e, tick);
    }
  }
  const nCre = r.u16();
  for (let i = 0; i < nCre; i++) {
    const id = r.u16();
    const kind = r.u8();
    const e = { id, kind, q: new Int32Array(9) };
    switch (kind) {
      case ENT.ZOMBIE:
        e.ztype = r.u8();
        e.variant = r.u8();
        break;
      case ENT.ITEM:
        e.item = r.u8();
        break;
      case ENT.STRUCTURE:
        e.stype = r.u8();
        e.rot8 = r.u8();
        break;
      case ENT.PROJECTILE:
        e.ptype = r.u8();
        e.owner = r.u16();
        break;
      case ENT.AREA:
        e.atype = r.u8();
        e.radius = r.u8() / 10;
        break;
      case ENT.CACHE:
        e.ctype = r.u8();
        break;
      case ENT.CAT:
        e.variant = r.u8();
        break;
    }
    const n = FIELD_COUNT[kind];
    for (let s = 0; s < n; s++) e.q[s] = readField(r, kind, s);
    const old = store.ents.get(id);
    if (old) store.onRemove(old, tick);
    store.ents.set(id, e);
    store.onCreate(e, tick);
  }
  const nUpd = r.u16();
  for (let i = 0; i < nUpd; i++) {
    const id = r.u16();
    const m = r.u8();
    const e = store.ents.get(id);
    if (!e) throw new Error(`update for unknown entity ${id}`);
    const bits = BIT_SLOTS[e.kind];
    const delta = m & POS_DELTA_BIT;
    for (let bi = 0; bi < bits.length; bi++) {
      if (!(m & (1 << bi))) continue;
      const [s0, s1] = bits[bi];
      if (bi === 0 && delta) {
        e.q[0] += r.i8();
        e.q[1] += r.i8();
        e.q[2] += r.i8();
      } else {
        for (let s = s0; s < s1; s++) e.q[s] = readField(r, e.kind, s);
      }
    }
    store.onUpdate(e, m & 0x7f, tick);
  }
}

export function readEvents(r, handler) {
  const n = r.u8();
  for (let i = 0; i < n; i++) {
    const type = r.u8();
    switch (type) {
      case EVT.SOUND:
        handler.sound(r.u8(), dqpos(r.i16()), dqpos(r.i16()), dqpos(r.i16()));
        break;
      case EVT.SHOT: {
        const ev = {
          shooter: r.u16(),
          weapon: r.u8(),
          x: dqpos(r.i16()),
          y: dqpos(r.i16()),
          z: dqpos(r.i16()),
          yaw: dqangle16(r.u16()),
          pitch: dqpitch(r.i16()),
          seed: r.u16(),
          spread: r.u16() / 10000,
          recoilPitch: r.u16() / 10000,
        };
        handler.shot(ev);
        break;
      }
      case EVT.IMPACT:
        handler.impact(r.u8(), dqpos(r.i16()), dqpos(r.i16()), dqpos(r.i16()), r.i8() / 127, r.i8() / 127, r.i8() / 127);
        break;
      case EVT.HITMARK:
        handler.hitmark(r.u8());
        break;
      case EVT.DAMAGE:
        handler.damage(r.u8(), dqpos(r.i16()), dqpos(r.i16()));
        break;
      case EVT.KILLFEED:
        handler.killfeed(r.u8(), r.u16(), r.u16(), r.u8(), r.u8());
        break;
      case EVT.NOTIFY:
        handler.notify(r.u8(), r.u16());
        break;
      case EVT.EXPLOSION:
        handler.explosion(dqpos(r.i16()), dqpos(r.i16()), dqpos(r.i16()), r.u8() / 10, r.u8());
        break;
      case EVT.PICKUP:
        handler.pickup(r.u8(), r.u16());
        break;
      case EVT.ZOMBIE_DIE:
        handler.zombieDie(r.u16(), dqangle8(r.u8()), r.u8());
        break;
      case EVT.STRUCT_BREAK:
        handler.structBreak(dqpos(r.i16()), dqpos(r.i16()), dqpos(r.i16()), r.u8());
        break;
      case EVT.PING:
        handler.ping?.(r.u16(), r.u8(), dqpos(r.i16()), dqpos(r.i16()), dqpos(r.i16()));
        break;
      case EVT.FLYOVER: {
        // read first: an optional call would skip its arguments (and the bytes) when there's no handler
        const x = dqpos(r.i16()), y = dqpos(r.i16()), z = dqpos(r.i16()), heading = dqangle16(r.u16()), eta = r.u16() / 1000;
        handler.flyover?.(x, y, z, heading, eta);
        break;
      }
      case EVT.SUMMARY:
        handler.summary?.({ night: r.u8(), kills: r.u16(), structLost: r.u8(), downs: r.u8(), deaths: r.u8(), revives: r.u8() });
        break;
      default:
        throw new Error(`unknown event ${type}`);
    }
  }
}

export { dqpos, dqangle16, dqangle8, dqpitch };
