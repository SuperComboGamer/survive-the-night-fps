// Stacking rules the server's inventory (server/inventory.js) and the client's models of it (client/game/bulkcraft.js,
// Game.quickHeal / quickDrink) share. A slot list is an array of { item, count } | null.
//
// The invariant: a survivor carries at most one part-used stack of an item, and the next pickup tops that one up.
// addItem fills the stacks that are not full before it starts a new one and removeItem takes from the smallest, so
// adding and paying alone keep it; consolidate puts it back after anything that takes from a stack of the player's
// choosing (a partial drop, salvage, the tin clicked in the grid), and after every add and remove, which also
// re-merges what a split (ACT.SPLIT_INV) kept apart once that item's count changes.
import { ITEM_DEFS } from './defs.js';

// The stacks of `item` that are not full merged into as few as will hold them, in place: filled in slot order, so
// what is left part-used is the last of them, and one emptied is freed. Full stacks, every other item, and the
// slots that did not hold this item are left as they are - nothing jumps to another slot. Returns whether anything
// changed. (A stack of one that carries something of its own - a gun's magazine, a vest's points - never merges.)
export function consolidate(slots, item) {
  const max = ITEM_DEFS[item]?.stack || 1;
  if (max <= 1) return false;
  let total = 0;
  let parts = 0;
  for (const s of slots) {
    if (s && s.item === item && s.count < max) {
      total += s.count;
      parts++;
    }
  }
  if (parts < 2) return false;
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (!s || s.item !== item || s.count >= max) continue;
    s.count = Math.min(max, total);
    total -= s.count;
    if (s.count <= 0) slots[i] = null;
  }
  return true;
}

// The slot removeItem would take one of `item` from: the smallest stack, the later of two the same size. -1: none.
// ([H] and [B] ask for that one, so a key press and a payment agree.)
export function smallestStack(slots, item) {
  let at = -1;
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (s && s.item === item && (at < 0 || s.count <= slots[at].count)) at = i;
  }
  return at;
}
