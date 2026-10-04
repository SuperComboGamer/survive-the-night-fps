// Experience, levels and perks: what a player earns over every game they play, and the small bonuses they pick
// with it. Pure rules, the same on both ends: the server awards the XP (server/game.js, at the points the
// leaderboard's stats are bumped) and keeps it with the rest of a player's record (stats.js / dbstats.js), the
// client only shows it.
//
// XP is stored and the level is worked out from it (levelOf), so the curve can be retuned without touching anyone's
// record. A perk is picked one of three (perkOffer) at each of PICK_LEVELS; what the picked perks do is perkMods,
// read by the player simulation (s.perks, a bitmask of perk ids) and by the server's rules.
import { ZTYPE } from './defs.js';
import { mulberry32 } from './rng.js';

// ---------------------------------------------------------------- XP
// What each thing a survivor does is worth. All first guesses: nobody has played them yet.
export const XP = {
  kill: 5, // one of the rank and file (walkers, runners, dogs, bats)
  kinds: { [ZTYPE.SPITTER]: 15, [ZTYPE.BOOMER]: 15, [ZTYPE.LEAPER]: 20, [ZTYPE.ROPER]: 20, [ZTYPE.SHADE]: 25, [ZTYPE.TANK]: 30 },
  headshot: 2, // on top of the kill
  boss: 150,
  revive: 40,
  night: 100, // x the night's number, for being alive at its dawn...
  nightCap: 500, // ...up to this
  escape: 500, // in the car as it leaves
  team: 250, // the run won without them in the car (turned, left behind)
  best: 50, // a dawn past the furthest day they have ever seen
  killsFull: 60, // kills a night (or a day) at full XP: each past that is worth half
  revivesFull: 6, // revives a night that earn anything
};
// the sources of a run's XP, in the order S2C.PROGRESS sends them and the end screen lists them
export const XP_SRC = ['kills', 'headshots', 'bosses', 'revives', 'nights', 'escape', 'best'];
export const XP_SRC_NAMES = ['Kills', 'Headshots', 'Bosses', 'Revives', 'Nights survived', 'Escape', 'Personal best'];
export const XPS = Object.fromEntries(XP_SRC.map((k, i) => [k, i]));

// what killing one of the dead is worth (before the night's diminishing returns): the kind, a boss, a headshot
export function killXp(ztype, boss, headshot) {
  if (boss) return XP.boss;
  return (XP.kinds[ztype] ?? XP.kill) + (headshot ? XP.headshot : 0);
}

// ---------------------------------------------------------------- levels
export const LEVEL_CAP = 30;
// XP from level L to L + 1
export const xpToNext = (level) => 200 + 120 * level;
// the XP a level starts at (level 1: 0)
const STARTS = [0, 0];
for (let l = 2; l <= LEVEL_CAP; l++) STARTS[l] = STARTS[l - 1] + xpToNext(l - 1);
export const xpForLevel = (level) => STARTS[Math.max(1, Math.min(LEVEL_CAP, level | 0))];

export function levelOf(xp) {
  let l = 1;
  while (l < LEVEL_CAP && xp >= STARTS[l + 1]) l++;
  return l;
}

// { level, into: XP past the level's start, need: XP from its start to the next (0 at the cap), frac: 0..1 }
export function levelInfo(xp) {
  const level = levelOf(Math.max(0, xp));
  if (level >= LEVEL_CAP) return { level, into: 0, need: 0, frac: 1 };
  const into = xp - STARTS[level];
  const need = xpToNext(level);
  return { level, into, need, frac: Math.min(1, into / need) };
}

// ---------------------------------------------------------------- perks
// The levels a perk is picked at: every second up to 20, then every fifth
export const PICK_LEVELS = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 25, 30];
export const KEYSTONE_LEVEL = 20; // keystones are offered from the pick at this level, one per player
export const picksEarned = (level) => PICK_LEVELS.filter((l) => l <= level).length;
export const PERK_GROUPS = ['Survivor', 'Gunner', 'Scavenger', 'Support', 'Movement', 'Keystone'];
const G = { SURVIVOR: 0, GUNNER: 1, SCAVENGER: 2, SUPPORT: 3, MOVEMENT: 4, KEYSTONE: 5 };

