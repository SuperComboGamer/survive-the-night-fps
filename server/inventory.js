// Inventory helpers (server authoritative). Inventory = Array(INVENTORY_MAX) of {item, count} | null. Only the
// first `cap` slots are open (invCap: INVENTORY_SIZE, more with a backpack worn); what puts something into a slot
// takes the cap, and the rest stay empty. (It defaults to the slots every survivor has, so a call that forgets it
// can never fill a locked one.)
import { INVENTORY_SIZE, INVENTORY_MAX, inventoryCap } from '../shared/constants.js';
import { ITEM_DEFS, BAG_TIER } from '../shared/defs.js';

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
  return left;
}

// Takes from the smallest stack of it first (of two the same size, the later one), so that what is left stays in as
// few stacks as it can: with addItem topping up a stack that is not full before it starts a new one, a survivor
// never carries more than one part-used stack of anything from play alone (a reload, a craft, the mounted gun's
// belt). Taken from the last slot back, as it once was, a reload drained a full stack sitting behind the part-used
// one whenever a new stack had gone into a free slot in front of it, and the part-used stacks piled up. (A split,
// ACT.SPLIT_INV, still makes as many as the player asks for.)
export function removeItem(inv, item, count) {
  let left = count;
  while (left > 0) {
    let at = -1;
    for (let i = 0; i < inv.length; i++) {
      const s = inv[i];
      if (s && s.item === item && (at < 0 || s.count <= inv[at].count)) at = i;
    }
    if (at < 0) break;
    const s = inv[at];
    const take = Math.min(s.count, left);
    s.count -= take;
    left -= take;
    if (s.count <= 0) inv[at] = null;
  }
  return count - left;
}

export function hasCost(inv, cost) {
  for (const k in cost) if (countItem(inv, +k) < cost[k]) return false;
  return true;
}

export function payCost(inv, cost) {
  for (const k in cost) removeItem(inv, +k, cost[k]);
}

// The Sort button (ACT.SORT_INV) on the open slots, in place: every item's stacks merged into as few as will hold
// them (full ones, then what is left over), then ordered by BAG_TIER, item and size, and the empty slots after them.
// The same inventory always comes out the same way. A stack of one that carries something of its own (a gun's
// magazine, a vest's points: `mag`) is kept as it is.
export function sortInventory(inv, cap = INVENTORY_SIZE) {
  cap = Math.min(cap, inv.length);
  const kept = [];
  const totals = new Map();
  for (let i = 0; i < cap; i++) {
    const s = inv[i];
    if (!s) continue;
    if ((ITEM_DEFS[s.item]?.stack || 1) > 1) totals.set(s.item, (totals.get(s.item) || 0) + s.count);
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
