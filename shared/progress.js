// Experience, levels and perks: what a player earns over every game they play, and the small bonuses they pick
// with it. Pure rules, the same on both ends: the server awards the XP (server/game.js, at the points the
// leaderboard's stats are bumped) and keeps it with the rest of a player's record (stats.js / dbstats.js), the
// client only shows it.
//
// XP is stored and the level is worked out from it (levelOf), so the curve can be retuned without touching anyone's
// record. Each of PICK_LEVELS earns a perk point, PERK_POINTS in all, spent on the perk tree (PERKS): five branches
// of three tiers, combinations that need a perk from two branches, and keystones. What the chosen perks do is perkMods,
// read by the player simulation (s.perks, a bitmask of perk ids) and by the server's rules.
import { ZTYPE } from './defs.js';

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
// A perk point at each of these levels: PERK_POINTS in all, so a survivor at the top level has a third of the tree
export const PICK_LEVELS = [2, 4, 6, 9, 12, 15, 18, 21, 25, 30];
export const PERK_POINTS = PICK_LEVELS.length;
export const picksEarned = (level) => PICK_LEVELS.filter((l) => l <= level).length;
// The tree's rows: a branch's three tiers, then the combinations, then the keystones. A perk opens at its row's level.
export const TIER = { COMBO: 3, KEYSTONE: 4 };
export const TIER_LEVELS = [2, 6, 12, 14, 20];
export const TIER_NAMES = ['Tier 1', 'Tier 2', 'Tier 3', 'Combination', 'Keystone'];
export const KEYSTONE_LEVEL = TIER_LEVELS[TIER.KEYSTONE];
// groups 0..BRANCHES-1 are the tree's branches; the keystones and the combinations stand below them
export const PERK_GROUPS = ['Survivor', 'Gunner', 'Scavenger', 'Support', 'Movement', 'Keystone', 'Combination'];
export const BRANCHES = 5;
const G = { SURVIVOR: 0, GUNNER: 1, SCAVENGER: 2, SUPPORT: 3, MOVEMENT: 4, KEYSTONE: 5, COMBO: 6 };

