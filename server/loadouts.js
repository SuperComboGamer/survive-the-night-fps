// Game-side loadout items: talks to userloadout.js on the network thread, applies equipped profile items once per run,
// and marks in-run copies so they cannot be dropped, salvaged, traded or stored.
import { randomUUID } from 'node:crypto';
import { CHATF } from '../shared/protocol.js';
import { ITEM_DEFS, WEAPONS, isFirearm } from '../shared/defs.js';
import { LOADOUT_CATALOG, loadoutDef, loadoutMods, loadoutName } from '../shared/loadout.js';
import { SKULL_EARN, nightSkulls } from '../shared/economy.js';
import { NO_PERKS, perkMods } from '../shared/progress.js';
import { freeSlot, invCap } from './inventory.js';
import { LoadoutService, MemoryLoadoutStore } from './userloadout.js';

const BOSS_POOL = new Map();
for (const def of LOADOUT_CATALOG) if (def.source?.kind === 'boss') {
  const list = BOSS_POOL.get(def.source.boss) || [];
  list.push(def.id);
  BOSS_POOL.set(def.source.boss, list);
}
const COMMON_POOL = LOADOUT_CATALOG.filter((def) => def.source?.kind !== 'boss').map((def) => def.id);
const ALL_POOL = LOADOUT_CATALOG.map((def) => def.id);

export const LOADOUT_BOSS_CHANCE = 0.15;
export const LOADOUT_STRONGBOX_CHANCE = 0.02;

export function playerMods(p) {
  const base = perkMods(p?.perks || 0);
  const lm = p?.loadoutMods || NO_PERKS;
  if (lm === NO_PERKS) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(lm)) {
    if (!(k in out) || v === NO_PERKS[k]) continue;
    if (NO_PERKS[k] === 1) out[k] *= v;
    else out[k] += v;
  }
  return out;
}

export const isLoadoutStack = (it) => !!it?.loadout;
export const isLoadoutWeapon = (p, slot) => !!p.loadoutWeapons?.[slot];
export const isLoadoutArmor = (p) => !!p.loadoutArmor;
export const isLoadoutBackpack = (p) => !!p.loadoutBackpack;

export function clearLoadoutRun(p) {
  p.loadoutApplied = false;
  p.loadoutItems = [];
  p.loadoutMods = NO_PERKS;
  p.loadoutWeapons = [null, null, null, null, null];
  p.loadoutArmor = null;
  p.loadoutBackpack = null;
}

export class LocalLoadouts {
  constructor(service = null) {
    this.service = service || new LoadoutService({ store: new MemoryLoadoutStore() });
    this.loadouts = null;
    this.room = { closed: false, code: 'local', worker: { postMessage: (m) => queueMicrotask(() => !this.room.closed && this.loadouts?.fromStore(m)) } };
  }
  attach(loadouts) {
    this.loadouts = loadouts;
  }
  post(m) {
    this.service.fromRoom(this.room, { t: 'loadout', ...m });
  }
  gone() {
    this.room.closed = true;
    this.service.roomGone(this.room);
  }
}

export class Loadouts {
  constructor(game, link = null) {
    this.game = game;
    this.link = link || new LocalLoadouts();
    this.link.attach?.(this);
    this.own = new Map(); // owner -> { items, slots, loaded, n }
  }

