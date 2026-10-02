// Night themes: what tonight's horde is made of. A theme is drawn from the map seed and the night number, so the
// server (which builds the waves, server/game.js startNight) and the client (which warns the team on the dawn
// card, at the dusk horn and on the night's title) each work it out for themselves: nothing crosses the wire.
import { ZTYPE } from './defs.js';
import { mulberry32 } from './rng.js';

// mul: multipliers on startNight's spawn weights. A theme changes what the horde is made of, not how many come
// (the head count is untouched), and a type the night has not unlocked has weight 0 and stays out.
// from: the first night it can be drawn (the night its zombies join the horde).
// warn: what is coming and what to do about it - one line, short enough for the night's title card (85 characters).
// No theme multiplies Tanks: at a fixed head count each one adds 2200 health, as much as twenty walkers.
// The multipliers are a first pass: measured to keep a night's total health within 15% of a plain one, not played.
export const NIGHT_THEMES = [
  { id: 'pack', name: 'The Pack', from: 2, mul: { [ZTYPE.DOG]: 4, [ZTYPE.WALKER]: 0.6 }, warn: 'Dog packs: they cannot jump a barricade, so close the ring and leave no gap.' },
  { id: 'sprinters', name: 'Sprinters', from: 2, mul: { [ZTYPE.RUNNER]: 2.5, [ZTYPE.WALKER]: 0.4 }, warn: 'Half the horde are runners: no walking away, so be behind walls by dark.' },
  // (spitters x2, not x3: they are the hardest-hitting special against a team that holds a spot)
  { id: 'bile', name: 'Bile', from: 2, mul: { [ZTYPE.SPITTER]: 2, [ZTYPE.BOOMER]: 3 }, warn: 'Spitters and boomers: spit clears barricades, not walls. Shoot boomers far off.' },
  // shadeCap: the night's cap on shades doubles too (never past 6: each one ties up a light)
  { id: 'lightsout', name: 'Lights Out', from: 2, mul: { [ZTYPE.SHADE]: 4 }, shadeCap: 2, warn: 'More shades: they freeze in light, so set torches or a campfire and stay in it.' },
  { id: 'wings', name: 'Wings', from: 3, mul: { [ZTYPE.BAT]: 4, [ZTYPE.LEAPER]: 2 }, warn: 'Bats and leapers: they clear barricades, so stay close and free whoever is pinned.' },
  { id: 'snare', name: 'The Snare', from: 4, mul: { [ZTYPE.ROPER]: 3 }, warn: 'Ropers: a rope needs line of sight, so keep to cover and shoot the roper to break it.' },
];

export const THEME_CHANCE = 0.65; // share of nights (from night 2) that draw a theme; the rest are plain

// The theme of a night, or null on a plain one. Night 1 is always plain (a first night is the baseline), and no
// theme comes two nights running.
export function nightTheme(seed, night) {
  let prev = null;
  for (let n = 2; n <= night; n++) {
    const rng = mulberry32((Math.imul(seed | 0, 2654435761) ^ Math.imul(n + 101, 40503)) >>> 0);
    let t = null;
    if (rng() < THEME_CHANCE) {
      const pool = NIGHT_THEMES.filter((th) => n >= th.from && th !== prev);
      t = pool[Math.floor(rng() * pool.length)];
    }
    prev = t;
  }
  return prev;
}
