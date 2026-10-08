// Permanent loadout items: collectible profile-owned item instances that can be equipped into any
// of three slots before a run. The catalog is append-only: ids are stored in the database and on the wire/API.
import { AMMO, ITEM, ZTYPE } from './defs.js';
import { NO_PERKS, PERK_CAP } from './progress.js';

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
  CLOTHING: 'clothing',
  TRINKET: 'trinket',
  AMMO: 'ammo',
  GEAR: 'gear',
  KIT: 'kit',
});

const L = LOADOUT_RARITY;
const T = LOADOUT_TYPES;
const freeze = (o) => Object.freeze(o);
const deepFreeze = (v) => {
  if (!v || typeof v !== 'object') return v;
  Object.freeze(v);
  for (const x of Object.values(v)) deepFreeze(x);
  return v;
};
const item = (o) =>
  deepFreeze({
    source: freeze({ kind: 'world' }),
    mods: freeze({}),
    grant: freeze({}),
    effects: freeze({}),
    icon: '',
    ...o,
    source: o.source || { kind: 'world' },
    mods: o.mods || {},
    grant: o.grant || {},
    effects: o.effects || {},
  });

// Loadout items are permanent and three can stack, so their combined passives are held below perk-tree power:
// multiplicative combat/utility stats can move at most 60% of a normal perk branch cap, while additive rewards
// are smaller than the matching perk. See docs/loadout-items.md for the item-row rules.
export const LOADOUT_BALANCE = freeze({
  maxEquipped: LOADOUT_SLOTS,
  mulCap: +(PERK_CAP * 0.6).toFixed(3),
  xpCap: 0.09,
  bleedCap: 0.2,
  addCaps: freeze({ hp: 15, extraFind: 0.15, gather: 0.15, reviveHp: 8, killStamina: 4, killHeal: 2, reviveSelf: 5, secondChance: 0 }),
  combatCaps: freeze({ damage: 1.1, headshot: 1.08, boss: 1.12, melee: 1.1, knock: 1.2, pierce: 1, ignite: 0.12 }),
  killCaps: freeze({ heal: 2, stamina: 5, ammo: 3 }),
  firstKillCaps: freeze({ heal: 12, stamina: 20, ammo: 12 }),
});

const strongboxes = { kind: 'container', text: 'Strongboxes' };
const caches = { kind: 'container', text: 'Strongboxes and boss caches' };
const lockers = { kind: 'container', text: 'Lockers and strongboxes' };
const medical = { kind: 'container', text: 'Clinic cabinets and strongboxes' };
const roadside = { kind: 'container', text: 'Roadside trunks and strongboxes' };
const boss = (boss) => ({ kind: 'boss', boss });

