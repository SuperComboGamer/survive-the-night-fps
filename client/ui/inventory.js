// Inventory / crafting screen (Tab). Equipment on the left, backpack grid in the centre,
// crafting on the right; survivors + car checklist + campfire under the grid.
import { ITEM, ITEM_DEFS, WEAPONS, RECIPES, AMMO_NAMES, AMMO_MAX, SUPPLIES, SUPPLY_NEED, SCHEMATICS, SCHEM_BIT, STATION_NAMES, ZONE_NAMES, CONSUMABLES, THROWABLES } from '../../shared/defs.js';
import { INVENTORY_SIZE } from '../../shared/constants.js';
import { el, svgEl, clamp, fmtTime, lsGet, lsSet } from './dom.js';
import { itemIcon, glyph } from './icons.js';

const SLOT_LABELS = ['Primary', 'Pistol', 'Melee', 'Throwable', 'Build tool'];
const CAT_LABEL = { res: 'Material', cons: 'Consumable', throw: 'Throwable', armor: 'Armor', weapon: 'Weapon', ammo: 'Ammunition', part: 'Car supply', schem: 'Schematic' };
const AMMO_ITEMS = [ITEM.AMMO_9MM, ITEM.AMMO_SHELLS, ITEM.AMMO_762, ITEM.AMMO_308];
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

// Which tab a recipe's output belongs to. The hammer is a build tool rather than a weapon, and
// consumables split into medicine (anything that heals) and utility (torches, batteries), which
// shares a tab with the raw materials.
function craftTab(item) {
  const cat = ITEM_DEFS[item]?.cat;
  if (item === ITEM.HAMMER) return 'util';
  if (cat === 'cons') return CONSUMABLES[item]?.heal ? 'med' : 'util';
  return CRAFT_TABS.some((t) => t.id === cat) ? cat : 'util';
}

// order inside a tab: tools, then consumables, then materials (stable, so recipe order breaks ties)
const CAT_RANK = { weapon: 0, cons: 1 };
const craftRank = (r) => CAT_RANK[ITEM_DEFS[r.out]?.cat] ?? 2;

