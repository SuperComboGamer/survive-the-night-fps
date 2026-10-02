// What an item is for and where more of it comes from, for the inventory's tooltips: "Used in" (the recipes and
// structures that consume it) and "Found in" (the containers, trees, wrecks, zombies, deer and places that yield it).
// Both are derived once, at load, from the tables in shared/defs.js (and DEER_LOOT in shared/deer.js), so the text
// follows a change to a recipe or a loot table by itself. Pure - no DOM, no three.js - so scripts/test-itemguide.js can hold it against the tables,
// generated worlds and the server.
import { ITEM, ITEM_DEFS, RECIPES, STRUCT_DEFS, STRUCT_ORDER, SCHEM_BIT, ZONE, ZONE_NAMES, LOOT_TABLES, CONT_TABLES, CONT_DEFS, ZOMBIE_DEFS, ZOMBIE_LOOT, SPECIAL_LOOT, loadedAmmo } from '../../shared/defs.js';
import { PLACES } from '../../shared/layout.js';
import { FIXTURE_USES } from '../../shared/fixtures.js';
import { DEER_LOOT } from '../../shared/deer.js';

const schemLocked = (schem, unlocked) => !!schem && !(unlocked & (1 << SCHEM_BIT[schem]));

// ---------------------------------------------------------------- used in
// item -> [{ name, schem, share }]: what consumes it, the thing it is the biggest part of first (share = its part
// of that cost, so Nails come before a Workbench for scrap). The sort is stable: ties stay in table order.
const USES = new Map();
function addUse(name, cost, schem) {
  let total = 0;
  for (const k in cost) total += cost[k];
  for (const k in cost) {
    if (!USES.has(+k)) USES.set(+k, []);
    USES.get(+k).push({ name, schem: schem || 0, share: cost[k] / total });
  }
}
for (const r of RECIPES) addUse(ITEM_DEFS[r.out].name, r.cost, r.schem);
for (const type of STRUCT_ORDER) addUse(STRUCT_DEFS[type].name, STRUCT_DEFS[type].cost, STRUCT_DEFS[type].schem);
for (const f of FIXTURE_USES) addUse(f.name, f.cost); // ...and what is spent at a fixture (the Relay Station's radio)
for (const uses of USES.values()) uses.sort((a, b) => b.share - a.share);

// What `item` goes into, as { list: [{ name, locked }], more }: at most `max` names and how many were left out; null
// when nothing consumes it. `unlocked` is the team's schematic mask: what can be made now comes first, and what
// waits on a schematic is marked locked - named all the same, as the crafting list and the build menu name it.
export function usedIn(item, unlocked = 0, max = 3) {
  const uses = USES.get(item);
  if (!uses) return null;
  const locked = (u) => schemLocked(u.schem, unlocked);
  const order = [...uses.filter((u) => !locked(u)), ...uses.filter(locked)];
  return { list: order.slice(0, max).map((u) => ({ name: u.name, locked: locked(u) })), more: Math.max(0, order.length - max) };
}

// ---------------------------------------------------------------- found in
// The one thing defs.js does not hold: what a melee hit on a tree or a wreck gives. Mirrors Game.gatherHit
// (server/game.js) for the knife everyone starts with, as [item, expected count per hit]; hits = how many a tree or
// a wreck has in it before it is bare. scripts/test-itemguide.js swings at the server to keep the two in step.
export const GATHER = [
  { name: 'chop trees', hits: 6, gives: [[ITEM.STICK, 1], [ITEM.WOOD, 0.22], [ITEM.HERB, 0.07]] },
  { name: 'salvage wrecks', hits: 5, gives: [[ITEM.SCRAP, 1], [ITEM.NAILS, 0.9], [ITEM.TAPE, 0.08], [ITEM.WIRE, 0.05], [ITEM.BATTERY, 0.04]] },
];

// expected count of each item from one roll of a loot table ([item, weight, min, max] rows)
function perRoll(table) {
  let total = 0;
  for (const row of table) total += row[1];
  const out = new Map();
  for (const [item, weight, min, max] of table) out.set(item, (out.get(item) || 0) + ((weight / total) * (min + max)) / 2);
  return out;
}

