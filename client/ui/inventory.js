// Inventory / crafting screen (I). Equipment on the left (weapons, the armor and backpack worn, ammunition), the
// backpack grid in the centre, crafting on the right. The grid always has INVENTORY_MAX cells: the last
// BACKPACK_SLOTS of them are locked until a backpack is worn. (The car supplies are on the HUD's objective tracker
// and the map, not in here.)
import { usedIn, foundIn, sourcesOf } from '../game/itemguide.js';
import { ITEM, ITEM_DEFS, WEAPONS, RECIPES, AMMO_NAMES, AMMO_MAX, AMMO_ITEMS, SCHEM_BIT, STATION_NAMES, CONSUMABLES, THROWABLES, BURN, salvageOf } from '../../shared/defs.js';
import { INVENTORY_SIZE, INVENTORY_MAX, BACKPACK_SLOTS, inventoryCap } from '../../shared/constants.js';
import { WORN, WORN_DO } from '../../shared/protocol.js';
import { CRAFT_FEW, CRAFT_MAX, craftRun, copyInv } from '../game/bulkcraft.js';
import { el, svgEl, clamp, fmtTime, lsGet, lsSet } from './dom.js';
import { itemIcon, glyph } from './icons.js';
import { needLines } from '../game/harvest.js';

const SLOT_LABELS = ['Primary', 'Pistol', 'Melee', 'Throwable', 'Build tool'];
const CAT_LABEL = { res: 'Material', cons: 'Consumable', throw: 'Throwable', armor: 'Armor', pack: 'Backpack', gear: 'Gear', weapon: 'Weapon', ammo: 'Ammunition', part: 'Car supply', schem: 'Schematic' };
// Crafting tabs, left to right (Q / E step through them). 'all' lists every recipe under its tab's header.
// icon: item shown on the tab; cat: item category whose colour marks the tab (defaults to the id).
const CRAFT_TABS = [
  { id: 'all', label: 'All' },
  { id: 'weapon', label: 'Weapons', icon: ITEM.PISTOL },
  { id: 'ammo', label: 'Ammo', icon: ITEM.AMMO_SHELLS },
  { id: 'throw', label: 'Throwables', icon: ITEM.MOLOTOV },
  { id: 'armor', label: 'Armor', icon: ITEM.KEVLAR },
  { id: 'med', label: 'Medical', icon: ITEM.MEDKIT, cat: 'cons' },
  { id: 'util', label: 'Utility', icon: ITEM.ROPE, cat: 'res' },
];
const TAB_KEY = 'stn.craftTab';
const STATION_GLYPH = { fire: 'campfire', bench: 'wrench' };
// Bulk crafting: Shift+click a recipe for CRAFT_FEW, Ctrl+click for as many as the materials allow. On a Mac the
// second key is Cmd as well: there Ctrl+click is the context-menu gesture and the browser never sends the click
// (Ctrl still works, through that contextmenu event).
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || '');
const MAX_KEY = IS_MAC ? 'Cmd' : 'Ctrl';
// ms a craft counts as on its way to the server before it is given up on: two slow round trips
const SENT_TTL = 2500;

// Which tab a recipe's output belongs to. The hammer is a build tool rather than a weapon, the
// backpack is worn as armor is, and consumables split into medicine (anything that heals) and
// utility (torches, batteries), which shares a tab with the raw materials.
function craftTab(item) {
  const cat = ITEM_DEFS[item]?.cat;
  if (item === ITEM.HAMMER) return 'util';
  if (cat === 'pack') return 'armor';
  if (cat === 'cons') return CONSUMABLES[item]?.heal ? 'med' : 'util';
  return CRAFT_TABS.some((t) => t.id === cat) ? cat : 'util';
}

// order inside a tab: tools, then consumables, then materials (stable, so recipe order breaks ties)
const CAT_RANK = { weapon: 0, cons: 1 };
const craftRank = (r) => CAT_RANK[ITEM_DEFS[r.out]?.cat] ?? 2;

// ---------------------------------------------------------------- recipe search
// An item answers to its display name and its ITEM key, so "wood" finds Planks and "pipebomb" finds Pipe Bomb.
const ITEM_KEY = Object.fromEntries(Object.entries(ITEM).map(([k, v]) => [v, k]));
const norm = (s) => String(s).toLowerCase().replace(/[\s_-]+/g, ' ').trim();

// 5 exact · 4 whole word · 3 prefix · 2 word prefix · 1 substring (or every word somewhere) · 0 none
function termScore(text, q) {
  const t = norm(text);
  if (t === q) return 5;
  const padded = ' ' + t + ' ';
  if (padded.includes(' ' + q + ' ')) return 4;
  if (t.startsWith(q)) return 3;
  if (padded.includes(' ' + q)) return 2;
  if (t.includes(q) || (q.includes(' ') && q.split(' ').every((w) => t.includes(w)))) return 1;
  return 0;
}

const itemScore = (id, q) => Math.max(termScore(ITEM_DEFS[id]?.name || '', q), termScore(ITEM_KEY[id] || '', q));

// Recipes relevant to a search across every tab, as titled sections: recipes whose output matches by name
// (ranked above tab-label / station matches), the recipes for their craftable ingredients all the way down,
// ammo for matching guns, then recipes that consume (or are unlocked by) a matching item.
// recs = the screen's recipe entries ({ r, tab }) in 'All' order; sections hold those same entries.
function searchRecipes(query, recs) {
  const q = norm(query);
  if (!q) return [];
  const items = new Map(); // matching item id -> score
  for (const id of Object.keys(ITEM_DEFS)) {
    const s = itemScore(+id, q);
    if (s) items.set(+id, s);
  }
  const score = new Map();
  for (const rec of recs) {
    const { r } = rec;
    const n = items.get(r.out) || 0;
    const s = n ? 5 + n : Math.max(termScore(rec.tab.label, q), r.station ? termScore(STATION_NAMES[r.station], q) : 0);
    if (s) score.set(rec, s);
  }
  const results = recs.filter((rec) => score.has(rec)).sort((a, b) => score.get(b) - score.get(a));
  const shown = new Set(results);
  const take = (pred) => recs.filter((rec) => !shown.has(rec) && pred(rec.r)).map((rec) => (shown.add(rec), rec));

  const parts = [];
  const queue = results.filter((rec) => items.has(rec.r.out));
  while (queue.length) {
    const need = Object.keys(queue.shift().r.cost).map(Number);
    const more = take((r) => need.includes(r.out));
    parts.push(...more);
    queue.push(...more);
  }

  const calibers = new Set([...items.keys()].map((id) => WEAPONS[id]).filter((w) => w && !w.melee && w.ammo != null).map((w) => w.ammo));
  const ammo = take((r) => calibers.has(ITEM_DEFS[r.out].ammo));

  const via = new Set();
  const uses = take((r) => {
    const hit = [...Object.keys(r.cost).map(Number), r.schem].filter((id) => items.has(id));
    hit.forEach((id) => via.add(id));
    return hit.length > 0;
  });
  const names = [...via].map((id) => ITEM_DEFS[id].name);

  return [
    { title: 'Results', recs: results },
    { title: 'Ingredients', recs: parts },
    { title: 'Ammunition', recs: ammo },
    { title: names.length <= 2 ? 'Uses ' + names.join(' & ') : 'Uses matching items', recs: uses },
  ].filter((s) => s.recs.length);
}