// The tree. `id` is what a record stores and the bit in s.perks: never reuse or renumber one, and no id past 30 (the
// mask is 31 bits). In a branch, `tier` is its row and `col` (0, 1) its side; `req` are the perks it needs, all of
// them, and a keystone needs any one of `reqAny` (the tier 3 perks). `mods` are the changes to perkMods' BASE, each a
// multiplier or (hp, reviveHp, extraFind, gather, killStamina, killHeal, reviveSelf) an amount. `icon` is a glyph of
// client/ui/icons.js.
export const PERKS = [
  // Survivor: hard to put down
  { id: 0, group: G.SURVIVOR, tier: 0, col: 0, req: [], icon: 'heart', name: 'Thick Skin', text: '+10 max health', mods: { hp: 10 } },
  { id: 1, group: G.SURVIVOR, tier: 0, col: 1, req: [], icon: 'ecg', name: 'Deep Lungs', text: 'Sprinting drains stamina 15% slower', mods: { staminaDrain: 0.85 } },
  { id: 3, group: G.SURVIVOR, tier: 1, col: 0, req: [0], icon: 'cross', name: 'Field Medic', text: 'Medkits, bandages, food and drink are used 25% faster', mods: { useTime: 0.75 } },
  { id: 2, group: G.SURVIVOR, tier: 1, col: 1, req: [1], icon: 'wave', name: 'Strong Swimmer', text: 'Swim 15% faster, and treading water tires you less', mods: { swim: 1.15, swimDrain: 0.8 } },
  { id: 20, group: G.SURVIVOR, tier: 2, col: 0, req: [3], icon: 'shield', name: 'Hardened', text: 'You take 15% less damage', mods: { hurt: 0.85 } },
  // Gunner: quicker and surer with a gun
  { id: 4, group: G.GUNNER, tier: 0, col: 0, req: [], icon: 'bolt', name: 'Quick Hands', text: 'Reload 15% faster', mods: { reload: 0.85 } },
  { id: 5, group: G.GUNNER, tier: 0, col: 1, req: [], icon: 'hand', name: 'Steady Grip', text: '20% less recoil', mods: { recoil: 0.8 } },
  { id: 7, group: G.GUNNER, tier: 1, col: 0, req: [4], icon: 'container', name: 'Scrounger', text: 'The dead you kill drop something 25% more often', mods: { drops: 1.25 } },
  { id: 6, group: G.GUNNER, tier: 1, col: 1, req: [5], icon: 'headshot', name: 'Deadeye', text: 'Headshots deal 15% more damage', mods: { headshot: 1.15 } },
  { id: 21, group: G.GUNNER, tier: 2, col: 1, req: [6], icon: 'skull', name: 'Executioner', text: 'Every kill gives you back 5 health', mods: { killHeal: 5 } },
  // Scavenger: more out of the valley
  { id: 9, group: G.SCAVENGER, tier: 0, col: 0, req: [], icon: 'search', name: 'Light Fingers', text: 'Search containers 25% faster', mods: { search: 0.75 } },
  { id: 10, group: G.SCAVENGER, tier: 0, col: 1, req: [], icon: 'axe', name: 'Lumberjack', text: 'A one in four chance of more sticks or scrap from every chop and salvage', mods: { gather: 0.25 } },
  { id: 8, group: G.SCAVENGER, tier: 1, col: 0, req: [9], icon: 'eye', name: 'Keen Eye', text: 'A one in four chance of an extra find in every container you search', mods: { extraFind: 0.25 } },
  { id: 22, group: G.SCAVENGER, tier: 1, col: 1, req: [10], icon: 'hammer', name: 'Heavy Swing', text: 'Melee hits on the dead deal 20% more damage', mods: { melee: 1.2 } },
  { id: 23, group: G.SCAVENGER, tier: 2, col: 0, req: [8], icon: 'map', name: 'Treasure Hunter', text: 'The extra find comes one time in two, not one in four', mods: { extraFind: 0.25 } },
  // Support: keeping the team on its feet
  { id: 11, group: G.SUPPORT, tier: 0, col: 0, req: [], icon: 'person', name: 'Guardian Angel', text: 'Revive teammates 25% faster', mods: { revive: 0.75 } },
  { id: 13, group: G.SUPPORT, tier: 0, col: 1, req: [], icon: 'trophy', name: 'Mentor', text: 'Revives earn you 50% more XP', mods: { reviveXp: 1.5 } },
  { id: 12, group: G.SUPPORT, tier: 1, col: 0, req: [11], icon: 'flag', name: 'Rally', text: 'Teammates you revive get up with 20 more health', mods: { reviveHp: 20 } },
  { id: 24, group: G.SUPPORT, tier: 1, col: 1, req: [13], icon: 'blueprint', name: 'Quick Study', text: 'Everything you do earns 10% more XP', mods: { xp: 1.1 } },
  { id: 25, group: G.SUPPORT, tier: 2, col: 0, req: [12], icon: 'heart', name: 'Second Wind', text: 'Reviving a teammate gives you back 20 health', mods: { reviveSelf: 20 } },
  // Movement: getting there, and not being seen
  { id: 14, group: G.MOVEMENT, tier: 0, col: 0, req: [], icon: 'arrowRight', name: 'Fleet Foot', text: 'Sprint 8% faster', mods: { sprint: 1.08 } },
  { id: 15, group: G.MOVEMENT, tier: 0, col: 1, req: [], icon: 'eyeOff', name: 'Quiet Steps', text: 'The dead notice you 15% closer', mods: { notice: 0.85 } },
  { id: 16, group: G.MOVEMENT, tier: 1, col: 0, req: [14], icon: 'downed', name: 'Sure Footing', text: 'Knockdowns stun you 25% shorter', mods: { stun: 0.75 } },
  { id: 26, group: G.MOVEMENT, tier: 1, col: 1, req: [15], icon: 'moon', name: 'Ghost', text: 'The dead notice you another 10% closer', mods: { notice: 0.9 } },
  { id: 27, group: G.MOVEMENT, tier: 2, col: 0, req: [16], icon: 'compass', name: 'Marathoner', text: 'Sprinting drains stamina 10% slower', mods: { staminaDrain: 0.9 } },
  // combinations: a tier 2 perk from each of two branches
  { id: 28, group: G.COMBO, tier: TIER.COMBO, col: 0, req: [3, 12], icon: 'cross', name: 'Combat Medic', text: 'Medkits and revives both go 15% faster', mods: { useTime: 0.85, revive: 0.85 } },
  { id: 29, group: G.COMBO, tier: TIER.COMBO, col: 1, req: [6, 26], icon: 'ping', name: 'Stalker', text: 'Headshots deal 10% more damage, and the dead notice you 10% closer', mods: { headshot: 1.1, notice: 0.9 } },
  { id: 30, group: G.COMBO, tier: TIER.COMBO, col: 2, req: [7, 8], icon: 'wrench', name: 'Pack Rat', text: 'The dead drop something 15% more often, and containers are searched 10% faster', mods: { drops: 1.15, search: 0.9 } },
  // keystones: one per survivor, from any branch's tier 3
  { id: 17, group: G.KEYSTONE, tier: TIER.KEYSTONE, col: 0, keystone: true, req: [], icon: 'flame', name: 'Last Stand', text: 'Downed, you bleed out half as fast', mods: { bleed: 0.5 } },
  { id: 18, group: G.KEYSTONE, tier: TIER.KEYSTONE, col: 1, keystone: true, req: [], icon: 'bolt', name: 'Adrenaline', text: 'Every kill gives you back 10 stamina', mods: { killStamina: 10 } },
  { id: 19, group: G.KEYSTONE, tier: TIER.KEYSTONE, col: 2, keystone: true, req: [], icon: 'sun', name: 'Second Chance', text: 'Once a night, a blow that would put you down leaves you on 1 health', mods: { secondChance: 1 } },
];
const TOPS = PERKS.filter((p) => p.tier === 2).map((p) => p.id);
export const PERK_BY_ID = [];
for (const p of PERKS) {
  p.level = TIER_LEVELS[p.tier];
  if (p.keystone) p.reqAny = TOPS;
  PERK_BY_ID[p.id] = p;
}