export const LOADOUT_CATALOG = freeze([
  item({
    id: 1,
    key: 'rangers_carbine',
    name: "Ranger's Carbine",
    type: T.WEAPON,
    rarity: L.RARE,
    flavor: 'Short, clean, and carried by someone who expected to come back.',
    source: caches,
    grant: { item: ITEM.M4A1, mag: 18, ammo: [[AMMO.R556, 30]] },
    mods: { headshot: 1.04 },
    effects: { weapon: { item: ITEM.M4A1, damage: 1.03 } },
    icon: 'headshot',
  }),
  item({
    id: 2,
    key: 'patched_kevlar',
    name: 'Patched Kevlar',
    type: T.ARMOR,
    rarity: L.COMMON,
    flavor: 'Old plates, new stitching, and one more bad idea survived.',
    source: strongboxes,
    grant: { item: ITEM.KEVLAR },
    mods: { hurt: 0.97 },
    icon: 'shield',
  }),
  item({
    id: 3,
    key: 'st_marys_medal',
    name: "St. Mary's Medal",
    type: T.TRINKET,
    rarity: L.RARE,
    flavor: 'Warm in the hand after the sun goes down.',
    source: boss(ZTYPE.BOSS_BRUTE),
    mods: { hp: 5 },
    icon: 'cross',
  }),
  item({
    id: 4,
    key: 'handloaded_556',
    name: 'Handloaded 5.56',
    type: T.AMMO,
    rarity: L.COMMON,
    flavor: 'Each casing marked with a notch. Somebody cared.',
    source: strongboxes,
    grant: { ammo: [[AMMO.R556, 45]] },
    mods: { headshot: 1.03 },
    effects: { ammo: { ammo: AMMO.R556, damage: 1.02 } },
    icon: 'bolt',
  }),
  item({
    id: 5,
    key: 'trail_pack',
    name: 'Trail Pack',
    type: T.GEAR,
    rarity: L.COMMON,
    flavor: 'A weekend bag for a trip that stopped being a weekend.',
    source: strongboxes,
    grant: { item: ITEM.BACKPACK },
    mods: { search: 0.97 },
    icon: 'grid',
  }),
  item({
    id: 6,
    key: 'bloater_filter',
    name: 'Bloater Filter',
    type: T.TRINKET,
    rarity: L.EPIC,
    flavor: 'It smells faintly sweet. That is not comforting.',
    source: boss(ZTYPE.BOSS_BLOATER),
    mods: { hurt: 0.95, useTime: 0.97 },
    icon: 'hazard',
  }),
  item({
    id: 7,
    key: 'alpha_fang',
    name: 'Alpha Fang',
    type: T.TRINKET,
    rarity: L.EPIC,
    flavor: 'The pack went quiet when it hit the dirt.',
    source: boss(ZTYPE.BOSS_ALPHA),
    mods: { melee: 1.06, drops: 1.04 },
    effects: { kill: { stamina: 1 } },
    icon: 'claw',
  }),
  item({
    id: 8,
    key: 'abomination_plate',
    name: 'Abomination Plate',
    type: T.ARMOR,
    rarity: L.LEGENDARY,
    flavor: 'Too heavy to be bone. Too alive-looking to be metal.',
    source: boss(ZTYPE.BOSS_ABOMINATION),
    grant: { item: ITEM.KEVLAR },
    mods: { hurt: 0.94 },
    icon: 'shield',
  }),
  item({
    id: 9,
    key: 'queen_charm',
    name: "Hive Queen's Charm",
    type: T.TRINKET,
    rarity: L.LEGENDARY,
    flavor: 'A tiny chitin crown on a frayed cord.',
    source: boss(ZTYPE.BOSS_HIVEQUEEN),
    mods: { extraFind: 0.05, xp: 1.03 },
    effects: { firstKill: { ammo: [[AMMO.BOLT, 2]] } },
    icon: 'crown',
  }),
  item({
    id: 10,
    key: 'brute_knuckles',
    name: 'Brute Knuckles',
    type: T.WEAPON,
    rarity: L.EPIC,
    flavor: 'They do not fit a human hand. You make do.',
    source: boss(ZTYPE.BOSS_BRUTE),
    grant: { item: ITEM.SPIKED_BAT },
    mods: { melee: 1.05 },
    effects: { weapon: { item: ITEM.SPIKED_BAT, damage: 1.04, knock: 1.08 } },
    icon: 'hand',
  }),
  item({
    id: 11,
    key: 'deputys_last_pistol',
    name: "Deputy's Last Pistol",
    type: T.WEAPON,
    rarity: L.COMMON,
    flavor: 'The grip is worn smooth where fear held on.',
    source: lockers,
    grant: { item: ITEM.PISTOL, mag: 12, ammo: [[AMMO.P9, 24]] },
    effects: { weapon: { item: ITEM.PISTOL, damage: 1.03, headshot: 1.02 } },
    icon: 'headshot',
  }),
  item({
    id: 12,
    key: 'widowmaker_pump',
    name: 'Widowmaker Pump',
    type: T.WEAPON,
    rarity: L.EPIC,
    flavor: 'Every scratch on the stock is a night somebody counted out loud.',
    source: strongboxes,
    grant: { item: ITEM.SHOTGUN, mag: 4, ammo: [[AMMO.SHELL, 12]] },
    effects: { weapon: { item: ITEM.SHOTGUN, damage: 1.05, knock: 1.05 } },
    icon: 'blast',
  }),
  item({
    id: 13,
    key: 'barn_door_double',
    name: 'Barn Door Double',
    type: T.WEAPON,
    rarity: L.RARE,
    flavor: 'Two barrels, no patience, and a prayer after each pull.',
    source: roadside,
    grant: { item: ITEM.DB_SHOTGUN, mag: 2, ammo: [[AMMO.SHELL, 10]] },
    effects: { weapon: { item: ITEM.DB_SHOTGUN, damage: 1.04, knock: 1.08 } },
    icon: 'blast',
  }),
  item({
    id: 14,
    key: 'sawmill_ak',
    name: 'Sawmill AK',
    type: T.WEAPON,
    rarity: L.RARE,
    flavor: 'Oiled with bar-chain grease. It still runs.',
    source: caches,
    grant: { item: ITEM.AK47, mag: 20, ammo: [[AMMO.R762, 45]] },
    effects: { weapon: { item: ITEM.AK47, damage: 1.03, boss: 1.03 } },
    icon: 'bolt',
  }),
  item({
    id: 15,
    key: 'blackline_m4',
    name: 'Blackline M4',
    type: T.WEAPON,
    rarity: L.EPIC,
    flavor: 'Matte tape over every shine, like darkness could be trained.',
    source: caches,
    grant: { item: ITEM.M4A1, mag: 24, ammo: [[AMMO.R556, 45]] },
    effects: { weapon: { item: ITEM.M4A1, damage: 1.04, headshot: 1.02 } },
    icon: 'headshot',
  }),
  item({
    id: 16,
    key: 'whisper_mp5',
    name: 'Whisper MP5',
    type: T.WEAPON,
    rarity: L.RARE,
    flavor: 'A soft chatter for close hallways and worse decisions.',
    source: lockers,
    grant: { item: ITEM.MP5, mag: 24, ammo: [[AMMO.P9, 48]] },
    effects: { weapon: { item: ITEM.MP5, damage: 1.03, headshot: 1.02 } },
    icon: 'bolt',
  }),
  item({
    id: 17,
    key: 'mercy_rifle',
    name: 'Mercy Rifle',
    type: T.WEAPON,
    rarity: L.EPIC,
    flavor: 'A hunting rifle with clinic tape round the sling. Mercy is relative.',
    source: caches,
    grant: { item: ITEM.HUNTING_RIFLE, mag: 4, ammo: [[AMMO.R308, 10]] },
    effects: { weapon: { item: ITEM.HUNTING_RIFLE, damage: 1.03, boss: 1.06 } },
    icon: 'headshot',
  }),
  item({
    id: 18,
    key: 'crowbar_crossbow',
    name: 'Crowbar Crossbow',
    type: T.WEAPON,
    rarity: L.RARE,
    flavor: 'Bent limbs, hand-filed latch, and bolts that punch through.',
    source: roadside,
    grant: { item: ITEM.CROSSBOW, mag: 1, ammo: [[AMMO.BOLT, 10]] },
    effects: { weapon: { item: ITEM.CROSSBOW, damage: 1.04, pierce: 1 } },
    icon: 'blade',
  }),
  item({
    id: 19,
    key: 'pilot_light',
    name: 'Pilot Light',
    type: T.WEAPON,
    rarity: L.EPIC,
    flavor: 'A flamethrower that coughs blue before it turns orange.',
    source: caches,
    grant: { item: ITEM.FLAMETHROWER, mag: 60, ammo: [[AMMO.FUEL, 80]] },
    effects: { weapon: { item: ITEM.FLAMETHROWER, damage: 1.06, ignite: 0.04 } },
    icon: 'flame',
  }),
  item({
    id: 20,
    key: 'lucky_machete',
    name: 'Lucky Machete',
    type: T.WEAPON,
    rarity: L.RARE,
    flavor: 'The blade is nicked in seven places. None of them stopped it.',
    source: roadside,
    grant: { item: ITEM.MACHETE },
    effects: { weapon: { item: ITEM.MACHETE, damage: 1.04, headshot: 1.02 } },
    icon: 'blade',
  }),
  item({
    id: 21,
    key: 'rail_spike_bat',
    name: 'Rail-Spike Bat',
    type: T.WEAPON,
    rarity: L.RARE,
    flavor: 'Whitlock iron hammered through ash wood. Heavy as guilt.',
    source: strongboxes,
    grant: { item: ITEM.SPIKED_BAT },
    effects: { weapon: { item: ITEM.SPIKED_BAT, damage: 1.04, knock: 1.1 } },
    icon: 'hammer',
  }),
  item({
    id: 22,
    key: 'chain_prayer_nunchaku',
    name: 'Chain-Prayer Nunchaku',
    type: T.WEAPON,
    rarity: L.EPIC,
    flavor: 'Two handles, one rosary bead in the chain, no room for mistakes.',
    source: strongboxes,
    grant: { item: ITEM.NUNCHAKU },
    effects: { weapon: { item: ITEM.NUNCHAKU, damage: 1.05, headshot: 1.02 } },
    icon: 'agile',
  }),
  item({
    id: 23,
    key: 'boot_knife',
    name: 'Boot Knife',
    type: T.WEAPON,
    rarity: L.COMMON,
    flavor: 'Small enough to hide. Sharp enough to matter.',
    source: roadside,
    grant: { item: ITEM.KNIFE },
    effects: { weapon: { item: ITEM.KNIFE, damage: 1.03, headshot: 1.02 } },
    icon: 'blade',
  }),
  item({
    id: 24,
    key: 'road_warden_jacket',
    name: 'Road Warden Jacket',
    type: T.ARMOR,
    rarity: L.COMMON,
    flavor: 'Reflective stripes gone black with road dust.',
    source: roadside,
    grant: { item: ITEM.JACKET },
    mods: { hurt: 0.98 },
    icon: 'shield',
  }),
  item({
    id: 25,
    key: 'riot_vest',
    name: 'Riot Vest',
    type: T.ARMOR,
    rarity: L.EPIC,
    flavor: 'Cracked plastic plates from a town that did not stay orderly.',
    source: lockers,
    grant: { item: ITEM.KEVLAR },
    mods: { hurt: 0.96, stun: 0.98 },
    icon: 'shield',
  }),
  item({
    id: 26,
    key: 'varsity_jacket',
    name: 'Varsity Jacket',
    type: T.CLOTHING,
    rarity: L.COMMON,
    flavor: 'A stitched wolf on the back, half torn away.',
    source: roadside,
    grant: { item: ITEM.JACKET },
    mods: { hp: 4 },
    icon: 'heart',
  }),
  item({
    id: 27,
    key: 'rain_poncho',
    name: 'Rain Poncho',
    type: T.CLOTHING,
    rarity: L.COMMON,
    flavor: 'Thin yellow plastic. Better than being wet when the screaming starts.',
    source: roadside,
    mods: { bleed: 0.96, search: 0.99 },
    icon: 'rain',
  }),
  item({
    id: 28,
    key: 'wool_scarf',
    name: 'Wool Scarf',
    type: T.CLOTHING,
    rarity: L.COMMON,
    flavor: 'It smells like woodsmoke and a house you will not find.',
    source: roadside,
    mods: { notice: 0.98, hurt: 0.99 },
    icon: 'moon',
  }),
  item({
    id: 29,
    key: 'miner_gloves',
    name: "Miner's Gloves",
    type: T.CLOTHING,
    rarity: L.RARE,
    flavor: 'Blackrock leather, stiff with dust that never washes out.',
    source: strongboxes,
    mods: { gather: 0.05, melee: 1.02 },
    icon: 'hand',
  }),
  item({
    id: 30,
    key: 'cemetery_boots',
    name: 'Cemetery Boots',
    type: T.CLOTHING,
    rarity: L.RARE,
    flavor: 'Mud on the soles, even after you clean them.',
    source: strongboxes,
    mods: { stun: 0.97, bleed: 0.95 },
    icon: 'downed',
  }),
  item({
    id: 31,
    key: 'clinic_scrubs',
    name: 'Clinic Scrubs',
    type: T.CLOTHING,
    rarity: L.RARE,
    flavor: 'Name tag missing. Blood type written inside the collar.',
    source: medical,
    grant: { items: [[ITEM.BANDAGE, 2]] },
    mods: { useTime: 0.98, revive: 0.98 },
    icon: 'cross',
  }),
  item({
    id: 32,
    key: 'firefighter_coat',
    name: 'Firefighter Coat',
    type: T.ARMOR,
    rarity: L.EPIC,
    flavor: 'Scorched sleeves, brass hooks, and the courage to stand too close.',
    source: strongboxes,
    grant: { item: ITEM.JACKET },
    mods: { hurt: 0.97, bleed: 0.94 },
    icon: 'flame',
  }),
  item({
    id: 33,
    key: 'welding_apron',
    name: 'Welding Apron',
    type: T.ARMOR,
    rarity: L.RARE,
    flavor: 'A shop apron stiff enough to turn claws aside.',
    source: strongboxes,
    grant: { item: ITEM.JACKET },
    mods: { hurt: 0.97 },
    icon: 'shield',
  }),
  item({
    id: 34,
    key: 'lucky_rabbit_foot',
    name: "Lucky Rabbit's Foot",
    type: T.TRINKET,
    rarity: L.COMMON,
    flavor: 'Bad luck for the rabbit. Maybe that is transferable.',
    source: roadside,
    mods: { extraFind: 0.03 },
    effects: { firstKill: { stamina: 8 } },
    icon: 'star',
  }),
  item({
    id: 35,
    key: 'tarnished_ring',
    name: 'Tarnished Ring',
    type: T.TRINKET,
    rarity: L.COMMON,
    flavor: 'A promise worn thin and found in a glovebox.',
    source: roadside,
    mods: { xp: 1.02 },
    icon: 'link',
  }),
  item({
    id: 36,
    key: 'keychain_compass',
    name: 'Keychain Compass',
    type: T.TRINKET,
    rarity: L.RARE,
    flavor: 'The needle points home, wherever that means now.',
    source: strongboxes,
    mods: { search: 0.98, extraFind: 0.03 },
    icon: 'compass',
  }),
  item({
    id: 37,
    key: 'blood_stained_watch',
    name: 'Blood-Stained Watch',
    type: T.TRINKET,
    rarity: L.RARE,
    flavor: 'Stopped at 3:17. The night did not.',
    source: strongboxes,
    mods: { revive: 0.97, bleed: 0.96 },
    effects: { firstKill: { heal: 4 } },
    icon: 'ecg',
  }),
  item({
    id: 38,
    key: 'saint_candle_stub',
    name: 'Saint Candle Stub',
    type: T.TRINKET,
    rarity: L.RARE,
    flavor: 'A wick burned down to hope.',
    source: medical,
    grant: { items: [[ITEM.TORCH, 2]] },
    mods: { reviveHp: 4 },
    icon: 'campfire',
  }),
  item({
    id: 39,
    key: 'motel_room_7_key',
    name: 'Motel Room 7 Key',
    type: T.TRINKET,
    rarity: L.COMMON,
    flavor: 'The tag says RETURN TO DESK. The desk is gone.',
    source: roadside,
    mods: { search: 0.98 },
    icon: 'unlock',
  }),
  item({
    id: 40,
    key: 'bottlecap_rosary',
    name: 'Bottlecap Rosary',
    type: T.TRINKET,
    rarity: L.RARE,
    flavor: 'Every cap is crimped around a whispered name.',
    source: strongboxes,
    mods: { hurt: 0.98, xp: 1.02 },
    icon: 'cross',
  }),
  item({
    id: 41,
    key: 'cracked_polaroid',
    name: 'Cracked Polaroid',
    type: T.TRINKET,
    rarity: L.COMMON,
    flavor: 'Four smiling faces. One thumb over the lens.',
    source: roadside,
    mods: { hp: 3, reviveHp: 2 },
    icon: 'person',
  }),
  item({
    id: 42,
    key: 'brass_knuckle_charm',
    name: 'Brass-Knuckle Charm',
    type: T.TRINKET,
    rarity: L.RARE,
    flavor: 'Too small to wear, big enough to remember what hands are for.',
    source: strongboxes,
    mods: { melee: 1.04 },
    effects: { kill: { stamina: 1 } },
    icon: 'hand',
  }),
  item({
    id: 43,
    key: 'highway_patrol_badge',
    name: 'Highway Patrol Badge',
    type: T.TRINKET,
    rarity: L.EPIC,
    flavor: 'The enamel is chipped, the number still legible.',
    source: caches,
    mods: { headshot: 1.04, notice: 0.98 },
    icon: 'star',
  }),
  item({
    id: 44,
    key: 'static_laced_radio_tag',
    name: 'Static-Laced Radio Tag',
    type: T.TRINKET,
    rarity: L.EPIC,
    flavor: 'Hold it near your ear and the dead sound far away.',
    source: caches,
    mods: { drops: 1.04, xp: 1.02 },
    effects: { firstKill: { ammo: [[AMMO.P9, 6]] } },
    icon: 'radio',
  }),
  item({
    id: 45,
    key: 'silver_thimble',
    name: 'Silver Thimble',
    type: T.TRINKET,
    rarity: L.COMMON,
    flavor: 'For mending little tears before they become graves.',
    source: medical,
    grant: { items: [[ITEM.CLOTH, 3], [ITEM.BANDAGE, 1]] },
    mods: { useTime: 0.99 },
    icon: 'wrench',
  }),
  item({
    id: 46,
    key: 'hollow_point_9mm',
    name: 'Hollow-Point 9mm',
    type: T.AMMO,
    rarity: L.COMMON,
    flavor: 'Ugly little petals folded into every round.',
    source: lockers,
    grant: { ammo: [[AMMO.P9, 60]] },
    effects: { ammo: { ammo: AMMO.P9, damage: 1.03, headshot: 1.03 } },
    icon: 'headshot',
  }),
  item({
    id: 47,
    key: 'waxed_buckshot',
    name: 'Waxed Buckshot',
    type: T.AMMO,
    rarity: L.RARE,
    flavor: 'Shells sealed against rain, blood, and poor planning.',
    source: lockers,
    grant: { ammo: [[AMMO.SHELL, 18]] },
    effects: { ammo: { ammo: AMMO.SHELL, damage: 1.04, knock: 1.06 } },
    icon: 'blast',
  }),
  item({
    id: 48,
    key: 'armor_piercing_762',
    name: 'Armor-Piercing 7.62',
    type: T.AMMO,
    rarity: L.RARE,
    flavor: 'Black tips from a can that said nothing friendly.',
    source: caches,
    grant: { ammo: [[AMMO.R762, 60]] },
    effects: { ammo: { ammo: AMMO.R762, damage: 1.03, pierce: 1 } },
    icon: 'bolt',
  }),
  item({
    id: 49,
    key: 'matchgrade_308',
    name: 'Matchgrade .308',
    type: T.AMMO,
    rarity: L.EPIC,
    flavor: 'Boxed for trophies. The valley offers bigger heads.',
    source: caches,
    grant: { ammo: [[AMMO.R308, 16]] },
    effects: { ammo: { ammo: AMMO.R308, headshot: 1.06, boss: 1.04 } },
    icon: 'headshot',
  }),
  item({
    id: 50,
    key: 'green_tip_556',
    name: 'Green-Tip 5.56',
    type: T.AMMO,
    rarity: L.RARE,
    flavor: 'A little more bite for rifles that already bark.',
    source: caches,
    grant: { ammo: [[AMMO.R556, 60]] },
    effects: { ammo: { ammo: AMMO.R556, damage: 1.03, boss: 1.03 } },
    icon: 'bolt',
  }),
  item({
    id: 51,
    key: 'broadhead_bolts',
    name: 'Broadhead Bolts',
    type: T.AMMO,
    rarity: L.RARE,
    flavor: 'Hunting heads sharpened for things that do not bleed right.',
    source: roadside,
    grant: { ammo: [[AMMO.BOLT, 16]] },
    effects: { ammo: { ammo: AMMO.BOLT, damage: 1.04, headshot: 1.03 } },
    icon: 'blade',
  }),
  item({
    id: 52,
    key: 'incendiary_fuel_mix',
    name: 'Incendiary Fuel Mix',
    type: T.AMMO,
    rarity: L.EPIC,
    flavor: 'Thickened fuel with a sweet stink and a mean afterburn.',
    source: caches,
    grant: { ammo: [[AMMO.FUEL, 120]] },
    effects: { ammo: { ammo: AMMO.FUEL, damage: 1.04, ignite: 0.08 } },
    icon: 'flame',
  }),
  item({
    id: 53,
    key: 'flare_phosphor_shells',
    name: 'Flare Phosphor Shells',
    type: T.AMMO,
    rarity: L.COMMON,
    flavor: 'Red light in brass cups, enough to make shadows hesitate.',
    source: roadside,
    grant: { ammo: [[AMMO.FLARE, 5]] },
    mods: { search: 0.99 },
    icon: 'sun',
  }),
  item({
    id: 54,
    key: 'breacher_slugs',
    name: 'Breacher Slugs',
    type: T.AMMO,
    rarity: L.EPIC,
    flavor: 'Too few in the pouch. Plenty if each one opens a path.',
    source: caches,
    grant: { ammo: [[AMMO.SHELL, 12]] },
    effects: { ammo: { ammo: AMMO.SHELL, damage: 1.05, boss: 1.04 } },
    icon: 'blast',
  }),
  item({
    id: 55,
    key: 'rust_cut_145',
    name: 'Rust-Cut 14.5mm',
    type: T.AMMO,
    rarity: L.EPIC,
    flavor: 'Rounds wrapped in oilcloth, long enough to look illegal.',
    source: caches,
    grant: { ammo: [[AMMO.R145, 4]] },
    effects: { ammo: { ammo: AMMO.R145, boss: 1.08, pierce: 1 } },
    icon: 'bolt',
  }),
  item({
    id: 56,
    key: 'bolt_runner_quiver',
    name: 'Bolt Runner Quiver',
    type: T.GEAR,
    rarity: L.COMMON,
    flavor: 'A cut-down pool cue case, perfect for quiet work.',
    source: roadside,
    grant: { ammo: [[AMMO.BOLT, 12]] },
    mods: { search: 0.99 },
    icon: 'grid',
  }),
  item({
    id: 57,
    key: 'toolbelt',
    name: 'Toolbelt',
    type: T.GEAR,
    rarity: L.COMMON,
    flavor: 'Hammer loop, nail pouch, and a stain shaped like a hand.',
    source: strongboxes,
    grant: { items: [[ITEM.HAMMER, 1], [ITEM.NAILS, 8]] },
    mods: { gather: 0.04 },
    icon: 'wrench',
  }),
  item({
    id: 58,
    key: 'field_medic_roll',
    name: 'Field Medic Roll',
    type: T.KIT,
    rarity: L.RARE,
    flavor: 'Bandages tied tight around one last red cross.',
    source: medical,
    grant: { items: [[ITEM.BANDAGE, 2], [ITEM.MEDKIT, 1]] },
    mods: { useTime: 0.98, revive: 0.98 },
    icon: 'cross',
  }),
  item({
    id: 59,
    key: 'battery_bandolier',
    name: 'Battery Bandolier',
    type: T.GEAR,
    rarity: L.COMMON,
    flavor: 'Dead flashlights are how the dark gets teeth.',
    source: roadside,
    grant: { items: [[ITEM.BATTERY, 3]] },
    mods: { search: 0.99 },
    icon: 'battery',
  }),
  item({
    id: 60,
    key: 'strongbox_pry_gloves',
    name: 'Strongbox Pry Gloves',
    type: T.GEAR,
    rarity: L.RARE,
    flavor: 'Leather palms scarred by crowbars and impatient survivors.',
    source: strongboxes,
    grant: { items: [[ITEM.SCRAP, 3], [ITEM.TAPE, 1]] },
    mods: { search: 0.96 },
    icon: 'unlock',
  }),
  item({
    id: 61,
    key: 'scavenger_map_case',
    name: 'Scavenger Map Case',
    type: T.GEAR,
    rarity: L.RARE,
    flavor: 'Grease-pencil circles around places nobody should enter.',
    source: strongboxes,
    grant: { items: [[ITEM.FLARE, 1]] },
    mods: { extraFind: 0.04, search: 0.99 },
    icon: 'map',
  }),
  item({
    id: 62,
    key: 'dead_drop_backpack',
    name: 'Dead-Drop Backpack',
    type: T.GEAR,
    rarity: L.EPIC,
    flavor: 'Canvas patched with mailbox flags and old trail signs.',
    source: caches,
    grant: { item: ITEM.BACKPACK, items: [[ITEM.TUNA, 1], [ITEM.BATTERY, 1]] },
    mods: { extraFind: 0.04 },
    icon: 'grid',
  }),
  item({
    id: 63,
    key: 'radio_relay_coil',
    name: 'Radio Relay Coil',
    type: T.GEAR,
    rarity: L.RARE,
    flavor: 'Copper wire wound around a nail, humming with borrowed voices.',
    source: caches,
    grant: { item: ITEM.WALKIE },
    mods: { reviveXp: 1.04, xp: 1.02 },
    icon: 'radio',
  }),
  item({
    id: 64,
    key: 'emergency_ration_tin',
    name: 'Emergency Ration Tin',
    type: T.KIT,
    rarity: L.COMMON,
    flavor: 'Packed before the sirens. Opened after the screaming.',
    source: roadside,
    grant: { items: [[ITEM.TUNA, 2], [ITEM.ENERGY_DRINK, 1]] },
    mods: { useTime: 0.99 },
    icon: 'container',
  }),
  item({
    id: 65,
    key: 'night_shift_coffee',
    name: 'Night Shift Coffee',
    type: T.KIT,
    rarity: L.COMMON,
    flavor: 'Cold, bitter, and somehow still stronger than sleep.',
    source: roadside,
    grant: { items: [[ITEM.ENERGY_DRINK, 2]] },
    effects: { firstKill: { stamina: 10 } },
    icon: 'bolt',
  }),
  item({
    id: 66,
    key: 'brute_door_hinge',
    name: "Brute's Door-Hinge",
    type: T.WEAPON,
    rarity: L.EPIC,
    flavor: 'It tore this off a cabin. You bolted it to a handle.',
    source: boss(ZTYPE.BOSS_BRUTE),
    grant: { item: ITEM.BAT },
    mods: { melee: 1.04 },
    effects: { weapon: { item: ITEM.BAT, damage: 1.05, knock: 1.12 } },
    icon: 'hammer',
  }),
  item({
    id: 67,
    key: 'brute_rib_guard',
    name: "Brute's Rib Guard",
    type: T.ARMOR,
    rarity: L.LEGENDARY,
    flavor: 'A curved plate that keeps trying to bend back into a monster.',
    source: boss(ZTYPE.BOSS_BRUTE),
    grant: { item: ITEM.KEVLAR },
    mods: { hp: 8, hurt: 0.96 },
    icon: 'shield',
  }),
  item({
    id: 68,
    key: 'alpha_bloodied_collar',
    name: "Alpha's Bloodied Collar",
    type: T.TRINKET,
    rarity: L.EPIC,
    flavor: 'Too large for any dog you want to meet.',
    source: boss(ZTYPE.BOSS_ALPHA),
    mods: { melee: 1.04, notice: 0.97 },
    effects: { kill: { stamina: 2 } },
    icon: 'claw',
  }),
  item({
    id: 69,
    key: 'alpha_howl_whistle',
    name: 'Alpha Howl Whistle',
    type: T.GEAR,
    rarity: L.LEGENDARY,
    flavor: 'No human ear hears it. The pack still looks over.',
    source: boss(ZTYPE.BOSS_ALPHA),
    mods: { drops: 1.05, search: 0.97 },
    effects: { firstKill: { ammo: [[AMMO.SHELL, 4]], stamina: 8 } },
    icon: 'horn',
  }),
  item({
    id: 70,
    key: 'bloater_bile_ampoule',
    name: 'Bloater Bile Ampoule',
    type: T.AMMO,
    rarity: L.EPIC,
    flavor: 'Glass cloudy with something that wants out.',
    source: boss(ZTYPE.BOSS_BLOATER),
    grant: { ammo: [[AMMO.FUEL, 60]] },
    effects: { ammo: { ammo: AMMO.FUEL, damage: 1.05, ignite: 0.1 } },
    icon: 'hazard',
  }),
  item({
    id: 71,
    key: 'bloater_lung_charm',
    name: 'Bloater Lung Charm',
    type: T.TRINKET,
    rarity: L.LEGENDARY,
    flavor: 'A shriveled sac that expands when the night gets quiet.',
    source: boss(ZTYPE.BOSS_BLOATER),
    mods: { hurt: 0.96, bleed: 0.92 },
    effects: { firstKill: { heal: 8 } },
    icon: 'hazard',
  }),
  item({
    id: 72,
    key: 'abomination_spine_hook',
    name: 'Abomination Spine Hook',
    type: T.WEAPON,
    rarity: L.LEGENDARY,
    flavor: 'A hooked shard that makes every swing feel heavier.',
    source: boss(ZTYPE.BOSS_ABOMINATION),
    grant: { item: ITEM.MACHETE },
    mods: { melee: 1.05 },
    effects: { weapon: { item: ITEM.MACHETE, damage: 1.06, boss: 1.04 } },
    icon: 'blade',
  }),
  item({
    id: 73,
    key: 'abomination_shoulder_plate',
    name: "Abomination's Shoulder Plate",
    type: T.ARMOR,
    rarity: L.LEGENDARY,
    flavor: 'It fits over kevlar like a promise made by a butcher.',
    source: boss(ZTYPE.BOSS_ABOMINATION),
    grant: { item: ITEM.KEVLAR },
    mods: { hp: 10, hurt: 0.97 },
    icon: 'shield',
  }),
  item({
    id: 74,
    key: 'hive_queen_stinger',
    name: "Hive Queen's Stinger",
    type: T.AMMO,
    rarity: L.LEGENDARY,
    flavor: 'Tied to a bolt shaft, it twitches toward warm blood.',
    source: boss(ZTYPE.BOSS_HIVEQUEEN),
    grant: { ammo: [[AMMO.BOLT, 12]] },
    effects: { ammo: { ammo: AMMO.BOLT, damage: 1.05, headshot: 1.04, ignite: 0.04 } },
    icon: 'claw',
  }),
  item({
    id: 75,
    key: 'queen_brood_pendant',
    name: "Queen's Brood Pendant",
    type: T.TRINKET,
    rarity: L.LEGENDARY,
    flavor: 'A chitin oval that clicks once for every thing in the dark.',
    source: boss(ZTYPE.BOSS_HIVEQUEEN),
    mods: { extraFind: 0.06, drops: 1.05 },
    effects: { firstKill: { ammo: [[AMMO.R556, 10], [AMMO.P9, 10]] } },
    icon: 'crown',
  }),
  item({
    id: 76,
    key: 'strongbox_coin',
    name: 'Strongbox Coin',
    type: T.TRINKET,
    rarity: L.COMMON,
    flavor: 'Stamped with a bank that has no doors left.',
    source: strongboxes,
    mods: { drops: 1.02, xp: 1.01 },
    icon: 'star',
  }),
]);

