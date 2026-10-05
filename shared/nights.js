// Night themes: what tonight's horde is made of. A theme is drawn from the map seed and the night number, so the
// server (which builds the waves, server/game.js startNight) and the client (which warns the team on the dawn
// card, at the dusk horn and on the night's title) each work it out for themselves: nothing crosses the wire.
import { ZTYPE } from './defs.js';
import { mulberry32 } from './rng.js';
import { WORLD, nightRank } from './acts.js';

// mul: multipliers on startNight's spawn weights. A theme changes what the horde is made of, not how many come
// (the head count is untouched), and a type the night has not unlocked has weight 0 and stays out.
// from: the first night it can be drawn (the night its zombies join the horde: ZOMBIE_DEFS minNight, one new kind a night).
// warn: what is coming and what to do about it - one line, short enough for the night's title card (85 characters).
// No theme multiplies Tanks: at a fixed head count each one adds 2200 health, as much as twenty walkers.
// The multipliers are a first pass: measured to keep a night's total health within 15% of a plain one, not played.
export const NIGHT_THEMES = [
  { id: 'pack', name: 'The Pack', from: 2, mul: { [ZTYPE.DOG]: 4, [ZTYPE.WALKER]: 0.6 }, warn: 'Dog packs: they cannot jump a barricade, so close the ring and leave no gap.' },
  { id: 'sprinters', name: 'Sprinters', from: 2, mul: { [ZTYPE.RUNNER]: 2.5, [ZTYPE.WALKER]: 0.4 }, warn: 'Half the horde are runners: no walking away, so be behind walls by dark.' },
  // (spitters x2, not x3: they are the hardest-hitting special against a team that holds a spot)
  { id: 'bile', name: 'Bile', from: 4, mul: { [ZTYPE.SPITTER]: 2, [ZTYPE.BOOMER]: 3 }, warn: 'Spitters and boomers: spit clears barricades, not walls. Shoot boomers far off.' },
  // shadeCap: the night's cap on shades doubles too (never past 6: each one ties up a light)
  { id: 'lightsout', name: 'Lights Out', from: 6, mul: { [ZTYPE.SHADE]: 4 }, shadeCap: 2, warn: 'More shades: they freeze in light, so set torches or a campfire and stay in it.' },
  { id: 'wings', name: 'Wings', from: 7, mul: { [ZTYPE.BAT]: 4, [ZTYPE.LEAPER]: 2 }, warn: 'Bats and leapers: they clear barricades, so stay close and free whoever is pinned.' },
  { id: 'snare', name: 'The Snare', from: 8, mul: { [ZTYPE.ROPER]: 3 }, warn: 'Ropers: a rope needs line of sight, so keep to cover and shoot the roper to break it.' },
];

export const THEME_CHANCE = 0.65; // share of nights (from night 2) that draw a theme; the rest are plain

// The theme of a night, or null on a plain one. Night 1 is always plain (a first night is the baseline), and no
// theme comes two nights running. act: the map it is played on (acts.js): on the mainland a night counts as the
// fourth at the least (nightRank), so the later themes can be drawn there however early the team crossed.
export function nightTheme(seed, night, act = WORLD.ISLAND) {
  let prev = null;
  for (let n = 2; n <= night; n++) {
    const rng = mulberry32((Math.imul(seed | 0, 2654435761) ^ Math.imul(n + 101, 40503)) >>> 0);
    let t = null;
    if (rng() < THEME_CHANCE) {
      const pool = NIGHT_THEMES.filter((th) => nightRank(act, n) >= th.from && th !== prev);
      t = pool[Math.floor(rng() * pool.length)];
    }
    prev = t;
  }
  return prev;
}

// Every night has a boss, and it comes with the second wave (BOSS_WAVE). Night 1's is always The Brute, a simple one
// to learn on; from night 2 on, the boss is drawn from the seed and the night number from those that can come that
// night (from), never the one that came the night before, and three times as likely to be one the run has not met
// yet. Like the theme, both ends work it out from the seed: the server to spawn it (Game.startNight), the client to
// name it on the dawn card and at the dusk horn, so the day can go on getting ready for it.
export const FIRST_BOSS = ZTYPE.BOSS_BRUTE;
export const BOSS_POOL = [
  { type: ZTYPE.BOSS_ALPHA, from: 2 },
  { type: ZTYPE.TANK, from: 2 }, // at TANK_BOSS_HP of a Tank's health
  { type: ZTYPE.BOSS_BLOATER, from: 3 },
  { type: ZTYPE.BOSS_ABOMINATION, from: 4 },
  { type: ZTYPE.BOSS_HIVEQUEEN, from: 5 },
];

// The mainland is where the two late bosses live (issue #111: nobody reached them on the island). Up to its fifth
// night they take turns - The Abomination on the even nights, The Hive Queen on the odd ones, so the fourth has the
// one and the fifth the other, as on the island they would first have come - and from the sixth the boss is drawn
// from MAINLAND_BOSSES off the seed, never the one of the night before.
export const MAINLAND_BOSSES = [ZTYPE.BOSS_ABOMINATION, ZTYPE.BOSS_HIVEQUEEN, ZTYPE.BOSS_BLOATER];
function mainlandBoss(seed, night) {
  if (night <= 5) return night % 2 ? ZTYPE.BOSS_HIVEQUEEN : ZTYPE.BOSS_ABOMINATION;
  let prev = ZTYPE.BOSS_HIVEQUEEN;
  for (let n = 6; n <= night; n++) {
    const rng = mulberry32((Math.imul(seed | 0, 2246822519) ^ Math.imul(n + 911, 69069)) >>> 0);
    const pool = MAINLAND_BOSSES.filter((t) => t !== prev);
    prev = pool[Math.floor(rng() * pool.length)];
  }
  return prev;
}

export function nightBoss(seed, night, act = WORLD.ISLAND) {
  if (act === WORLD.MAINLAND) return mainlandBoss(seed, night);
  let prev = FIRST_BOSS;
  const met = new Set([prev]);
  for (let n = 2; n <= night; n++) {
    const rng = mulberry32((Math.imul(seed | 0, 2246822519) ^ Math.imul(n + 307, 69069)) >>> 0);
    const pool = BOSS_POOL.filter((b) => n >= b.from && b.type !== prev);
    const w = pool.map((b) => (met.has(b.type) ? 1 : 3));
    let r = rng() * w.reduce((a, b) => a + b, 0);
    let pick = pool[pool.length - 1].type;
    for (let i = 0; i < pool.length; i++) {
      r -= w[i];
      if (r < 0) {
        pick = pool[i].type;
        break;
      }
    }
    prev = pick;
    met.add(pick);
  }
  return prev;
}