// No stat moves more than this far from its base through the branches' perks. A combination's bonus goes on top of
// it: the perks a combination needs already take the stats it touches to the cap (Field Medic and Guardian Angel
// healing and reviving, Scrounger and Light Fingers drops and searching), so under the cap Combat Medic and Pack Rat
// did nothing at all. The keystones may pass it too: they are the late, stronger picks, one per player.
export const PERK_CAP = 0.25;
const BASE = { hp: 0, staminaDrain: 1, swim: 1, swimDrain: 1, useTime: 1, reload: 1, recoil: 1, headshot: 1, drops: 1, extraFind: 0, search: 1, gather: 0, revive: 1, reviveHp: 0, reviveXp: 1, sprint: 1, notice: 1, stun: 1, bleed: 1, killStamina: 0, secondChance: 0, hurt: 1, melee: 1, xp: 1, killHeal: 0, reviveSelf: 0 };
const MULS = ['staminaDrain', 'swim', 'swimDrain', 'useTime', 'reload', 'recoil', 'headshot', 'drops', 'search', 'revive', 'sprint', 'notice', 'stun', 'bleed', 'reviveXp', 'hurt', 'melee', 'xp'];
const CAPPED = MULS.filter((k) => k !== 'bleed' && k !== 'reviveXp' && k !== 'xp'); // (a keystone's, and XP, which is no stat of the fight)
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
  const add = (combos) => {
    for (const p of PERKS) {
      if (!(mask & (1 << p.id)) || (p.tier === TIER.COMBO) !== combos) continue;
      for (const [k, v] of Object.entries(p.mods)) {
        if (MULS.includes(k)) m[k] *= v;
        else m[k] += v;
      }
    }
  };
  add(false);
  for (const k of CAPPED) m[k] = Math.max(1 - PERK_CAP, Math.min(1 + PERK_CAP, m[k]));
  m.hp = Math.min(m.hp, Math.round(100 * PERK_CAP));
  add(true); // the combinations, on top of the cap
  cache.set(mask, Object.freeze(m));
  return m;
}

