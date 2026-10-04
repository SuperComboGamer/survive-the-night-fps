// Achievements: the one list the server and the client both go by (ids, numbers, rules), and the pure rules on a
// player's progress: what a counter has reached, what a batch of progress unlocks, two records merged.
//
// Two kinds:
//   counters  `stat` + `goal`: unlocked once the player's lifetime count of that stat reaches the goal. The counts
//             are ACH_STATS, kept per player (an account's in Postgres, a guest's in their browser's localStorage)
//   feats     no stat: the server sees it happen (server/achievements.js) and says so
// `n` is the achievement's number on the wire (EVT.ACHIEVE, a u8) and `id` its name in storage: neither is ever
// changed or reused. A new achievement takes the next free number.
//
// Who keeps what (docs/ARCHITECTURE.md, Achievements):
//   a guest    the server sends the stat counts as they grow and the feats as they happen; the browser adds them up,
//              decides the counters (applyAchievements) and keeps it all (client/net/achievements.js)
//   an account the server does all of it, against the database (server/userachievements.js), and tells the
//              browser what unlocked. Signing in merges what the browser earned as a guest (mergeProgress).
import { ITEM } from './defs.js';
import { MOUNTED_GUN } from './mountedgun.js';

// The lifetime counts. The index is the stat's number on the wire: append only.
//   kills      the dead put down (zombies and turned players)     nights    nights seen through alive
//   escapes    runs escaped: at the car, alive, as it drove off   headshots kills with a shot to the head
//   revives    teammates got back on their feet                   crafted   things crafted
//   salvaged   things torn down for parts                         trees     trees felled
//   distance   metres covered as a survivor                       days      calendar days played on
export const ACH_STATS = ['kills', 'nights', 'escapes', 'headshots', 'revives', 'crafted', 'salvaged', 'trees', 'distance', 'days'];
export const ACH_STAT_INDEX = Object.fromEntries(ACH_STATS.map((k, i) => [k, i]));
export const ACH_STAT_MAX = 0x7fffffff;

// EVT.ACHIEVE flags. ACCOUNT: what it names is the player's account's, already kept by the server (only unlocks
// follow); without it, it is a guest's progress for the browser to add to its own
export const ACHF = { ACCOUNT: 1 };

export const ACH_TIERS = ['bronze', 'silver', 'gold', 'platinum'];
export const ACH_GROUPS = [
  ['progress', 'Progression'],
  ['combat', 'Combat'],
  ['places', 'Places'],
  ['survival', 'Survival'],
  ['social', 'Social'],
  ['secret', 'Secret'],
];

// icon: a glyph name (client/ui/icons.js), or 'item:<id>' for an item's icon. unit 'm': the stat is metres
const C = (n, id, tier, stat, goal, name, desc, icon, extra) => ({ n, id, group: 'progress', tier, stat, goal, name, desc, icon, ...extra });
const F = (n, id, group, tier, name, desc, icon, extra) => ({ n, id, group, tier, name, desc, icon, ...extra });

