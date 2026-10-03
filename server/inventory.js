// Inventory helpers (server authoritative). Inventory = Array(INVENTORY_SIZE) of {item, count} | null
import { INVENTORY_SIZE } from '../shared/constants.js';
import { ITEM_DEFS } from '../shared/defs.js';

export function createInventory() {
  return new Array(INVENTORY_SIZE).fill(null);
}

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
export function addItem(inv, item, count) {
  const def = ITEM_DEFS[item];
  const max = def ? def.stack : 1;
  let left = count;
  for (let i = 0; i < inv.length && left > 0; i++) {
    const s = inv[i];
    if (s && s.item === item && s.count < max) {
      const take = Math.min(max - s.count, left);
      s.count += take;
      left -= take;
    }
  }
  for (let i = 0; i < inv.length && left > 0; i++) {
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

export function freeSlots(inv) {
  let n = 0;
  for (const s of inv) if (!s) n++;
  return n;
}

export function canFit(inv, item, count) {
  const def = ITEM_DEFS[item];
  const max = def ? def.stack : 1;
  let room = 0;
  for (const s of inv) {
    if (!s) room += max;
    else if (s.item === item) room += Math.max(0, max - s.count);
    if (room >= count) return true;
  }
  return room >= count;
}

export { INVENTORY_SIZE };
