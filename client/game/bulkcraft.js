// Crafting several at once (Shift / Ctrl+click on a recipe in the inventory screen). The protocol has no "craft n":
// a bulk craft is the ordinary ACT.CRAFT sent n times, so the client has to know beforehand how many the server
// will take - each one it refuses is a "Not enough materials" or "Inventory full" toast. craftRun repeats the checks
// of Game.craft (server/game.js) and the slot rules of server/inventory.js craft by craft: paying frees slots and
// stacks fill up, so the answer is not a division. No DOM in here: sim-smoke holds it against the server, so
// change the two together.
import { ITEM_DEFS, WEAPONS, AMMO_MAX } from '../../shared/defs.js';
import { INVENTORY_SIZE } from '../../shared/constants.js';
import { consolidate, smallestStack } from '../../shared/stacks.js';
import { planCost } from '../../shared/autocraft.js';

export const CRAFT_FEW = 5; // Shift+click
export const CRAFT_MAX = 20; // Ctrl+click (Cmd on a Mac): as many as the materials allow, up to this

// inv = { slots: [{ item, count } | null], ammo: [reserve per calibre, carried apart from the slots], weapons: [item per weapon slot],
// cap: how many of the slots are open (inventoryCap: more with a backpack worn; INVENTORY_SIZE when left out) }
export const copyInv = (inv) => ({ slots: inv.slots.map((s) => (s ? { item: s.item, count: s.count } : null)), ammo: [...inv.ammo], weapons: [...inv.weapons], cap: inv.cap ?? INVENTORY_SIZE });

// room for n more of an item in the open slots: free ones, and the stacks of it that are not full (canFit)
function fits(slots, cap, item, n) {
  const max = ITEM_DEFS[item].stack;
  let room = 0;
  for (let i = 0; i < cap; i++) {
    const s = slots[i];
    room += !s ? max : s.item === item ? Math.max(0, max - s.count) : 0;
  }
  return room >= n;
}

// taken from the smallest stack of it first, the later of two the same size (removeItem); a slot paid empty is free
// again, and so is one the part stacks merged out of (consolidate: a split kept apart is merged once the count changes)
function pay(slots, cost) {
  for (const k in cost) {
    let left = cost[k];
    while (left > 0) {
      const at = smallestStack(slots, +k);
      if (at < 0) break;
      const s = slots[at];
      const take = Math.min(s.count, left);
      s.count -= take;
      left -= take;
      if (s.count <= 0) slots[at] = null;
    }
    if (left < cost[k]) consolidate(slots, +k);
  }
}

// onto the stacks of it first, then into free slots, then its part stacks merged (addItem), in the open slots
function add(slots, cap, item, n) {
  const want = n;
  const max = ITEM_DEFS[item].stack;
  for (let i = 0; i < cap && n > 0; i++) {
    const s = slots[i];
    if (!s || s.item !== item || s.count >= max) continue;
    const take = Math.min(max - s.count, n);
    s.count += take;
    n -= take;
  }
  for (let i = 0; i < cap && n > 0; i++) {
    if (slots[i]) continue;
    const take = Math.min(max, n);
    slots[i] = { item, count: take };
    n -= take;
  }
  if (n < want) consolidate(slots, item);
}

const counts = (slots) => {
  const m = {};
  for (const s of slots) if (s) m[s.item] = (m[s.item] || 0) + s.count;
  return m;
};

// How `inv` pays `cost` once, what is short made on the way (planCost, shared/autocraft.js); null: it cannot
export const planFor = (inv, cost, ctx) => planCost(counts(inv.slots), cost, ctx);

// Crafts `rec` up to `want` times on `inv`, which is left as the server would leave it, and returns how many went
// through: ask with a copy (copyInv). Station and schematic are the caller's to check - they do not change from
// one craft to the next. ctx ({ fire, bench, unlocked }, Game.craftContext): what the materials short of a craft can
// be made with on the way, as the server makes them (left out: nothing is)
export function craftRun(rec, inv, want, ctx) {
  const def = ITEM_DEFS[rec.out];
  const { slots } = inv;
  const cap = Math.min(inv.cap ?? INVENTORY_SIZE, slots.length);
  const free = () => slots.findIndex((s, i) => !s && i < cap);
  let done = 0;
  for (; done < want; done++) {
    const plan = planFor(inv, rec.cost, ctx);
    if (!plan) return done;
    const cost = plan.take;
    if (def.cat === 'ammo') {
      // The server takes a craft while the reserve has room for a single round, and puts the rest of that batch on
      // the ground. A bulk craft stops at the last whole batch that fits, so nothing has to be picked up again
      if (inv.ammo[def.ammo] + rec.n > AMMO_MAX[def.ammo]) return done;
      pay(slots, cost);
      inv.ammo[def.ammo] += rec.n;
    } else if (def.cat === 'weapon') {
      // its weapon slot when that is empty, else a backpack slot - which has to be free before the cost is paid
      const slot = WEAPONS[rec.out].slot;
      if (inv.weapons[slot] && free() < 0) return done;
      pay(slots, cost);
      if (inv.weapons[slot]) slots[free()] = { item: rec.out, count: 1 };
      else inv.weapons[slot] = rec.out;
    } else {
      if (!fits(slots, cap, rec.out, rec.n)) {
        // paying may be what makes the room
        const trial = slots.map((s) => s && { ...s });
        pay(trial, cost);
        if (!fits(trial, cap, rec.out, rec.n)) return done;
      }
      pay(slots, cost);
      add(slots, cap, rec.out, rec.n);
    }
    // what the batches made on the way left over (Game.madeExtra): what finds no room goes on the ground
    for (const k in plan.give) add(slots, cap, +k, plan.give[k]);
  }
  return done;
}