// The pool. `id` is what a record stores and the bit in s.perks: never reuse or renumber one. `mods` are the
// changes to perkMods' BASE, each a multiplier or (hp, reviveHp, extraFind, gather, killStamina) an amount.
export const PERKS = [
  { id: 0, group: G.SURVIVOR, name: 'Thick Skin', text: '+10 max health', mods: { hp: 10 } },
  { id: 1, group: G.SURVIVOR, name: 'Deep Lungs', text: 'Sprinting drains stamina 15% slower', mods: { staminaDrain: 0.85 } },
  { id: 2, group: G.SURVIVOR, name: 'Strong Swimmer', text: 'Swim 15% faster, and treading water tires you less', mods: { swim: 1.15, swimDrain: 0.8 } },
  { id: 3, group: G.SURVIVOR, name: 'Field Medic', text: 'Medkits, bandages, food and drink are used 25% faster', mods: { useTime: 0.75 } },
  { id: 4, group: G.GUNNER, name: 'Quick Hands', text: 'Reload 15% faster', mods: { reload: 0.85 } },
  { id: 5, group: G.GUNNER, name: 'Steady Grip', text: '20% less recoil', mods: { recoil: 0.8 } },
  { id: 6, group: G.GUNNER, name: 'Deadeye', text: 'Headshots deal 15% more damage', mods: { headshot: 1.15 } },
  { id: 7, group: G.GUNNER, name: 'Scrounger', text: 'The dead you kill drop something 25% more often', mods: { drops: 1.25 } },
  { id: 8, group: G.SCAVENGER, name: 'Keen Eye', text: 'A one in four chance of an extra find in every container you search', mods: { extraFind: 0.25 } },
  { id: 9, group: G.SCAVENGER, name: 'Light Fingers', text: 'Search containers 25% faster', mods: { search: 0.75 } },
  { id: 10, group: G.SCAVENGER, name: 'Lumberjack', text: 'A one in four chance of more sticks or scrap from every chop and salvage', mods: { gather: 0.25 } },
  { id: 11, group: G.SUPPORT, name: 'Guardian Angel', text: 'Revive teammates 25% faster', mods: { revive: 0.75 } },
  { id: 12, group: G.SUPPORT, name: 'Rally', text: 'Teammates you revive get up with 20 more health', mods: { reviveHp: 20 } },
  { id: 13, group: G.SUPPORT, name: 'Mentor', text: 'Revives earn you 50% more XP', mods: { reviveXp: 1.5 } },
  { id: 14, group: G.MOVEMENT, name: 'Fleet Foot', text: 'Sprint 8% faster', mods: { sprint: 1.08 } },
  { id: 15, group: G.MOVEMENT, name: 'Quiet Steps', text: 'The dead notice you 15% closer', mods: { notice: 0.85 } },
  { id: 16, group: G.MOVEMENT, name: 'Sure Footing', text: 'Knockdowns stun you 25% shorter', mods: { stun: 0.75 } },
  { id: 17, group: G.KEYSTONE, keystone: true, name: 'Last Stand', text: 'Downed, you bleed out half as fast', mods: { bleed: 0.5 } },
  { id: 18, group: G.KEYSTONE, keystone: true, name: 'Adrenaline', text: 'Every kill gives you back 10 stamina', mods: { killStamina: 10 } },
  { id: 19, group: G.KEYSTONE, keystone: true, name: 'Second Chance', text: 'Once a night, a blow that would put you down leaves you on 1 health', mods: { secondChance: 1 } },
];
export const PERK_BY_ID = [];
for (const p of PERKS) PERK_BY_ID[p.id] = p;

// No stat moves more than this far from its base through the ordinary perks (keystones may: they are the late,
// stronger picks, one per player)
export const PERK_CAP = 0.25;
const BASE = { hp: 0, staminaDrain: 1, swim: 1, swimDrain: 1, useTime: 1, reload: 1, recoil: 1, headshot: 1, drops: 1, extraFind: 0, search: 1, gather: 0, revive: 1, reviveHp: 0, reviveXp: 1, sprint: 1, notice: 1, stun: 1, bleed: 1, killStamina: 0, secondChance: 0 };
const MULS = ['staminaDrain', 'swim', 'swimDrain', 'useTime', 'reload', 'recoil', 'headshot', 'drops', 'search', 'revive', 'sprint', 'notice', 'stun', 'bleed', 'reviveXp'];
const CAPPED = MULS.filter((k) => k !== 'bleed' && k !== 'reviveXp'); // (a keystone's, and XP, which is no stat of the fight)
const cache = new Map();
export const NO_PERKS = Object.freeze({ ...BASE });

