// Inventory helpers (server authoritative). Inventory = Array(INVENTORY_MAX) of {item, count} | null. Only the
// first `cap` slots are open (invCap: INVENTORY_SIZE, more with a backpack worn); what puts something into a slot
// takes the cap, and the rest stay empty. (It defaults to the slots every survivor has, so a call that forgets it
// can never fill a locked one.)
import { INVENTORY_SIZE, INVENTORY_MAX, inventoryCap } from '../shared/constants.js';
import { ITEM_DEFS, BAG_TIER } from '../shared/defs.js';
import { consolidate, smallestStack } from '../shared/stacks.js';

export { consolidate };

export function createInventory() {
  return new Array(INVENTORY_MAX).fill(null);
}

// the slots open to player p: the worn backpack's pockets on top of everyone's
export const invCap = (p) => inventoryCap(p.backpackItem);

export function countItem(inv, item) {
  let n = 0;
  for (const s of inv) if (s && s.item === item) n += s.count;
  return n;
}

export function countsMap(inv) {
  const m = {};
  for (const s of inv) if (s) m[s.item] = (m[s.item] || 0) + s.count;
  return m;
}

// Adds as many as fit: onto the stacks of it that are not full first, then into free slots. Returns leftover count.
// (Then consolidate: two part stacks a split kept apart are one again once the count changes.)
export function addItem(inv, item, count, cap = INVENTORY_SIZE) {
  cap = Math.min(cap, inv.length);
  const def = ITEM_DEFS[item];
  const max = def ? def.stack : 1;
  let left = count;
  for (let i = 0; i < cap && left > 0; i++) {
    const s = inv[i];
    if (s && s.item === item && s.count < max) {
      const take = Math.min(max - s.count, left);
      s.count += take;
      left -= take;
    }
  }
  for (let i = 0; i < cap && left > 0; i++) {
    if (!inv[i]) {
      const take = Math.min(max, left);
      inv[i] = { item, count: take };
      left -= take;
    }
  }
  if (left < count) consolidate(inv, item);
  return left;
}

// Takes from the smallest stack of it first (of two the same size, the later one), so that what is left stays in as
// few stacks as it can: with addItem topping up a stack that is not full before it starts a new one, a survivor
// never carries more than one part-used stack of anything from play alone (a reload, a craft, the mounted gun's
// belt). Taken from the last slot back, as it once was, a reload drained a full stack sitting behind the part-used
// one whenever a new stack had gone into a free slot in front of it, and the part-used stacks piled up. (A split,
// ACT.SPLIT_INV, still makes as many as the player asks for, until that item's count changes: then consolidate
// merges them again, as it does after anything taken from a stack of the player's choosing.)
export function removeItem(inv, item, count) {
  let left = count;
  while (left > 0) {
    const at = smallestStack(inv, item);
    if (at < 0) break;
    const s = inv[at];
    const take = Math.min(s.count, left);
    s.count -= take;
    left -= take;
    if (s.count <= 0) inv[at] = null;
  }
  if (left < count) consolidate(inv, item);
  return count - left;
}

// n of the stack in slot idx taken out of it (a drop, salvage, the tin clicked in the grid: never more than that stack
// holds). Off a full stack while the item has a part stack elsewhere, the part stack gives first: one tin off any
// stack leaves the same as removeItem would, with only one cell changing. What is left is consolidated either way, so
// the stack taken from never stays a second part stack. Returns how many were taken.
export function takeFrom(inv, idx, n) {
  const s = inv[idx];
  if (!s || n <= 0) return 0;
  const item = s.item;
  const max = ITEM_DEFS[item]?.stack || 1;
  n = Math.min(n, s.count);
  let left = n;
  const low = s.count >= max ? smallestStack(inv, item) : idx;
  if (low !== idx && inv[low].count < max) {
    const take = Math.min(left, inv[low].count);
    inv[low].count -= take;
    left -= take;
    if (inv[low].count <= 0) inv[low] = null;
  }
  s.count -= left;
  if (s.count <= 0) inv[idx] = null;
  consolidate(inv, item);
  return n;
}

// The safety net, for whatever changed the counts without going through the above: every item's part stacks merged
// (consolidate), but those of an item split (ACT.SPLIT_INV) whose count is still what it was split at - `keep`, a
// Map of item -> that count, which loses an item as soon as its count is something else.
export function tidyStacks(inv, keep) {
  let changed = false;
  for (let i = 0; i < inv.length; i++) {
    const s = inv[i];
    if (!s || (ITEM_DEFS[s.item]?.stack || 1) <= 1) continue;
    if (keep?.has(s.item)) {
      if (keep.get(s.item) === countItem(inv, s.item)) continue;
      keep.delete(s.item);
    }
    if (consolidate(inv, s.item)) changed = true;
  }
  return changed;
}

export function hasCost(inv, cost) {
  for (const k in cost) if (countItem(inv, +k) < cost[k]) return false;
  return true;
}

export function payCost(inv, cost) {
  for (const k in cost) removeItem(inv, +k, cost[k]);
}

// The auto sort after a pickup or a drop, on the open slots, in place: every item's stacks merged into as few as will
// hold them (full ones, then what is left over), then ordered by BAG_TIER, item and size, and the empty slots after
// them. The same inventory always comes out the same way. A stack of one that carries something of its own (a gun's
// magazine, a vest's points: `mag`) is kept as it is. So are the stacks of an item split (ACT.SPLIT_INV) whose
// count is still what it was split at, given `keep` (as tidyStacks takes it): moved, but left apart.
export function sortInventory(inv, cap = INVENTORY_SIZE, keep) {
  cap = Math.min(cap, inv.length);
  if (keep) for (const [item, n] of keep) if (countItem(inv, item) !== n) keep.delete(item);
  const kept = [];
  const totals = new Map();
  for (let i = 0; i < cap; i++) {
    const s = inv[i];
    if (!s) continue;
    if ((ITEM_DEFS[s.item]?.stack || 1) > 1 && !keep?.has(s.item)) totals.set(s.item, (totals.get(s.item) || 0) + s.count);
    else kept.push(s);
  }
  for (const [item, total] of totals) {
    const max = ITEM_DEFS[item].stack;
    for (let left = total; left > 0; left -= max) kept.push({ item, count: Math.min(max, left) });
  }
  const tier = (s) => BAG_TIER[ITEM_DEFS[s.item]?.cat] ?? 99;
  kept.sort((a, b) => tier(a) - tier(b) || a.item - b.item || b.count - a.count || (b.mag || 0) - (a.mag || 0));
  for (let i = 0; i < cap; i++) inv[i] = kept[i] || null;
}

export function freeSlots(inv, cap = INVENTORY_SIZE) {
  cap = Math.min(cap, inv.length);
  let n = 0;
  for (let i = 0; i < cap; i++) if (!inv[i]) n++;
  return n;
}

// the first free slot of the open ones, or -1
export function freeSlot(inv, cap = INVENTORY_SIZE) {
  cap = Math.min(cap, inv.length);
  for (let i = 0; i < cap; i++) if (!inv[i]) return i;
  return -1;
}

export function canFit(inv, item, count, cap = INVENTORY_SIZE) {
  cap = Math.min(cap, inv.length);
  const def = ITEM_DEFS[item];
  const max = def ? def.stack : 1;
  let room = 0;
  for (let i = 0; i < cap; i++) {
    const s = inv[i];
    if (!s) room += max;
    else if (s.item === item) room += Math.max(0, max - s.count);
    if (room >= count) return true;
  }
  return room >= count;
}

export { INVENTORY_SIZE };
