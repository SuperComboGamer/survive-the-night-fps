// The admin spawn menu [`]: every item, zombie and world event the admin commands can make, found by typing a few
// letters or by browsing a category and clicking. Only a player the server said may run admin commands
// (WELCOMEF.ADMIN) is offered it, and what it does goes out as those chat commands (/give, /spawn, /supply, ...): the
// server checks each one itself.
//
// Search: each word typed has to fit the name somewhere - its start, the start of one of its words, its initials
// ("hq": The Hive Queen), its ITEM / ZTYPE key, its category ("ammo", "boss") or, failing those, its letters in order.
// A trailing number is how many ("walker 5", "9mm x60"). The best fit is picked: Enter spawns it.
import { ITEM, ITEM_DEFS, AMMO_MAX, ZTYPE, ZOMBIE_DEFS } from '../../shared/defs.js';
import { el, svgEl, lsGet, lsSet, replay } from './dom.js';
import { itemIcon, glyph } from './icons.js';

// (a fixed key, not a keybind: the menu is not everybody's, so it has no place in the settings' list)
export const SPAWN_KEY = 'Backquote';
const RECENT_KEY = 'stn.spawn.recent';
const QTY_KEY = 'stn.spawn.qty';
const RECENT_MAX = 10;
const ZOMBIE_MAX = 20; // what one /spawn makes at most

// the sidebar, in this order. Items go under their ITEM_DEFS category (ITEM_CAT), zombies under zombie or boss
export const SPAWN_CATS = [
  { id: 'all', label: 'Everything' },
  { id: 'recent', label: 'Recent' },
  { id: 'weapon', label: 'Weapons', words: ['weapons', 'guns', 'melee'] },
  { id: 'ammo', label: 'Ammo', words: ['ammunition', 'rounds', 'bullets'] },
  { id: 'throw', label: 'Throwables', words: ['throwables', 'explosives'] },
  { id: 'cons', label: 'Healing & food', words: ['healing', 'heal', 'food', 'consumables'] },
  { id: 'gear', label: 'Armor & gear', words: ['armor', 'gear', 'backpack'] },
  { id: 'res', label: 'Materials', words: ['materials', 'resources', 'crafting'] },
  { id: 'part', label: 'Car parts', words: ['car', 'parts', 'supplies'] },
  { id: 'schem', label: 'Schematics', words: ['schematics', 'blueprints', 'unlock'] },
  { id: 'zombie', label: 'Zombies', words: ['zombies', 'enemies', 'undead', 'infected'] },
  { id: 'boss', label: 'Bosses', words: ['bosses', 'enemies'] },
  { id: 'world', label: 'World', words: ['world', 'events'] },
];
const CAT = Object.fromEntries(SPAWN_CATS.map((c) => [c.id, c]));
const ITEM_CAT = { weapon: 'weapon', ammo: 'ammo', throw: 'throw', cons: 'cons', armor: 'gear', pack: 'gear', gear: 'gear', res: 'res', part: 'part', schem: 'schem' };

// the admin commands that put something into the world that is not an item or a zombie
const WORLD = [
  { id: 'supply', name: 'Supply Crate', glyph: 'container', cmd: '/supply', sub: 'Drops 5 m ahead', alias: ['loot', 'box'] },
  { id: 'airdrop', name: 'Airdrop', glyph: 'flag', cmd: '/airdrop', sub: 'A supply plane drops a crate', alias: ['plane', 'drop'] },
  { id: 'deer', name: 'Deer', glyph: 'eye', cmd: '/deer spawn', sub: 'A group 20 m ahead', alias: ['animals', 'hunt', 'venison'] },
  { id: 'cat', name: 'Stray Cat', glyph: 'heart', cmd: '/cat', sub: 'Brings it over', alias: ['pet', 'kitty'] },
  { id: 'map2', name: 'Skip to Map 2', glyph: 'map', cmd: '/map2', sub: 'Day 1 on the mainland, no cutscene', alias: ['mainland', 'act2', 'bridge'] },
  { id: 'cross', name: 'Map 2 Cutscene', glyph: 'car', cmd: '/cutscene', sub: 'The car drives off, as if the final stand was won', alias: ['cross', 'crossing', 'cinematic', 'escape', 'mainland', 'bridge'] },
];

const compact = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const wordsOf = (s) => String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const STOP = new Set(['the', 'of', 'a']);

