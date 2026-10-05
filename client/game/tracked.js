// The recipe a survivor is working towards (the crafting panel's "Track on HUD"): one at a time, kept in localStorage so
// it lasts through closing the inventory, a reload and a rejoin. Client only. The HUD's checklist (hud2.js), the pickup
// prompts (Game.updateLookTarget) and the inventory all read it from here. No DOM.
import { RECIPES, ITEM_DEFS, STATION_NAMES, SCHEM_BIT } from '../../shared/defs.js';
import { foundIn } from './itemguide.js';

const KEY = 'stn.tracked';
const subs = new Set();
let id = load();

function load() {
  try {
    const v = localStorage.getItem(KEY);
    return v != null && RECIPES[+v] ? +v : -1;
  } catch {
    return -1;
  }
}

export const trackedId = () => id;
export const trackedRecipe = () => (id >= 0 ? RECIPES[id] : null);

// n: a recipe id, or -1 to track nothing
export function setTracked(n) {
  n = RECIPES[n] ? n : -1;
  if (n === id) return;
  id = n;
  try {
    if (n < 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(n));
  } catch {
    /* storage unavailable: tracked for as long as the page lives */
  }
  for (const fn of subs) fn(id);
}

export function onTracked(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

const schemOk = (schem, unlocked) => !schem || !!(unlocked & (1 << SCHEM_BIT[schem]));

// Where recipe r stands against what is carried (counts: item -> how many), the stations in reach (near: { fire,
// bench }) and the team's schematics (unlocked): its ingredients as { item, name, have, need, ok }, then whether its
// station is near and its schematic found, and `ready` when all of that holds. src: where to get the first short one.
export function trackStatus(r, counts, near, unlocked) {
  const ings = Object.entries(r.cost).map(([k, need]) => {
    const have = counts[k] || 0;
    return { item: +k, name: ITEM_DEFS[k].name, have, need, ok: have >= need };
  });
  const stationOk = !r.station || !!near?.[r.station];
  const unlockedOk = schemOk(r.schem, unlocked);
  const mats = ings.every((g) => g.ok);
  const short = ings.find((g) => !g.ok);
  return {
    ings,
    mats,
    station: r.station ? { name: STATION_NAMES[r.station], ok: stationOk } : null,
    schem: r.schem ? { name: ITEM_DEFS[r.schem].name, ok: unlockedOk } : null,
    ready: mats && stationOk && unlockedOk,
    src: short ? { name: short.name, where: foundIn(short.item, unlocked) } : null,
  };
}

// How many more of `item` the tracked recipe needs (0: none, or nothing tracked)
export function trackedNeed(item, counts) {
  const r = trackedRecipe();
  const need = r?.cost[item];
  return need ? Math.max(0, need - (counts[item] || 0)) : 0;
}
