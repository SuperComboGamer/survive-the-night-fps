// Snapshot / message decoding. Pure JS (no DOM, no three.js) so it also runs in Node test bots.
import { ENT, SNAP, SELF, PFLAG, UPOS, UEXT, UEXT_ABS, dqpos, dqangle16, dqangle8, dqpitch, unpackLookYaw, unpackLookPitch } from '../../shared/protocol.js';
import { CMDS_PER_PACKET, EYE_HEIGHT, EYE_HEIGHT_CROUCH, EYE_HEIGHT_DOWNED, SERVER_DT } from '../../shared/constants.js';
import { EVT, AMMO_ITEMS, PROJ } from '../../shared/defs.js';

const FIELD_COUNT = { [ENT.PLAYER]: 9, [ENT.ZOMBIE]: 9, [ENT.ITEM]: 4, [ENT.STRUCTURE]: 5, [ENT.PROJECTILE]: 3, [ENT.CRATE]: 4, [ENT.AREA]: 3, [ENT.CACHE]: 4, [ENT.CAT]: 5, [ENT.DEER]: 5, [ENT.FAIR]: 9, [ENT.GUN]: 8, [ENT.HANDCAR]: 5 };
const BIT_SLOTS = {
  [ENT.PLAYER]: [[0, 3], [3, 5], [5, 6], [6, 7], [7, 8], [8, 9]],
  [ENT.ZOMBIE]: [[0, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9]],
  [ENT.ITEM]: [[0, 3], [3, 4]],
  [ENT.STRUCTURE]: [[0, 3], [3, 4], [4, 5]],
  [ENT.PROJECTILE]: [[0, 3]],
  [ENT.CRATE]: [[0, 3], [3, 4]],
  [ENT.AREA]: [[0, 3]],
  [ENT.CACHE]: [[0, 3], [3, 4]],
  [ENT.CAT]: [[0, 3], [3, 4], [4, 5]],
  [ENT.GUN]: [[0, 3], [3, 4], [4, 5], [5, 6], [6, 8]],
  [ENT.DEER]: [[0, 3], [3, 4], [4, 5]],
  [ENT.FAIR]: [[0, 3], [3, 4], [4, 7], [7, 9]],
  [ENT.HANDCAR]: [[0, 3], [3, 4], [4, 5]],
};

// reads slots [s0, s1) of an entity record with kind-specific widths
function readFields(r, kind, q, s0, s1) {
  for (let s = s0; s < s1; s++) {
    if (s < 3) q[s] = r.i16();
    else if (kind === ENT.PLAYER) {
      if (s === 3) {
        // the view angles share a u16 (pitch = slot 4)
        const v = r.u16();
        q[3] = unpackLookYaw(v);
        q[4] = unpackLookPitch(v);
      } else if (s === 5) q[s] = r.u16();
      else if (s > 5) q[s] = r.u8();
    } else if (kind === ENT.ZOMBIE) q[s] = s === 6 ? r.u16() : r.u8();
    else if (kind === ENT.ITEM || kind === ENT.GUN || kind === ENT.HANDCAR) q[s] = r.u16();
    else q[s] = r.u8();
  }
}

// Snapshot header (after the message type byte). net = { tick, ack } is the client's running state: an ordinary
// snapshot only says "one tick on, one packet of commands acked". Returns the SNAP flags of the sections that follow.
export function readHeader(r, net) {
  const flags = r.u8();
  if (flags & SNAP.TICK) {
    net.tick = r.u32();
    net.ack = r.u16();
  } else {
    net.tick++;
    net.ack = (net.ack + (flags & SNAP.ACK ? r.varu() : CMDS_PER_PACKET)) & 0xffff;
  }
  return flags;
}

// Decodes a whole snapshot (after the message type byte) for a client with nothing to do between its sections:
// c = { net: { tick, ack }, global, self, store, handler }. Returns true when the self state is a rebase.
export function readSnapshot(r, c) {
  const flags = readHeader(r, c.net);
  if (flags & SNAP.GLOBAL) c.global = readGlobal(r, c.global);
  const sync = readSelf(r, c.self, flags);
  readEntities(r, c.store, c.net.tick, flags);
  readEvents(r, c.handler, flags, c.store.ents);
  return sync;
}