function entry(e) {
  const words = wordsOf(e.name).filter((w) => !STOP.has(w));
  return {
    ...e,
    compact: words.join(''),
    words,
    initials: words.map((w) => w[0]).join(''),
    alias: (e.alias || []).flatMap((a) => [compact(a), ...wordsOf(a)]),
    catWords: [...wordsOf(CAT[e.cat].label), ...(CAT[e.cat].words || [])],
  };
}

/** Everything the menu offers, in the order it browses: [{ key, name, cat, sub, icon, auto, max, cmd(n) }]. */
export function spawnCatalog() {
  const items = [];
  for (const [key, id] of Object.entries(ITEM)) {
    const def = ITEM_DEFS[id];
    if (!def) continue;
    const cat = ITEM_CAT[def.cat] || 'res';
    // a weapon is one whatever the count (Game.giveItem), a schematic unlocks once, ammo fills its reserve at most
    const one = def.cat === 'weapon' || def.cat === 'schem';
    const max = one ? 1 : def.cat === 'ammo' ? AMMO_MAX[def.ammo] : 999;
    // (by ITEM key, not id: everybody in the game reads the command back as a [debug] line)
    items.push(entry({ key: `i${id}`, kind: 'item', name: def.name, cat, sub: CAT[cat].label, icon: itemIcon(id), alias: [key], auto: one ? 1 : def.stack || 1, max, cmd: (n) => `/give ${key.toLowerCase()} ${n}` }));
  }
  const order = SPAWN_CATS.map((c) => c.id);
  items.sort((a, b) => order.indexOf(a.cat) - order.indexOf(b.cat));
  const zombies = Object.entries(ZTYPE).map(([key, id]) => {
    const def = ZOMBIE_DEFS[id];
    const cat = def.boss ? 'boss' : 'zombie';
    return entry({ key: `z${id}`, kind: 'zombie', name: def.name, cat, sub: `${def.boss ? 'Boss' : 'Zombie'} · 12 m ahead`, icon: glyph(def.boss ? 'bossSkull' : 'skull'), alias: [key], auto: 1, max: ZOMBIE_MAX, cmd: (n) => `/spawn ${key.toLowerCase()} ${n}` });
  });
  zombies.sort((a, b) => order.indexOf(a.cat) - order.indexOf(b.cat));
  const world = WORLD.map((w) => entry({ key: `w${w.id}`, kind: 'world', name: w.name, cat: 'world', sub: w.sub, icon: glyph(w.glyph), alias: w.alias, auto: 1, max: 0, cmd: () => w.cmd }));
  return [...items, ...zombies, ...world];
}

