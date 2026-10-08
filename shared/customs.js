// A player's own survivors (the character creator), as a browser keeps them (client/ui/customs.js) and as their
// account does (server/usersettings.js, user_settings kind 'customs'):
//   { v: 2, list: [{ id, name, fields, made, updatedAt }], gone: [{ id, at }] }
// fields: the look by name (shared/appearance.js), made / updatedAt / at: ms, by the clock of the browser that did it.
//
// Two copies - two browsers, a browser and the account - are merged survivor by survivor (mergeCustoms): of each, the
// copy changed last wins; one deleted (gone) stays deleted unless it was changed after. So a survivor made on one
// computer and another made on a laptop both live on, which the whole-copy "newer wins" of the keybinds would not do.
// A player makes CUSTOMS_MAX at most, but up to CUSTOMS_KEPT are kept, so that two browsers' merged lose nothing.
import { fromNames } from './appearance.js';

export const CUSTOMS_MAX = 4; // made at most (the creator's "Create" goes at this many)
export const CUSTOMS_KEPT = 8; // kept at most (two browsers' worth, merged); past it, the ones changed longest ago go
export const NAME_MAX = 16;
const GONE_KEPT = 32; // deletions remembered (the newest)
const DAY = 86400_000;
const ID = /^[a-z0-9]{1,12}$/;

/** A name as the server would allow a player's (letters, digits, space, _ - .), at most NAME_MAX. */
export const cleanName = (s) => String(s || '').replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, NAME_MAX);

// a time from a copy: a whole number of ms, never more than a day past now (a clock run ahead can't win for ever)
const when = (x, now, none) => {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), now + DAY) : none;
};
const order = (a, b) => a.made - b.made || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// the CUSTOMS_KEPT changed last, in the order they were made
function keep(list) {
  const kept = list.length > CUSTOMS_KEPT ? [...list].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, CUSTOMS_KEPT) : list;
  return [...kept].sort(order);
}

/**
 * Anything at all as a copy: { v: 2, list, gone } - entries that are not one left out, names cleaned, looks repaired
 * against this wardrobe (a part since removed: its default), times held sane. (A copy from before the times, v 1:
 * made in the order listed, changed at 1 ms - older than anything changed since.)
 */
export function tidyCustoms(data, now = Date.now()) {
  const src = data && typeof data === 'object' ? data : {};
  const seen = new Set();
  const list = [];
  (Array.isArray(src.list) ? src.list : []).forEach((it, i) => {
    if (!it || typeof it !== 'object' || typeof it.id !== 'string' || !ID.test(it.id) || seen.has(it.id)) return;
    seen.add(it.id);
    list.push({ id: it.id, name: cleanName(it.name) || 'Survivor', fields: fromNames(it.fields).values, made: when(it.made, now, i + 1), updatedAt: when(it.updatedAt, now, 1) });
  });
  const gone = new Map();
  for (const g of Array.isArray(src.gone) ? src.gone : []) {
    if (!g || typeof g.id !== 'string' || !ID.test(g.id)) continue;
    const at = when(g.at, now, 0);
    if (at) gone.set(g.id, Math.max(gone.get(g.id) || 0, at));
  }
  return { v: 2, list: keep(list.filter((it) => !(gone.get(it.id) >= it.updatedAt))), gone: goneList(gone) };
}
const goneList = (m) => [...m].map(([id, at]) => ({ id, at })).sort((a, b) => b.at - a.at).slice(0, GONE_KEPT);

/**
 * What an account is asked to keep, checked strictly: -> { ok: true, customs } (tidied) or { ok: false, error }. Not
 * an object, a list or deletions that are not lists, too many of either, an entry that is not one (no id, a bad one,
 * twice) are refused; a name is cleaned and a look repaired, as on reading.
 */
export function checkCustoms(data, now = Date.now()) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'not a list of survivors' };
  if (!Array.isArray(data.list)) return { ok: false, error: 'list: not a list' };
  if (data.list.length > CUSTOMS_KEPT) return { ok: false, error: `more than ${CUSTOMS_KEPT} survivors` };
  if (data.gone !== undefined && (!Array.isArray(data.gone) || data.gone.length > GONE_KEPT * 2)) return { ok: false, error: 'gone: not a short list' };
  const ids = new Set();
  for (const it of data.list) {
    if (!it || typeof it !== 'object' || typeof it.id !== 'string' || !ID.test(it.id)) return { ok: false, error: 'a survivor without a good id' };
    if (ids.has(it.id)) return { ok: false, error: `two survivors called ${it.id}` };
    ids.add(it.id);
    if (it.fields !== undefined && (typeof it.fields !== 'object' || it.fields === null || Array.isArray(it.fields))) return { ok: false, error: `${it.id}: fields: not a look` };
  }
  return { ok: true, customs: tidyCustoms(data, now) };
}

/** Two copies as one: of each survivor the copy changed last; one deleted stays deleted unless changed after. */
export function mergeCustoms(a, b, now = Date.now()) {
  const x = tidyCustoms(a, now), y = tidyCustoms(b, now);
  const byId = new Map();
  for (const it of [...x.list, ...y.list]) {
    const had = byId.get(it.id);
    if (!had || it.updatedAt > had.updatedAt) byId.set(it.id, it);
  }
  const gone = new Map();
  for (const g of [...x.gone, ...y.gone]) gone.set(g.id, Math.max(gone.get(g.id) || 0, g.at));
  return { v: 2, list: keep([...byId.values()].filter((it) => !(gone.get(it.id) >= it.updatedAt))), gone: goneList(gone) };
}

/** Whether two copies hold the same (each survivor and its times, and the deletions). */
export function sameCustoms(a, b) {
  const key = (c) => JSON.stringify([c.list.map((it) => [it.id, it.updatedAt, it.made, it.name]), c.gone.map((g) => [g.id, g.at])]);
  return key(tidyCustoms(a)) === key(tidyCustoms(b));
}
