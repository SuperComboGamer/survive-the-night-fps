// The custom survivors this browser keeps (the character creator: client/ui/creator.js): up to MAX_CUSTOMS, each a
// name and its look by name (shared/appearance.js), in localStorage['stn.customs'] as
// { v: 1, list: [{ id, name, fields: { hair: 'bun', height: 0.99, ... } }] }. Nothing of it leaves the browser but the
// look itself, at a join (the name never does).
//
// Kept by name, a look outlives the wardrobe changing under it: a part taken out of the game since (or a field) falls
// back to the field's default, or its first choice, when the list is read (appearance.js fromNames). The repaired look
// is kept at once, and the player is told, once, what happened (note).
import { fromNames, clean } from '../../shared/appearance.js';
import { lsGet, lsSet } from './dom.js';

export const CUSTOMS_KEY = 'stn.customs';
export const MAX_CUSTOMS = 4;
export const NAME_MAX = 16;

let list = null; // [{ id, name, values }]
const notes = new Map(); // id -> what was replaced (shown once)

/** A name as the server would allow a player's (letters, digits, space, _ - .), at most NAME_MAX. */
export const cleanName = (s) => String(s || '').replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, NAME_MAX);

function read() {
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
  const items = Array.isArray(data?.list) ? data.list : [];
  const out = [];
  let repairedAny = false;
  for (const it of items.slice(0, MAX_CUSTOMS)) {
    if (!it || typeof it !== 'object') continue;
    const id = typeof it.id === 'string' && /^[a-z0-9]{1,12}$/.test(it.id) ? it.id : newId();
    const name = cleanName(it.name) || 'Survivor';
    const { values, repaired } = fromNames(it.fields);
    if (repaired.length) {
      repairedAny = true;
      notes.set(id, `Some parts of ${name} are no longer in the game and were replaced (${repaired.slice(0, 4).join(', ')}${repaired.length > 4 ? ', ...' : ''}).`);
    }
    out.push({ id, name, values });
  }
  if (repairedAny) write(out);
  return out;
}

function write(l) {
  lsSet(CUSTOMS_KEY, JSON.stringify({ v: 1, list: l.map((c) => ({ id: c.id, name: c.name, fields: c.values })) }));
}

function newId() {
  return Math.random().toString(36).slice(2, 10) || 'c' + Date.now().toString(36);
}

/** The saved survivors: [{ id, name, values }] (read, and repaired, the first time). */
export function customs() {
  if (!list) list = read();
  return list;
}
export const getCustom = (id) => customs().find((c) => c.id === id) || null;

/** Keeps a survivor: a new one (no id), or the one with that id changed. -> its id (null: no room for another). */
export function saveCustom({ id = null, name, values }) {
  const l = customs();
  const entry = { id: id || newId(), name: cleanName(name) || 'Survivor', values: clean(values) };
  const i = id ? l.findIndex((c) => c.id === id) : -1;
  if (i >= 0) l[i] = entry;
  else if (l.length >= MAX_CUSTOMS) return null;
  else l.push(entry);
  notes.delete(entry.id);
  write(l);
  return entry.id;
}

export function deleteCustom(id) {
  const l = customs();
  const i = l.findIndex((c) => c.id === id);
  if (i < 0) return;
  l.splice(i, 1);
  notes.delete(id);
  write(l);
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