export const perkMask = (ids) => (Array.isArray(ids) ? ids.reduce((m, id) => (PERK_BY_ID[id] ? m | (1 << id) : m), 0) >>> 0 : 0);
export const perkIds = (mask) => PERK_BY_ID.filter((p) => p && mask & (1 << p.id)).map((p) => p.id);

// does a set of perks (ids) have what this perk needs?
export const perkNeedsMet = (p, have) => p.req.every((r) => have.includes(r)) && (!p.reqAny || p.reqAny.some((r) => have.includes(r)));

// Why someone at `level` with `owned` (ids) cannot take this perk now, '' when they can: 'unknown', 'owned', 'level'
// (below the perk's level), 'needs' (a perk it needs is missing), 'keystone' (they have one) or 'points' (none left)
export function perkLock(owned, id, level) {
  const p = Number.isInteger(id) ? PERK_BY_ID[id] : null;
  if (!p) return 'unknown';
  if (owned.includes(id)) return 'owned';
  if (level < p.level) return 'level';
  if (!perkNeedsMet(p, owned)) return 'needs';
  if (p.keystone && owned.some((o) => PERK_BY_ID[o]?.keystone)) return 'keystone';
  if (owned.length >= picksEarned(level)) return 'points';
  return '';
}

// The perks of `owned` that need this one, and would be left without what they need if it went
export function perkDependents(owned, id) {
  const rest = owned.filter((o) => o !== id);
  return rest.filter((o) => PERK_BY_ID[o] && !perkNeedsMet(PERK_BY_ID[o], rest));
}

// Is this a set of perks a player with this much XP can have? Known, none twice, no more than their level has earned
// points for, each at or under their level with what it needs in the set, and at most one keystone. The order is
// not looked at.
export function perksValid(ids, xp) {
  const level = levelOf(xp);
  if (!Array.isArray(ids) || ids.length > picksEarned(level)) return false;
  if (new Set(ids).size !== ids.length) return false;
  let keys = 0;
  for (const id of ids) {
    const p = Number.isInteger(id) ? PERK_BY_ID[id] : null;
    if (!p || level < p.level || !perkNeedsMet(p, ids)) return false;
    if (p.keystone && ++keys > 1) return false;
  }
  return true;
}

// As much of a stored set as a player with this much XP can still have (the tree or the curve may have changed
// since it was picked): the perks taken in their order, each once what it needs is in, until the points run out
export function fitPerks(ids, xp) {
  const level = levelOf(xp);
  const want = Array.isArray(ids) ? ids.map(Number) : [];
  const out = [];
  for (let grew = true; grew; ) {
    grew = false;
    for (const id of want) {
      if (perkLock(out, id, level)) continue;
      out.push(id);
      grew = true;
    }
  }
  return out;
}

// What a player's progress amounts to, as the API and the Perks panel show it: points earned (picks), unspent
// (pending), the level of the next one
export function progressView(xp, perks) {
  const info = levelInfo(xp);
  const earned = picksEarned(info.level);
  const nextPick = PICK_LEVELS.find((l) => l > info.level) || 0;
  return { xp, ...info, perks: perks.slice(), picks: earned, points: PERK_POINTS, pending: Math.max(0, earned - perks.length), nextPick };
}