// What a set of perks (a bitmask of ids, as s.perks) does: one frozen object per mask, so it costs nothing to ask
// every command.
export function perkMods(mask) {
  mask >>>= 0;
  if (!mask) return NO_PERKS;
  let m = cache.get(mask);
  if (m) return m;
  m = { ...BASE };
  for (const p of PERKS) {
    if (!(mask & (1 << p.id))) continue;
    for (const [k, v] of Object.entries(p.mods)) {
      if (MULS.includes(k)) m[k] *= v;
      else m[k] += v;
    }
  }
  for (const k of CAPPED) m[k] = Math.max(1 - PERK_CAP, Math.min(1 + PERK_CAP, m[k]));
  m.hp = Math.min(m.hp, Math.round(100 * PERK_CAP));
  cache.set(mask, Object.freeze(m));
  return m;
}

export const perkMask = (ids) => (Array.isArray(ids) ? ids.reduce((m, id) => (PERK_BY_ID[id] ? m | (1 << id) : m), 0) >>> 0 : 0);
export const perkIds = (mask) => PERKS.filter((p) => mask & (1 << p.id)).map((p) => p.id);

// Is this a set of picks a player with this much XP can have? ids in the order they were picked: known, none twice,
// no more than their level has earned, and at most one keystone, picked no earlier than KEYSTONE_LEVEL's pick.
export function perksValid(ids, xp) {
  if (!Array.isArray(ids) || ids.length > picksEarned(levelOf(xp))) return false;
  const seen = new Set();
  let keys = 0;
  for (const [i, id] of ids.entries()) {
    const p = Number.isInteger(id) ? PERK_BY_ID[id] : null;
    if (!p || seen.has(id)) return false;
    seen.add(id);
    if (p.keystone && (++keys > 1 || PICK_LEVELS[i] < KEYSTONE_LEVEL)) return false;
  }
  return true;
}

// a number from a string, for perkSalt
function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}
// What a player's offers are drawn from: who they are (their record's key, which never leaves the server) and how
// many times they have started over (a respec deals new offers)
export const perkSalt = (key, respecs = 0) => (hashStr(String(key)) ^ Math.imul((respecs | 0) + 1, 0x85ebca6b)) >>> 0;

// The three perks offered for a player's next pick, after `owned` (ids, in pick order): [] when every pick is made.
// Each from a different group where the pool allows; from KEYSTONE_LEVEL's pick on, one of them is a keystone until
// they have one. The same owned + salt always deal the same three, so reloading the page draws nothing new.
export function perkOffer(owned, salt) {
  const n = owned.length;
  if (n >= PICK_LEVELS.length) return [];
  const have = new Set(owned);
  const keyOk = PICK_LEVELS[n] >= KEYSTONE_LEVEL && !owned.some((id) => PERK_BY_ID[id]?.keystone);
  const pool = PERKS.filter((p) => !have.has(p.id) && (!p.keystone || keyOk));
  const rnd = mulberry32((salt ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const out = [];
  const groups = new Set();
  const take = (p) => {
    out.push(p);
    groups.add(p.group);
  };
  if (keyOk) {
    const key = pool.find((p) => p.keystone);
    if (key) take(key);
  }
  for (const p of pool) if (out.length < 3 && !groups.has(p.group)) take(p);
  for (const p of pool) if (out.length < 3 && !out.includes(p)) take(p);
  return out.map((p) => p.id);
}

// What a player's progress amounts to, as the API and the Progress panel show it
export function progressView(xp, perks, salt) {
  const info = levelInfo(xp);
  const earned = picksEarned(info.level);
  const nextPick = PICK_LEVELS.find((l) => l > info.level) || 0;
  return { xp, ...info, perks: perks.slice(), picks: earned, pending: Math.max(0, earned - perks.length), nextPick, offer: earned > perks.length ? perkOffer(perks, salt) : [] };
}
