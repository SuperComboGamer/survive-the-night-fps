// Keybinds: every action a player presses, the keys it is on unless they rebind it, and what a bind may be. The
// client keeps a player's own binds (client/game/binds.js: this browser's localStorage, and their account when they
// are signed in); the server only checks what it is asked to keep (server/index.js /api/me/binds). Nothing here goes
// over the game's socket: a bind changes which key sends a button, never the button.
//
// A bind is a KeyboardEvent.code - the physical key, so W is forward on an AZERTY keyboard too, where it is labelled Z
// - or a mouse button as 'Mouse0'..'Mouse4' (left, middle, right, back, forward). Each action has two, a primary and a
// secondary; null is "no key". Escape is not anybody's: it is the menu and the way back out of everything.

// what the settings list them under, in this order
export const BIND_GROUPS = ['Movement', 'Combat', 'Inventory & items', 'Building', 'Communication', 'Interface'];

// When two actions may share a key. Most can't: a key does one thing. But with the hammer out (build mode) the keys
// of the weapon in the hands mean something else - Q steps back through the structures instead of to the last weapon,
// R forward instead of reloading - so an action of the hands and one of building may sit on the same key.
//   any    always live: shares with nothing
//   hands  what the weapon in the hands does (a build action takes the key over while the hammer is out)
//   build  only with the hammer out
// (Interact is of the hands, and still beats a build action on its key whenever the prompt offers it.)
const CTX_ANY = 'any';
const CTX_HANDS = 'hands';
const CTX_BUILD = 'build';

// hold: a held action, a button the simulation reads for as long as it is down (Input turns those into BTN bits);
// the rest act once, as they are pressed. menu: still answered while the controls are off (the inventory, the map
// or the pause menu is up) - the key that opened something shuts it again.
export const ACTIONS = [
  { id: 'forward', label: 'Move forward', group: 'Movement', keys: ['KeyW', 'ArrowUp'], hold: true },
  { id: 'back', label: 'Move back', group: 'Movement', keys: ['KeyS', 'ArrowDown'], hold: true },
  { id: 'left', label: 'Strafe left', group: 'Movement', keys: ['KeyA', 'ArrowLeft'], hold: true },
  { id: 'right', label: 'Strafe right', group: 'Movement', keys: ['KeyD', 'ArrowRight'], hold: true },
  { id: 'jump', label: 'Jump · vault · throw off', group: 'Movement', keys: ['Space', null], hold: true },
  { id: 'sprint', label: 'Sprint', group: 'Movement', keys: ['ShiftLeft', 'ShiftRight'], hold: true },
  { id: 'crouch', label: 'Crouch', group: 'Movement', keys: ['ControlLeft', 'KeyC'], hold: true },

  { id: 'fire', label: 'Fire · attack · place', group: 'Combat', keys: ['Mouse0', null], hold: true },
  // (on a trackpad a right click can't be held while you click to fire: the left thumb rests on Alt, the fingers on WASD)
  { id: 'aim', label: 'Aim · heavy swing · leap', group: 'Combat', keys: ['Mouse2', 'AltLeft'], hold: true },
  { id: 'reload', label: 'Reload · flourish (nunchucks)', group: 'Combat', keys: ['KeyR', null], hold: true, ctx: CTX_HANDS },
  { id: 'slot1', label: 'Primary weapon', group: 'Combat', keys: ['Digit1', null] },
  { id: 'slot2', label: 'Pistol', group: 'Combat', keys: ['Digit2', null] },
  { id: 'slot3', label: 'Melee', group: 'Combat', keys: ['Digit3', null] },
  { id: 'slot4', label: 'Throwable (again: the next kind)', group: 'Combat', keys: ['Digit4', null] },
  { id: 'lastWeapon', label: 'Last weapon', group: 'Combat', keys: ['KeyQ', null], ctx: CTX_HANDS },
  { id: 'drop', label: 'Drop weapon', group: 'Combat', keys: ['KeyG', null], ctx: CTX_HANDS },

  { id: 'interact', label: 'Interact · pick up', group: 'Inventory & items', keys: ['KeyE', null], ctx: CTX_HANDS },
  { id: 'inventory', label: 'Inventory & crafting', group: 'Inventory & items', keys: ['KeyI', null], menu: true },
  { id: 'heal', label: 'Quick heal', group: 'Inventory & items', keys: ['KeyH', null] },
  { id: 'drink', label: 'Energy drink', group: 'Inventory & items', keys: ['KeyB', null] },
  { id: 'flashlight', label: 'Flashlight', group: 'Inventory & items', keys: ['KeyF', null] },

  { id: 'slot5', label: 'Hammer (build mode)', group: 'Building', keys: ['Digit5', null] },
  { id: 'buildNext', label: 'Next structure', group: 'Building', keys: ['KeyR', 'KeyE'], ctx: CTX_BUILD },
  { id: 'buildPrev', label: 'Previous structure', group: 'Building', keys: ['KeyQ', null], ctx: CTX_BUILD },
  { id: 'demolish', label: 'Demolish · remove', group: 'Building', keys: ['KeyX', null], ctx: CTX_BUILD },

  { id: 'chat', label: 'Chat', group: 'Communication', keys: ['KeyY', 'Enter'] },
  { id: 'talk', label: 'Push to talk', group: 'Communication', keys: ['KeyV', null] },
  { id: 'slot6', label: 'Walkie-talkie (fire held: talk to everyone)', group: 'Communication', keys: ['Digit6', null] },
  { id: 'ping', label: 'Ping', group: 'Communication', keys: ['KeyZ', 'Mouse1'] },

  { id: 'map', label: 'Field map', group: 'Interface', keys: ['KeyM', null], menu: true },
  { id: 'board', label: 'Leaderboard', group: 'Interface', keys: ['KeyL', null], menu: true },
  { id: 'bestiary', label: 'Bestiary', group: 'Interface', keys: ['KeyJ', null], menu: true },
  { id: 'cards', label: 'Dead Hand (cards)', group: 'Interface', keys: ['KeyK', null], menu: true },
  { id: 'players', label: 'Player list (hold)', group: 'Interface', keys: ['Tab', null], menu: true },
].map((a) => Object.freeze({ ctx: CTX_ANY, hold: false, menu: false, ...a, keys: Object.freeze(a.keys) }));

