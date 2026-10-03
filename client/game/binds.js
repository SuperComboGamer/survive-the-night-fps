// The player's keybinds, as this page has them: the one place every key the game answers to is looked up (Input, the
// one-off actions in Game.onKey, the HUD's key hints and prompts, the controls list, the fullscreen keyguard). What an
// action is and what it may be bound to: shared/binds.js.
//
// Kept in localStorage (stn.binds), so they are there the moment the page loads, signed in or not:
//   { v: 1, at: <ms of the last change, this browser's clock>, binds: { action: [primary, secondary] } }
// with only the actions that differ from the defaults. Anything unreadable in it falls back to the defaults. A signed-in
// player's are kept on their account as well (net/accountbinds.js), and whichever copy was changed last wins.
import { ACTIONS, ACTION, DEFAULT_BINDS, codeLabel, conflictsIn, fromOverrides, toOverrides, isMouseCode } from '../../shared/binds.js';

const KEY = 'stn.binds';
const VERSION = 1;
const MAC = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform || '');

let binds = fromOverrides(null); // action -> [primary, secondary]
let at = 0; // when they were last changed (0: never - the defaults, or binds from before there was a clock on them)
let byCode = new Map(); // code -> [action ids], in ACTIONS order
let version = 0; // bumped on every change: whatever caches a text with a key in it compares this
let layout = null; // the keyboard's own labels (navigator.keyboard.getLayoutMap), once the browser has said
const subs = new Set();

function index() {
  byCode = new Map();
  for (const a of ACTIONS) {
    for (const c of binds[a.id]) {
      if (!c) continue;
      const l = byCode.get(c);
      if (l) {
        if (!l.includes(a.id)) l.push(a.id);
      } else byCode.set(c, [a.id]);
    }
  }
}

function changed(why) {
  version++;
  index();
  for (const fn of subs) {
    try {
      fn(why);
    } catch (err) {
      console.error(err);
    }
  }
}

// ---------------------------------------------------------------- storage
// storage: localStorage, or a stand-in with getItem / setItem (the tests)
const store = (s) => s ?? globalThis.localStorage ?? null;

export function loadBinds(storage) {
  let o = null;
  try {
    o = JSON.parse(store(storage)?.getItem(KEY) || 'null');
  } catch {
    o = null;
  }
  const ok = o && typeof o === 'object' && o.v === VERSION;
  binds = fromOverrides(ok ? o.binds : null);
  at = ok && Number.isFinite(o.at) && o.at > 0 ? o.at : 0;
  changed('load');
}

function saveLocal(storage) {
  try {
    store(storage)?.setItem(KEY, JSON.stringify({ v: VERSION, at, binds: toOverrides(binds) }));
  } catch {
    /* storage unavailable (a private window, a full disk): they last as long as the page */
  }
}

// ---------------------------------------------------------------- lookups
// [primary, secondary] (either may be null: no key)
export const bindsOf = (action) => binds[action] || [null, null];
// the actions on a code, [] for none
export const actionsOf = (code) => byCode.get(code) || [];
export const isBound = (code) => byCode.has(code);
export const hasBind = (action) => bindsOf(action).some(Boolean);
export const bindsVersion = () => version;
export const bindsUpdatedAt = () => at;
// every keyboard code something is bound to (the keyguard locks these)
export const boundKeyCodes = () => [...byCode.keys()].filter((c) => !isMouseCode(c));
// a copy of the whole set: { action: [primary, secondary] }
export const allBinds = () => Object.fromEntries(ACTIONS.map((a) => [a.id, [...binds[a.id]]]));
export const isDefault = (action) => bindsOf(action)[0] === DEFAULT_BINDS[action][0] && bindsOf(action)[1] === DEFAULT_BINDS[action][1];

export function setLayout(map) {
  layout = map || null;
  changed('layout');
}

// a code's key-cap label: 'KeyZ' -> 'Z' (or what this keyboard has printed on that key), 'Mouse3' -> 'Mouse 4'
export const keyName = (code) => codeLabel(code, { layout, mac: MAC });