const BY_ID = new Map(LOADOUT_CATALOG.map((it) => [it.id, it]));
export const loadoutDef = (id) => BY_ID.get(id) || null;
export const loadoutName = (id) => loadoutDef(id)?.name || 'Loadout item';
export const loadoutRarityName = (rarity) => LOADOUT_RARITY_NAMES[rarity] || 'Unknown';
export const loadoutTypeName = (type) => String(type || 'item').replace(/^\w/, (c) => c.toUpperCase());

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

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const capMul = (k, v) => {
  const cap = k === 'xp' || k === 'reviveXp' ? LOADOUT_BALANCE.xpCap : k === 'bleed' ? LOADOUT_BALANCE.bleedCap : LOADOUT_BALANCE.mulCap;
  return clamp(v, 1 - cap, 1 + cap);
};
const capAdd = (k, v) => (k in LOADOUT_BALANCE.addCaps ? clamp(v, Math.min(0, NO_PERKS[k]), NO_PERKS[k] + LOADOUT_BALANCE.addCaps[k]) : v);

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
  for (const k of Object.keys(m)) {
    if (NO_PERKS[k] === 1) m[k] = capMul(k, m[k]);
    else if (typeof NO_PERKS[k] === 'number') m[k] = capAdd(k, m[k]);
  }
  return m;
}