export const ACTION = Object.freeze(Object.fromEntries(ACTIONS.map((a) => [a.id, a])));

// action -> [primary, secondary]
export const DEFAULT_BINDS = Object.freeze(Object.fromEntries(ACTIONS.map((a) => [a.id, a.keys])));

// ---------------------------------------------------------------- what a bind may be
// The keys a bind can go on: what a keyboard has that a browser hands a page. Not Escape (the menu), not Backspace or
// Delete (they clear a bind while one is being set), not the OS keys (Meta, the context menu key), and not F11 / F12,
// which the browser keeps for itself.
const KEY_CODES = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => 'Key' + c),
  ...'0123456789'.split('').map((d) => 'Digit' + d),
  ...'0123456789'.split('').map((d) => 'Numpad' + d),
  'NumpadAdd', 'NumpadSubtract', 'NumpadMultiply', 'NumpadDivide', 'NumpadDecimal', 'NumpadEnter',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10',
  'Space', 'Tab', 'Enter', 'CapsLock',
  'Backquote', 'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash', 'IntlBackslash', 'Semicolon', 'Quote', 'Comma', 'Period', 'Slash',
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Insert', 'Home', 'End', 'PageUp', 'PageDown',
];
export const MOUSE_CODES = ['Mouse0', 'Mouse1', 'Mouse2', 'Mouse3', 'Mouse4'];
const VALID = new Set([...KEY_CODES, ...MOUSE_CODES]);

export const isBindCode = (code) => typeof code === 'string' && VALID.has(code);
export const isMouseCode = (code) => typeof code === 'string' && code.startsWith('Mouse');
// MouseEvent.button -> its code ('' for a button past the fifth)
export const mouseCode = (button) => (button >= 0 && button <= 4 ? 'Mouse' + button : '');

// ---------------------------------------------------------------- labels
const NAMES = {
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Enter',
  CapsLock: 'Caps Lock',
  ShiftLeft: 'Left Shift',
  ShiftRight: 'Right Shift',
  ControlLeft: 'Left Ctrl',
  ControlRight: 'Right Ctrl',
  AltLeft: 'Left Alt',
  AltRight: 'Right Alt',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  IntlBackslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num -',
  NumpadMultiply: 'Num *',
  NumpadDivide: 'Num /',
  NumpadDecimal: 'Num .',
  NumpadEnter: 'Num Enter',
  Mouse0: 'LMB',
  Mouse1: 'MMB',
  Mouse2: 'RMB',
  Mouse3: 'Mouse 4',
  Mouse4: 'Mouse 5',
};
const MAC_NAMES = { AltLeft: 'Left Option', AltRight: 'Right Option' };