export const ACHIEVEMENTS = [
  // ---- progression: lifetime counts
  C(1, 'kills_10', 'bronze', 'kills', 10, 'First Blood', 'Put down 10 of the dead.', 'skull'),
  C(2, 'kills_100', 'silver', 'kills', 100, 'Body Count', 'Put down 100 of the dead.', 'skull'),
  C(3, 'kills_1000', 'gold', 'kills', 1000, 'Grim Harvest', 'Put down 1,000 of the dead.', 'horde'),
  C(4, 'kills_10000', 'platinum', 'kills', 10000, 'Extinction Event', 'Put down 10,000 of the dead.', 'bossSkull'),
  C(5, 'nights_1', 'bronze', 'nights', 1, 'Made It to Morning', 'See a night through to the dawn.', 'sun'),
  C(6, 'nights_10', 'silver', 'nights', 10, 'Night Owl', 'See 10 nights through.', 'moon'),
  C(7, 'nights_50', 'gold', 'nights', 50, 'Creature of the Night', 'See 50 nights through.', 'moon'),
  C(8, 'escapes_1', 'bronze', 'escapes', 1, 'Hit the Road', 'Escape the valley: be at the car, alive, when it drives off.', 'car'),
  C(9, 'escapes_5', 'silver', 'escapes', 5, 'Repeat Offender', 'Escape the valley 5 times.', 'car'),
  C(10, 'escapes_25', 'gold', 'escapes', 25, 'Valley Veteran', 'Escape the valley 25 times.', 'car'),
  C(11, 'headshots_25', 'bronze', 'headshots', 25, 'Sharpshooter', 'Kill 25 of the dead with a shot to the head.', 'headshot'),
  C(12, 'headshots_250', 'silver', 'headshots', 250, 'Dead Eye', 'Kill 250 with a shot to the head.', 'headshot'),
  C(13, 'headshots_2500', 'gold', 'headshots', 2500, 'One Shot, One Kill', 'Kill 2,500 with a shot to the head.', 'headshot'),
  C(14, 'revives_1', 'bronze', 'revives', 1, 'Get Up!', 'Get a downed teammate back on their feet.', 'cross'),
  C(15, 'revives_25', 'silver', 'revives', 25, 'Field Medic', 'Revive 25 teammates.', 'cross'),
  C(16, 'revives_100', 'gold', 'revives', 100, 'Guardian Angel', 'Revive 100 teammates.', 'heart'),
  C(17, 'crafted_10', 'bronze', 'crafted', 10, 'Tinkerer', 'Craft 10 things.', 'wrench'),
  C(18, 'crafted_100', 'silver', 'crafted', 100, 'Workshop Hero', 'Craft 100 things.', 'wrench'),
  C(19, 'crafted_1000', 'gold', 'crafted', 1000, 'Master Crafter', 'Craft 1,000 things.', 'hammer'),
  C(20, 'salvaged_10', 'bronze', 'salvaged', 10, 'Scrapper', 'Tear 10 things down for parts.', 'container'),
  C(21, 'salvaged_100', 'silver', 'salvaged', 100, 'Strip Mine', 'Tear 100 things down for parts.', 'container'),
  C(22, 'salvaged_500', 'gold', 'salvaged', 500, 'Nothing Goes to Waste', 'Tear 500 things down for parts.', 'container'),
  C(23, 'trees_1', 'bronze', 'trees', 1, 'Timber!', 'Chop a tree all the way down.', 'axe'),
  C(24, 'trees_25', 'silver', 'trees', 25, 'Lumberjack', 'Fell 25 trees.', 'axe'),
  C(25, 'trees_250', 'gold', 'trees', 250, 'Deforestation', 'Fell 250 trees.', 'axe'),
  C(26, 'distance_1k', 'bronze', 'distance', 1000, 'Stretch Your Legs', 'Cover 1 km as a survivor.', 'compass', { unit: 'm' }),
  C(27, 'distance_10k', 'silver', 'distance', 10000, 'The Long Walk', 'Cover 10 km as a survivor.', 'compass', { unit: 'm' }),
  C(28, 'distance_100k', 'gold', 'distance', 100000, 'Walking Dead', 'Cover 100 km as a survivor.', 'map', { unit: 'm' }),
  C(29, 'days_3', 'bronze', 'days', 3, 'Regular', 'Play on 3 different days.', 'sun'),
  C(30, 'days_10', 'silver', 'days', 10, 'Habit', 'Play on 10 different days.', 'sun'),
  C(31, 'days_30', 'gold', 'days', 30, 'Lifer', 'Play on 30 different days.', 'sun'),

  // ---- combat
  F(32, 'kill_pistol', 'combat', 'bronze', 'Sidearm', 'Kill one of the dead with the pistol.', `item:${ITEM.PISTOL}`),
  F(33, 'kill_shotgun', 'combat', 'bronze', 'Boomstick', 'Kill one with a shotgun or the double-barrel.', `item:${ITEM.SHOTGUN}`),
  F(34, 'kill_rifle', 'combat', 'bronze', 'Rifleman', 'Kill one with a rifle: the AK-47, the M4A1 or the hunting rifle.', `item:${ITEM.AK47}`),
  F(35, 'kill_atrifle', 'combat', 'silver', 'Big Game', 'Kill one with the anti-tank rifle.', `item:${ITEM.AT_RIFLE}`),
  F(36, 'kill_rpg', 'combat', 'silver', 'Danger Close', 'Kill one with the RPG.', `item:${ITEM.RPG}`),
  F(37, 'kill_flame', 'combat', 'silver', 'Barbecue', 'Kill one with the flamethrower.', `item:${ITEM.FLAMETHROWER}`),
  F(38, 'kill_knife', 'combat', 'bronze', 'Up Close and Personal', 'Kill one with the knife.', `item:${ITEM.KNIFE}`),
  F(39, 'kill_mg', 'combat', 'silver', 'Hold the Line', 'Kill one with the mounted gun.', 'bolt'),
  F(40, 'kill_boss', 'combat', 'gold', 'Giant Slayer', "Bring down a night's boss before the sun does.", 'bossSkull'),
  F(41, 'kill_tank', 'combat', 'silver', 'Tank Buster', 'Kill a Tank.', 'shield'),
  F(42, 'pacifist', 'combat', 'gold', 'Conscientious Objector', 'See a whole night through without firing a shot.', 'hand'),
  F(43, 'grenade_5', 'combat', 'gold', 'Frag Out', 'Kill 5 of the dead with one grenade or pipe bomb.', `item:${ITEM.GRENADE}`),

  // ---- places: the valley and what is in it
  F(44, 'mine_enter', 'places', 'bronze', 'Into the Dark', 'Go down into Blackrock Mine.', 'flashlight'),
  F(45, 'mine_deep', 'places', 'silver', 'Rock Bottom', 'Reach the deepest room of Blackrock Mine.', 'lock'),
  F(46, 'clinic_clear', 'places', 'gold', 'Clean Bill of Health', "Put down the last of the dead in Mercy Clinic's wards.", 'cross'),
  F(47, 'town_loot', 'places', 'gold', 'Picked Clean', 'Help strip Hollow Creek: every container in town searched in one run.', 'search'),
  F(48, 'handcar_run', 'places', 'silver', 'End of the Line', 'Ride a handcar from one end of its line to the other.', 'arrowRight'),
  F(49, 'swim_lake', 'places', 'bronze', 'Strong Swimmer', 'Swim 60 m in one go.', 'wave'),
  F(50, 'near_drown', 'places', 'silver', 'Second Wind', 'Start to drown, and make it out of the water alive.', 'wave'),
  F(51, 'radio_call', 'places', 'bronze', 'Mayday', "Call in a supply drop on the Relay Station's radio.", 'radio'),
  F(52, 'flare', 'places', 'bronze', 'Light It Up', 'Light a road flare, or fire the flare gun.', 'flame'),
  F(53, 'landmarks', 'places', 'gold', 'Tourist', 'Visit every place in the valley in one run.', 'flag'),
  F(54, 'ferris', 'places', 'bronze', 'Thrill Seeker', 'Ride the Ferris wheel at the fair while it turns.', 'star'),
  F(55, 'driver', 'places', 'gold', 'Getaway Driver', 'Be the one who drives the car away.', 'engine'),

  // ---- survival
  F(56, 'low_hp', 'survival', 'silver', 'By a Thread', 'See the dawn on your feet with under 10 health.', 'ecg'),
  F(57, 'flawless', 'survival', 'platinum', 'Flawless', 'Escape in a run where no survivor died.', 'shield'),
  F(58, 'leaper_off', 'survival', 'bronze', 'Get Off Me!', 'Throw off a leaper that has you pinned.', 'hand'),
  F(59, 'tank_dodge', 'survival', 'silver', 'Olé!', 'A charging Tank comes for you, and misses.', 'bolt'),

  // ---- with other people
  F(60, 'friend', 'social', 'bronze', 'Better Together', 'Play in a game with a friend.', 'people'),
  F(61, 'stranger', 'social', 'bronze', 'Kindness of Strangers', 'Revive a survivor who is not on your friends list.', 'personPlus'),
  F(62, 'invited', 'social', 'bronze', 'Plus One', 'Join an invite-only game.', 'link'),
  F(63, 'walkie', 'social', 'bronze', 'Breaker, Breaker', 'Talk over the walkie-talkie.', 'radio'),

  // ---- secret: "???" until unlocked
  F(64, 'fall_death', 'secret', 'bronze', 'Gravity Wins', 'Die from a fall.', 'downed', { secret: true }),
  F(65, 'drowned', 'secret', 'bronze', 'Sleeps with the Fishes', 'Drown.', 'wave', { secret: true }),
  F(66, 'turncoat', 'secret', 'silver', 'Turncoat', 'As one of the dead, kill a survivor.', 'claw', { secret: true }),
  F(67, 'car_alarm', 'secret', 'bronze', 'Wake the Neighbours', "Set off a car's alarm.", 'hazard', { secret: true }),
  F(68, 'dinner_bell', 'secret', 'silver', 'Dinner Bell', 'Ring the chapel bell at night.', 'horde', { secret: true }),
];