const combatBase = () => ({ damage: 1, headshot: 1, boss: 1, melee: 1, knock: 1, pierce: 0, ignite: 0 });
export function combineLoadoutCombatEffects(effects) {
  const out = combatBase();
  for (const e of effects || []) {
    if (!e) continue;
    for (const k of ['damage', 'headshot', 'boss', 'melee', 'knock']) if (typeof e[k] === 'number') out[k] *= e[k];
    if (typeof e.pierce === 'number') out.pierce += e.pierce;
    if (typeof e.ignite === 'number') out.ignite += e.ignite;
  }
  const c = LOADOUT_BALANCE.combatCaps;
  for (const k of ['damage', 'headshot', 'boss', 'melee', 'knock']) out[k] = clamp(out[k], 1 / c[k], c[k]);
  out.pierce = Math.max(0, Math.min(c.pierce, out.pierce | 0));
  out.ignite = clamp(out.ignite, 0, c.ignite);
  return out;
}

export function loadoutWeaponEffect(def) {
  const raw = def?.effects?.weapon;
  if (!raw) return null;
  return { item: raw.item | 0 || def.grant?.item || 0, ...combineLoadoutCombatEffects([raw]) };
}

const addAmmoReward = (out, list, cap) => {
  let total = out.reduce((a, p) => a + p[1], 0);
  for (const pair of list || []) {
    const cal = pair[0] | 0;
    if (cal < 0 || total >= cap) continue;
    const n = Math.min(Math.max(0, pair[1] | 0), cap - total);
    if (!n) continue;
    const got = out.find((p) => p[0] === cal);
    if (got) got[1] += n;
    else out.push([cal, n]);
    total += n;
  }
};
const addKillReward = (out, raw, caps) => {
  if (!raw) return;
  if (typeof raw.heal === 'number') out.heal = clamp((out.heal || 0) + raw.heal, 0, caps.heal);
  if (typeof raw.stamina === 'number') out.stamina = clamp((out.stamina || 0) + raw.stamina, 0, caps.stamina);
  addAmmoReward(out.ammo, raw.ammo, caps.ammo);
};
export function loadoutEffects(defs) {
  const ammo = new Map();
  const kill = { heal: 0, stamina: 0, ammo: [] };
  const firstKill = { heal: 0, stamina: 0, ammo: [] };
  for (const def of defs || []) {
    const eff = def?.effects || {};
    if (eff.ammo && Number.isInteger(eff.ammo.ammo)) {
      const list = ammo.get(eff.ammo.ammo) || [];
      list.push(eff.ammo);
      ammo.set(eff.ammo.ammo, list);
    }
    addKillReward(kill, eff.kill, LOADOUT_BALANCE.killCaps);
    addKillReward(firstKill, eff.firstKill, LOADOUT_BALANCE.firstKillCaps);
  }
  return {
    ammo: [...ammo.entries()].map(([cal, list]) => ({ ammo: cal, ...combineLoadoutCombatEffects(list) })),
    kill,
    firstKill,
  };
}