// What goes on the key cap: 'KeyZ' -> 'Z', 'Digit5' -> '5', 'ControlLeft' -> 'Left Ctrl', 'Mouse3' -> 'Mouse 4', null
// -> ''. layout: the keyboard's own label for a code where it has one (the client asks the browser: on an AZERTY
// keyboard KeyQ is labelled A), mac: Alt is Option there
export function codeLabel(code, { layout = null, mac = false } = {}) {
  if (!code) return '';
  if (mac && MAC_NAMES[code]) return MAC_NAMES[code];
  const own = layout && /^(Key|Digit|Backquote|Minus|Equal|Bracket|Backslash|IntlBackslash|Semicolon|Quote|Comma|Period|Slash)/.test(code) ? layout.get?.(code) : '';
  if (own && own.trim()) return own.length === 1 ? own.toUpperCase() : own;
  if (NAMES[code]) return NAMES[code];
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1];
  m = /^(?:Digit)(\d)$/.exec(code);
  if (m) return m[1];
  m = /^Numpad(\d)$/.exec(code);
  if (m) return 'Num ' + m[1];
  return code;
}

// ---------------------------------------------------------------- conflicts
// Can a and b be on the same key? (an action is always fine with itself: its two binds are just two ways to press it)
export function sharesOk(a, b) {
  if (a === b) return true;
  const ca = ACTION[a]?.ctx || CTX_ANY;
  const cb = ACTION[b]?.ctx || CTX_ANY;
  return ca !== CTX_ANY && cb !== CTX_ANY && ca !== cb;
}

// The binds that putting `code` on `action` would collide with: [{ action, slot }] (another action's, of a kind that
// can't share a key with it)
export function conflictsIn(binds, action, code) {
  const out = [];
  if (!code) return out;
  for (const a of ACTIONS) {
    if (a.id === action || sharesOk(action, a.id)) continue;
    const ks = binds[a.id] || [];
    for (let slot = 0; slot < 2; slot++) if (ks[slot] === code) out.push({ action: a.id, slot });
  }
  return out;
}

// ---------------------------------------------------------------- stored binds
// What is kept, here and on the account, is only what differs from the defaults: { action: [primary, secondary] }.
// So a change to a default reaches everybody who never touched that action.
export const MAX_BIND_ACTIONS = ACTIONS.length;

// A full set of binds from stored overrides: anything unknown or malformed is dropped (that action keeps its
// defaults), never trusted. Never throws.
// A player's own bind beats a default: an action they never rebound gives up a default key that one they did rebind
// is on now. (A new action's default - Dead Hand's K - must not land on a key a player already chose for something
// else, and quietly make it do two things at once; the new action is left without that key, to be bound in the
// settings.)
export function fromOverrides(over) {
  const out = {};
  for (const a of ACTIONS) out[a.id] = [...a.keys];
  if (!over || typeof over !== 'object' || Array.isArray(over)) return out;
  const own = new Set(); // the actions the overrides set
  for (const a of ACTIONS) {
    const v = over[a.id];
    if (!Array.isArray(v) || v.length !== 2) continue;
    if (!v.every((c) => c === null || isBindCode(c))) continue;
    out[a.id] = v[0] === v[1] && v[0] !== null ? [v[0], null] : [v[0], v[1]];
    own.add(a.id);
  }
  if (!own.size) return out;
  for (const a of ACTIONS) {
    if (own.has(a.id)) continue;
    const ks = out[a.id];
    for (let s = 0; s < 2; s++) if (ks[s] && ACTIONS.some((b) => own.has(b.id) && !sharesOk(a.id, b.id) && out[b.id].includes(ks[s]))) ks[s] = null;
    if (ks[0] === null && ks[1] !== null) [ks[0], ks[1]] = [ks[1], null]; // (a lone bind is the primary)
  }
  return out;
}

// ...and back: only the actions that differ from their defaults
export function toOverrides(binds) {
  const out = {};
  for (const a of ACTIONS) {
    const v = binds[a.id];
    if (!v) continue;
    if (v[0] !== a.keys[0] || v[1] !== a.keys[1]) out[a.id] = [v[0] ?? null, v[1] ?? null];
  }
  return out;
}

// The server's check of overrides a client asks it to keep: strict, where fromOverrides is forgiving - junk is refused
// whole, with the reason, not cleaned. -> { ok: true, binds } | { ok: false, error }
export function checkOverrides(over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return { ok: false, error: 'binds must be an object' };
  const keys = Object.keys(over);
  if (keys.length > MAX_BIND_ACTIONS) return { ok: false, error: 'too many binds' };
  const out = {};
  for (const k of keys) {
    if (!Object.hasOwn(ACTION, k)) return { ok: false, error: `no action called ${String(k).slice(0, 32)}` };
    const v = over[k];
    if (!Array.isArray(v) || v.length !== 2) return { ok: false, error: `${k}: a bind is [primary, secondary]` };
    for (const c of v) if (c !== null && !isBindCode(c)) return { ok: false, error: `${k}: ${typeof c === 'string' ? c.slice(0, 32) : typeof c} is not a key` };
    out[k] = [v[0], v[1]];
  }
  return { ok: true, binds: out };
}