  use(owner) {
    let o = this.own.get(owner);
    if (!o) {
      this.own.set(owner, (o = { items: [], slots: [null, null, null], loaded: false, n: 0 }));
      this.link.post({ op: 'enter', owner });
    }
    o.n++;
  }
  unuse(owner) {
    const o = this.own.get(owner);
    if (!o || --o.n > 0) return;
    this.own.delete(owner);
    this.link.post({ op: 'leave', owner });
  }
  join(p) {
    if (p.rejoinKey && !p.loadoutEntered) {
      p.loadoutEntered = true;
      this.use(p.rejoinKey);
    }
    this.apply(p);
  }
  leave(p) {
    if (p.loadoutEntered) this.unuse(p.rejoinKey);
    p.loadoutEntered = false;
  }
  fromStore(m) {
    if (m.op !== 'coll') return;
    const o = this.own.get(m.owner);
    if (!o) return;
    o.loaded = m.ok === true;
    o.items = Array.isArray(m.items) ? m.items : [];
    o.slots = Array.isArray(m.slots) ? m.slots : [null, null, null];
    for (const p of this.game.players.values()) if (p.rejoinKey === m.owner) this.apply(p);
  }
  equipped(owner) {
    const o = this.own.get(owner);
    if (!o?.loaded) return [];
    const byId = new Map(o.items.map((it) => [it.id, it]));
    return o.slots.map((id) => byId.get(id)).filter(Boolean);
  }
  apply(p) {
    if (p.loadoutApplied || !p.rejoinKey || !p.alive || p.zombie) return false;
    const equipped = this.equipped(p.rejoinKey);
    if (!equipped.length && !this.own.get(p.rejoinKey)?.loaded) return false;
    p.loadoutApplied = true;
    p.loadoutItems = equipped.map((it) => it.id);
    p.loadoutMods = loadoutMods(equipped.map((it) => loadoutDef(it.catalog)).filter(Boolean));
    for (const owned of equipped) this.grantRunCopy(p, owned, loadoutDef(owned.catalog));
    if (p.loadoutMods.hp) {
      p.maxHp += p.loadoutMods.hp;
      p.hp += p.loadoutMods.hp;
    }
    if (equipped.length) p.invDirty = true;
    return true;
  }
  grantRunCopy(p, owned, def) {
    const grant = def?.grant || {};
    const marker = owned.id;
    const item = grant.item | 0;
    const count = Math.max(1, grant.count | 0 || 1);
    for (const [cal, n] of grant.ammo || []) if (Number.isInteger(cal) && cal >= 0 && cal < p.state.ammo.length) p.state.ammo[cal] += Math.max(0, n | 0);
    if (!item || !ITEM_DEFS[item]) return;
    const cat = ITEM_DEFS[item].cat;
    if (cat === 'weapon') {
      const slot = WEAPONS[item].slot;
      if (!p.state.weapons[slot]) {
        p.state.weapons[slot] = item;
        p.loadoutWeapons[slot] = marker;
        if (slot === 0) p.state.mags[0] = grant.mag ?? (isFirearm(item) ? WEAPONS[item].mag : 0);
        if (slot === 1) p.state.mags[1] = grant.mag ?? (isFirearm(item) ? WEAPONS[item].mag : 0);
        return;
      }
    } else if (cat === 'armor' && !p.armorItem) {
      p.armorItem = item;
      p.armor = ITEM_DEFS[item].armor;
      p.armorMax = ITEM_DEFS[item].armor;
      p.loadoutArmor = marker;
      return;
    } else if (cat === 'pack' && !p.backpackItem) {
      p.backpackItem = item;
      p.loadoutBackpack = marker;
      return;
    }
    const cap = invCap(p);
    for (let i = 0; i < count; i++) {
      const at = freeSlot(p.inv, cap);
      if (at < 0) return;
      p.inv[at] = { item, count: 1, mag: grant.mag ?? (cat === 'weapon' && isFirearm(item) ? WEAPONS[item].mag : 0), loadout: marker };
    }
  }
  grant(p, catalog, source) {
    if (!p?.rejoinKey || !loadoutDef(catalog)) return;
    const id = `${this.game.code || 'game'}:${this.game.tick}:${p.id}:${catalog}:${randomUUID()}`;
    this.link.post({ op: 'grant', id, owner: p.rejoinKey, catalog, source });
    this.game.sendChat(p, 0, CHATF.SYSTEM, `Loadout item found: ${loadoutName(catalog)}. It is in your Loadout collection.`);
  }
  skullId(kind, owner, key) {
    return `${this.game.code || 'game'}:${this.game.seed}:${kind}:${key}:${owner.replace(':', '_')}`;
  }
  skulls(p, amount, source, key) {
    if (!p?.rejoinKey || amount <= 0) return;
    const id = this.skullId(source.kind || 'play', p.rejoinKey, key);
    this.game.skullAwards ||= new Set();
    if (this.game.skullAwards.has(id)) return;
    this.game.skullAwards.add(id);
    this.link.post({ op: 'skulls', id, owner: p.rejoinKey, amount, source });
    this.game.sendChat(p, 0, CHATF.SYSTEM, `+${amount} Zombie Skulls`);
  }
  nightReward(p, night) {
    this.skulls(p, nightSkulls(night), { kind: 'night', night }, `night:${night}`);
  }
  bossReward(z, killer) {
    this.skulls(killer, SKULL_EARN.BOSS_KILL, { kind: 'boss', boss: z.ztype }, `boss:${z.id}`);
  }
  escapeReward(p, aboard, key) {
    this.skulls(p, aboard ? SKULL_EARN.ESCAPE_ABOARD : SKULL_EARN.ESCAPE_TEAM, { kind: 'escape', aboard: !!aboard, act: this.game.act }, key);
  }
  bossDrop(z, killer) {
    if (!killer?.rejoinKey || this.game.rng() >= LOADOUT_BOSS_CHANCE) return;
    const pool = BOSS_POOL.get(z.ztype) || ALL_POOL;
    this.grant(killer, pool[(this.game.rng() * pool.length) | 0], { kind: 'boss', boss: z.ztype });
  }
  containerDrop(p, ctype) {
    if (!p?.rejoinKey || this.game.rng() >= LOADOUT_STRONGBOX_CHANCE) return;
    const pool = COMMON_POOL.length ? COMMON_POOL : ALL_POOL;
    this.grant(p, pool[(this.game.rng() * pool.length) | 0], { kind: 'container', container: ctype });
  }
}