function statLines(id) {
  const d = ITEM_DEFS[id];
  const out = [];
  const w = WEAPONS[id];
  if (w) {
    if (w.melee) out.push(`Damage ${w.damage}` + (w.altDamage !== w.damage ? ` · heavy ${w.altDamage}` : ''), `Swing ${w.rate.toFixed(2)}s`);
    else if (w.flame) out.push(`Fire ${Math.round(w.damage / w.rate)}/s · ${w.range}m`, `Tank ${w.mag} · ${AMMO_NAMES[w.ammo]}`, `Sets alight: ${BURN.dps}/s for ${BURN.time}s`);
    else out.push(`Damage ${w.damage}${w.pellets > 1 ? ' × ' + w.pellets : ''}`, `Magazine ${w.mag} · ${AMMO_NAMES[w.ammo]}`, w.quiet ? 'Single shot · near-silent' : w.auto ? 'Full-auto' : 'Semi-auto');
  }
  const c = CONSUMABLES[id];
  if (c) {
    if (c.heal) out.push(`Heals ${c.heal} HP`);
    if (c.stamina) out.push('Restores stamina');
    if (c.flashlight) out.push('Recharges flashlight');
    out.push(`Use time ${c.time}s`);
  }
  const t = THROWABLES[id];
  if (t) out.push(`Radius ${t.radius}m` + (t.damage ? ` · ${t.damage} dmg` : ` · burns ${t.burnTime}s`));
  if (d && d.cat === 'armor') out.push(`${d.armor} armor · absorbs ${Math.round(d.absorb * 100)}%`);
  if (d && d.cat === 'pack') out.push(`+${BACKPACK_SLOTS} backpack slots`);
  return out;
}

// '4 Leather · 6 Cloth · 2 Rope': a cost, or what salvage gives back, in a line
const costLine = (cost) => Object.entries(cost).map(([id, n]) => `${n} ${ITEM_DEFS[id].name}`).join(' · ');
const PACK_RECIPE = RECIPES.find((r) => r.out === ITEM.BACKPACK);
// the hint on a worn row: what a click does with it, and what salvaging it gives back
const wornHint = (item) => `LMB take off · RMB drop\nShift+LMB salvage for ${costLine(salvageOf(item) || {})}`;

// how much of an item an inventory ({ slots, weapons }) holds, wherever it is kept: backpack or a weapon slot
function carried(inv, item) {
  return inv.slots.reduce((n, s) => n + (s && s.item === item ? s.count : 0), inv.weapons.includes(item) ? 1 : 0);
}

function hintFor(cat) {
  if (cat === 'cons') return 'LMB use';
  if (cat === 'weapon' || cat === 'throw') return 'LMB equip';
  if (cat === 'armor' || cat === 'pack') return 'LMB wear';
  return '';
}

// ---------------------------------------------------------------- tooltip
// A comma-separated line that wraps between its names and never inside one. list = [{ name, locked }], or the line
// as text; locked: waits on a schematic, so it carries the crafting list's padlock. more: how many were left out.
function phrases(parent, list, more = 0) {
  if (typeof list === 'string') list = list.split(', ').map((name) => ({ name }));
  list.forEach((it, i) => {
    if (i) parent.append(' '); // the one place the line may break
    const s = el('span', 'tip-phrase' + (it.locked ? ' locked' : ''), parent);
    if (it.locked) svgEl('i', 'tip-note-lock', s, glyph('lock'));
    s.append(it.name + (i < list.length - 1 ? ',' : more ? ` +${more} more` : ''));
  });
}

class Tooltip {
  constructor(parent) {
    this.root = el('div', 'tip', parent);
    this.root.hidden = true;
    this.head = el('div', 'tip-head', this.root);
    this.ico = el('i', 'tip-ico', this.head);
    const t = el('div', 'tip-titles', this.head);
    this.name = el('div', 'tip-name', t);
    this.cat = el('div', 'tip-cat', t);
    this.desc = el('div', 'tip-desc', this.root);
    this.stats = el('div', 'tip-stats', this.root);
    this.notes = el('div', 'tip-notes', this.root);
    this.reqs = el('div', 'tip-reqs', this.root);
    this.hint = el('div', 'tip-hint', this.root);
    this.x = 0;
    this.y = 0;
  }

  // reqs = [{ icon, name, val, ok, src }] - a have/need checklist (recipes); src: where to get what is short
  // notes = [{ label, list, more }] - labelled lines ("Used in", "Found in"); list and more as phrases() takes them
  // anchor = the element the tooltip describes: move() keeps the tooltip from lying across it
  show({ icon, name, cat, catCls, desc, stats, notes, reqs, hint, hintCls, anchor }, x = this.x, y = this.y) {
    this.anchor = anchor;
    this.ico.innerHTML = icon || '';
    this.name.textContent = name || '';
    this.cat.textContent = cat || '';
    this.cat.className = 'tip-cat ' + (catCls || '');
    this.desc.textContent = desc || '';
    this.desc.hidden = !desc;
    this.stats.textContent = '';
    for (const s of stats || []) el('div', 'tip-stat', this.stats, s);
    this.stats.hidden = !(stats && stats.length);
    this.notes.textContent = '';
    for (const n of notes || []) {
      const row = el('div', 'tip-note', this.notes);
      el('div', 'tip-note-h', row, n.label);
      phrases(el('div', 'tip-note-v', row), n.list, n.more);
    }
    this.notes.hidden = !(notes && notes.length);
    this.reqs.textContent = '';
    if (reqs && reqs.length) {
      el('div', 'tip-reqs-h', this.reqs, 'Requires');
      for (const q of reqs) {
        const row = el('div', 'tip-req ' + (q.ok ? 'ok' : 'lack'), this.reqs);
        svgEl('i', 'tip-req-ico', row, q.icon);
        el('span', 'tip-req-name', row, q.name);
        el('span', 'tip-req-val', row, q.val);
        svgEl('i', 'tip-req-mark', row, glyph(q.ok ? 'check' : 'xmark'));
        if (q.src) phrases(el('div', 'tip-req-src', this.reqs), q.src);
      }
    }
    this.reqs.hidden = !(reqs && reqs.length);
    this.hint.textContent = '';
    for (const line of (hint || '').split('\n')) el('div', '', this.hint, line);
    this.hint.className = 'tip-hint' + (hintCls ? ' ' + hintCls : '');
    this.hint.hidden = !hint;
    this.root.hidden = false;
    this.move(x, y);
  }

  move(x, y) {
    this.x = x;
    this.y = y;
    const r = this.root.getBoundingClientRect();
    let px = x + 18;
    let py = y + 18;
    if (px + r.width > innerWidth - 8) px = x - r.width - 14;
    if (py + r.height > innerHeight - 8) {
      py = innerHeight - r.height - 8;
      // pushed up from the bottom edge it would lie across the very thing it describes: stand beside that instead
      const a = this.anchor?.getBoundingClientRect();
      if (a && py < a.bottom && px < a.right && px + r.width > a.left) px = a.right + 8 + r.width > innerWidth - 8 ? a.left - r.width - 8 : a.right + 8;
    }
    this.root.style.transform = `translate(${Math.max(8, px) | 0}px,${Math.max(8, py) | 0}px)`;
  }

  hide() {
    this.root.hidden = true;
  }
}