export const ACH_BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));
export const ACH_BY_N = [];
for (const a of ACHIEVEMENTS) ACH_BY_N[a.n] = a;

// The kind of weapon a kill counts for (combat's "first kill with..."), by the weapon on the kill
export const KILL_FEATS = {
  [ITEM.PISTOL]: 'kill_pistol',
  [ITEM.SHOTGUN]: 'kill_shotgun',
  [ITEM.DB_SHOTGUN]: 'kill_shotgun',
  [ITEM.AK47]: 'kill_rifle',
  [ITEM.M4A1]: 'kill_rifle',
  [ITEM.HUNTING_RIFLE]: 'kill_rifle',
  [ITEM.AT_RIFLE]: 'kill_atrifle',
  [ITEM.RPG]: 'kill_rpg',
  [ITEM.FLAMETHROWER]: 'kill_flame',
  [ITEM.KNIFE]: 'kill_knife',
  [MOUNTED_GUN]: 'kill_mg',
};

// ---------------------------------------------------------------- the rules
const whole = (v, max = ACH_STAT_MAX) => (typeof v === 'number' && v > 0 ? Math.min(Math.floor(v), max) : 0);
const EARLIEST = Date.UTC(2024, 0, 1); // (no unlock is older than the game)

// is this one a feat (the server says it happened), not a counter?
export const isFeat = (id) => {
  const a = ACH_BY_ID.get(id);
  return !!a && !a.stat;
};