// item -> { any, places }: its sources as { name, n, place }, n = the expected count from one visit (a search, a
// kill, a tree chopped bare). `any` is found all over the valley; a place is one spot, and not on every map.
const SOURCES = new Map();
function addSource(place, name, yields, visits = 1) {
  for (const [item, n] of yields) {
    if (!SOURCES.has(item)) SOURCES.set(item, { any: [], places: [] });
    SOURCES.get(item)[place ? 'places' : 'any'].push({ name, n: n * visits, place });
  }
}
const plural = (name) => name + (name.endsWith('s') ? '' : name.endsWith('x') ? 'es' : 's');

for (const g of GATHER) addSource(false, g.name, g.gives, g.hits);
// a kind of container with a table of its own, named as its search prompt names it: its rolls, what is always in
// it besides (also), and the ammunition its weapons come with (loaded) - Game.searchCache
for (const d of Object.values(CONT_DEFS)) {
  if (!d.table) continue;
  const rolls = (d.rolls[0] + d.rolls[1]) / 2;
  const yields = new Map();
  const add = (item, n) => yields.set(item, (yields.get(item) || 0) + n);
  for (const [item, n] of perRoll(CONT_TABLES[d.table])) {
    add(item, n * rolls);
    const ammo = d.loaded ? loadedAmmo(item, d.loaded) : null;
    if (ammo) add(ammo[0], ammo[1] * n * rolls);
  }
  for (const [item, n] of d.also || []) add(item, n);
  addSource(false, d.guide || plural(d.name.toLowerCase()), yields);
}
// what the dead drop: one roll, at the odds of that kind of zombie
const odds = (common) => {
  const kinds = Object.values(ZOMBIE_DEFS).filter((z) => !z.boss && !!z.common === common);
  return kinds.reduce((sum, z) => sum + z.loot, 0) / kinds.length;
};
addSource(false, 'zombies', perRoll(ZOMBIE_LOOT), odds(true));
addSource(false, 'special zombies', perRoll(SPECIAL_LOOT), odds(false));
// what a deer leaves when it is brought down (server/deer.js): all of DEER_LOOT, every time
addSource(false, 'hunt deer', DEER_LOOT.map(([item, min, max]) => [item, (min + max) / 2]));
// A place's table is rolled for the loot lying around it (one roll a find) and for its crates and shelves, the
// containers with no table of their own. Only the tables that are ever rolled count: the places a map can have and
// the woods between them. (ZONE.ROADSIDE's never is: every roadside container has a table of its own.)
for (const zone of [...Object.keys(PLACES).map(Number), ZONE.FOREST]) addSource(true, ZONE_NAMES[zone], perRoll(LOOT_TABLES[zone]));
// (St. Agnes Cemetery is no place of its own - it lies behind the chapel - but what lies around in it is its own table's)
addSource(true, ZONE_NAMES[ZONE.CEMETERY], perRoll(LOOT_TABLES[ZONE.CEMETERY]));

// The order they are told in: the best two found anywhere, then the places, then the rest. Ranking them all by
// yield alone would bury a kind of container there are fifty of under a place with three things lying around.
const LEAD = 2;
const ORDER = new Map();
for (const [item, s] of SOURCES) {
  const best = (a, b) => b.n - a.n;
  s.any.sort(best);
  s.places.sort(best);
  ORDER.set(item, [...s.any.slice(0, LEAD), ...s.places, ...s.any.slice(LEAD)]);
}

const EMPTY = [];
// every source of `item` in the world, as [{ name, n, place }] in the order above ([] when it is never found)
export const sourcesOf = (item) => ORDER.get(item) || EMPTY;

// Where to get `item`, in a line: 'Ammo crates, special zombies, Blackrock Mine +8 more, or craft it' - the first
// `max` sources, how many were left out, and whether a recipe the team can use (`unlocked`: its schematic mask)
// makes it. 'Craft it' when that is the only way, '' when there is none (car supplies, schematics, walkie-talkies).
export function foundIn(item, unlocked = 0, max = 3) {
  const all = sourcesOf(item);
  let text = all.slice(0, max).map((s) => s.name).join(', ');
  if (all.length > max) text += ` +${all.length - max} more`;
  if (RECIPES.some((r) => r.out === item && !schemLocked(r.schem, unlocked))) text += text ? ', or craft it' : 'craft it';
  return text && text[0].toUpperCase() + text.slice(1);
}