// ---------------------------------------------------------------- inventory screen
export class Inventory {
  constructor(ui, parent, tipParent) {
    this.ui = ui;
    this.open = false;
    this.inv = { slots: new Array(INVENTORY_MAX).fill(null), armor: null, backpack: 0, cap: INVENTORY_SIZE, ammo: AMMO_ITEMS.map(() => 0), weapons: [0, 0, 0, 0, 0], throwCounts: {} };
    this.counts = {};
    this.near = { fire: false, bench: false };
    this.unlocked = 0;
    this.tip = new Tooltip(tipParent);
    this.bulk = 0; // crafts a click on a recipe asks for while a bulk key is held (CRAFT_FEW / CRAFT_MAX); 0: none held
    this.keys = { few: false, max: false }; // bulk keys pressed since the screen opened
    this.sent = []; // crafts asked for that the server has not answered yet: { r, n, t, had }
    this.split = null; // the stack the split popover is open on, and how much of it is picked: { i, item, n }
    this.splitShut = -1; // the stack whose popover the press now going on has just put away

    const root = (this.root = el('div', 'inv', parent));
    root.hidden = true;
    const bg = el('div', 'inv-bg', root);
    const close = el('button', 'inv-close', root);
    close.type = 'button';
    close.title = 'Close inventory (I)';
    el('span', 'kbd sm', close, 'I');
    el('span', 'inv-close-t', close, 'Close');
    svgEl('i', 'inv-close-x', close, glyph('xmark'));
    close.addEventListener('click', () => this.ui.cb.onCloseInventory());
    const wrap = el('div', 'inv-wrap', root);

    // ---- left: equipment
    const left = el('section', 'inv-col inv-left paper', wrap);
    this._h(left, 'Equipment', 'RMB drop');
    const eqs = el('div', 'eq-list', left);
    this.eqEls = SLOT_LABELS.map((lab, i) => {
      const r = el('div', 'eq empty', eqs);
      r.dataset.slot = i;
      el('span', 'eq-key', r, String(i + 1));
      const ico = el('i', 'eq-ico', r);
      const txt = el('div', 'eq-txt', r);
      el('span', 'eq-lab', txt, lab);
      const name = el('span', 'eq-name', txt, 'Empty');
      const cnt = el('span', 'eq-cnt', r, '');
      return { r, ico, name, cnt, item: -1 };
    });
    this.throwAlt = el('div', 'eq-throws', left);

    // what is worn: armor, and under it the backpack (its pockets are the grid's last BACKPACK_SLOTS cells)
    this._h(left, 'Armor', 'RMB drop');
    const arm = (this.armEl = el('div', 'armor empty', left));
    this.armIco = el('i', 'arm-ico', arm);
    const at = el('div', 'arm-txt', arm);
    this.armName = el('span', 'arm-name', at, 'No armor');
    const ab = el('div', 'arm-bar', at);
    this.armFill = el('i', '', ab);
    this.armPts = el('span', 'arm-pts', arm, '');
    const pk = (this.packEl = el('div', 'armor pack empty', left));
    this.packIco = el('i', 'arm-ico', pk);
    const pt = el('div', 'arm-txt', pk);
    this.packName = el('span', 'arm-name', pt, 'No backpack');
    this.packSub = el('span', 'arm-sub', pt, '');
    this.packPts = el('span', 'arm-pts', pk, '');

    this._h(left, 'Ammunition', 'in pack');
    const ammo = el('div', 'ammo-list', left);
    this.ammoEls = AMMO_ITEMS.map((id, i) => {
      const r = el('div', 'am', ammo);
      svgEl('i', 'am-ico', r, itemIcon(id));
      el('span', 'am-name', r, AMMO_NAMES[i]);
      const bar = el('div', 'am-bar', r);
      const fill = el('i', '', bar);
      const n = el('span', 'am-n', r, '0');
      return { r, fill, n, v: -1 };
    });

    // ---- centre: backpack grid
    const mid = el('section', 'inv-col inv-mid', wrap);
    const gp = el('div', 'grid-wrap paper', mid);
    const gh = this._h(gp, 'Backpack');
    const ghr = el('span', 'inv-h-right', gh);
    // Sort: stacks merged, the grid ordered by kind (BAG_TIER), the server's to do
    const sort = (this.sortEl = el('button', 'inv-sort', ghr, 'Sort'));
    sort.type = 'button';
    sort.title = 'Merge stacks and order the backpack by kind';
    this.capEl = el('span', 'inv-cap', ghr, '0 / ' + INVENTORY_SIZE);
    this.grid = el('div', 'grid', gp);
    this.cells = [];
    for (let i = 0; i < INVENTORY_MAX; i++) {
      const c = el('div', 'cell empty', this.grid);
      c.dataset.i = i;
      const ico = el('i', 'cell-ico', c);
      const n = el('span', 'cell-n', c, '');
      this.cells.push({ c, ico, n, key: '' });
    }
    const hints = el('div', 'grid-hints', gp);
    for (const [k, t] of [
      ['LMB', 'use / equip'],
      ['Shift+LMB', 'split / drop some'],
      ['RMB', 'drop stack'],
      ['Shift+RMB', 'drop one'],
      ['Drag', 'move · drag out to drop'],
    ]) {
      const s = el('span', 'gh', hints);
      el('span', 'kbd sm', s, k);
      el('span', '', s, t);
    }

    // ---- right: crafting
    const right = el('section', 'inv-col inv-right paper', wrap);
    const ch = this._h(right, 'Crafting');
    this.stationEl = el('span', 'station', ch);
    this.stationIco = svgEl('i', 'st-ico', this.stationEl, glyph('campfire'));
    this.stationTxt = el('span', '', this.stationEl, '');
    // search sits above the tabs: while it holds a query it covers every tab, and the tabs step back
    const find = (this.findEl = el('label', 'craft-find', right));
    svgEl('i', 'cf-ico', find, glyph('search'));
    const field = (this.findInput = el('input', 'cf-field', find));
    field.type = 'text';
    field.maxLength = 40;
    field.autocomplete = 'off';
    field.spellcheck = false;
    field.placeholder = 'Search all recipes';
    field.setAttribute('aria-label', 'Search recipes');
    const clr = (this.findClear = svgEl('button', 'cf-clear', find, glyph('xmark')));
    clr.type = 'button';
    clr.hidden = true;
    clr.title = 'Clear search (Esc)';
    clr.setAttribute('aria-label', 'Clear search');
    const tabBar = (this.tabBar = el('div', 'craft-tabs', right));
    el('span', 'kbd sm ct-key', tabBar, 'Q');
    const list = (this.craftList = el('div', 'craft-list', right));
    this.recipeEls = [];
    this.tabs = [];
    for (const t of CRAFT_TABS) {
      const recs = t.id === 'all' ? null : RECIPES.filter((r) => craftTab(r.out) === t.id).sort((a, b) => craftRank(a) - craftRank(b));
      if (recs && !recs.length) continue;
      const tb = el('button', 'ct c-' + (t.cat || t.id), tabBar);
      tb.type = 'button';
      tb.dataset.tab = t.id;
      svgEl('i', 'ct-ico', tb, t.icon ? itemIcon(t.icon) : glyph('grid'));
      el('span', 'ct-lab', tb, t.label);
      const tab = { id: t.id, label: t.label, b: tb, n: el('span', 'ct-n', tb), ready: -1, head: null, grid: null, recs: [] };
      this.tabs.push(tab);
      if (!recs) continue;
      tab.head = el('div', 'craft-group', list, t.label);
      const gg = (tab.grid = el('div', 'craft-grid', list));
      for (const r of recs) {
        const b = el('button', 'rc', gg);
        b.type = 'button';
        b.dataset.id = r.id;
        svgEl('i', 'rc-ico', b, itemIcon(r.out));
        const main = el('div', 'rc-main', b);
        const nm = el('div', 'rc-name', main, ITEM_DEFS[r.out].name);
        if (r.n > 1) el('span', 'rc-n', nm, '×' + r.n);
        const cost = el('div', 'rc-cost', main);
        const ings = Object.entries(r.cost).map(([id, need]) => {
          const chip = el('span', 'ing', cost);
          chip.title = ITEM_DEFS[id]?.name || '';
          svgEl('i', 'ing-ico', chip, itemIcon(+id));
          const t = el('span', 'ing-t', chip, '0/' + need);
          return { id: +id, need, chip, t, key: '' };
        });
        let st = null;
        if (r.station) {
          st = svgEl('i', 'rc-station st-' + r.station, b, glyph(STATION_GLYPH[r.station]));
          st.title = r.station === 'fire' ? 'Requires a lit campfire nearby' : 'Requires a workbench nearby';
        }
        let lock = null;
        if (r.schem) {
          lock = svgEl('i', 'rc-lock', b, glyph('lock'));
          lock.title = `Needs the ${ITEM_DEFS[r.schem].name}`;
        }
        // what a click would add while a bulk key is held (_renderBulk)
        const bulk = el('span', 'rc-bulk', b);
        bulk.hidden = true;
        const rec = { r, tab, b, ings, st, lock, bulk, bulkTxt: '', key: '' };
        this.recipeEls.push(rec);
        tab.recs.push(rec);
      }
    }
    el('span', 'kbd sm ct-key', tabBar, 'E');
    // search results: the same recipe buttons, moved into relevance sections while a search is active
    this.findView = el('div', 'craft-found', list);
    this.findView.hidden = true;
    // the bulk keys, spelled out under the list: nobody finds a modifier click by hovering
    const keys = el('div', 'grid-hints craft-hints', right);
    for (const [k, t] of [
      ['LMB', 'craft'],
      ['Shift+LMB', `craft ${CRAFT_FEW}`],
      [MAX_KEY + '+LMB', `craft up to ${CRAFT_MAX}`],
    ]) {
      const s = el('span', 'gh', keys);
      el('span', 'kbd sm', s, k);
      el('span', '', s, t);
    }

    // ---- split popover (Shift+LMB on a stack): how much of it to put in a slot of its own, or down on the ground
    // for a teammate
    const sp = (this.splitEl = el('div', 'split', root));
    sp.hidden = true;
    const sh = el('div', 'split-head', sp);
    this.splitIco = el('i', 'split-ico', sh);
    this.splitName = el('span', 'split-name', sh);
    this.splitOf = el('span', 'split-of', sh);
    const splitX = svgEl('button', 'btn-icon split-x', sh, glyph('xmark'));
    splitX.type = 'button';
    splitX.title = 'Close (Esc)';
    splitX.addEventListener('click', () => this._closeSplit());
    const sr = el('div', 'split-row', sp);
    const range = (this.splitRange = el('input', 'set-range split-range', sr));
    range.type = 'range';
    range.min = 1;
    range.step = 1;
    range.setAttribute('aria-label', 'How many');
    const num = (this.splitNum = el('input', 'split-num', sr));
    num.type = 'text';
    num.inputMode = 'numeric';
    num.maxLength = 4;
    num.autocomplete = 'off';
    num.setAttribute('aria-label', 'How many');
    const sb = el('div', 'split-btns', sp);
    this.splitDrop = el('button', 'btn split-b', sb, 'Drop');
    this.splitDrop.type = 'button';
    this.splitKeep = el('button', 'btn split-b', sb, 'Split');
    this.splitKeep.type = 'button';
    this.splitNote = el('div', 'split-note', sp);

    this._bind(root, wrap, bg);
    this._setTab(lsGet(TAB_KEY, 'all'));
    this._renderAll();
  }

