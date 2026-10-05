// Auto-crafting: a build, a craft or a repair short of a material that a recipe makes (Planks from Sticks, Nails from
// Scrap Metal, Rope from Cloth...) makes it on the spot from what that recipe takes, when the recipe could be crafted
// right there: its station in reach and its schematic found, as the crafting panel asks. What is carried is used
// first; only what is short is made, and what a batch makes past that (ten Nails for the four a wall takes) stays in
// the pack. The server (Game.build, Game.craft, Game.repair) and the client (craftRun in client/game/bulkcraft.js,
// the build menu, the HUD's tracked recipe) plan with this same function, so the two agree on what can be afforded.
import { RECIPES, ITEM_DEFS, SCHEM_BIT } from './defs.js';

// item -> the recipes that make it. Weapons and ammunition are never an ingredient, and do not go into the pack
const MAKERS = {};
for (const r of RECIPES) {
  const cat = ITEM_DEFS[r.out]?.cat;
  if (cat === 'weapon' || cat === 'ammo') continue;
  (MAKERS[r.out] ||= []).push(r);
}
const DEPTH = 3; // recipes inside recipes, at most

// ctx = { fire, bench, unlocked }: the stations in reach and the team's schematics (Game.craftContext on the client)
export const recipeOk = (r, ctx) => !!ctx && (!r.schem || !!((ctx.unlocked | 0) & (1 << SCHEM_BIT[r.schem]))) && (!r.station || !!ctx[r.station]);

// What paying `cost` `times` over takes from `counts` (item -> carried), with whatever is short made on the way:
// { take: item -> n, give: item -> n made past what was needed, made: [{ r, runs }] in the order they are made }, or
// null when even that cannot pay it. Without ctx nothing is made, and it is a plain "is it all there".
export function planCost(counts, cost, ctx, times = 1) {
  const c = { ...counts };
  const made = [];
  if (!pay(c, cost, times, ctx, made, 0)) return null;
  const take = {};
  const give = {};
  for (const k in c) {
    const d = (c[k] || 0) - (counts[k] || 0);
    if (d < 0) take[k] = -d;
    else if (d > 0) give[k] = d;
  }
  return { take, give, made };
}

function pay(c, cost, times, ctx, made, depth) {
  const short = [];
  for (const k in cost) {
    const want = cost[k] * times;
    const have = c[k] || 0;
    c[k] = Math.max(0, have - want);
    if (have < want) short.push([+k, want - have]);
  }
  for (const [item, n] of short) {
    if (!ctx || depth >= DEPTH) return false;
    let ok = false;
    for (const r of MAKERS[item] || []) {
      if (!recipeOk(r, ctx)) continue;
      const runs = Math.ceil(n / r.n);
      const trial = { ...c };
      const sub = [];
      if (!pay(trial, r.cost, runs, ctx, sub, depth + 1)) continue;
      Object.assign(c, trial);
      c[item] = (c[item] || 0) + runs * r.n - n;
      made.push(...sub, { r, runs });
      ok = true;
      break;
    }
    if (!ok) return false;
  }
  return true;
}