function statLines(id) {
  const d = ITEM_DEFS[id];
  const out = [];
  const w = WEAPONS[id];
  if (w) {
    if (w.melee) out.push(`Damage ${w.damage}` + (w.altDamage !== w.damage ? ` · heavy ${w.altDamage}` : ''), `Swing ${w.rate.toFixed(2)}s`);
    else out.push(`Damage ${w.damage}${w.pellets > 1 ? ' × ' + w.pellets : ''}`, `Magazine ${w.mag} · ${AMMO_NAMES[w.ammo]}`, w.auto ? 'Full-auto' : 'Semi-auto');
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
  return out;
}

function hintFor(cat) {
  if (cat === 'cons') return 'LMB use';
  if (cat === 'weapon' || cat === 'throw') return 'LMB equip';
  if (cat === 'armor') return 'LMB wear';
  return '';
}

// ---------------------------------------------------------------- tooltip
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
    this.reqs = el('div', 'tip-reqs', this.root);
    this.hint = el('div', 'tip-hint', this.root);
    this.x = 0;
    this.y = 0;
  }

  // reqs = [{ icon, name, val, ok }] - a have/need checklist (recipes)
  show({ icon, name, cat, catCls, desc, stats, reqs, hint, hintCls }, x = this.x, y = this.y) {
    this.ico.innerHTML = icon || '';
    this.name.textContent = name || '';
    this.cat.textContent = cat || '';
    this.cat.className = 'tip-cat ' + (catCls || '');
    this.desc.textContent = desc || '';
    this.desc.hidden = !desc;
    this.stats.textContent = '';
    for (const s of stats || []) el('div', 'tip-stat', this.stats, s);
    this.stats.hidden = !(stats && stats.length);
    this.reqs.textContent = '';
    if (reqs && reqs.length) {
      el('div', 'tip-reqs-h', this.reqs, 'Requires');
      for (const q of reqs) {
        const row = el('div', 'tip-req ' + (q.ok ? 'ok' : 'lack'), this.reqs);
        svgEl('i', 'tip-req-ico', row, q.icon);
        el('span', 'tip-req-name', row, q.name);
        el('span', 'tip-req-val', row, q.val);
        svgEl('i', 'tip-req-mark', row, glyph(q.ok ? 'check' : 'xmark'));
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
    if (py + r.height > innerHeight - 8) py = innerHeight - r.height - 8;
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
    this.inv = { slots: new Array(INVENTORY_SIZE).fill(null), armor: null, ammo: [0, 0, 0, 0], weapons: [0, 0, 0, 0, 0], throwCounts: {} };
    this.counts = {};
    this.near = { fire: false, bench: false };
    this.unlocked = 0;
    this.camp = { supplies: [0, 0, 0, 0, 0], hints: [], carried: {} };
    this.tip = new Tooltip(tipParent);

    const root = (this.root = el('div', 'inv', parent));
    root.hidden = true;
    el('div', 'inv-bg', root);
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

    this._h(left, 'Armor');
    const arm = (this.armEl = el('div', 'armor empty', left));
    this.armIco = el('i', 'arm-ico', arm);
    const at = el('div', 'arm-txt', arm);
    this.armName = el('span', 'arm-name', at, 'No armor');
    const ab = el('div', 'arm-bar', at);
    this.armFill = el('i', '', ab);
    this.armPts = el('span', 'arm-pts', arm, '');

    this._h(left, 'Ammunition');
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

    // ---- centre: backpack grid + camp info
    const mid = el('section', 'inv-col inv-mid', wrap);
    const gp = el('div', 'grid-wrap paper', mid);
    const gh = this._h(gp, 'Backpack');
    this.capEl = el('span', 'inv-cap', gh, '0 / ' + INVENTORY_SIZE);
    this.grid = el('div', 'grid', gp);
    this.cells = [];
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const c = el('div', 'cell empty', this.grid);
      c.dataset.i = i;
      const ico = el('i', 'cell-ico', c);
      const n = el('span', 'cell-n', c, '');
      this.cells.push({ c, ico, n, key: '' });
    }
    const hints = el('div', 'grid-hints', gp);
    for (const [k, t] of [
      ['LMB', 'use / equip'],
      ['RMB', 'drop stack'],
      ['Shift+RMB', 'drop one'],
      ['Drag', 'move · drag out to drop'],
    ]) {
      const s = el('span', 'gh', hints);
      el('span', 'kbd sm', s, k);
      el('span', '', s, t);
    }

    const sub = el('div', 'inv-sub', mid);
    const sv = el('div', 'sv-box paper', sub);
    const svh = this._h(sv, 'Survivors');
    this.svCount = el('span', 'inv-cap', svh, '');
    this.svList = el('ul', 'sv-list', sv);

    const camp = el('div', 'camp-box paper', sub);
    const cph = this._h(camp, 'Car supplies');
    this.carCount = el('span', 'inv-cap', cph, '0 / 7');
    const pl = el('ul', 'car-list', camp);
    this.partEls = SUPPLIES.map((id, i) => {
      const li = el('li', 'cp', pl);
      svgEl('i', 'cp-ico', li, itemIcon(id));
      el('span', 'cp-name', li, ITEM_DEFS[id].name + (SUPPLY_NEED[i] > 1 ? ` ×${SUPPLY_NEED[i]}` : ''));
      const where = el('span', 'cp-where', li, '?');
      svgEl('i', 'cp-chk', li, glyph('check'));
      li.where = where;
      return li;
    });
    const sch = el('div', 'schem-row', camp);
    el('span', 'schem-lab', sch, 'Schematics');
    this.schemEls = SCHEMATICS.map((id) => {
      const b = el('span', 'schem locked', sch);
      b.dataset.item = id;
      svgEl('i', 'schem-ico', b, itemIcon(id));
      svgEl('i', 'schem-lock', b, glyph('lock'));
      return b;
    });

    // ---- right: crafting
    const right = el('section', 'inv-col inv-right paper', wrap);
    const ch = this._h(right, 'Crafting');
    this.stationEl = el('span', 'station', ch);
    this.stationIco = svgEl('i', 'st-ico', this.stationEl, glyph('campfire'));
    this.stationTxt = el('span', '', this.stationEl, '');
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
      const tab = { id: t.id, b: tb, n: el('span', 'ct-n', tb), ready: -1, head: null, grid: null };
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
        this.recipeEls.push({ r, tab, b, ings, st, lock, key: '' });
      }
    }
    el('span', 'kbd sm ct-key', tabBar, 'E');

    this._bind(root, wrap);
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
  _bind(root, wrap) {
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
        this.drag = { i, x: e.clientX, y: e.clientY, started: false };
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
          const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.cell');
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
          if (b !== d.i) {
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
      } else {
        this._useSlot(d.i);
      }
    };
    window.addEventListener('pointermove', this._move);
    window.addEventListener('pointerup', this._up);

    // tooltips
    wrap.addEventListener('pointerover', (e) => {
      if (this.drag?.started) return;
      const t = e.target.closest('.cell, .eq, .rc, .armor, .cp, .am, .schem');
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

    // crafting tabs: click, or Q / E to step through them while the screen is open
    this.tabBar.addEventListener('click', (e) => {
      const b = e.target.closest('.ct');
      if (!b || b.dataset.tab === this.tab) return;
      this.ui.sound('ui_click');
      this._setTab(b.dataset.tab);
    });
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

    // crafting
    this.craftList.addEventListener('click', (e) => {
      const b = e.target.closest('.rc');
      if (!b) return;
      const rec = this.recipeEls.find((x) => x.b === b);
      if (!rec) return;
      if (b.classList.contains('ok')) {
        this.ui.sound('ui_click');
        cb.onCraft(rec.r.id);
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

  _useSlot(i) {
    const s = this.inv.slots[i];
    if (!s) return;
    const cat = ITEM_DEFS[s.item]?.cat;
    const cb = this.ui.cb;
    if (cat === 'armor') {
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
    if (t.classList.contains('cell')) {
      const s = this.inv.slots[+t.dataset.i];
      if (!s) return null;
      id = s.item;
      const h = hintFor(ITEM_DEFS[id]?.cat);
      hint = (h ? h + ' · ' : '') + 'RMB drop · Shift+RMB drop one';
    } else if (t.classList.contains('eq')) {
      const q = this.eqEls[+t.dataset.slot];
      if (!(q.item > 0)) return null;
      id = q.item;
      hint = 'RMB drop';
    } else if (t.classList.contains('armor')) {
      if (!this.inv.armor) return null;
      id = this.inv.armor.item;
      extra = [`${Math.ceil(this.inv.armor.points)} / ${this.inv.armor.max} armor remaining`];
    } else if (t.classList.contains('rc')) {
      const rec = this.recipeEls.find((x) => x.b === t);
      if (!rec) return null;
      const { r } = rec;
      id = r.out;
      reqs = [];
      const missing = [];
      for (const ing of rec.ings) {
        const have = this.counts[ing.id] || 0;
        const ok = have >= ing.need;
        const nm = ITEM_DEFS[ing.id].name;
        if (!ok) missing.push(`${ing.need - have} ${nm}`);
        reqs.push({ icon: itemIcon(ing.id), name: nm, val: Math.min(have, 999) + ' / ' + ing.need, ok });
      }
      const st = r.station;
      const stationOk = !st || this.near[st];
      if (st) reqs.push({ icon: glyph(STATION_GLYPH[st]), name: st === 'fire' ? 'Lit campfire' : STATION_NAMES[st], val: stationOk ? 'nearby' : 'not nearby', ok: stationOk });
      const unlocked = !r.schem || this._schemOk(r.schem);
      if (r.schem) reqs.push({ icon: glyph(unlocked ? 'unlock' : 'lock'), name: ITEM_DEFS[r.schem].name, val: unlocked ? 'found' : 'not found', ok: unlocked });
      const todo = [];
      if (missing.length) todo.push('Missing ' + missing.join(', '));
      if (!stationOk) todo.push(`Build a ${STATION_NAMES[st].toLowerCase()} [5] or find one`);
      if (!unlocked) todo.push('Find the schematic in lockers, crates or toolboxes');
      hint = todo.length ? todo.join('\n') : 'Click to craft';
      if (todo.length) hintCls = 'bad';
    } else if (t.classList.contains('cp')) {
      const i = this.partEls.indexOf(t);
      id = SUPPLIES[i];
      const zs = (i < 4 ? [this.camp.hints[i]] : (this.camp.hints || []).slice(4)).filter((z) => z != null && z !== 255);
      extra = [zs.length ? `Rumoured: ${zs.map((z) => ZONE_NAMES[z]).join(', ')}` : 'Nobody knows where'];
      if (SUPPLY_NEED[i] > 1) extra.push(`${this.camp.supplies[i] | 0} / ${SUPPLY_NEED[i]} in the tank`);
    } else if (t.classList.contains('schem')) {
      id = +t.dataset.item;
      extra = [this._schemOk(id) ? 'Found - unlocked for the whole team' : 'Not found yet. Hidden in a locker, ammo crate or toolbox somewhere - or in a supply drop.'];
    } else if (t.classList.contains('am')) {
      id = AMMO_ITEMS[this.ammoEls.findIndex((a) => a.r === t)];
    }
    const d = ITEM_DEFS[id];
    if (!d) return null;
    return {
      icon: itemIcon(id),
      name: d.name,
      cat: CAT_LABEL[d.cat] || '',
      catCls: 'c-' + d.cat,
      desc: d.desc,
      stats: [...statLines(id), ...(extra || [])],
      reqs,
      hint,
      hintCls,
    };
  }

  // ------------------------------------------------------------ data
  set(inv) {
    if (!inv) return;
    const slots = inv.slots || [];
    this.inv = {
      slots: Array.from({ length: INVENTORY_SIZE }, (_, i) => (slots[i] && slots[i].item ? { item: slots[i].item, count: slots[i].count | 0 } : null)),
      armor: inv.armor && inv.armor.item ? inv.armor : null,
      ammo: inv.ammo || [0, 0, 0, 0],
      weapons: inv.weapons || [0, 0, 0, 0, 0],
      throwCounts: inv.throwCounts || {},
    };
    this.counts = {};
    for (const s of this.inv.slots) if (s) this.counts[s.item] = (this.counts[s.item] || 0) + s.count;
    this._renderAll();
  }

  _renderAll() {
    for (let i = 0; i < INVENTORY_SIZE; i++) this._renderCell(i);
    const used = this.inv.slots.filter(Boolean).length;
    if (this._used !== used) {
      this._used = used;
      this.capEl.textContent = used + ' / ' + INVENTORY_SIZE;
      this.capEl.classList.toggle('full', used >= INVENTORY_SIZE);
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

  _renderCell(i) {
    const s = this.inv.slots[i];
    const cell = this.cells[i];
    const key = s ? s.item + ':' + s.count : '';
    if (cell.key === key) return;
    cell.key = key;
    cell.c.className = 'cell' + (s ? ' c-' + (ITEM_DEFS[s.item]?.cat || 'res') : ' empty');
    cell.ico.innerHTML = s ? itemIcon(s.item) : '';
    cell.n.textContent = s && s.count > 1 ? String(s.count) : '';
  }

  _setTab(id) {
    const tab = this.tabs.find((t) => t.id === id) || this.tabs[0];
    this.tab = tab.id;
    lsSet(TAB_KEY, tab.id);
    const all = tab.id === 'all';
    for (const t of this.tabs) {
      t.b.classList.toggle('on', t === tab);
      if (!t.grid) continue;
      t.head.hidden = !all;
      t.grid.hidden = !all && t !== tab;
    }
    this.craftList.scrollTop = 0;
    if (this.tipTarget?.classList.contains('rc')) {
      this.tipTarget = null;
      this.tip.hide();
    }
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
  }

  // ctx = { fire, bench, unlocked }
  setCraftContext(ctx) {
    const near = { fire: !!ctx?.fire, bench: !!ctx?.bench };
    const unlocked = ctx?.unlocked ?? this.unlocked;
    if (near.fire === this.near.fire && near.bench === this.near.bench && unlocked === this.unlocked) return;
    this.near = near;
    if (unlocked !== this.unlocked) {
      this.unlocked = unlocked;
      this.schemEls.forEach((b) => b.classList.toggle('locked', !this._schemOk(+b.dataset.item)));
    }
    this._renderRecipes();
  }

  setPlayers(list) {
    list = Array.isArray(list) ? list : [];
    const key = list.map((p) => [p.id, p.name, p.status, p.kills | 0, Math.round((p.ping || 0) / 5), p.talking ? 1 : 0, p.self ? 1 : 0].join('|')).join(';');
    if (key === this._svKey) return;
    this._svKey = key;
    this.svList.textContent = '';
    let alive = 0;
    for (const p of list) {
      if (p.status === 'alive') alive++;
      const li = el('li', 'sv st-' + (p.status || 'alive') + (p.self ? ' self' : '') + (p.talking ? ' talking' : ''), this.svList);
      svgEl('i', 'sv-st', li, glyph(p.status === 'zombie' ? 'claw' : p.status === 'dead' ? 'skull' : 'person'));
      const nm = el('span', 'sv-name', li, p.name || '???');
      if (p.self) el('small', 'sv-you', nm, 'you');
      svgEl('i', 'sv-mic', li, glyph('mic'));
      const k = el('span', 'sv-kills', li);
      svgEl('i', '', k, glyph('skull'));
      el('b', '', k, String(p.kills | 0));
      el('span', 'sv-ping', li, p.ping != null ? Math.round(p.ping) + 'ms' : '');
    }
    this.svCount.textContent = list.length ? alive + ' alive' : '';
  }

  // info = { supplies:[n x5], hints:[zone x7], carried:{item:n} } (any subset)
  setCamp(info) {
    if (!info) return;
    const c = this.camp;
    const key = JSON.stringify([info.supplies, info.hints, info.carried]);
    if (key === this._campKey) return;
    this._campKey = key;
    if (info.supplies) c.supplies = info.supplies;
    if (info.hints) c.hints = info.hints;
    if (info.carried) c.carried = info.carried;
    let n = 0;
    let tot = 0;
    this.partEls.forEach((li, i) => {
      const have = c.supplies[i] | 0;
      const need = SUPPLY_NEED[i];
      n += Math.min(have, need);
      tot += need;
      const done = have >= need;
      li.classList.toggle('on', done);
      li.classList.toggle('carried', !done && !!c.carried[SUPPLIES[i]]);
      const zs = (i < 4 ? [c.hints[i]] : (c.hints || []).slice(4)).filter((z) => z != null && z !== 255);
      li.where.textContent = done ? 'installed' : c.carried[SUPPLIES[i]] ? 'carrying' : need > 1 ? `${have}/${need} · ${zs.map((z) => ZONE_NAMES[z]).join(', ')}` : zs.length ? ZONE_NAMES[zs[0]] + '?' : '?';
    });
    this.carCount.textContent = n + ' / ' + tot;
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