/** "walker 5" -> { tokens: ['walker'], qty: 5 }. A number on its own is a search ("308"), not how many. */
export function parseQuery(text) {
  const raw = String(text || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  let qty = null;
  if (raw.length > 1) {
    const m = /^(?:x(\d+)|(\d+)x?)$/.exec(raw[raw.length - 1]);
    if (m) {
      qty = Math.max(1, Math.min(999, +(m[1] || m[2])));
      raw.pop();
    }
  }
  return { tokens: raw.map(compact).filter(Boolean), qty };
}

// letters of t in order through hay: how tightly they sit (1 = side by side), 0 if they are not all there
function inOrder(hay, t) {
  let i = 0;
  let first = -1;
  let last = -1;
  for (let k = 0; k < hay.length && i < t.length; k++) {
    if (hay[k] !== t[i]) continue;
    if (first < 0) first = k;
    last = k;
    i++;
  }
  return i === t.length ? t.length / (last - first + 1) : 0;
}

function scoreWord(e, t) {
  if (e.compact === t) return 100;
  if (e.compact.startsWith(t)) return 85;
  if (e.words.some((w) => w.startsWith(t))) return 75;
  if (t.length >= 2 && e.initials.startsWith(t)) return 65;
  if (e.alias.some((a) => a.startsWith(t))) return 55;
  if (e.catWords.some((w) => w.startsWith(t))) return 25;
  // (inside a word, or letters in order: only for three letters or more, or two would fit half the list)
  if (t.length < 3) return 0;
  if (e.compact.includes(t)) return 45;
  if (e.alias.some((a) => a.includes(t))) return 35;
  const tight = inOrder(e.compact, t);
  return tight >= 0.5 ? 5 + 15 * tight : 0;
}

/** How well the query's words fit an entry (0: not at all). A plural fits the singular ("walkers"). */
export function scoreEntry(e, tokens) {
  let total = 0;
  for (const t of tokens) {
    let s = scoreWord(e, t);
    if (!s && t.length > 3 && t.endsWith('s')) s = scoreWord(e, t.slice(0, -1)) * 0.9;
    if (!s) return 0;
    total += s;
  }
  return total;
}

/** The entries that fit, best first. recent: keys, most recent first (they win a tie). */
export function searchSpawns(catalog, tokens, recent = []) {
  const out = [];
  catalog.forEach((e, i) => {
    const s = scoreEntry(e, tokens);
    if (s > 0) out.push({ e, s, r: recent.indexOf(e.key), i });
  });
  const rank = (r) => (r < 0 ? RECENT_MAX : r);
  out.sort((a, b) => b.s - a.s || rank(a.r) - rank(b.r) || a.e.name.length - b.e.name.length || a.i - b.i);
  return out.map((x) => x.e);
}

function loadRecent() {
  try {
    const v = JSON.parse(lsGet(RECENT_KEY, '[]'));
    return Array.isArray(v) ? v.filter((k) => typeof k === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

const QTYS = [
  ['auto', 'Auto', 'A full stack, a full ammo reserve, or one weapon or zombie'],
  [1, '1'],
  [5, '5'],
  [10, '10'],
  [20, '20'],
];

export class SpawnMenu {
  constructor(ui, parent) {
    this.ui = ui;
    this.open = false;
    this.onSpawn = null; // (command): the game sends it as chat
    this.onClose = null;
    this.catalog = spawnCatalog();
    this.byKey = new Map(this.catalog.map((e) => [e.key, e]));
    this.cat = 'all';
    const q = lsGet(QTY_KEY, 'auto');
    this.qty = QTYS.some(([v]) => String(v) === q) ? (q === 'auto' ? 'auto' : +q) : 'auto';
    this.query = { tokens: [], qty: null };
    this.recent = loadRecent();
    this.shown = []; // the entries listed, in order, and their rows
    this.rows = [];
    this.sel = -1;
    this.sentT = -1e9;

    this.root = el('div', 'spawnscr', parent);
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Spawn menu');
    const bg = el('div', 'spawn-bg', this.root);
    const frame = el('div', 'spawn-frame paper', this.root);
    const head = el('div', 'map-head', frame);
    el('span', 'map-title', head, 'Spawn');
    el('span', 'spawn-tag', head, 'Admin');
    this.count = el('span', 'map-coords', head, '');
    const close = svgEl('button', 'set-close btn-icon map-close', head, glyph('xmark'));
    close.type = 'button';
    close.title = 'Close (` or Esc)';
    close.setAttribute('aria-label', 'Close spawn menu');
    close.addEventListener('click', () => this.onClose?.());

    const top = el('div', 'spawn-top', frame);
    const bar = el('label', 'spawn-search', top);
    svgEl('i', 'spawn-search-ico', bar, glyph('search'));
    this.input = el('input', 'spawn-field', bar);
    this.input.type = 'text';
    this.input.maxLength = 60;
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.placeholder = 'Search weapons, items, zombies…   "walker 5" spawns five';
    this.input.setAttribute('aria-label', 'Search what to spawn');
    this.input.setAttribute('aria-controls', 'spawn-list');
    this.input.addEventListener('input', () => {
      const was = this.query.tokens.length;
      this.query = parseQuery(this.input.value);
      // a new search looks through everything (a category picked while searching narrows it)
      if (!was && this.query.tokens.length) this.cat = 'all';
      this.render();
    });
    const qty = el('div', 'set-seg spawn-qty', top);
    qty.title = 'How many';
    this.qtyBtns = QTYS.map(([v, label, tip]) => {
      const b = el('button', 'seg-btn', qty, label);
      b.type = 'button';
      b.title = tip || `${label} at a time`;
      b.addEventListener('click', () => this.setQty(v));
      return b;
    });

    const body = el('div', 'spawn-body', frame);
    this.side = el('div', 'spawn-side', body);
    this.catBtns = new Map();
    for (const c of SPAWN_CATS) {
      const b = el('button', 'spawn-cat', this.side);
      b.type = 'button';
      el('span', 'spawn-cat-l', b, c.label);
      b.n = el('span', 'spawn-n', b, '');
      b.addEventListener('click', () => this.setCat(c.id));
      this.catBtns.set(c.id, b);
    }
    this.list = el('div', 'spawn-list', body);
    this.list.id = 'spawn-list';
    this.list.setAttribute('role', 'listbox');

    const foot = el('div', 'spawn-foot', frame);
    this.status = el('div', 'spawn-status', foot, '');
    const keys = el('div', 'map-keys', foot);
    for (const [k, t] of [
      ['↑↓', 'choose'],
      ['Enter', 'spawn'],
      ['Shift+Enter', 'spawn, stay open'],
      ['Tab', 'category'],
      ['` / Esc', 'close'],
    ]) {
      const s = el('span', 'gh', keys);
      el('span', 'kbd sm', s, k);
      el('span', '', s, t);
    }

    // the search box keeps the keys: a click on a row, a category or a count never takes the focus off it
    for (const n of [this.list, this.side, qty]) n.addEventListener('mousedown', (e) => e.preventDefault());
    this.root.addEventListener('pointerdown', (e) => {
      if (e.button === 0 && (e.target === bg || e.target === this.root)) this.onClose?.();
    });
    this.list.addEventListener('pointermove', (e) => {
      const i = this.rows.indexOf(e.target.closest?.('.spawn-row'));
      if (i >= 0 && i !== this.sel) this.select(i, false);
    });
    this.list.addEventListener('click', (e) => {
      const i = this.rows.indexOf(e.target.closest?.('.spawn-row'));
      if (i >= 0) this.spawn(i, false);
    });
    // (stopped here: none of these keys are the game's while the menu is up)
    this.root.addEventListener('keydown', (e) => this.key(e));
    this.syncQty();
  }

  setOpen(open) {
    open = !!open;
    if (open === this.open) return;
    this.open = open;
    this.root.hidden = !open;
    this.ui.root.classList.toggle('spawn-open', open);
    if (open) {
      this.cat = 'all';
      this.recent = loadRecent();
      this.say('');
      this.render();
      // what was searched last stays, selected: Enter spawns it again, a letter starts a new search. (Focused on the
      // next tick, so the key that opened the menu is not typed into it)
      setTimeout(() => {
        if (!this.open) return;
        this.input.focus({ preventScroll: true });
        this.input.select();
      }, 0);
    } else this.input.blur();
  }

  setCat(id) {
    if (!CAT[id]) return;
    this.cat = id;
    this.render();
  }

  setQty(v) {
    this.qty = v;
    lsSet(QTY_KEY, String(v));
    this.syncQty();
    this.render(true);
  }

  syncQty() {
    this.qtyBtns.forEach((b, i) => b.classList.toggle('on', QTYS[i][0] === this.qty));
  }

  // how many of e a spawn makes now: the number typed, else the count picked, within what one command can make
  amount(e) {
    if (!e.max) return 0;
    const want = this.query.qty ?? (this.qty === 'auto' ? e.auto : this.qty);
    return Math.max(1, Math.min(e.max, want));
  }

  inCat(e, cat) {
    if (cat === 'all') return true;
    if (cat === 'recent') return this.recent.includes(e.key);
    return e.cat === cat;
  }

  // keep: the same entry stays selected (the count changed, nothing moved)
  render(keep = false) {
    const was = keep ? this.shown[this.sel] : null;
    const tokens = this.query.tokens;
    const searching = tokens.length > 0;
    const recentEntries = this.recent.map((k) => this.byKey.get(k)).filter(Boolean);
    const pool = searching ? searchSpawns(this.catalog, tokens, this.recent) : this.catalog;
    // per category: what fits the search, or everything in it
    for (const c of SPAWN_CATS) {
      const n = c.id === 'recent' ? (searching ? pool.filter((e) => this.recent.includes(e.key)).length : recentEntries.length) : pool.filter((e) => this.inCat(e, c.id)).length;
      const b = this.catBtns.get(c.id);
      b.n.textContent = String(n);
      b.classList.toggle('on', c.id === this.cat);
      b.classList.toggle('none', n === 0);
    }
    this.list.textContent = '';
    this.shown = [];
    this.rows = [];
    const section = (label) => el('div', 'spawn-sec', this.list, label);
    if (!searching && this.cat === 'all') {
      // browsing everything: what was spawned lately first, then each category under its heading
      if (recentEntries.length) {
        section('Recent');
        for (const e of recentEntries) this.row(e);
      }
      for (const c of SPAWN_CATS) {
        const list = this.catalog.filter((e) => e.cat === c.id);
        if (!list.length) continue;
        section(c.label);
        for (const e of list) this.row(e);
      }
    } else {
      const list = !searching && this.cat === 'recent' ? recentEntries : pool.filter((e) => this.inCat(e, this.cat));
      for (const e of list) this.row(e);
    }
    if (!this.rows.length) {
      const elsewhere = searching && this.cat !== 'all' ? pool.length : 0;
      el('div', 'spawn-note', this.list, elsewhere ? `Nothing in ${CAT[this.cat].label} - ${elsewhere} found in Everything (Tab)` : searching ? 'Nothing fits that. Try fewer letters.' : 'Nothing spawned yet.');
    }
    this.count.textContent = searching ? `${this.rows.length} found` : `${this.catalog.length} things`;
    const i = was ? this.shown.indexOf(was) : -1;
    this.select(i >= 0 ? i : this.rows.length ? 0 : -1, true);
  }

  row(e) {
    const r = el('div', `spawn-row ${e.kind} cat-${e.cat}`, this.list);
    r.setAttribute('role', 'option');
    svgEl('i', 'spawn-ico', r, e.icon);
    const txt = el('span', 'spawn-txt', r);
    el('span', 'spawn-name', txt, e.name);
    el('span', 'spawn-sub', txt, e.sub);
    const n = this.amount(e);
    el('span', 'spawn-amt', r, n ? `×${n}` : '');
    r.title = n ? `${e.name}: spawn ${n}` : e.name;
    this.shown.push(e);
    this.rows.push(r);
  }

  select(i, scroll) {
    const old = this.rows[this.sel];
    if (old) {
      old.classList.remove('on');
      old.setAttribute('aria-selected', 'false');
    }
    this.sel = i;
    const r = this.rows[i];
    if (!r) return;
    r.classList.add('on');
    r.setAttribute('aria-selected', 'true');
    if (scroll) r.scrollIntoView({ block: 'nearest' });
  }

  // the arrow keys through a grid of rows: up / down to the nearest row on the next line that way
  step(dx, dy) {
    if (!this.rows.length) return;
    if (this.sel < 0) return this.select(0, true);
    if (dx) return this.select((this.sel + dx + this.rows.length) % this.rows.length, true);
    const cur = this.rows[this.sel].getBoundingClientRect();
    const cx = cur.left + cur.width / 2;
    let best = -1;
    let bestD = Infinity;
    this.rows.forEach((r, i) => {
      const b = r.getBoundingClientRect();
      const ahead = dy > 0 ? b.top - cur.bottom : cur.top - b.bottom;
      if (ahead < -2) return;
      const d = ahead * 10 + Math.abs(b.left + b.width / 2 - cx);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best >= 0) this.select(best, true);
  }

  spawn(i, close) {
    const e = this.shown[i];
    if (!e) return;
    const n = this.amount(e);
    this.onSpawn?.(e.cmd(n));
    this.sentT = performance.now();
    this.recent = [e.key, ...this.recent.filter((k) => k !== e.key)].slice(0, RECENT_MAX);
    lsSet(RECENT_KEY, JSON.stringify(this.recent));
    this.say(n ? `Spawning ${n} × ${e.name}…` : `${e.name}…`);
    if (this.rows[i]) replay(this.rows[i], 'fired');
    this.ui.sound('ui_click');
    if (close) this.onClose?.();
  }

  // the server's answer to what was just sent (a system chat line), on the menu's status line
  serverSays(text) {
    if (!this.open || performance.now() - this.sentT > 3000 || text.startsWith('[debug]')) return;
    this.say(text, /^(no |which )/i.test(text));
  }

  say(text, bad = false) {
    this.status.textContent = text;
    this.status.classList.toggle('err', bad);
  }

  key(e) {
    e.stopPropagation();
    if (e.code === SPAWN_KEY) {
      e.preventDefault();
      if (!e.repeat) this.onClose?.();
      return;
    }
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        if (this.input.value) {
          this.input.value = '';
          this.query = parseQuery('');
          this.render();
        } else this.onClose?.();
        break;
      case 'Enter':
        e.preventDefault();
        if (!e.repeat) this.spawn(this.sel, !e.shiftKey);
        break;
      case 'ArrowDown':
      case 'ArrowUp':
        e.preventDefault();
        this.step(0, e.key === 'ArrowDown' ? 1 : -1);
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
        // (the caret's keys while there is text to move through)
        if (this.input.value && document.activeElement === this.input) break;
        e.preventDefault();
        this.step(e.key === 'ArrowRight' ? 1 : -1, 0);
        break;
      case 'PageDown':
      case 'PageUp':
        e.preventDefault();
        for (let k = 0; k < 4; k++) this.step(0, e.key === 'PageDown' ? 1 : -1);
        break;
      case 'Tab': {
        e.preventDefault();
        // through the categories that have something in them
        const ids = SPAWN_CATS.map((c) => c.id).filter((id) => id === this.cat || !this.catBtns.get(id).classList.contains('none'));
        const i = ids.indexOf(this.cat);
        this.setCat(ids[(i + (e.shiftKey ? -1 : 1) + ids.length) % ids.length]);
        break;
      }
    }
  }
}