// prev: the global state so far. Between full states the server only sends the clocks.
export function readGlobal(r, prev) {
  if (!r.u8()) {
    const timeLeft = r.u16() / 10;
    const v = r.u16();
    return { ...prev, timeLeft, hordeLeft: v === 0xffff ? -1 : v };
  }
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
    found: r.u8(), // a bit per hint: that supply has been taken from its hiding place
    unlocked: r.u8(),
    wave: r.u8(),
    waves: r.u8(),
    escapeT: r.u16() / 10,
    flags: r.u8(),
    humansAlive: r.u8(),
    playersTotal: r.u8(),
    restartT: r.f32(),
    phaseLen: r.u16(),
    benches: [],
  };
  for (let n = r.u8(); n > 0; n--) g.benches.push({ x: dqpos(r.i16()), z: dqpos(r.i16()) });
  g.finale = !!(g.flags & 1);
  g.suppliesDone = !!(g.flags & 2);
  g.escapeReady = !!(g.flags & 4);
  g.escapeStalled = !!(g.flags & 8); // nobody on their feet at the car: the warm-up has stopped where it is
  g.escapeLeaving = !!(g.flags & 16); // a survivor is getting in to drive
  return g;
}

// Self state: `out` keeps the previous values of whatever is absent. The simulated part (position, stamina, weapon
// state...) only arrives when the server asks for a rebase (returns true: reconcile on `out`); otherwise the
// client's prediction already matches. The status part (hp, armor, battery...) arrives whenever it changes.
export function readSelf(r, out, flags) {
  if (!out.weapons) out.weapons = [0, 0, 0, 0, 0];
  if (!out.mags) out.mags = [0, 0];
  if (!out.ammo) out.ammo = AMMO_ITEMS.map(() => 0);
  if (out.ride === undefined) out.ride = out.rideGo = out.rideT = 0;
  if (out.cart === undefined) out.cart = out.cartS = out.cartV = 0;
  if (out.hmg === undefined) out.hmg = 0;
  if (!(flags & SNAP.SELF)) return false;
  const mask = r.u8();
  if (mask & 1) {
    out.x = r.f32();
    out.y = r.f32();
    out.z = r.f32();
    out.vx = r.f32();
    out.vy = r.f32();
    out.vz = r.f32();
  }
  if (mask & 2) {
    const f = r.u8();
    out.onGround = f & 1 ? 1 : 0;
    out.crouch = f & 2 ? 1 : 0;
    out.exhausted = f & 4 ? 1 : 0;
    out.zombie = f & 8 ? 1 : 0;
    out.pulled = f & 16 ? 1 : 0;
    out.pinned = f & 32 ? 1 : 0;
    out.sprinting = f & 64 ? 1 : 0;
    out.downed = f & 128 ? 1 : 0;
    out.stamina = r.f32();
    out.staminaDelay = r.f32();
  }
  if (mask & 4) {
    out.slot = r.u8();
    out.switchT = r.f32();
    out.cooldown = r.f32();
    out.reloadT = r.f32();
    out.recoil = r.f32();
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
    out.leapCd = r.f32();
    out.stunT = r.f32();
    if (r.u8()) {
      out.pullX = r.f32();
      out.pullY = r.f32();
      out.pullZ = r.f32();
    } else out.pullX = out.pullY = out.pullZ = 0;
  }
  if (mask & SELF.RIDE) {
    out.ride = r.u8();
    out.rideGo = r.u8();
    out.rideT = r.u32();
    out.cart = r.u8();
    out.cartS = r.f32();
    out.cartV = r.f32();
    out.hmg = r.u8();
  }
  if (mask & SELF.STATUS) {
    const m = r.u8();
    if (m & 1) {
      out.hp = r.u16();
      out.maxHp = r.u16();
    }
    if (m & 2) {
      out.armor = r.u8();
      out.armorMax = r.u8();
    }
    if (m & 4) {
      const f = r.u8();
      out.alive = f & 1 ? 1 : 0;
      out.flashlight = f & 2 ? 1 : 0;
      out.beingRevived = f & 4 ? 1 : 0;
      out.battery = r.u8();
    }
    if (m & 8) {
      out.useItem = r.u8();
      out.useProgress = r.u8() / 255;
    }
    if (m & 16) out.respawnT = r.u8();
    if (m & 32) {
      out.holdKind = r.u8();
      out.holdProgress = r.u8() / 255;
    }
    if (m & 64) out.bleed = r.u8() / 4;
  }
  // (the simulation's hands-busy flag is not sent on its own: the server holds it up exactly while an item is in use,
  // Game.endUse)
  out.using = out.useItem ? 1 : 0;
  return !!(mask & SELF.SYNC);
}