// The counters reached by these counts that are not in `unlocked` (an object: id -> when) yet: [id]
export function counterUnlocks(stats, unlocked = {}) {
  const out = [];
  for (const a of ACHIEVEMENTS) if (a.stat && !unlocked[a.id] && (stats[a.stat] || 0) >= a.goal) out.push(a.id);
  return out;
}

// A record of the right shape out of anything at all: { stats: { stat: n }, unlocked: { id: ms } }. Unknown stats and
// achievements are dropped, counts are whole numbers in range, and a time that is no time is "some time" (1). The
// stored or posted value is never trusted.
export function sanitizeProgress(raw, now = Date.now()) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const s = o.stats && typeof o.stats === 'object' ? o.stats : {};
  const u = o.unlocked && typeof o.unlocked === 'object' && !Array.isArray(o.unlocked) ? o.unlocked : {};
  const stats = {};
  for (const k of ACH_STATS) stats[k] = whole(s[k]);
  const unlocked = {};
  for (const id of Object.keys(u)) {
    if (!ACH_BY_ID.has(id)) continue;
    const t = whole(u[id], now);
    unlocked[id] = t >= EARLIEST ? t : 1;
  }
  return { stats, unlocked };
}

// Two records of one player as one (a guest's browser and their account): the greater of each count, every
// unlock of either at the earlier of its two times. Neither is changed.
export function mergeProgress(a, b) {
  const stats = {};
  for (const k of ACH_STATS) stats[k] = Math.max(a.stats[k] || 0, b.stats[k] || 0);
  const unlocked = { ...a.unlocked };
  for (const [id, t] of Object.entries(b.unlocked)) unlocked[id] = unlocked[id] ? Math.min(unlocked[id], t) : t;
  return { stats, unlocked };
}

// Adds what came in to a record, in place: counts (`add`: stat -> n), feats (ids) and every counter that now
// reaches its goal. -> the ids newly unlocked, feats first
export function applyAchievements(prog, add = {}, feats = [], now = Date.now()) {
  const fresh = [];
  for (const k of ACH_STATS) {
    const n = whole(add[k]);
    if (n) prog.stats[k] = Math.min(ACH_STAT_MAX, (prog.stats[k] || 0) + n);
  }
  for (const id of feats) {
    if (!isFeat(id) || prog.unlocked[id]) continue;
    prog.unlocked[id] = now;
    fresh.push(id);
  }
  for (const id of counterUnlocks(prog.stats, prog.unlocked)) {
    prog.unlocked[id] = now;
    fresh.push(id);
  }
  return fresh;
}

// How far along a counter is: { have, goal } (have capped at goal); null for a feat
export function achProgress(a, stats) {
  if (!a.stat) return null;
  return { have: Math.min(a.goal, stats[a.stat] || 0), goal: a.goal };
}