  _h(parent, title, aside) {
    const h = el('h3', 'inv-h', parent);
    el('span', 'inv-h-t', h, title);
    if (aside) el('span', 'inv-h-aside', h, aside);
    return h;
  }

  // ------------------------------------------------------------ input
  _bind(root, wrap, bg) {
    const cb = this.ui.cb;
    root.addEventListener('contextmenu', (e) => e.preventDefault());

    // backpack grid
    this.grid.addEventListener('pointerdown', (e) => {
      const cell = e.target.closest('.cell');
      if (!cell) return;
      const i = +cell.dataset.i;
      const s = this.inv.slots[i];
      if (!s) return;
      if (e.button === 0) {
        e.preventDefault();
        this.drag = { i, x: e.clientX, y: e.clientY, started: false, shut: this.splitShut === i };
      } else if (e.button === 2) {
        e.preventDefault();
        this.ui.sound('ui_click');
        cb.onDropItem(i, e.shiftKey ? 1 : 0);
      }
    });
    this._move = (e) => {
      const d = this.drag;
      if (d) {
        if (!d.started && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) this._startDrag(d);
        if (d.started) {
          this.ghost.style.transform = `translate(${e.clientX}px,${e.clientY}px) translate(-50%,-50%)`;
          const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.cell:not(.locked)');
          const oi = over ? +over.dataset.i : -1;
          if (d.over !== oi) {
            if (d.over >= 0) this.cells[d.over].c.classList.remove('drop-t');
            d.over = oi;
            if (oi >= 0 && oi !== d.i) this.cells[oi].c.classList.add('drop-t');
          }
          const outside = !document.elementFromPoint(e.clientX, e.clientY)?.closest('.inv-col');
          this.ghost.classList.toggle('dropping', outside);
        }
      } else if (this.tipTarget) this.tip.move(e.clientX, e.clientY);
    };
    this._up = (e) => {
      const d = this.drag;
      if (!d || e.button !== 0) return;
      this.drag = null;
      if (d.started) {
        this.ghost.remove();
        this.ghost = null;
        this.cells[d.i].c.classList.remove('dragging');
        if (d.over >= 0) this.cells[d.over].c.classList.remove('drop-t');
        const t = document.elementFromPoint(e.clientX, e.clientY);
        const over = t?.closest('.cell');
        if (over) {
          const b = +over.dataset.i;
          // (a locked cell takes nothing: let go over one, the stack stays where it was)
          if (b !== d.i && b < this.inv.cap) {
            this.ui.sound('ui_click');
            cb.onSwapItems(d.i, b);
            // optimistic local swap (server state will overwrite on the next setInventory)
            const sl = this.inv.slots;
            [sl[d.i], sl[b]] = [sl[b], sl[d.i]];
            this._renderCell(d.i);
            this._renderCell(b);
          }
        } else if (!t?.closest('.inv-col')) {
          this.ui.sound('ui_click');
          cb.onDropItem(d.i, 0);
        }
      } else if (e.shiftKey) {
        // (not on the stack it was open on: that click only put it away. And a single item has nothing to split:
        // the click must not use it instead)
        if (!d.shut) this._openSplit(d.i);
      } else {
        this._useSlot(d.i);
      }
    };
    window.addEventListener('pointermove', this._move);
    window.addEventListener('pointerup', this._up);

    // tooltips
    wrap.addEventListener('pointerover', (e) => {
      if (this.drag?.started || this.split) return;
      const t = e.target.closest('.cell, .eq, .rc, .armor, .am');
      if (t === this.tipTarget) return;
      this.tipTarget = t;
      if (!t) return this.tip.hide();
      const info = this._tipInfo(t);
      if (info) this.tip.show(info, e.clientX, e.clientY);
      else this.tip.hide();
    });
    wrap.addEventListener('pointerleave', () => {
      this.tipTarget = null;
      this.tip.hide();
    });

    // split popover. A press anywhere else puts it away, and goes on to do whatever it does there (captured: the
    // grid's own handler comes after, and must find it closed)
    root.addEventListener(
      'pointerdown',
      (e) => {
        this.splitShut = -1;
        if (!this.split || this.splitEl.contains(e.target)) return;
        this.splitShut = this.split.i;
        this._closeSplit();
      },
      true,
    );
    // a left press on the backdrop (around the panels, or in the gaps between them) closes the screen. Not the press
    // that has just put the split popover away: that one only closes the popover
    root.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.splitShut >= 0) return;
      if (e.target === bg || e.target === wrap || e.target === root) this.ui.cb.onCloseInventory();
    });
    this.splitRange.addEventListener('input', () => this._setSplit(+this.splitRange.value));
    this.splitNum.addEventListener('input', () => {
      const digits = this.splitNum.value.replace(/\D/g, '');
      if (digits !== this.splitNum.value) this.splitNum.value = digits;
      this._setSplit(+digits, true);
    });
    this.splitNum.addEventListener('change', () => this.split && this._setSplit(this.split.n));
    // (the whole number selected, so that typing replaces it; after the click that gave the focus has placed its caret)
    this.splitNum.addEventListener('focus', () => setTimeout(() => this.splitNum.select()));
    this.splitDrop.addEventListener('click', () => this._doSplit(true));
    this.splitKeep.addEventListener('click', () => this._doSplit(false));
    // Enter splits, Escape puts it away. Captured, so that neither reaches the game (the chat, the pause menu)
    this._splitKey = (e) => {
      if (!this.split || (e.key !== 'Enter' && e.key !== 'Escape')) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') this._closeSplit();
      else if (!e.repeat) this._doSplit(false);
    };
    window.addEventListener('keydown', this._splitKey, true);

    this.sortEl.addEventListener('click', () => {
      this._closeSplit(); // (its stack is about to move)
      this.sortEl.blur(); // (or Space, the jump key, would press it again once the screen is shut)
      this.ui.sound('ui_click');
      cb.onSortItems();
    });

    // worn gear: LMB takes it off into the grid, RMB drops it, Shift+LMB salvages it (the server refuses the
    // backpack while its pockets hold anything, and says so)
    for (const [row, which] of [[this.armEl, WORN.ARMOR], [this.packEl, WORN.BACKPACK]]) {
      row.addEventListener('pointerdown', (e) => {
        const on = which === WORN.ARMOR ? !!this.inv.armor : !!this.inv.backpack;
        if (!on || (e.button !== 0 && e.button !== 2)) return;
        e.preventDefault();
        this.ui.sound('ui_click');
        cb.onWorn(which, e.button === 2 ? WORN_DO.DROP : e.shiftKey ? WORN_DO.SALVAGE : WORN_DO.OFF);
      });
    }

    // equipment: RMB drops the weapon
    this.eqEls.forEach((q, slot) => {
      q.r.addEventListener('pointerdown', (e) => {
        if (e.button === 2 && q.item > 0) {
          e.preventDefault();
          this.ui.sound('ui_click');
          cb.onDropWeapon(slot);
        }
      });
    });
    this.throwAlt.addEventListener('click', (e) => {
      const b = e.target.closest('.tw');
      if (b) {
        this.ui.sound('ui_click');
        cb.onSelectThrowable(+b.dataset.item);
      }
    });

    // crafting tabs: click, or Q / E to step through them while the screen is open. While a search is
    // active the tabs are dimmed; picking one (or stepping with Q / E) clears the search and opens it.
    this.tabBar.addEventListener('click', (e) => {
      const b = e.target.closest('.ct');
      if (!b || (b.dataset.tab === this.tab && !this.searching)) return;
      this.ui.sound('ui_click');
      this._setTab(b.dataset.tab);
    });
    // never fires from the search field: it stops its own keydowns, and isTyping() counts it as well
    this._key = (e) => {
      if (!this.open || e.repeat || e.ctrlKey || e.metaKey || e.altKey || this.ui.isTyping()) return;
      const dir = e.code === 'KeyQ' ? -1 : e.code === 'KeyE' ? 1 : 0;
      if (!dir) return;
      e.preventDefault();
      const n = this.tabs.length;
      const i = this.tabs.findIndex((t) => t.id === this.tab);
      this.ui.sound('ui_click');
      this._setTab(this.tabs[(i + dir + n) % n].id);
    };
    window.addEventListener('keydown', this._key);

    // crafting search. Keydown is consumed so the game (and Q / E above) never sees keys typed here -
    // except Tab, which drops focus (so that I closes the inventory again) and falls through to the player list.
    const field = this.findInput;
    field.addEventListener('input', () => this._showRecipes());
    field.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        return field.blur();
      }
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        if (field.value) this.clearSearch();
        else field.blur();
      }
    });
    this.findClear.addEventListener('click', () => {
      this.ui.sound('ui_click');
      this.clearSearch();
      field.focus({ preventScroll: true });
    });
    this.findView.addEventListener('click', (e) => {
      if (e.target.closest('.cf-reset')) this.clearSearch();
    });

    // crafting. With a bulk key held a click is that many crafts - as many of them as the server will take
    // (_bulkRun), sent as the ordinary craft and its repeats. None at all (no room for the output) is refused
    // here, with the same shake as a recipe that cannot be made.
    this.craftList.addEventListener('click', (e) => {
      const b = e.target.closest('.rc');
      if (!b) return;
      const rec = this.recipeEls.find((x) => x.b === b);
      if (!rec) return;
      const model = this._model();
      const n = this.bulk ? this._bulkRun(rec.r, model).n : 1;
      if (b.classList.contains('ok') && n) {
        this.ui.sound('ui_click');
        cb.onCraft(rec.r.id);
        if (n > 1) cb.onCraftRepeat(rec.r.id, n - 1);
        this.sent.push({ r: rec.r, n, t: performance.now(), had: carried(model, rec.r.out) });
        if (this.bulk) this._renderBulk();
        b.getAnimations().forEach((a) => a.cancel());
        b.animate([{ background: 'rgba(228,220,203,.22)' }, { background: 'rgba(228,220,203,0)' }], { duration: 380 });
      } else {
        b.getAnimations().forEach((a) => a.cancel());
        b.animate(
          [{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(-2px)' }, { transform: 'translateX(0)' }],
          { duration: 260 },
        );
      }
    });
    // macOS: Ctrl+click asks for the context menu and no click follows. The key is down (this.bulk), so make it one
    this.craftList.addEventListener('contextmenu', (e) => {
      if (IS_MAC && e.button === 0 && e.ctrlKey) e.target.closest('.rc')?.click();
    });
    // The bulk keys. They are also sprint and crouch, and may still be down from the game when the screen opens:
    // only a press made while it is open counts, so a click with a leftover key stays a single craft. Captured,
    // or the search field would keep its keydowns to itself.
    this._bulkKey = (e) => {
      const k = e.key === 'Shift' ? 'few' : e.key === 'Control' || (IS_MAC && e.key === 'Meta') ? 'max' : '';
      if (!k || e.repeat || (e.type === 'keydown' && !this.open)) return;
      this.keys[k] = e.type === 'keydown';
      this._setBulk();
    };
    window.addEventListener('keydown', this._bulkKey, true);
    window.addEventListener('keyup', this._bulkKey, true);
    // (a key released while another window had the focus never reports its keyup)
    window.addEventListener('blur', () => this._dropBulk());
  }

  _dropBulk() {
    this.keys.few = this.keys.max = false;
    this._setBulk();
  }

  _setBulk() {
    const n = this.keys.max ? CRAFT_MAX : this.keys.few ? CRAFT_FEW : 0;
    if (n === this.bulk) return;
    this.bulk = n;
    this._renderBulk();
    this._refreshTip();
  }

  // an open recipe tooltip, redrawn
  _refreshTip() {
    if (!this.tipTarget?.classList.contains('rc') || this.tip.root.hidden) return;
    const info = this._tipInfo(this.tipTarget);
    if (info) this.tip.show(info);
  }

  // The inventory as it will be once the crafts on their way to the server are answered: counting on what the
  // server last sent would offer the same materials twice to a second click that lands before the answer (a
  // double-click does). A craft is answered when there is more of its output than there was (the inventory
  // message) - or it never is, and is given up on after SENT_TTL.
  _model() {
    const now = performance.now();
    this.sent = this.sent.filter((e) => now - e.t < SENT_TTL && carried(this.inv, e.r.out) <= e.had);
    const inv = copyInv(this.inv);
    for (const e of this.sent) craftRun(e.r, inv, e.n);
    return inv;
  }

  // What a click on a recipe makes now, with a bulk key held: n crafts - what the key asks for, less what the
  // materials or the backpack stop short of. full: it is room, not materials, that stops the next.
  _bulkRun(r, model = this._model()) {
    const inv = copyInv(model);
    const n = craftRun(r, inv, this.bulk);
    // (`inv` is as the last craft left it)
    return { n, full: n < this.bulk && Object.keys(r.cost).every((id) => carried(inv, +id) >= r.cost[id]) };
  }

  // tooltip hint of a recipe that can be made, as [text, class]
  _craftHint(r) {
    if (!this.bulk) return [`Click to craft\nShift+click to craft ${CRAFT_FEW} · ${MAX_KEY}+click up to ${CRAFT_MAX}`, ''];
    const { n, full } = this._bulkRun(r);
    if (!n) return [full ? 'No room in the backpack' : 'The materials are spoken for', 'bad'];
    const made = `Click to craft ${ITEM_DEFS[r.out].name} ×${n * r.n}`;
    return [n === this.bulk ? made : `${made}\nThat is all ${full ? 'the backpack has room for' : 'the materials make'}`, ''];
  }

  // The count on every recipe that can be made, while a bulk key is held: the items a click would add, or 'full'
  // when there is no room for even one more craft's worth.
  _renderBulk() {
    const on = this.open && this.bulk > 0;
    const model = on ? this._model() : null;
    for (const rec of this.recipeEls) {
      const { n, full } = on && rec.b.classList.contains('ok') ? this._bulkRun(rec.r, model) : { n: 0, full: false };
      const txt = n ? '+' + n * rec.r.n : full ? 'full' : '';
      if (rec.bulkTxt === txt) continue;
      rec.bulkTxt = txt;
      rec.bulk.textContent = txt;
      rec.bulk.hidden = !txt;
      rec.bulk.classList.toggle('none', !n);
    }
  }

  _startDrag(d) {
    d.started = true;
    d.over = -1;
    this.tip.hide();
    this.tipTarget = null;
    const s = this.inv.slots[d.i];
    this.ghost = svgEl('div', 'drag-ghost', this.ui.root, itemIcon(s.item));
    if (s.count > 1) el('span', 'cell-n', this.ghost, String(s.count));
    this.cells[d.i].c.classList.add('dragging');
  }

  // The split popover, on stack i: half of it picked to begin with. It sits above the stack, or below when there
  // is no room there, and inside the screen either way.
  _openSplit(i) {
    const s = this.inv.slots[i];
    if (!s || s.count < 2) return;
    this._closeSplit();
    this.tip.hide();
    this.tipTarget = null;
    this.split = { i, item: s.item, n: s.count >> 1 };
    this.splitIco.innerHTML = itemIcon(s.item);
    this.splitName.textContent = ITEM_DEFS[s.item]?.name || '';
    this.splitEl.hidden = false;
    this.cells[i].c.classList.add('splitting');
    this._syncSplit();
    const c = this.cells[i].c.getBoundingClientRect();
    const o = this.root.getBoundingClientRect();
    const r = this.splitEl.getBoundingClientRect();
    const x = clamp(c.left + c.width / 2 - r.width / 2, o.left + 8, o.right - r.width - 8);
    const y = c.top - r.height - 8 >= o.top + 8 ? c.top - r.height - 8 : c.bottom + 8;
    this.splitEl.style.transform = `translate(${Math.round(x - o.left)}px,${Math.round(y - o.top)}px)`;
    this.splitRange.focus({ preventScroll: true });
  }

  // the popover against its stack as the server last left it: put away when the stack is gone (or down to one),
  // and never picking more than it holds
  _syncSplit() {
    const sp = this.split;
    if (!sp) return;
    const s = this.inv.slots[sp.i];
    if (!s || s.item !== sp.item || s.count < 2) return this._closeSplit();
    this.splitRange.max = s.count;
    this.splitOf.textContent = 'of ' + s.count;
    this._setSplit(sp.n);
  }

  // typed: it came from the number field, whose text is left as it was typed
  _setSplit(n, typed = false) {
    const sp = this.split;
    if (!sp) return;
    const max = this.inv.slots[sp.i].count;
    const free = this.inv.slots.some((s, i) => !s && i < this.inv.cap);
    sp.n = clamp(n | 0, 1, max);
    this.splitRange.value = sp.n;
    this.splitRange.style.setProperty('--p', (((sp.n - 1) / (max - 1)) * 100).toFixed(1) + '%');
    if (!typed) this.splitNum.value = String(sp.n);
    this.splitDrop.textContent = 'Drop ' + sp.n;
    this.splitKeep.textContent = 'Split ' + sp.n;
    // nothing to split off a stack taken whole, and nowhere to put it with every slot taken
    this.splitKeep.disabled = sp.n >= max || !free;
    this.splitNote.textContent = sp.n >= max ? 'The whole stack: it can only be dropped' : free ? '' : 'No free slot to split into';
  }

  // drop: the amount picked goes on the ground; else into a free slot of its own
  _doSplit(drop) {
    const sp = this.split;
    if (!sp || (!drop && this.splitKeep.disabled)) return;
    this.ui.sound('ui_click');
    if (drop) this.ui.cb.onDropItem(sp.i, sp.n);
    else this.ui.cb.onSplitItem(sp.i, sp.n);
    this._closeSplit();
  }

  _closeSplit() {
    if (!this.split) return;
    this.cells[this.split.i].c.classList.remove('splitting');
    this.split = null;
    this.splitEl.hidden = true;
    // (a focused number field would keep ui.isTyping() true and swallow gameplay keys)
    if (this.splitEl.contains(document.activeElement)) document.activeElement.blur();
  }

  _useSlot(i) {
    const s = this.inv.slots[i];
    if (!s) return;
    const cat = ITEM_DEFS[s.item]?.cat;
    const cb = this.ui.cb;
    if (cat === 'armor' || cat === 'pack') {
      this.ui.sound('ui_click');
      cb.onEquipArmor(i);
    } else if (cat === 'cons' || cat === 'weapon' || cat === 'throw') {
      this.ui.sound('ui_click');
      cb.onUseItem(i);
    } else {
      const c = this.cells[i].c;
      c.getAnimations().forEach((a) => a.cancel());
      c.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'translateX(0)' }], { duration: 200 });
    }
  }

  _tipInfo(t) {
    let id = 0;
    let hint = '';
    let hintCls = '';
    let extra = null;
    let reqs = null;
    if (t.classList.contains('cell') && t.classList.contains('locked')) {
      // a pocket of the backpack nobody is wearing: what opens it, and how to make one
      return { icon: glyph('lock'), name: 'Unlocks with a backpack', cat: 'Locked slot', catCls: 'c-pack', desc: `Craft one at a workbench: ${costLine(PACK_RECIPE.cost)}`, anchor: t };
    }
    if (t.classList.contains('cell')) {
      const s = this.inv.slots[+t.dataset.i];
      if (!s) return null;
      id = s.item;
      const h = hintFor(ITEM_DEFS[id]?.cat);
      hint = (h ? h + ' · ' : '') + 'RMB drop · Shift+RMB drop one' + (s.count > 1 ? '\nShift+LMB split, or drop some' : '');
    } else if (t.classList.contains('eq')) {
      const q = this.eqEls[+t.dataset.slot];
      if (!(q.item > 0)) return null;
      id = q.item;
      hint = 'RMB drop';
    } else if (t === this.packEl) {
      if (!this.inv.backpack) return null;
      id = this.inv.backpack;
      const used = this.inv.slots.filter((x, i) => x && i >= INVENTORY_SIZE).length;
      extra = [`${used} / ${BACKPACK_SLOTS} of its slots in use`];
      if (used) [hint, hintCls] = ['Empty its extra slots to take it off', 'bad'];
      else hint = wornHint(id);
    } else if (t.classList.contains('armor')) {
      if (!this.inv.armor) return null;
      id = this.inv.armor.item;
      extra = [`${Math.ceil(this.inv.armor.points)} / ${this.inv.armor.max} armor remaining`];
      hint = wornHint(id);
    } else if (t.classList.contains('rc')) {
      const rec = this.recipeEls.find((x) => x.b === t);
      if (!rec) return null;
      const { r } = rec;
      id = r.out;
      reqs = [];
      for (const ing of rec.ings) {
        const have = this.counts[ing.id] || 0;
        const ok = have >= ing.need;
        const nm = ITEM_DEFS[ing.id].name;
        reqs.push({ icon: itemIcon(ing.id), name: nm, val: Math.min(have, 999) + ' / ' + ing.need, ok });
      }
      const st = r.station;
      const stationOk = !st || this.near[st];
      if (st) reqs.push({ icon: glyph(STATION_GLYPH[st]), name: st === 'fire' ? 'Lit campfire' : STATION_NAMES[st], val: stationOk ? 'nearby' : 'not nearby', ok: stationOk });
      const unlocked = !r.schem || this._schemOk(r.schem);
      if (r.schem) reqs.push({ icon: glyph(unlocked ? 'unlock' : 'lock'), name: ITEM_DEFS[r.schem].name, val: unlocked ? 'found' : 'not found', ok: unlocked });
      const todo = needLines(r.cost, this.counts); // what is short, and where it comes from
      if (!stationOk) todo.push(`Build a ${STATION_NAMES[st].toLowerCase()} [5] or find one`);
      if (!unlocked) todo.push('Find the schematic in lockers, crates or toolboxes');
      hint = todo.length ? todo.join('\n') : 'Click to craft';
      if (todo.length) hintCls = 'bad';
      // it can be made: name the bulk keys, or - with one of them held - say what the click will make
      if (!todo.length) [hint, hintCls] = this._craftHint(r);
    } else if (t.classList.contains('am')) {
      id = AMMO_ITEMS[this.ammoEls.findIndex((a) => a.r === t)];
    }
    const d = ITEM_DEFS[id];
    if (!d) return null;
    // Something carried (a backpack cell, an ammo reserve): what it goes into and where more of it is found. A
    // line with nothing to say is left out, and "Found in" is for what the world yields: a thing that is only
    // ever crafted has its recipe next door.
    const notes = [];
    if (t.classList.contains('cell') || t.classList.contains('am')) {
      const used = usedIn(id, this.unlocked);
      if (used) notes.push({ label: 'Used in', ...used });
      if (sourcesOf(id).length) notes.push({ label: 'Found in', list: foundIn(id, this.unlocked) });
    }
    // A recipe: under each ingredient the player is short of, the same line (reqs opens with the ingredients, in
    // the recipe's order).
    if (t.classList.contains('rc')) {
      const ings = this.recipeEls.find((x) => x.b === t).ings;
      ings.forEach((ing, i) => {
        if (!reqs[i].ok) reqs[i].src = foundIn(ing.id, this.unlocked);
      });
    }
    return {
      icon: itemIcon(id),
      name: d.name,
      cat: CAT_LABEL[d.cat] || '',
      catCls: 'c-' + d.cat,
      desc: d.desc,
      stats: [...statLines(id), ...(extra || [])],
      notes,
      reqs,
      hint,
      hintCls,
      anchor: t,
    };
  }

  // ------------------------------------------------------------ data
  set(inv) {
    if (!inv) return;
    const slots = inv.slots || [];
    this.inv = {
      slots: Array.from({ length: INVENTORY_MAX }, (_, i) => (slots[i] && slots[i].item ? { item: slots[i].item, count: slots[i].count | 0 } : null)),
      armor: inv.armor && inv.armor.item ? inv.armor : null,
      backpack: inv.backpack | 0,
      cap: inventoryCap(inv.backpack),
      ammo: inv.ammo || AMMO_ITEMS.map(() => 0),
      weapons: inv.weapons || [0, 0, 0, 0, 0],
      throwCounts: inv.throwCounts || {},
    };
    this.counts = {};
    for (const s of this.inv.slots) if (s) this.counts[s.item] = (this.counts[s.item] || 0) + s.count;
    this._renderAll();
    this._syncSplit();
  }

  _renderAll() {
    for (let i = 0; i < INVENTORY_MAX; i++) this._renderCell(i);
    const used = this.inv.slots.filter(Boolean).length;
    const capKey = used + '/' + this.inv.cap;
    if (this._capKey !== capKey) {
      this._capKey = capKey;
      this.capEl.textContent = used + ' / ' + this.inv.cap;
      this.capEl.classList.toggle('full', used >= this.inv.cap);
    }

    // equipment
    const w = this.inv.weapons;
    const tc = this.inv.throwCounts || {};
    this.eqEls.forEach((q, i) => {
      const id = w[i] | 0;
      if (q.item !== id) {
        q.item = id;
        q.r.classList.toggle('empty', !id);
        q.ico.innerHTML = id ? itemIcon(id) : '';
        q.name.textContent = id ? ITEM_DEFS[id]?.name || '?' : 'Empty';
      }
      const cnt = i === 3 && id && tc[id] > 0 ? '×' + tc[id] : '';
      if (q.cntTxt !== cnt) q.cnt.textContent = q.cntTxt = cnt;
    });
    // other throwables to switch to
    const throws = Object.entries(tc).filter(([, n]) => n > 0);
    const twKey = (w[3] | 0) + ':' + throws.map((t) => t.join('x')).join(',');
    if (this._twKey !== twKey) {
      this._twKey = twKey;
      this._renderThrows(throws, w[3] | 0);
    }

    // armor
    const a = this.inv.armor;
    const armKey = a ? a.item + ':' + Math.ceil(a.points) + ':' + a.max : '';
    if (this._armKey !== armKey) {
      this._armKey = armKey;
      this._renderArmor(a);
    }
    const pack = this.inv.backpack;
    const packKey = pack + ':' + used;
    if (this._packKey !== packKey) {
      this._packKey = packKey;
      this._renderPack(pack);
    }

    // ammo
    this.ammoEls.forEach((q, i) => {
      const v = this.inv.ammo[i] | 0;
      if (q.v !== v) {
        q.v = v;
        q.n.textContent = String(v);
        q.fill.style.transform = `scaleX(${clamp(v / AMMO_MAX[i], 0, 1)})`;
        q.r.classList.toggle('zero', v === 0);
      }
    });

    this._renderRecipes();
  }

  _renderThrows(throws, cur) {
    this.throwAlt.textContent = '';
    if (throws.length > 1 || (throws.length === 1 && +throws[0][0] !== cur)) {
      for (const [id, n] of throws) {
        const b = el('button', 'tw' + (+id === cur ? ' on' : ''), this.throwAlt);
        b.type = 'button';
        b.dataset.item = id;
        b.title = 'Select ' + ITEM_DEFS[id]?.name;
        svgEl('i', 'tw-ico', b, itemIcon(+id));
        el('span', 'tw-n', b, '×' + n);
      }
    }
  }

  _renderArmor(a) {
    this.armEl.classList.toggle('empty', !a);
    if (a) {
      this.armIco.innerHTML = itemIcon(a.item);
      this.armName.textContent = ITEM_DEFS[a.item]?.name || 'Armor';
      const r = clamp(a.points / (a.max || 1), 0, 1);
      this.armFill.style.transform = `scaleX(${r})`;
      this.armPts.textContent = Math.ceil(a.points) + '/' + a.max;
    } else {
      this.armIco.innerHTML = glyph('shield');
      this.armName.textContent = 'No armor';
      this.armFill.style.transform = 'scaleX(0)';
      this.armPts.textContent = '';
    }
  }

  // the backpack worn, under the armor: what it adds, and how many of its slots are taken
  _renderPack(item) {
    this.packEl.classList.toggle('empty', !item);
    this.packIco.innerHTML = itemIcon(ITEM.BACKPACK);
    this.packName.textContent = item ? ITEM_DEFS[item]?.name || 'Backpack' : 'No backpack';
    this.packSub.textContent = item ? `+${BACKPACK_SLOTS} slots` : 'Craft one at a workbench';
    this.packPts.textContent = item ? this.inv.slots.filter((x, i) => x && i >= INVENTORY_SIZE).length + '/' + BACKPACK_SLOTS : '';
  }

  _renderCell(i) {
    const s = this.inv.slots[i];
    const cell = this.cells[i];
    const locked = i >= this.inv.cap; // (and so empty: nothing is ever put in one)
    const key = locked ? 'locked' : s ? s.item + ':' + s.count : '';
    if (cell.key === key) return;
    cell.key = key;
    cell.c.className = 'cell' + (locked ? ' empty locked' : s ? ' c-' + (ITEM_DEFS[s.item]?.cat || 'res') : ' empty') + (this.split?.i === i ? ' splitting' : '');
    cell.ico.innerHTML = locked ? glyph('lock') : s ? itemIcon(s.item) : '';
    cell.n.textContent = s && s.count > 1 ? String(s.count) : '';
  }

  // Open a crafting tab. The search covers every tab, so picking one also ends it.
  _setTab(id) {
    const tab = this.tabs.find((t) => t.id === id) || this.tabs[0];
    this.tab = tab.id;
    lsSet(TAB_KEY, tab.id);
    for (const t of this.tabs) t.b.classList.toggle('on', t === tab);
    this.findInput.value = '';
    this._showRecipes();
  }

  // Lay out the recipe list: the selected tab, or - while the search field holds a query - every recipe
  // relevant to it, in relevance sections, with the tabs dimmed. The same buttons move between the two,
  // so their craft state, clicks and tooltips carry over. The list's height comes from the flex column,
  // not its contents, so neither filtering nor switching tabs moves the screen.
  _showRecipes() {
    const text = this.findInput.value;
    const on = (this.searching = !!norm(text));
    const all = this.tab === 'all';
    this.findClear.hidden = !text;
    this.findEl.classList.toggle('on', on);
    this.tabBar.classList.toggle('searching', on);
    for (const t of this.tabs) {
      if (!t.grid) continue;
      for (const rec of t.recs) t.grid.appendChild(rec.b); // back from the search view, in tab order
      t.head.hidden = on || !all;
      t.grid.hidden = on || (!all && t.id !== this.tab);
    }
    const view = this.findView;
    view.textContent = '';
    view.hidden = !on;
    if (on) {
      const sections = searchRecipes(text, this.recipeEls);
      for (const s of sections) {
        el('div', 'craft-group', view, s.title);
        const grid = el('div', 'craft-grid', view);
        for (const rec of s.recs) grid.appendChild(rec.b);
      }
      if (!sections.length) {
        const none = el('div', 'craft-none', view);
        el('span', '', none, `Nothing craftable matches "${text.trim()}"`);
        const b = el('button', 'btn cf-reset', none, 'Clear search');
        b.type = 'button';
      }
    }
    this.craftList.scrollTop = 0;
    if (this.tipTarget?.classList.contains('rc')) {
      this.tipTarget = null;
      this.tip.hide();
    }
  }

  clearSearch() {
    if (!this.findInput.value) return;
    this.findInput.value = '';
    this._showRecipes();
  }

  _schemOk(item) {
    return !!(this.unlocked & (1 << SCHEM_BIT[item]));
  }

  _renderRecipes() {
    let changed = false;
    const ready = { all: 0 };
    for (const rec of this.recipeEls) {
      let afford = true;
      for (const ing of rec.ings) {
        const have = this.counts[ing.id] || 0;
        const ok = have >= ing.need;
        if (!ok) afford = false;
        const k = have + '/' + ing.need;
        if (ing.key !== k) {
          ing.key = k;
          changed = true;
          ing.t.textContent = Math.min(have, 999) + '/' + ing.need;
          ing.chip.classList.toggle('lack', !ok);
        }
      }
      const stationOk = !rec.r.station || this.near[rec.r.station];
      const unlocked = !rec.r.schem || this._schemOk(rec.r.schem);
      if (afford && stationOk && unlocked) {
        ready.all++;
        ready[rec.tab.id] = (ready[rec.tab.id] || 0) + 1;
      }
      const key = (afford ? 'a' : '') + (stationOk ? 's' : '') + (unlocked ? 'u' : '');
      if (rec.key !== key) {
        rec.key = key;
        changed = true;
        rec.b.classList.toggle('ok', afford && stationOk && unlocked);
        rec.b.classList.toggle('no-mat', !afford);
        rec.b.classList.toggle('no-station', !stationOk);
        rec.b.classList.toggle('locked', !unlocked);
        if (rec.lock) rec.lock.hidden = unlocked;
      }
    }
    // keep an open recipe tooltip's have/need counts live (pickups, crafting, walking to a station)
    if (changed && this.tipTarget?.classList.contains('rc') && !this.tip.root.hidden) {
      const info = this._tipInfo(this.tipTarget);
      if (info) this.tip.show(info);
    }
    // badge each tab with how many of its recipes can be crafted right now
    for (const t of this.tabs) {
      const n = ready[t.id] || 0;
      if (t.ready === n) continue;
      t.ready = n;
      t.n.textContent = n ? String(n) : '';
      t.b.title = n ? `${n} ready to craft` : '';
    }
    const f = this.near.fire;
    const bn = this.near.bench;
    this.stationEl.classList.toggle('near', f || bn);
    this.stationIco.innerHTML = glyph(bn ? 'wrench' : 'campfire');
    this.stationTxt.textContent = f && bn ? 'Campfire + workbench' : f ? 'At a campfire' : bn ? 'At a workbench' : 'No station nearby';
    // a bulk key is down: its counts follow the inventory (the ammo reserve too, which the block above does not watch)
    if (this.bulk) {
      this._renderBulk();
      this._refreshTip();
    }
  }

  // ctx = { fire, bench, unlocked }
  setCraftContext(ctx) {
    const near = { fire: !!ctx?.fire, bench: !!ctx?.bench };
    const unlocked = ctx?.unlocked ?? this.unlocked;
    if (near.fire === this.near.fire && near.bench === this.near.bench && unlocked === this.unlocked) return;
    this.near = near;
    this.unlocked = unlocked;
    this._renderRecipes();
  }

  setOpen(open) {
    open = !!open;
    if (open === this.open) return;
    this.open = open;
    this.root.hidden = !open;
    this.ui.root.classList.toggle('inv-open', open);
    if (open) {
      this.root.classList.remove('in');
      void this.root.offsetWidth;
      this.root.classList.add('in');
    } else {
      // a focused search field would keep ui.isTyping() true and swallow gameplay keys
      if (document.activeElement === this.findInput) this.findInput.blur();
      this._dropBulk();
      this._closeSplit();
      this.tip.hide();
      this.tipTarget = null;
      if (this.drag) {
        if (this.drag.started) {
          this.ghost?.remove();
          this.ghost = null;
          this.cells[this.drag.i].c.classList.remove('dragging');
        }
        this.drag = null;
      }
      for (const c of this.cells) c.c.classList.remove('drop-t');
    }
  }
}
