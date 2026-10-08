// The custom survivors this browser keeps (the character creator: client/ui/creator.js), in localStorage['stn.customs']
// as shared/customs.js has them: { v: 2, list: [{ id, name, fields, made, updatedAt }], gone: [{ id, at }] }. A player
// makes CUSTOMS_MAX at most; a signed-in player's are kept on their account too and merged with it, survivor by survivor
// (client/net/accountcustoms.js), so up to CUSTOMS_KEPT may be here. Nothing of them leaves the browser but the look
// itself, at a join, and - signed in - the list to the player's own account.
//
// Kept by name, a look outlives the wardrobe changing under it: a part taken out of the game since (or a field) falls
// back to the field's default, or its first choice, when the list is read (appearance.js fromNames). The repaired look
// is kept at once, and the player is told, once, what happened (note).
//
// The browser is asked to keep this storage (navigator.storage.persist) the first time a survivor is saved: without it
// a browser short of disk may clear it. (Safari still clears a site's storage after 7 days without a visit: the
// account's copy is what outlives that.)
import { fromNames, clean } from '../../shared/appearance.js';
import { CUSTOMS_MAX, NAME_MAX, cleanName, tidyCustoms } from '../../shared/customs.js';
import { lsGet, lsSet } from './dom.js';

export { NAME_MAX, cleanName };
export const MAX_CUSTOMS = CUSTOMS_MAX;
export const CUSTOMS_KEY = 'stn.customs';
const PERSIST_KEY = 'stn.persistAsked';

let list = null; // [{ id, name, values, made, updatedAt }]
let gone = []; // [{ id, at }]: deleted, remembered so a merge does not bring them back
const notes = new Map(); // id -> what was replaced (shown once)
const subs = new Set();

function read() {
  gone = [];
  const raw = lsGet(CUSTOMS_KEY, null);
  if (!raw) return [];
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    // (unreadable: put aside once, never thrown away, and start again)
    if (lsGet(CUSTOMS_KEY + '.broken', null) == null) lsSet(CUSTOMS_KEY + '.broken', raw);
    return [];
  }
  // what was replaced, said once: by name, against this wardrobe, before the copy is tidied
  let repairedAny = false;
  for (const it of Array.isArray(data?.list) ? data.list : []) {
    if (!it || typeof it !== 'object' || typeof it.id !== 'string') continue;
    const { repaired } = fromNames(it.fields);
    if (!repaired.length) continue;
    repairedAny = true;
    const name = cleanName(it.name) || 'Survivor';
    notes.set(it.id, `Some parts of ${name} are no longer in the game and were replaced (${repaired.slice(0, 4).join(', ')}${repaired.length > 4 ? ', ...' : ''}).`);
  }
  const t = tidyCustoms(data);
  gone = t.gone;
  const out = t.list.map(fromStored);
  if (repairedAny || data.v !== 2) write(out);
  return out;
}
const fromStored = (it) => ({ id: it.id, name: it.name, values: it.fields, made: it.made, updatedAt: it.updatedAt });
const toStored = (c) => ({ id: c.id, name: c.name, fields: c.values, made: c.made, updatedAt: c.updatedAt });

function write(l) {
  lsSet(CUSTOMS_KEY, JSON.stringify({ v: 2, list: l.map(toStored), gone }));
}

function newId() {
  return Math.random().toString(36).slice(2, 10) || 'c' + Date.now().toString(36);
}

// fn(why) when the list changes: 'edit' (made, changed or deleted here), 'sync' (merged with the account's)
function emit(why) {
  for (const fn of subs) {
    try {
      fn(why);
    } catch (err) {
      console.error(err);
    }
  }
}
export function onCustomsChange(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

// (asked once, the first time one is saved: Chrome decides by itself, Firefox may ask the player)
function askToKeep() {
  if (lsGet(PERSIST_KEY, '')) return;
  lsSet(PERSIST_KEY, '1');
  try {
    navigator.storage?.persist?.().catch(() => {});
  } catch {
    /* (not offered) */
  }
}

/** The saved survivors: [{ id, name, values, made, updatedAt }] (read, and repaired, the first time). */
export function customs() {
  if (!list) list = read();
  return list;
}
export const getCustom = (id) => customs().find((c) => c.id === id) || null;

/** Keeps a survivor: a new one (no id), or the one with that id changed. -> its id (null: no room for another). */
export function saveCustom({ id = null, name, values }) {
  const l = customs();
  const now = Date.now();
  const i = id ? l.findIndex((c) => c.id === id) : -1;
  if (i < 0 && l.length >= CUSTOMS_MAX) return null;
  const entry = { id: i >= 0 ? id : newId(), name: cleanName(name) || 'Survivor', values: clean(values), made: i >= 0 ? l[i].made : now, updatedAt: now };
  if (i >= 0) l[i] = entry;
  else l.push(entry);
  notes.delete(entry.id);
  write(l);
  askToKeep();
  emit('edit');
  return entry.id;
}

export function deleteCustom(id) {
  const l = customs();
  const i = l.findIndex((c) => c.id === id);
  if (i < 0) return;
  l.splice(i, 1);
  gone = [{ id, at: Date.now() }, ...gone.filter((g) => g.id !== id)];
  notes.delete(id);
  write(l);
  emit('edit');
}

/** This browser's copy, as shared/customs.js has it (what goes to the account). */
export function exportCustoms() {
  customs();
  return { v: 2, list: list.map(toStored), gone };
}
/** A copy merged with the account's (accountcustoms.js): kept here as it is. */
export function adoptCustoms(data) {
  const t = tidyCustoms(data);
  list = t.list.map(fromStored);
  gone = t.gone;
  write(list);
  emit('sync');
}

/** What was replaced in a saved survivor when it was read, if anything (until it is saved again). */
export const noteFor = (id) => notes.get(id) || '';
/** ...said once: then forgotten. */
export function takeNote(id) {
  const n = notes.get(id) || '';
  notes.delete(id);
  return n;
}

/** Tests and the UI sandbox: read the list again from storage. */
export function reloadCustoms() {
  list = null;
  notes.clear();
  return customs();
}

