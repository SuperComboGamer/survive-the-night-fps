// Game-side loadout items: talks to userloadout.js on the network thread, applies equipped profile items once per run,
// and marks in-run copies so they cannot be dropped, salvaged, traded or stored.
import { randomUUID } from 'node:crypto';
import { CHATF } from '../shared/protocol.js';
import { ITEM_DEFS, WEAPONS, isFirearm } from '../shared/defs.js';
import { LOADOUT_CATALOG, combineLoadoutCombatEffects, loadoutDef, loadoutEffects, loadoutMods, loadoutName, loadoutWeaponEffect } from '../shared/loadout.js';
import { SKULL_EARN, nightSkulls } from '../shared/economy.js';
import { NO_PERKS, perkMods } from '../shared/progress.js';
import { STAMINA_MAX } from '../shared/constants.js';
import { freeSlot, invCap, INVENTORY_SIZE } from './inventory.js';
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
  p.loadoutEffects = null;
  p.loadoutWeaponEffects = {};
  p.loadoutNight = {};
  p.loadoutWeapons = [null, null, null, null, null];
  p.loadoutArmor = null;
  p.loadoutBackpack = null;
}

export function loadoutCombatEffect(p, weapon, ammo = -1) {
  const effects = [];
  const slot = WEAPONS[weapon]?.slot;
  const marker = slot != null ? p?.loadoutWeapons?.[slot] : null;
  const w = marker ? p?.loadoutWeaponEffects?.[marker] : null;
  if (w && (!w.item || w.item === weapon)) effects.push(w);
  for (const e of p?.loadoutEffects?.ammo || []) if (e.ammo === ammo) effects.push(e);
  return combineLoadoutCombatEffects(effects);
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
  gone(handedOff = false) {
    this.room.closed = true;
    this.service.roomGone(this.room, handedOff);
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
    if (m.op === 'xfered') return this.game.cards?.fromLoadoutStore(m);
    if (m.op !== 'coll') return;
    const o = this.own.get(m.owner);
    if (!o) return;
    o.loaded = m.ok === true;
    o.items = Array.isArray(m.items) ? m.items : [];
    o.slots = Array.isArray(m.slots) ? m.slots : [null, null, null];
    for (const p of this.game.players.values()) if (p.rejoinKey === m.owner) this.apply(p);
    this.game.cards?.loadoutsChanged?.(m.owner);
  }
  xfer(id, kind, moves, match = '') {
    if (Array.isArray(kind)) {
      moves = kind;
      kind = 'trade';
    }
    this.link.post({ op: 'xfer', id, kind, moves, match: String(match || '') });
  }
  tradeLock(trade, owner, items) {
    this.link.post({ op: 'trade_lock', trade: String(trade), owner, items });
  }
  tradeUnlock(trade) {
    this.link.post({ op: 'trade_unlock', trade: String(trade) });
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
    const defs = equipped.map((it) => loadoutDef(it.catalog)).filter(Boolean);
    p.loadoutApplied = true;
    p.loadoutItems = equipped.map((it) => it.id);
    p.loadoutMods = loadoutMods(defs);
    p.loadoutEffects = loadoutEffects(defs);
    p.loadoutWeaponEffects = {};
    p.loadoutNight = {};
    for (const owned of equipped) {
      const def = loadoutDef(owned.catalog);
      const weaponEffect = loadoutWeaponEffect(def);
      if (weaponEffect) p.loadoutWeaponEffects[owned.id] = weaponEffect;
      this.grantRunCopy(p, owned, def);
    }
    if (p.loadoutMods.hp) {
      p.maxHp += p.loadoutMods.hp;
      p.hp += p.loadoutMods.hp;
    }
    if (equipped.length) p.invDirty = true;
    return true;
  }
  removeRunCopies(p, ids) {
    const moved = new Set(ids);
    if (!p || !moved.size) return false;
    const oldMods = p.loadoutMods || NO_PERKS;
    let changed = false;
    p.loadoutItems = (p.loadoutItems || []).filter((id) => {
      const keep = !moved.has(id);
      if (!keep) changed = true;
      return keep;
    });
    for (let i = 0; i < p.inv.length; i++) {
      if (p.inv[i]?.loadout && moved.has(p.inv[i].loadout)) {
        p.inv[i] = null;
        changed = true;
      }
    }
    for (let slot = 0; slot < p.loadoutWeapons.length; slot++) {
      if (!p.loadoutWeapons[slot] || !moved.has(p.loadoutWeapons[slot])) continue;
      p.loadoutWeapons[slot] = null;
      p.state.weapons[slot] = 0;
      if (slot === 0) p.state.mags[0] = 0;
      if (slot === 1) p.state.mags[1] = 0;
      if (p.state.slot === slot) p.state.reloadT = 0;
      changed = true;
    }
    if (p.loadoutArmor && moved.has(p.loadoutArmor)) {
      p.loadoutArmor = null;
      p.armorItem = 0;
      p.armor = 0;
      p.armorMax = 0;
      changed = true;
    }
    if (p.loadoutBackpack && moved.has(p.loadoutBackpack)) {
      const s = p.state;
      for (let i = INVENTORY_SIZE; i < p.inv.length; i++) {
        const it = p.inv[i];
        if (!it) continue;
        this.game.dropItem(it.item, it.count, s.x, s.y, s.z, { spread: 0.8, mag: it.mag, noAuto: 2 });
        p.inv[i] = null;
      }
      p.loadoutBackpack = null;
      p.backpackItem = 0;
      changed = true;
    }
    if (changed) {
      const byId = new Map((this.own.get(p.rejoinKey)?.items || []).map((it) => [it.id, it]));
      p.loadoutMods = loadoutMods(p.loadoutItems.map((id) => loadoutDef(byId.get(id)?.catalog)).filter(Boolean));
      const hpDelta = (p.loadoutMods.hp || 0) - (oldMods.hp || 0);
      if (hpDelta) {
        p.maxHp += hpDelta;
        p.hp = Math.min(p.hp, p.maxHp);
      }
      p.invDirty = p.invSort = true;
      this.game.syncThrow(p);
    }
    return changed;
  }
  grantRunCopy(p, owned, def) {
    const grant = def?.grant || {};
    const marker = owned.id;
    for (const [cal, n] of grant.ammo || []) if (Number.isInteger(cal) && cal >= 0 && cal < p.state.ammo.length) p.state.ammo[cal] += Math.max(0, n | 0);
    const grantItem = (item, count = 1, mag = grant.mag) => {
      item |= 0;
      if (!item || !ITEM_DEFS[item]) return false;
      const cat = ITEM_DEFS[item].cat;
      if (cat === 'weapon') {
        const slot = WEAPONS[item].slot;
        if (!p.state.weapons[slot]) {
          p.state.weapons[slot] = item;
          p.loadoutWeapons[slot] = marker;
          if (slot === 0) p.state.mags[0] = mag ?? (isFirearm(item) ? WEAPONS[item].mag : 0);
          if (slot === 1) p.state.mags[1] = mag ?? (isFirearm(item) ? WEAPONS[item].mag : 0);
          return true;
        }
      } else if (cat === 'armor' && !p.armorItem) {
        p.armorItem = item;
        p.armor = ITEM_DEFS[item].armor;
        p.armorMax = ITEM_DEFS[item].armor;
        p.loadoutArmor = marker;
        return true;
      } else if (cat === 'pack' && !p.backpackItem) {
        p.backpackItem = item;
        p.loadoutBackpack = marker;
        return true;
      }
      const cap = invCap(p);
      let left = Math.max(1, count | 0 || 1);
      while (left > 0) {
        const at = freeSlot(p.inv, cap);
        if (at < 0) return false;
        const n = Math.min(left, ITEM_DEFS[item].stack || 1);
        p.inv[at] = { item, count: n, mag: mag ?? (cat === 'weapon' && isFirearm(item) ? WEAPONS[item].mag : 0), loadout: marker };
        left -= n;
      }
      return true;
    };
    if (grant.item) grantItem(grant.item, grant.count, grant.mag);
    for (const [item, count, mag] of grant.items || []) grantItem(item, count, mag);
  }
  resetNight(p) {
    if (p) p.loadoutNight = {};
  }
  onKill(p) {
    if (!p?.alive || p.downed || p.zombie) return;
    const apply = (eff) => {
      if (!eff) return;
      if (eff.heal) p.hp = Math.min(p.maxHp, p.hp + eff.heal);
      if (eff.stamina) p.state.stamina = Math.min(STAMINA_MAX, p.state.stamina + eff.stamina);
      for (const [cal, n] of eff.ammo || []) if (Number.isInteger(cal) && cal >= 0 && cal < p.state.ammo.length) p.state.ammo[cal] += Math.max(0, n | 0);
    };
    apply(p.loadoutEffects?.kill);
    if (p.loadoutEffects?.firstKill && !p.loadoutNight?.firstKill) {
      p.loadoutNight = { ...(p.loadoutNight || {}), firstKill: true };
      apply(p.loadoutEffects.firstKill);
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

