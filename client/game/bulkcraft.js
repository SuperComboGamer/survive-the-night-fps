// Crafting several at once (Shift / Ctrl+click on a recipe in the inventory screen). The protocol has no "craft n":
// a bulk craft is the ordinary ACT.CRAFT sent n times, so the client has to know beforehand how many the server
// will take - each one it refuses is a "Not enough materials" or "Inventory full" toast. craftRun repeats the checks
// of Game.craft (server/game.js) and the slot rules of server/inventory.js craft by craft: paying frees slots and
// stacks fill up, so the answer is not a division. No DOM in here: sim-smoke holds it against the server, so
// change the two together.
import { ITEM_DEFS, WEAPONS, AMMO_MAX } from '../../shared/defs.js';

export const CRAFT_FEW = 5; // Shift+click
export const CRAFT_MAX = 20; // Ctrl+click (Cmd on a Mac): as many as the materials allow, up to this

// inv = { slots: [{ item, count } | null], ammo: [reserve per calibre, carried apart from the slots], weapons: [item per weapon slot] }
export const copyInv = (inv) => ({ slots: inv.slots.map((s) => (s ? { item: s.item, count: s.count } : null)), ammo: [...inv.ammo], weapons: [...inv.weapons] });

const have = (slots, item) => slots.reduce((n, s) => n + (s && s.item === item ? s.count : 0), 0);

// room for n more of an item: free slots, and the stacks of it that are not full (canFit)
function fits(slots, item, n) {
  const max = ITEM_DEFS[item].stack;
  let room = 0;
  for (const s of slots) room += !s ? max : s.item === item ? Math.max(0, max - s.count) : 0;
  return room >= n;
}

// taken from the last slot back (removeItem); a slot paid empty is free again
function pay(slots, cost) {
  for (const k in cost) {
    let left = cost[k];
    for (let i = slots.length - 1; i >= 0 && left > 0; i--) {
      const s = slots[i];
      if (!s || s.item !== +k) continue;
      const take = Math.min(s.count, left);
      s.count -= take;
      left -= take;
      if (s.count <= 0) slots[i] = null;
    }
  }
}

// onto the stacks of it first, then into free slots (addItem)
function add(slots, item, n) {
  const max = ITEM_DEFS[item].stack;
  for (let i = 0; i < slots.length && n > 0; i++) {
    const s = slots[i];
    if (!s || s.item !== item || s.count >= max) continue;
    const take = Math.min(max - s.count, n);
    s.count += take;
    n -= take;
  }
  for (let i = 0; i < slots.length && n > 0; i++) {
    if (slots[i]) continue;
    const take = Math.min(max, n);
    slots[i] = { item, count: take };
    n -= take;
  }
}

// Crafts `rec` up to `want` times on `inv`, which is left as the server would leave it, and returns how many went
// through: ask with a copy (copyInv). Station and schematic are the caller's to check - they do not change from
// one craft to the next.
export function craftRun(rec, inv, want) {
  const def = ITEM_DEFS[rec.out];
  const { slots } = inv;
  let done = 0;
  for (; done < want; done++) {
    for (const k in rec.cost) if (have(slots, +k) < rec.cost[k]) return done;
    if (def.cat === 'ammo') {
      // The server takes a craft while the reserve has room for a single round, and puts the rest of that batch on
      // the ground. A bulk craft stops at the last whole batch that fits, so nothing has to be picked up again
      if (inv.ammo[def.ammo] + rec.n > AMMO_MAX[def.ammo]) return done;
      pay(slots, rec.cost);
      inv.ammo[def.ammo] += rec.n;
    } else if (def.cat === 'weapon') {
      // its weapon slot when that is empty, else a backpack slot - which has to be free before the cost is paid
      const slot = WEAPONS[rec.out].slot;
      if (inv.weapons[slot] && slots.every(Boolean)) return done;
      pay(slots, rec.cost);
      if (inv.weapons[slot]) slots[slots.findIndex((s) => !s)] = { item: rec.out, count: 1 };
      else inv.weapons[slot] = rec.out;
    } else {
      if (!fits(slots, rec.out, rec.n)) {
        // paying may be what makes the room
        const trial = slots.map((s) => s && { ...s });
        pay(trial, rec.cost);
        if (!fits(trial, rec.out, rec.n)) return done;
      }
      pay(slots, rec.cost);
      add(slots, rec.out, rec.n);
    }
  }
  return done;
}