// store: { ents: Map, onCreate(e), onRemove(e), onUpdate(e, mask) }
// entity record: { id, kind, q: Int32Array(9), ...static attrs }
export function readEntities(r, store, tick, flags) {
  if (flags & SNAP.REMOVES) {
    let id = 0;
    for (let n = r.varu(); n > 0; n--) {
      id += r.varu();
      const e = store.ents.get(id);
      if (e) {
        store.ents.delete(id);
        store.onRemove(e, tick);
      }
    }
  }
  if (flags & SNAP.CREATES) {
    for (let n = r.varu(); n > 0; n--) {
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
          if (e.ptype === PROJ.SKYFLARE) {
            e.age = r.u16() * SERVER_DT; // (s since the shot when this was written)
            e.tOpen = r.u8() / 20;
          }
          break;
        case ENT.AREA:
          e.atype = r.u8();
          e.radius = r.u8() / 10;
          break;
        case ENT.CACHE:
          e.ctype = r.u8();
          break;
        case ENT.CAT:
        case ENT.DEER:
          e.variant = r.u8();
          break;
        case ENT.HANDCAR:
          e.k = r.u8(); // (which of the valley's cars: shared/handcar.js)
          break;
      }
      readFields(r, kind, e.q, 0, FIELD_COUNT[kind]);
      const old = store.ents.get(id);
      if (old) store.onRemove(old, tick);
      store.ents.set(id, e);
      store.onCreate(e, tick);
    }
  }
  if (flags & SNAP.UPDATES) {
    let id = 0;
    for (let n = r.varu(); n > 0; n--) {
      const head = r.u8();
      id += head & 3 || r.varu();
      const ext = head & UEXT ? r.u8() : 0;
      const e = store.ents.get(id);
      if (!e) throw new Error(`update for unknown entity ${id}`);
      const q = e.q;
      const pos = (head >> 2) & 3;
      let mask = ((head >> 3) & 0b1110) | ((ext & 0x3f) << 4);
      if (pos) {
        mask |= 1;
        if (pos === UPOS.NIB) {
          const v = r.u8();
          q[0] += (v << 24) >> 28;
          q[2] += (v << 28) >> 28;
        } else if (pos === UPOS.PACK) {
          const v = r.u16();
          q[0] += (v << 16) >> 26;
          q[2] += (v << 22) >> 26;
          q[1] += (v << 28) >> 28;
        } else if (ext & UEXT_ABS) readFields(r, e.kind, q, 0, 3);
        else {
          q[0] += r.i8();
          q[1] += r.i8();
          q[2] += r.i8();
        }
      }
      const bits = BIT_SLOTS[e.kind];
      for (let bi = 1; bi < bits.length; bi++) {
        if (mask & (1 << bi)) readFields(r, e.kind, q, bits[bi][0], bits[bi][1]);
      }
      store.onUpdate(e, mask, tick);
    }
  }
}

// ents: the entity store's Map (a shot's origin is where its shooter stands)
export function readEvents(r, handler, flags, ents) {
  const n = flags & SNAP.EVENTS ? r.u8() : 0;
  for (let i = 0; i < n; i++) {
    const type = r.u8();
    switch (type) {
      case EVT.SOUND:
        handler.sound(r.u8(), dqpos(r.i16()), dqpos(r.i16()), dqpos(r.i16()));
        break;
      case EVT.SHOT: {
        const ev = { shooter: r.u16(), weapon: r.u8(), x: 0, y: 0, z: 0, yaw: dqangle16(r.u16()), pitch: dqpitch(r.i16()), seed: r.u16(), spread: r.u8() / 500, recoilPitch: r.u8() / 500 };
        // fired from the shooter's eyes, as of this snapshot
        const q = ents?.get(ev.shooter)?.q;
        if (!q) break;
        ev.x = dqpos(q[0]);
        ev.y = dqpos(q[1]) + (q[5] & PFLAG.DOWNED ? EYE_HEIGHT_DOWNED : q[5] & PFLAG.CROUCH ? EYE_HEIGHT_CROUCH : EYE_HEIGHT);
        ev.z = dqpos(q[2]);
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
      case EVT.ZOMBIE_LEG: {
        const id = r.u16(), legs = r.u8(), yaw = dqangle8(r.u8());
        handler.zombieLeg?.(id, legs, yaw);
        break;
      }
      case EVT.PONG: {
        const held = r.u8();
        handler.pong?.(held);
        break;
      }
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
      case EVT.STRIPPED:
        // left quantized: they name colliders (harvest.js strippedKey), they are not places to draw anything at
        for (let k = r.u8(); k > 0; k--) {
          const x = r.i16(), y = r.i16(), z = r.i16();
          handler.stripped?.(x, y, z);
        }
        break;
      case EVT.REGROWN:
        handler.regrown?.();
        break;
      case EVT.FELL: {
        // (the tree's name left quantized, as STRIPPED's)
        const x = r.i16(), y = r.i16(), z = r.i16(), yaw = dqangle8(r.u8());
        handler.fell?.(x, y, z, yaw);
        break;
      }
      case EVT.GRAVE: {
        const grave = r.u8();
        handler.grave?.(grave);
        break;
      }
      default:
        throw new Error(`unknown event ${type}`);
    }
  }
}

export { dqpos, dqangle16, dqangle8, dqpitch };