// An action's key, for text that names it: the primary, or the secondary if it has no primary, 'unbound' if neither
export function bindLabel(action) {
  const [p, s] = bindsOf(action);
  return keyName(p || s) || 'unbound';
}
// '[F]', the way a prompt names a key
export const bindTag = (action) => `[${bindLabel(action)}]`;
// both keys: 'Ctrl / C', 'Y / Enter'
export function bindPair(action) {
  const ks = bindsOf(action).filter(Boolean).map(keyName);
  return ks.length ? ks.join(' / ') : 'unbound';
}

// ---------------------------------------------------------------- changing them
export function onBindsChange(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

function touch(storage) {
  at = Math.max(Date.now(), at + 1); // (later than the last change even with a clock that went back)
  saveLocal(storage);
  changed('edit');
}

// What setting `code` on (action, slot) would collide with: [{ action, slot }] of other actions
export const conflictsFor = (action, code) => conflictsIn(binds, action, code);

// Puts `code` (or null: no key) on an action's primary (slot 0) or secondary (slot 1).
//   mode 'swap'    each colliding bind gets the key this slot had (or none, if it had none - or if that key would
//                  collide for it in turn)
//   mode 'replace' each colliding bind is left with no key
// The same key on the action's other slot just changes places with this one. -> [{ action, slot, code }]: what
// happened to the other binds, for the settings to show.
export function setBind(action, slot, code, { mode = 'replace', storage } = {}) {
  if (!ACTION[action] || (slot !== 0 && slot !== 1)) return [];
  const { next, moved } = planBind(binds, action, slot, code, mode);
  binds = next;
  touch(storage);
  return moved;
}

// ...what setBind would do, without doing it: { next: the whole set after, moved } (the settings ask before a swap
// whether it would give the other action anything)
export function planBind(from, action, slot, code, mode = 'replace') {
  const next = Object.fromEntries(ACTIONS.map((a) => [a.id, [...(from[a.id] || [null, null])]]));
  code = code || null;
  const mine = next[action];
  const old = mine[slot];
  const moved = [];
  if (code && mine[1 - slot] === code) mine[1 - slot] = old;
  if (code) {
    for (const c of conflictsIn(next, action, code)) {
      let give = mode === 'swap' ? old : null;
      // (none, if the key would collide for it in turn - or it has that key already)
      if (give && (next[c.action].includes(give) || conflictsIn({ ...next, [action]: [null, null] }, c.action, give).length)) give = null;
      next[c.action][c.slot] = give;
      moved.push({ ...c, code: give });
    }
  }
  mine[slot] = code;
  for (const id in next) {
    const ks = next[id];
    if (ks[0] === null && ks[1] !== null) {
      // (a lone bind is the primary: it is the one text names)
      ks[0] = ks[1];
      ks[1] = null;
    }
  }
  return { next, moved };
}

export function resetBind(action, { storage } = {}) {
  if (!ACTION[action]) return;
  binds[action] = [...DEFAULT_BINDS[action]];
  touch(storage);
}

export function resetAllBinds({ storage } = {}) {
  binds = fromOverrides(null);
  touch(storage);
}

// What goes to the account: { binds: overrides, updatedAt }
export const exportBinds = () => ({ binds: toOverrides(binds), updatedAt: at });

// The account's copy, taken over when it is the newer one (net/accountbinds.js decides that): kept here too, with its
// time, so the two agree
export function adoptBinds(over, updatedAt, { storage } = {}) {
  binds = fromOverrides(over);
  at = Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : 0;
  saveLocal(storage);
  changed('account');
}

// A piece of the page that names keys, kept up to date: node.textContent = fn() now and after every change (a key cap
// in a legend, a tooltip with set = 'title')
export function liveText(node, fn, set = 'textContent') {
  const put = () => (node[set] = fn());
  put();
  onBindsChange(put);
  return node;
}

// the labels this keyboard prints on its keys, when the browser can say (Chrome, over https or on localhost)
export function askLayout() {
  try {
    const p = globalThis.navigator?.keyboard?.getLayoutMap?.();
    p?.then?.(
      (m) => setLayout(m),
      () => {},
    );
  } catch {
    /* (not offered here) */
  }
}
