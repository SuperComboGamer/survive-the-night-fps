// Permanent loadout items: collectible profile-owned item instances that can be equipped into any
// of three slots before a run. The catalog is append-only: ids are stored in the database and on the wire/API.
import { AMMO, ITEM, ZTYPE } from './defs.js';
import { NO_PERKS } from './progress.js';

export const LOADOUT_SLOTS = 3;
export const LOADOUT_RARITY = Object.freeze({ COMMON: 1, RARE: 2, EPIC: 3, LEGENDARY: 4 });
export const LOADOUT_RARITY_NAMES = Object.freeze({
  [LOADOUT_RARITY.COMMON]: 'Common',
  [LOADOUT_RARITY.RARE]: 'Rare',
  [LOADOUT_RARITY.EPIC]: 'Epic',
  [LOADOUT_RARITY.LEGENDARY]: 'Legendary',
});
export const LOADOUT_TYPES = Object.freeze({
  WEAPON: 'weapon',
  ARMOR: 'armor',
  TRINKET: 'trinket',
  AMMO: 'ammo',
  GEAR: 'gear',
});

const L = LOADOUT_RARITY;
const T = LOADOUT_TYPES;
const freeze = (o) => Object.freeze(o);
const item = (o) =>
  freeze({
    source: freeze({ kind: 'world' }),
    mods: freeze({}),
    grant: freeze({}),
    ...o,
    source: freeze(o.source || { kind: 'world' }),
    mods: freeze(o.mods || {}),
    grant: freeze(o.grant || {}),
  });

export const LOADOUT_CATALOG = freeze([
  item({
    id: 1,
    key: 'rangers_carbine',
    name: "Ranger's Carbine",
    type: T.WEAPON,
    rarity: L.RARE,
    flavor: 'Short, clean, and carried by someone who expected to come back.',
    source: { kind: 'container', text: 'Strongboxes and boss caches' },
    grant: { item: ITEM.M4A1, mag: 18, ammo: [[AMMO.R556, 30]] },
    mods: { headshot: 1.04 },
  }),
  item({
    id: 2,
    key: 'patched_kevlar',
    name: 'Patched Kevlar',
    type: T.ARMOR,
    rarity: L.COMMON,
    flavor: 'Old plates, new stitching, and one more bad idea survived.',
    source: { kind: 'container', text: 'Strongboxes' },
    grant: { item: ITEM.KEVLAR },
    mods: { hurt: 0.97 },
  }),
  item({
    id: 3,
    key: 'st_marys_medal',
    name: "St. Mary's Medal",
    type: T.TRINKET,
    rarity: L.RARE,
    flavor: 'Warm in the hand after the sun goes down.',
    source: { kind: 'boss', boss: ZTYPE.BOSS_BRUTE },
    mods: { hp: 5 },
  }),
  item({
    id: 4,
    key: 'handloaded_556',
    name: 'Handloaded 5.56',
    type: T.AMMO,
    rarity: L.COMMON,
    flavor: 'Each casing marked with a notch. Somebody cared.',
    source: { kind: 'container', text: 'Strongboxes' },
    grant: { ammo: [[AMMO.R556, 45]] },
    mods: { headshot: 1.03 },
  }),
  item({
    id: 5,
    key: 'trail_pack',
    name: 'Trail Pack',
    type: T.GEAR,
    rarity: L.COMMON,
    flavor: 'A weekend bag for a trip that stopped being a weekend.',
    source: { kind: 'container', text: 'Strongboxes' },
    grant: { item: ITEM.BACKPACK },
    mods: { search: 0.97 },
  }),
  item({
    id: 6,
    key: 'bloater_filter',
    name: 'Bloater Filter',
    type: T.TRINKET,
    rarity: L.EPIC,
    flavor: 'It smells faintly sweet. That is not comforting.',
    source: { kind: 'boss', boss: ZTYPE.BOSS_BLOATER },
    mods: { hurt: 0.95, useTime: 0.97 },
  }),
  item({
    id: 7,
    key: 'alpha_fang',
    name: 'Alpha Fang',
    type: T.TRINKET,
    rarity: L.EPIC,
    flavor: 'The pack went quiet when it hit the dirt.',
    source: { kind: 'boss', boss: ZTYPE.BOSS_ALPHA },
    mods: { melee: 1.06, drops: 1.04 },
  }),
  item({
    id: 8,
    key: 'abomination_plate',
    name: 'Abomination Plate',
    type: T.ARMOR,
    rarity: L.LEGENDARY,
    flavor: 'Too heavy to be bone. Too alive-looking to be metal.',
    source: { kind: 'boss', boss: ZTYPE.BOSS_ABOMINATION },
    grant: { item: ITEM.KEVLAR },
    mods: { hurt: 0.94 },
  }),
  item({
    id: 9,
    key: 'queen_charm',
    name: "Hive Queen's Charm",
    type: T.TRINKET,
    rarity: L.LEGENDARY,
    flavor: 'A tiny chitin crown on a frayed cord.',
    source: { kind: 'boss', boss: ZTYPE.BOSS_HIVEQUEEN },
    mods: { extraFind: 0.05, xp: 1.03 },
  }),
  item({
    id: 10,
    key: 'brute_knuckles',
    name: 'Brute Knuckles',
    type: T.WEAPON,
    rarity: L.EPIC,
    flavor: 'They do not fit a human hand. You make do.',
    source: { kind: 'boss', boss: ZTYPE.BOSS_BRUTE },
    grant: { item: ITEM.SPIKED_BAT },
    mods: { melee: 1.05 },
  }),
]);

const BY_ID = new Map(LOADOUT_CATALOG.map((it) => [it.id, it]));
export const loadoutDef = (id) => BY_ID.get(id) || null;
export const loadoutName = (id) => loadoutDef(id)?.name || 'Loadout item';
export const loadoutRarityName = (rarity) => LOADOUT_RARITY_NAMES[rarity] || 'Unknown';

export function cleanLoadoutSlots(slots, ownedIds = null) {
  const out = Array(LOADOUT_SLOTS).fill(null);
  if (!Array.isArray(slots)) return out;
  const seen = new Set();
  for (let i = 0; i < LOADOUT_SLOTS; i++) {
    const id = typeof slots[i] === 'string' ? slots[i] : slots[i]?.id;
    if (!id || seen.has(id) || (ownedIds && !ownedIds.has(id))) continue;
    out[i] = id;
    seen.add(id);
  }
  return out;
}

export function loadoutMods(defs) {
  const m = { ...NO_PERKS };
  for (const def of defs || []) {
    if (!def?.mods) continue;
    for (const [k, v] of Object.entries(def.mods)) {
      if (!(k in m) || typeof v !== 'number') continue;
      if (NO_PERKS[k] === 1) m[k] *= v;
      else m[k] += v;
    }
  }
  return m;
}

