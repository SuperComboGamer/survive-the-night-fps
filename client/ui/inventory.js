// Inventory / crafting screen (I). The game does not pause while it is open (the survivor stands still while the world
// goes on), so everything here is one click or one key away:
// - left: the loadout as the hotbar has it, each gun with its own ammunition; what is worn; the ammo pouch (only the
//   calibres carried, each with the gun that fires it)
// - centre: the backpack, searchable (/), filtered by category, in labelled sections with names under the icons. A
//   click selects (the item card under the grid says what it is and has the buttons), a double-click does the main
//   thing, a right click opens a menu of drop amounts. The same keys work on whatever is under the pointer or selected:
//   F use / equip · S split · G drop one (Shift+G all) · X salvage. A drop can be taken back for a few seconds (Z).
// - right: crafting (crafting.js)
// The grid always has INVENTORY_MAX cells: the last BACKPACK_SLOTS of them only exist while a backpack is worn. (The car
// supplies are on the HUD's objective tracker and the map, not in here.)
import { usedIn, foundIn, sourcesOf } from '../game/itemguide.js';
import { ITEM, ITEM_DEFS, WEAPONS, RECIPES, SALVAGE, isFirearm, AMMO_NAMES, AMMO_ITEMS, SCHEM_BIT, CONSUMABLES } from '../../shared/defs.js';
import { INVENTORY_SIZE, INVENTORY_MAX, BACKPACK_SLOTS, inventoryCap } from '../../shared/constants.js';
import { SALVAGE_FROM, WORN, WORN_DO } from '../../shared/protocol.js';
import { smallestStack } from '../../shared/stacks.js';
import { el, svgEl, clamp } from './dom.js';
import { itemIcon, glyph } from './icons.js';
import { actionsOf, bindLabel, liveText } from '../game/binds.js';
import { levelOf } from '../../shared/progress.js';
import { fetchProgress, lastProgress, onProgress } from '../net/progress.js';
import { xpBar } from './progress.js';
import { norm, itemScore } from './search.js';
import { CAT_LABEL, statLines, costLine, salvageOf, shortName } from './iteminfo.js';
import { Crafting } from './crafting.js';

const SLOT_LABELS = ['Primary', 'Pistol', 'Melee', 'Throwable', 'Build tool'];
// The backpack's sections, in the order the server's Sort leaves them (BAG_TIER in defs.js), each with its filter chip.
// Only the grid is laid out that way - the server keeps each stack in its slot - so within a section stacks stay in
// slot order, which a drag onto another stack of the section swaps.
const SECTIONS = [
  { id: 'gear', label: 'Weapons & gear', chip: 'Gear', cats: ['weapon', 'armor', 'pack', 'gear'] },
  { id: 'cons', label: 'Consumables', chip: 'Consumables', cats: ['cons', 'ammo'] },
  { id: 'throw', label: 'Throwables', chip: 'Throw', cats: ['throw'] },
  { id: 'res', label: 'Materials', chip: 'Materials', cats: ['res'] },
  { id: 'part', label: 'Car supplies', chip: 'Parts', cats: ['part', 'schem'] },
];
const SEC_OF_CAT = Object.fromEntries(SECTIONS.flatMap((s) => s.cats.map((c) => [c, s.id])));
const secOf = (s) => (s ? SEC_OF_CAT[ITEM_DEFS[s.item]?.cat] || 'res' : '');
const CAP_WARN = 0.8; // the capacity bar turns amber this full
const UNDO_TIME = 5; // s the undo toast offers to take a drop back (the server allows a little more: UNDO_DROP_TIME)
const PACK_RECIPE = RECIPES.find((r) => r.out === ITEM.BACKPACK);

// what a double-click (or F) does with a backpack stack, by category
const MAIN_OF = { cons: 'Use', weapon: 'Equip', throw: 'Equip', armor: 'Wear', pack: 'Wear' };
// the key of the game that uses an item without opening the inventory, said on its card
function quickKey(id) {
  const c = CONSUMABLES[id];
  if (c?.drink) return ['Drink', 'drink'];
  if (c?.heal && c.meat !== 1) return ['Quick heal', 'heal'];
  return null;
}
// keys that open or shut a screen are the game's even here (passesMenus in game/input.js)
const MENU_KEYS = new Set(['inventory', 'map', 'board', 'players', 'chat']);
const menuKey = (code) => actionsOf(code).some((a) => MENU_KEYS.has(a));

// The backpack stacks n crafts of a recipe would be paid from, and how much from each: slot index -> count. Taken from
// the smallest stack first, as the server pays (removeItem) and craftRun counts
function takesOf(cost, n, slots) {
  const sl = slots.map((s) => s && { ...s });
  const out = new Map();
  for (const k in cost) {
    let left = cost[k] * n;
    while (left > 0) {
      const at = smallestStack(sl, +k);
      if (at < 0) break;
      const take = Math.min(sl[at].count, left);
      sl[at].count -= take;
      left -= take;
      out.set(at, (out.get(at) || 0) + take);
      if (sl[at].count <= 0) sl[at] = null;
    }
  }
  return out;
}

// ---------------------------------------------------------------- tooltip
// The name of what is under the pointer (the item card has the rest), and a line of what to do with it
class Tooltip {
  constructor(parent) {
    this.root = el('div', 'tip', parent);
    this.root.hidden = true;
    this.name = el('div', 'tip-name', this.root);
    this.cat = el('div', 'tip-cat', this.root);
    this.hint = el('div', 'tip-hint', this.root);
    this.x = 0;
    this.y = 0;
  }

  show({ name, cat, catCls, hint }, x = this.x, y = this.y) {
    this.name.textContent = name || '';
    this.cat.textContent = cat || '';
    this.cat.className = 'tip-cat ' + (catCls || '');
    this.cat.hidden = !cat;
    this.hint.textContent = hint || '';
    this.hint.hidden = !hint;
    this.root.hidden = false;
    this.move(x, y);
  }

  move(x, y) {
    this.x = x;
    this.y = y;
    const r = this.root.getBoundingClientRect();
    let px = x + 16;
    let py = y + 18;
    if (px + r.width > innerWidth - 8) px = x - r.width - 12;
    if (py + r.height > innerHeight - 8) py = y - r.height - 12;
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
    this.inv = { slots: new Array(INVENTORY_MAX).fill(null), armor: null, backpack: 0, cap: INVENTORY_SIZE, ammo: AMMO_ITEMS.map(() => 0), weapons: [0, 0, 0, 0, 0], mags: [0, 0], throwCounts: {} };
    this.counts = {};
    this.near = { fire: false, bench: false };
    this.unlocked = 0;
    this.tip = new Tooltip(tipParent);
    // What the item card is about: { kind: 'slot', i, item } a backpack stack, { kind: 'eq', slot, item } a weapon in
    // its slot, { kind: 'worn', which, item } the armor or backpack worn. null: nothing. The keys act on what is under
    // the pointer (hoverEl) before it
    this.sel = null;
    this.hoverEl = null;
    this.filter = 'all'; // the backpack's category chip
    this.query = ''; // ...and its search, norm()ed
    this.showAllAmmo = false;
    // what the split popover is open on and how much of it is picked: { i, from, item, n, count, anchor }. i: the
    // backpack index, or -1 for a weapon slot or the armor worn; from: the same as ACT.SALVAGE names it (SALVAGE_FROM)
    this.split = null;
    this.splitShut = -1; // `from` of the popover the press now going on has just put away
    this.apop = null; // the ammo popover: { cal, n, anchor }
    this.menu = null; // the right-click menu: { ref }
    this.undoAt = 0; // when the undo toast went up (0: it is down)

    const root = (this.root = el('div', 'inv', parent));
    root.hidden = true;
    const bg = el('div', 'inv-bg', root);
    const close = el('button', 'inv-close', root);
    close.type = 'button';
    liveText(close, () => `Close inventory (${bindLabel('inventory')})`, 'title');
    liveText(el('span', 'kbd sm', close), () => bindLabel('inventory'));
    el('span', 'inv-close-t', close, 'Close');
    svgEl('i', 'inv-close-x', close, glyph('xmark'));
    close.addEventListener('click', () => this.ui.cb.onCloseInventory());
    const wrap = (this.wrap = el('div', 'inv-wrap', root));

    this._buildLeft(wrap);
    this._buildMid(wrap);
    const right = el('section', 'inv-col inv-right paper', wrap);
    this.craft = new Crafting(this, right);
    this._buildPopovers(root);

    this._bind(root, wrap, bg);
    this._renderAll();
  }

  _h(parent, title, aside) {
    const h = el('h3', 'inv-h', parent);
    el('span', 'inv-h-t', h, title);
    if (aside) el('span', 'inv-h-aside', h, aside);
    return h;
  }

  // ---- left: your level (progress.js) and the perks to pick, the loadout, what is worn, the ammo pouch
  _buildLeft(wrap) {
    const left = el('section', 'inv-col inv-left paper', wrap);
    const lvl = el('div', 'inv-lvl', left);
    this.lvlBar = xpBar(lvl, 'inv-xpb');
    const perks = (this.perksBtn = el('button', 'inv-perks', lvl));
    perks.type = 'button';
    svgEl('i', 'inv-perks-ico', perks, glyph('arrowUp'));
    this.perksTxt = el('span', '', perks, 'Perks');
    this.perksBadge = el('b', 'sp-badge', perks, '');
    this.perksBadge.hidden = true;
    perks.addEventListener('click', () => this.ui.progress.show());
    this.prog = null; // our XP as the game last heard it (setProgress)
    this.progAsked = -1e9; // when the server was last asked about our picks (fetchProgress)
    onProgress((v) => {
      this.perksTxt.textContent = v?.pending ? 'Spend a perk point' : 'Perks';
      this.perksBtn.classList.toggle('lit', !!v?.pending);
      this.perksBadge.hidden = !v?.pending;
      this.perksBadge.textContent = v?.pending ? String(v.pending) : '';
    });

    this._h(left, 'Loadout', 'matches your hotbar');
    const eqs = el('div', 'eq-list', left);
    this.eqEls = SLOT_LABELS.map((lab, i) => {
      const r = el('div', 'eq empty', eqs);
      r.dataset.slot = i;
      el('span', 'eq-key', r, String(i + 1));
      const ico = el('i', 'eq-ico', r);
      const txt = el('div', 'eq-txt', r);
      el('span', 'eq-lab', txt, lab);
      const name = el('span', 'eq-name', txt, 'Empty');
      // a gun's own ammunition: calibre, the magazine and what is carried for it besides
      const ammo = el('span', 'eq-ammo', txt);
      ammo.hidden = true;
      const cal = el('span', 'eq-cal', ammo);
      const mag = el('span', 'eq-mag', ammo);
      const bar = el('i', 'eq-bar', ammo);
      const fill = el('i', '', bar);
      const spare = el('span', 'eq-spare', ammo);
      const cnt = el('span', 'eq-cnt', r, '');
      return { r, ico, name, ammo, cal, mag, fill, spare, cnt, item: -1, akey: '' };
    });
    // the other throwables to switch to, on the throwable's row
    this.throwAlt = el('div', 'eq-throws', this.eqEls[3].r.querySelector('.eq-txt'));

    // what is worn: the armor, and beside it the backpack (its pockets are the grid's last BACKPACK_SLOTS cells)
    this._h(left, 'Worn');
    const worn = el('div', 'worn', left);
    const arm = (this.armEl = el('div', 'armor empty', worn));
    this.armIco = el('i', 'arm-ico', arm);
    const at = el('div', 'arm-txt', arm);
    this.armName = el('span', 'arm-name', at, 'No armor');
    this.armSub = el('span', 'arm-sub', at, '');
    const ab = el('div', 'arm-bar', at);
    this.armFill = el('i', '', ab);
    const pk = (this.packEl = el('div', 'armor pack empty', worn));
    this.packIco = el('i', 'arm-ico', pk);
    const pt = el('div', 'arm-txt', pk);
    this.packName = el('span', 'arm-name', pt, 'No backpack');
    this.packSub = el('span', 'arm-sub', pt, '');

    // Ammunition is carried apart from the backpack, a reserve per calibre: the pouch lists the ones carried, each with
    // the gun that fires it. A click opens the amount popover (drop some for a teammate, craft more)
    this._h(left, 'Ammo pouch', 'click to share');
    const pouch = (this.pouchEl = el('div', 'pouch', left));
    this.calEls = AMMO_ITEMS.map((id, cal) => {
      const b = el('button', 'pouch-cal', pouch);
      b.type = 'button';
      b.dataset.cal = cal;
      svgEl('i', 'pc-ico', b, itemIcon(id));
      el('span', 'pc-name', b, AMMO_NAMES[cal]);
      const n = el('span', 'pc-n', b, '0');
      const who = el('span', 'pc-who', b, '');
      return { b, who, n, key: '' };
    });
    const foot = (this.pouchFoot = el('div', 'pouch-foot', left));
    this.pouchHidden = el('span', 'pf-t', foot, '');
    const more = (this.pouchMore = el('button', 'pf-more', foot, 'show all'));
    more.type = 'button';
    more.addEventListener('click', () => {
      this.ui.sound('ui_click');
      this.showAllAmmo = !this.showAllAmmo;
      this._renderPouch(true);
    });
  }

  // ---- centre: the backpack
  _buildMid(wrap) {
    const mid = el('section', 'inv-col inv-mid', wrap);
    const gp = (this.gridWrap = el('div', 'grid-wrap paper', mid));
    const gh = this._h(gp, 'Backpack');
    const ghr = el('span', 'inv-h-right', gh);
    const capBar = (this.capBar = el('i', 'inv-capbar', ghr));
    this.capFill = el('i', '', capBar);
    this.capEl = el('span', 'inv-cap', ghr, '0 / ' + INVENTORY_SIZE);
    // Sort: stacks merged, the slots ordered by kind (BAG_TIER), the server's to do
    const sort = (this.sortEl = el('button', 'inv-sort', ghr, 'Sort'));
    sort.type = 'button';
    sort.title = 'Merge stacks and order the backpack by kind';

    // search: matches light up and the rest dims
    const find = (this.bpFind = el('label', 'craft-find bp-find', gp));
    svgEl('i', 'cf-ico', find, glyph('search'));
    const field = (this.bpInput = el('input', 'cf-field', find));
    field.type = 'text';
    field.maxLength = 40;
    field.autocomplete = 'off';
    field.spellcheck = false;
    field.placeholder = 'Find in backpack';
    field.setAttribute('aria-label', 'Find in backpack');
    this.bpCount = el('span', 'bp-count', find, '');
    el('span', 'kbd sm bp-slash', find, '/');
    const clr = (this.bpClear = svgEl('button', 'cf-clear', find, glyph('xmark')));
    clr.type = 'button';
    clr.hidden = true;
    clr.title = 'Clear (Esc)';

    // category chips, each with how many stacks it has
    const chips = (this.chipBar = el('div', 'bp-chips', gp));
    this.chips = [{ id: 'all', chip: 'All' }, ...SECTIONS].map((s) => {
      const b = el('button', 'chip c-' + s.id, chips);
      b.type = 'button';
      b.dataset.f = s.id;
      el('i', 'chip-dot', b);
      el('span', '', b, s.chip);
      return { id: s.id, b, n: el('b', 'chip-n', b, '0'), v: -1 };
    });

    const scroll = (this.gridScroll = el('div', 'grid-scroll', gp));
    this.grid = el('div', 'grid', scroll);
    this.secEls = Object.fromEntries(
      SECTIONS.map((s) => {
        const h = el('div', 'bp-sec', this.grid);
        const t = el('span', 'bp-sec-t', h, s.label);
        const note = el('span', 'bp-sec-note', h, '');
        return [s.id, { h, t, note, n: -1 }];
      }),
    );
    this.cells = [];
    for (let i = 0; i < INVENTORY_MAX; i++) {
      const c = el('div', 'cell empty', this.grid);
      c.dataset.i = i;
      const ico = el('i', 'cell-ico', c);
      const n = el('span', 'cell-n', c, '');
      const name = el('span', 'cell-name', c, '');
      const use = el('span', 'cell-use', c, '');
      this.cells.push({ c, ico, n, name, use, key: '', cls: '', take: 0 });
    }
    // the pockets of a backpack nobody is wearing: one line instead of BACKPACK_SLOTS padlocked cells
    const lk = (this.lockedEl = el('div', 'bp-locked', gp));
    svgEl('i', 'bp-lock-ico', lk, glyph('lock'));
    el('span', 'bp-lock-t', lk, `+${BACKPACK_SLOTS} slots with a Backpack`);
    el('span', 'bp-lock-how', lk, 'craft one at a workbench');
    lk.title = `Craft one at a workbench: ${costLine(PACK_RECIPE.cost)}`;

    this._buildCard(gp);
  }

  // the item card: what the selected thing is, what it is for, and a button (with its key) for everything it can do
  _buildCard(parent) {
    const card = (this.cardEl = el('div', 'card', parent));
    this.cardEmpty = el('div', 'card-empty', card);
    el('span', '', this.cardEmpty, 'Click an item to see it here · double-click uses it · right-click to drop');
    const body = (this.cardBody = el('div', 'card-body', card));
    const head = el('div', 'card-head', body);
    this.cardIco = el('i', 'card-ico', head);
    const t = el('div', 'card-titles', head);
    const nl = el('div', 'card-nameline', t);
    this.cardName = el('span', 'card-name', nl);
    this.cardCat = el('span', 'card-cat', nl);
    this.cardKey = el('span', 'card-key', nl);
    this.cardDesc = el('div', 'card-desc', t);
    const btns = el('div', 'card-btns', body);
    const btn = (label, key, act) => {
      const b = el('button', 'card-b', btns);
      b.type = 'button';
      const t = el('span', 'card-bt', b, label);
      el('span', 'kbd sm', b, key);
      b.addEventListener('click', () => this.sel && this._do(act, this.sel, false));
      return { b, t };
    };
    this.cbMain = btn('Use', 'F', 'main');
    this.cbSplit = btn('Split', 'S', 'split');
    this.cbDrop = btn('Drop', 'G', 'drop');
    this.cbAll = btn('Drop all', 'Shift+G', 'dropAll');
    this.cbSalv = btn('Salvage', 'X', 'salvage');
    this.cardFoot = el('div', 'card-foot', body);
  }

  _buildPopovers(root) {
    // ---- split popover: how much of a stack to put in a slot of its own, or down on the ground for a teammate
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
    const sr = (this.splitRow = el('div', 'split-row', sp));
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
    const sb = (this.splitBtns = el('div', 'split-btns', sp));
    this.splitDrop = el('button', 'btn split-b', sb, 'Drop');
    this.splitDrop.type = 'button';
    this.splitKeep = el('button', 'btn split-b', sb, 'Split');
    this.splitKeep.type = 'button';
    this.splitNote = el('div', 'split-note', sp);
    // ...and tearing it down, for anything SALVAGE lists: what the amount picked comes apart into
    const sv = (this.salvEl = el('div', 'salv', sp));
    el('div', 'salv-h', sv, 'Comes apart into');
    this.salvYield = el('div', 'salv-yield', sv);
    this.salvNote = el('div', 'split-note', sv);
    this.salvBtn = el('button', 'btn split-b salv-b', sv, 'Salvage');
    this.salvBtn.type = 'button';

    // ---- the ammo popover: an amount of a calibre (presets, a slider), dropped for a teammate, or more of it crafted
    const ap = (this.apEl = el('div', 'split apop', root));
    ap.hidden = true;
    const ah = el('div', 'split-head', ap);
    this.apIco = el('i', 'split-ico', ah);
    this.apName = el('span', 'split-name', ah);
    this.apOf = el('span', 'split-of', ah);
    const apX = svgEl('button', 'btn-icon split-x', ah, glyph('xmark'));
    apX.type = 'button';
    apX.title = 'Close (Esc)';
    apX.addEventListener('click', () => this._closeAmmo());
    const pre = el('div', 'ap-pre', ap);
    this.apPre = [
      ['10', () => 10],
      ['30', () => 30],
      ['Half', (v) => Math.ceil(v / 2)],
      ['All', (v) => v],
    ].map(([t, f]) => {
      const b = el('button', 'ap-p', pre, t);
      b.type = 'button';
      b.addEventListener('click', () => this._setAmmo(f(this.inv.ammo[this.apop?.cal] | 0)));
      return { b, f };
    });
    const ar = el('div', 'split-row', ap);
    const arange = (this.apRange = el('input', 'set-range split-range', ar));
    arange.type = 'range';
    arange.min = 1;
    arange.step = 1;
    arange.setAttribute('aria-label', 'How many');
    const anum = (this.apNum = el('input', 'split-num', ar));
    anum.type = 'text';
    anum.inputMode = 'numeric';
    anum.maxLength = 4;
    anum.autocomplete = 'off';
    anum.setAttribute('aria-label', 'How many');
    const abt = el('div', 'split-btns', ap);
    this.apDrop = el('button', 'btn split-b ap-drop', abt);
    this.apDrop.type = 'button';
    this.apDropT = el('span', '', this.apDrop, 'Drop');
    el('span', 'kbd sm', this.apDrop, 'G');
    this.apCraft = el('button', 'btn split-b', abt, 'Craft');
    this.apCraft.type = 'button';
    this.apNote = el('div', 'split-note', ap);

    // ---- the right-click menu
    this.menuEl = el('div', 'ctx', root);
    this.menuEl.hidden = true;

    // ---- while something is dragged: where to let go of it to put it on the ground
    const dz = (this.dropZone = el('div', 'dropzone', root));
    svgEl('i', 'dz-ico', dz, glyph('arrowRight'));
    el('span', 'dz-t', dz, 'Release to drop on the ground');
    this.dzWhat = el('span', 'dz-what', dz, '');

    // ---- after a drop: what went down, and the key that takes it back. Over the compass, which says nothing while the
    // screen is up (the tooltips' layer is the one above the HUD's top strip)
    const u = (this.undoEl = el('div', 'undo', this.tip.root.parentElement));
    u.hidden = true;
    this.undoIco = el('i', 'undo-ico', u);
    this.undoTxt = el('span', 'undo-t', u, '');
    const ub = (this.undoBtn = el('button', 'undo-b', u));
    ub.type = 'button';
    el('span', 'kbd sm', ub, 'Z');
    el('span', '', ub, 'Undo');
    this.undoBar = el('i', 'undo-bar', u);
  }

  // ------------------------------------------------------------ input
  _bind(root, wrap, bg) {
    const cb = this.ui.cb;
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    // a button pressed with the mouse does not keep the focus: Space (craft, or a jump once the screen is shut) must not
    // press it again
    root.addEventListener(
      'mousedown',
      (e) => {
        if (e.target.closest('button')) e.preventDefault();
      },
      true,
    );

    // A press on a stack, a weapon in its slot or something worn: the left button selects it (or drags it), the right
    // one opens its menu. A press on an empty cell lets go of the selection
    wrap.addEventListener('pointerdown', (e) => {
      const t = e.target.closest('.cell, .eq, .armor, .pouch-cal');
      if (!t) return;
      const ref = this._refOf(t);
      if (e.button === 2) {
        e.preventDefault();
        if (ref) this._openMenu(ref, e.clientX, e.clientY);
        return;
      }
      if (e.button !== 0 || t.classList.contains('pouch-cal')) return;
      if (!ref) {
        if (t.classList.contains('cell')) this._select(null);
        return;
      }
      e.preventDefault();
      // (a stack, or a weapon in its slot: those can be dragged. Worn gear and the throwable slot only select)
      const drag = ref.kind === 'slot' || ref.kind === 'eq';
      this.drag = { ref, i: ref.kind === 'slot' ? ref.i : -1, eq: ref.kind === 'eq' ? ref.slot : -1, x: e.clientX, y: e.clientY, started: false, can: drag };
    });
    wrap.addEventListener('dblclick', (e) => {
      const t = e.target.closest('.cell, .eq, .armor');
      const ref = t && this._refOf(t);
      if (ref) this._do('main', ref, false);
    });
    this.pouchEl.addEventListener('click', (e) => {
      const b = e.target.closest('.pouch-cal');
      if (!b) return;
      const cal = +b.dataset.cal;
      if (this.apop?.cal === cal) return this._closeAmmo();
      this.ui.sound('ui_click');
      this._openAmmo(cal, b);
    });

    this._move = (e) => {
      const d = this.drag;
      if (d) {
        if (d.can && !d.started && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) this._startDrag(d);
        if (d.started) this._dragOver(d, e);
      } else if (!this.tip.root.hidden) this.tip.move(e.clientX, e.clientY);
    };
    this._up = (e) => {
      const d = this.drag;
      if (!d || e.button !== 0) return;
      this.drag = null;
      if (!d.started) {
        // (a click on what is selected lets go of it - but not the second click of a double-click)
        const now = performance.now();
        const again = this._sameRef(d.ref, this.lastClick?.ref) && now - this.lastClick.t < 450;
        this.lastClick = { ref: d.ref, t: now };
        return this._select(d.ref, !again);
      }
      // (what is under it before the drag ends: that takes the drop zone away)
      const t = document.elementFromPoint(e.clientX, e.clientY);
      this._endDrag(d);
      this._drop(d, t);
    };
    window.addEventListener('pointermove', this._move);
    window.addEventListener('pointerup', this._up);

    // what is under the pointer: the hotkeys act on it, and a slim tooltip names it
    wrap.addEventListener('pointerover', (e) => {
      const t = e.target.closest('.cell, .eq, .armor, .pouch-cal');
      if (t === this.hoverEl) return;
      this.hoverEl = t;
      this._showTip(t, e.clientX, e.clientY);
    });
    wrap.addEventListener('pointerleave', () => {
      this.hoverEl = null;
      this.tip.hide();
    });

    // The popovers and the menu. A press anywhere else puts them away, and goes on to do whatever it does there
    // (captured: the grid's own handler comes after, and must find them closed)
    root.addEventListener(
      'pointerdown',
      (e) => {
        this.splitShut = -1;
        if (this.menu && !this.menuEl.contains(e.target)) {
          this._closeMenu();
          this.splitShut = 0x100; // (only closes it)
        }
        if (this.apop && !this.apEl.contains(e.target) && !e.target.closest('.pouch-cal')) this._closeAmmo();
        if (!this.split || this.splitEl.contains(e.target)) return;
        this.splitShut = this.split.from;
        this._closeSplit();
      },
      true,
    );
    // a left press on the backdrop (around the panels, or in the gaps between them) closes the screen. Not the press
    // that has just put a popover or the menu away: that one only closes it
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
    this.salvBtn.addEventListener('click', () => this._doSalvage());
    this.apRange.addEventListener('input', () => this._setAmmo(+this.apRange.value));
    this.apNum.addEventListener('input', () => {
      const digits = this.apNum.value.replace(/\D/g, '');
      if (digits !== this.apNum.value) this.apNum.value = digits;
      this._setAmmo(+digits, true);
    });
    this.apNum.addEventListener('change', () => this.apop && this._setAmmo(this.apop.n));
    this.apNum.addEventListener('focus', () => setTimeout(() => this.apNum.select()));
    this.apDrop.addEventListener('click', () => this._dropAmmo());
    this.apCraft.addEventListener('click', () => {
      const out = this.apop && AMMO_ITEMS[this.apop.cal];
      if (out) this.craft.craftOut(out);
    });
    // Enter splits (or salvages, on what cannot be split; or drops, in the ammo popover), Escape puts it away. Captured,
    // so that neither reaches the game (the chat, the pause menu)
    this._popKey = (e) => {
      if ((!this.split && !this.apop) || (e.key !== 'Enter' && e.key !== 'Escape')) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        this._closeSplit();
        this._closeAmmo();
      } else if (!e.repeat) {
        if (this.apop) this._dropAmmo();
        else if (this.splitRow.hidden) this._doSalvage();
        else this._doSplit(false);
      }
    };
    window.addEventListener('keydown', this._popKey, true);

    this.menuEl.addEventListener('click', (e) => {
      const b = e.target.closest('.ctx-item');
      if (!b || b.disabled) return;
      const it = this.menu?.items[+b.dataset.k];
      const ref = this.menu?.ref;
      this._closeMenu();
      if (it && ref) it.run();
    });

    this.sortEl.addEventListener('click', () => {
      this._closeSplit(); // (its stack is about to move)
      this.ui.sound('ui_click');
      cb.onSortItems();
    });
    this.throwAlt.addEventListener('click', (e) => {
      const b = e.target.closest('.tw');
      if (b) {
        this.ui.sound('ui_click');
        cb.onSelectThrowable(+b.dataset.item);
      }
    });
    this.throwAlt.addEventListener('pointerdown', (e) => e.target.closest('.tw') && e.stopPropagation());
    this.throwAlt.addEventListener('dblclick', (e) => e.stopPropagation());
    this.undoBtn.addEventListener('click', () => this._undo());

    // backpack search. Its keydowns are its own (the game and the screen's keys never see them), but Tab drops the
    // focus so that I closes the inventory again
    const field = this.bpInput;
    field.addEventListener('input', () => this._setQuery(field.value));
    field.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        return field.blur();
      }
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        if (field.value) this._setQuery('');
        else field.blur();
      } else if (e.key === 'Enter') field.blur();
    });
    this.bpClear.addEventListener('click', () => {
      this.ui.sound('ui_click');
      this._setQuery('');
      field.focus({ preventScroll: true });
    });
    this.chipBar.addEventListener('click', (e) => {
      const b = e.target.closest('.chip');
      if (!b) return;
      this.ui.sound('ui_click');
      this.filter = this.filter === b.dataset.f ? 'all' : b.dataset.f;
      this._renderGrid();
    });

    // The screen's keys, on what is under the pointer or else what is selected. Never from a text field (they keep
    // their keydowns, and isTyping() counts them too), never a key that opens or shuts a screen
    this._key = (e) => {
      if (!this.open || this.ui.isTyping() || e.ctrlKey || e.metaKey || e.altKey || menuKey(e.code)) return;
      if (e.code === 'Escape') {
        if (this.menu) this._closeMenu();
        else if (this.query) this._setQuery('');
        else if (this.sel) this._select(null);
        return;
      }
      if (e.repeat) return;
      if (e.code === 'Slash') {
        e.preventDefault();
        this.bpInput.focus({ preventScroll: true });
        return;
      }
      if (e.code === 'KeyZ' && this.undoAt) {
        e.preventDefault();
        return this._undo();
      }
      if (this.craft.key(e)) return void e.preventDefault();
      const act = { KeyF: 'main', KeyS: 'split', KeyG: e.shiftKey ? 'dropAll' : 'drop', KeyX: 'salvage' }[e.code];
      if (!act) return;
      const ref = (this.hoverEl && this._refOf(this.hoverEl)) || this.sel;
      if (!ref) return;
      e.preventDefault();
      this._closeMenu();
      this._do(act, ref, true);
    };
    window.addEventListener('keydown', this._key);
  }

  // ------------------------------------------------------------ what an element stands for, and what it can do
  _refOf(t) {
    const inv = this.inv;
    if (t.classList.contains('cell')) {
      const i = +t.dataset.i;
      const s = inv.slots[i];
      return s && i < inv.cap ? { kind: 'slot', i, item: s.item } : null;
    }
    if (t.classList.contains('eq')) {
      const slot = +t.dataset.slot;
      const item = inv.weapons[slot] | 0;
      if (!item) return null;
      // (the throwable slot only points at a stack in the backpack: that is what it stands for)
      if (slot === 3) {
        const i = inv.slots.findIndex((s, k) => s && s.item === item && k < inv.cap);
        return i >= 0 ? { kind: 'slot', i, item } : null;
      }
      return { kind: 'eq', slot, item };
    }
    if (t === this.armEl) return inv.armor ? { kind: 'worn', which: WORN.ARMOR, item: inv.armor.item } : null;
    if (t === this.packEl) return inv.backpack ? { kind: 'worn', which: WORN.BACKPACK, item: inv.backpack } : null;
    if (t.classList.contains('pouch-cal')) {
      const cal = +t.dataset.cal;
      return inv.ammo[cal] > 0 ? { kind: 'ammo', cal, item: AMMO_ITEMS[cal] } : null;
    }
    return null;
  }

  _sameRef(a, b) {
    return !!a && !!b && a.kind === b.kind && a.item === b.item && a.i === b.i && a.slot === b.slot && a.which === b.which && a.cal === b.cal;
  }

  // the backpack's extra pockets hold something: the backpack does not come off
  _pocketsUsed() {
    return this.inv.slots.filter((x, i) => x && i >= INVENTORY_SIZE).length;
  }

  // What each action is for a ref: { label, ok } (ok: it can be done now), or null where it does not apply
  _acts(ref) {
    const inv = this.inv;
    const s = ref.kind === 'slot' ? inv.slots[ref.i] : null;
    const cat = ITEM_DEFS[ref.item]?.cat;
    const salv = !!SALVAGE[ref.item];
    if (ref.kind === 'slot') {
      const main = MAIN_OF[cat];
      return {
        main: { label: main || 'Use', ok: !!main },
        split: { label: 'Split', ok: s.count > 1 },
        drop: { label: s.count > 1 ? 'Drop 1' : 'Drop', ok: true },
        dropAll: { label: `Drop all ${s.count}`, ok: s.count > 1 },
        salvage: { label: 'Salvage', ok: salv },
      };
    }
    if (ref.kind === 'eq') return { main: { label: 'Put in pack', ok: true }, split: null, drop: { label: 'Drop', ok: true }, dropAll: null, salvage: { label: 'Salvage', ok: salv } };
    if (ref.kind === 'worn') {
      const pack = ref.which === WORN.BACKPACK;
      const ok = !pack || !this._pocketsUsed();
      return { main: { label: 'Take off', ok }, split: null, drop: { label: 'Drop', ok }, dropAll: null, salvage: { label: 'Salvage', ok: ok && salv } };
    }
    const v = inv.ammo[ref.cal] | 0;
    return { main: { label: 'Amount…', ok: v > 0 }, split: null, drop: { label: 'Drop 1', ok: v > 0 }, dropAll: { label: `Drop all ${v}`, ok: v > 1 }, salvage: null };
  }

  // Do `act` (main / split / drop / dropAll / salvage) to ref. key: from a key (a refusal says nothing then)
  _do(act, ref, key) {
    const a = this._acts(ref)[act];
    const cb = this.ui.cb;
    if (!a || !a.ok) {
      if (!key) this._nudge(ref);
      return;
    }
    if (act === 'main') {
      if (ref.kind === 'slot') return this._useSlot(ref.i);
      this.ui.sound('ui_click');
      if (ref.kind === 'eq') return cb.onUnequip(ref.slot, 255);
      if (ref.kind === 'worn') return cb.onWorn(ref.which, WORN_DO.OFF);
      return this._openAmmo(ref.cal, this.calEls[ref.cal].b);
    }
    if (act === 'split') return this._openSplit(ref.i);
    if (act === 'drop' || act === 'dropAll') return this._dropRef(ref, act === 'dropAll' ? 0 : 1);
    if (act === 'salvage') {
      if (ref.kind === 'slot') return this._openSplit(ref.i, true);
      if (ref.kind === 'eq') return this._openSalvage(SALVAGE_FROM.WEAPON + ref.slot, ref.item, this.eqEls[ref.slot].r);
      if (ref.which === WORN.ARMOR) return this._openSalvage(SALVAGE_FROM.ARMOR, ref.item, this.armEl);
      this.ui.sound('ui_click');
      return cb.onWorn(WORN.BACKPACK, WORN_DO.SALVAGE);
    }
  }

  // n of ref on the ground (0: all of it), and the undo toast up for it
  _dropRef(ref, n) {
    const inv = this.inv;
    const cb = this.ui.cb;
    this.ui.sound('ui_click');
    if (ref.kind === 'slot') {
      const s = inv.slots[ref.i];
      if (!s) return;
      cb.onDropItem(ref.i, n);
      this._dropped(s.item, n === 0 ? s.count : Math.min(n, s.count));
    } else if (ref.kind === 'eq') {
      cb.onDropWeapon(ref.slot);
      this._dropped(ref.item, 1);
    } else if (ref.kind === 'worn') {
      cb.onWorn(ref.which, WORN_DO.DROP);
      this._dropped(ref.item, 1);
    } else {
      const v = inv.ammo[ref.cal] | 0;
      if (v <= 0) return;
      cb.onDropAmmo(ref.cal, n === 0 ? 0 : Math.min(n, v));
      this._dropped(ref.item, n === 0 ? v : Math.min(n, v));
    }
  }

  // what cannot be done to it: the thing it is shakes
  _nudge(ref) {
    const e = ref.kind === 'slot' ? this.cells[ref.i]?.c : ref.kind === 'eq' ? this.eqEls[ref.slot].r : ref.kind === 'worn' ? (ref.which === WORN.ARMOR ? this.armEl : this.packEl) : this.calEls[ref.cal]?.b;
    if (!e) return;
    e.getAnimations().forEach((a) => a.cancel());
    e.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'translateX(0)' }], { duration: 200 });
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
    } else this._nudge({ kind: 'slot', i });
  }

  // ------------------------------------------------------------ selection and the item card
  // ref: what to select (null: nothing). toggle: a click on what is selected already lets go of it
  _select(ref, toggle = false) {
    if (toggle && this._sameRef(ref, this.sel)) ref = null;
    if (ref?.kind === 'ammo') ref = null;
    if (this._sameRef(ref, this.sel) || (!ref && !this.sel)) return;
    this.sel = ref;
    this.craft.setItemFocus(ref?.item || 0);
    this._renderMarks();
    this._renderCard();
  }

  // the selection against the inventory as the server last left it: a stack that moved is followed (a sort, a swap), one
  // that is gone is let go of
  _syncSel() {
    const r = this.sel;
    if (!r) return;
    const inv = this.inv;
    let next = r;
    if (r.kind === 'slot') {
      if (inv.slots[r.i]?.item !== r.item) {
        const i = inv.slots.findIndex((s, k) => s && s.item === r.item && k < inv.cap);
        next = i >= 0 ? { ...r, i } : null;
      }
    } else if (r.kind === 'eq') {
      if ((inv.weapons[r.slot] | 0) !== r.item) next = null;
    } else if (r.kind === 'worn') {
      if ((r.which === WORN.ARMOR ? inv.armor?.item : inv.backpack) !== r.item) next = null;
    }
    if (next !== r) {
      this.sel = next;
      this.craft.setItemFocus(next?.item || 0);
    }
  }

  _renderCard() {
    const r = this.sel;
    this.cardEmpty.hidden = !!r;
    this.cardBody.hidden = !r;
    if (!r) return (this._cardSig = '');
    const inv = this.inv;
    const id = r.item;
    const d = ITEM_DEFS[id];
    const s = r.kind === 'slot' ? inv.slots[r.i] : null;
    const acts = this._acts(r);
    const key = JSON.stringify([r, s?.count, inv.armor, inv.weapons, inv.mags, this._pocketsUsed(), this.unlocked]);
    if (key === this._cardSig) return;
    this._cardSig = key;
    this.cardIco.innerHTML = itemIcon(id);
    this.cardName.textContent = d.name + (s && s.count > 1 ? ` ×${s.count}` : '');
    this.cardCat.textContent = (CAT_LABEL[d.cat] || '') + (r.kind === 'eq' ? ' · in your hands' : r.kind === 'worn' ? ' · worn' : '');
    this.cardCat.className = 'card-cat c-' + d.cat;
    const q = r.kind === 'slot' && quickKey(id);
    this.cardKey.textContent = q ? `${q[0]}: ${bindLabel(q[1])}` : '';
    // what it does, in a line: its description, then its numbers, then (worn or in its slot) how it stands
    const extra = [];
    if (r.kind === 'worn' && r.which === WORN.ARMOR && inv.armor) extra.push(`${Math.ceil(inv.armor.points)} / ${inv.armor.max} armor left`);
    if (r.kind === 'worn' && r.which === WORN.BACKPACK) extra.push(this._pocketsUsed() ? `${this._pocketsUsed()} / ${BACKPACK_SLOTS} of its slots in use: empty them to take it off` : `${BACKPACK_SLOTS} extra slots, all empty`);
    if (r.kind === 'eq' && isFirearm(id)) {
      const w = WEAPONS[id];
      extra.push(`${inv.mags[r.slot === 0 ? 0 : 1] | 0} / ${w.mag} loaded · ${inv.ammo[w.ammo] | 0} ${AMMO_NAMES[w.ammo]} carried`);
    }
    // (a description that already gives a number - "Heals 80 HP." - is not told it again)
    const desc = (d.desc || '').toLowerCase();
    const stats = statLines(id).filter((x) => !desc.includes(x.toLowerCase()));
    this.cardDesc.textContent = [d.desc, [...stats.slice(0, 2), ...extra].join(' · ')].filter(Boolean).join(' ');

    const set = (btn, a, primary) => {
      btn.b.hidden = !a;
      if (!a) return;
      btn.t.textContent = a.label;
      btn.b.disabled = !a.ok;
      btn.b.classList.toggle('primary', !!primary && a.ok);
    };
    set(this.cbMain, acts.main, true);
    set(this.cbSplit, acts.split || { label: 'Split', ok: false });
    set(this.cbDrop, acts.drop);
    set(this.cbAll, acts.dropAll && acts.dropAll.ok ? acts.dropAll : null);
    set(this.cbSalv, acts.salvage || { label: 'Salvage', ok: false });
    this.cbAll.b.classList.add('danger');

    // what it is for: what it goes into, where more of it is found, what it comes apart into
    const foot = this.cardFoot;
    foot.textContent = '';
    const part = (label, text) => {
      if (!text) return;
      if (foot.childNodes.length) el('span', 'cf-sep', foot, ' · ');
      el('span', 'cf-l', foot, label + ' ');
      el('b', '', foot, text);
    };
    const used = usedIn(id, this.unlocked);
    part('Used in', used ? used.list.map((u) => u.name).join(', ') + (used.more ? ` +${used.more}` : '') : r.kind === 'slot' && d.cat === 'res' ? 'nothing' : '');
    if (sourcesOf(id).length) part('Found in', foundIn(id, this.unlocked, 2).toLowerCase());
    if (SALVAGE[id]) part('Salvages into', costLine(SALVAGE[id]));
    foot.hidden = !foot.childNodes.length;
  }

  // ------------------------------------------------------------ tooltip
  _showTip(t, x, y) {
    if (!t || this.drag?.started || this.split || this.apop || this.menu) return this.tip.hide();
    const ref = this._refOf(t);
    if (!ref) return this.tip.hide();
    const d = ITEM_DEFS[ref.item];
    let hint = '';
    if (ref.kind === 'ammo') hint = `${this.inv.ammo[ref.cal]} carried · click for an amount`;
    else if (ref.kind === 'slot') hint = MAIN_OF[d.cat] ? `Double-click to ${MAIN_OF[d.cat].toLowerCase()} · right-click for more` : 'Right-click for more';
    else if (ref.kind === 'eq') hint = 'Double-click or drag into the pack · right-click for more';
    else hint = 'Double-click to take off · right-click for more';
    this.tip.show({ name: d.name, cat: CAT_LABEL[d.cat], catCls: 'c-' + d.cat, hint }, x, y);
  }

  // ------------------------------------------------------------ the right-click menu
  _openMenu(ref, x, y) {
    this._closeSplit();
    this._closeAmmo();
    this.tip.hide();
    const inv = this.inv;
    const acts = this._acts(ref);
    const items = [];
    const add = (label, key, run, opts = {}) => items.push({ label, key, run, ...opts });
    const sep = () => items.push({ sep: true });
    if (ref.kind === 'ammo') {
      const v = inv.ammo[ref.cal] | 0;
      const drop = (n) => () => this._dropRef(ref, n);
      for (const n of [10, 30]) if (v > n) add(`Drop ${n}`, '', drop(n));
      if (v > 1) add(`Drop half (${Math.ceil(v / 2)})`, '', drop(Math.ceil(v / 2)));
      add('Drop amount…', '', () => this._openAmmo(ref.cal, this.calEls[ref.cal].b));
      add(`Drop all ${v}`, 'Shift+G', drop(0), { danger: true });
      const rec = RECIPES.find((r) => r.out === ref.item);
      if (rec) {
        sep();
        add(`Craft +${rec.n}`, '', () => this.craft.craftOut(ref.item), { off: !this._craftable(rec) });
      }
    } else {
      if (acts.main) add(acts.main.label, 'F', () => this._do('main', ref, false), { off: !acts.main.ok });
      if (ref.kind === 'slot') add('Split…', 'S', () => this._do('split', ref, false), { off: !acts.split.ok });
      sep();
      const s = ref.kind === 'slot' ? inv.slots[ref.i] : null;
      if (s && s.count > 1) {
        const drop = (n) => () => this._dropRef(ref, n);
        add('Drop 1', 'G', drop(1));
        if (s.count > 10) add('Drop 10', '', drop(10));
        if (s.count > 2) add(`Drop half (${Math.ceil(s.count / 2)})`, '', drop(Math.ceil(s.count / 2)));
        add('Drop amount…', '', () => this._openSplit(ref.i, false, true));
        add(`Drop all ${s.count}`, 'Shift+G', drop(0), { danger: true });
      } else add('Drop', 'G', () => this._do('drop', ref, false), { danger: true, off: !acts.drop.ok });
      if (acts.salvage) {
        sep();
        add('Salvage…', 'X', () => this._do('salvage', ref, false), { off: !acts.salvage.ok, note: acts.salvage.ok ? '' : "can't" });
      }
    }
    const m = this.menuEl;
    m.textContent = '';
    const head = el('div', 'ctx-head', m);
    svgEl('i', 'ctx-ico', head, itemIcon(ref.item));
    el('span', 'ctx-name', head, ref.kind === 'ammo' ? `${AMMO_NAMES[ref.cal]} rounds` : ITEM_DEFS[ref.item].name);
    const cnt = ref.kind === 'slot' ? inv.slots[ref.i].count : ref.kind === 'ammo' ? inv.ammo[ref.cal] : 0;
    if (cnt > 1) el('span', 'ctx-n', head, String(cnt));
    items.forEach((it, k) => {
      if (it.sep) {
        if (m.lastChild?.className !== 'ctx-sep') el('div', 'ctx-sep', m);
        return;
      }
      const b = el('button', 'ctx-item' + (it.danger ? ' danger' : ''), m);
      b.type = 'button';
      b.dataset.k = k;
      b.disabled = !!it.off;
      el('span', 'ctx-l', b, it.label);
      if (it.note) el('span', 'ctx-note', b, it.note);
      else if (it.key) el('span', 'kbd sm', b, it.key);
    });
    if (m.lastChild?.className === 'ctx-sep') m.lastChild.remove();
    this.menu = { ref, items };
    m.hidden = false;
    const o = this.root.getBoundingClientRect();
    const r = m.getBoundingClientRect();
    const px = clamp(x + 2, o.left + 8, o.right - r.width - 8);
    const py = clamp(y + 2, o.top + 8, o.bottom - r.height - 8);
    m.style.transform = `translate(${Math.round(px - o.left)}px,${Math.round(py - o.top)}px)`;
    this._renderMarks();
  }

  _closeMenu() {
    if (!this.menu) return;
    this.menu = null;
    this.menuEl.hidden = true;
    this._renderMarks();
  }

  // ------------------------------------------------------------ dragging
  _startDrag(d) {
    d.started = true;
    d.over = -1;
    d.mark = null;
    d.bad = null;
    this.tip.hide();
    this._closeMenu();
    const s = d.eq >= 0 ? { item: this.inv.weapons[d.eq], count: 1 } : this.inv.slots[d.i];
    this.ghost = svgEl('div', 'drag-ghost', this.ui.root, itemIcon(s.item));
    if (s.count > 1) el('span', 'cell-n', this.ghost, String(s.count));
    (d.eq >= 0 ? this.eqEls[d.eq].r : this.cells[d.i].c).classList.add('dragging');
    this.dzWhat.textContent = `${ITEM_DEFS[s.item].name}${s.count > 1 ? ' ×' + s.count : ''} · stays where you stand for your team`;
    this.root.classList.add('dragging');
  }

  _dragOver(d, e) {
    this.ghost.style.transform = `translate(${e.clientX}px,${e.clientY}px) translate(-50%,-50%)`;
    const t = document.elementFromPoint(e.clientX, e.clientY);
    const over = t?.closest('.cell');
    const oi = over && !over.hidden ? +over.dataset.i : -1;
    if (d.over !== oi) {
      if (d.over >= 0) this.cells[d.over].c.classList.remove('drop-t', 'no-drop');
      d.over = oi;
      if (oi >= 0 && oi !== d.i) this.cells[oi].c.classList.add(this._canDrop(d, oi) ? 'drop-t' : 'no-drop');
    }
    // where it would go besides a cell: the backpack as a whole (a weapon out of its slot), or the slot a weapon or
    // vest from the backpack would be equipped in
    const mark = this._dropMark(d, t);
    if (d.mark !== mark) {
      d.mark?.classList.remove('drop-in');
      d.mark = mark;
      mark?.classList.add('drop-in');
    }
    const zone = !!t?.closest('.dropzone');
    this.dropZone.classList.toggle('on', zone);
    this.ghost.classList.toggle('dropping', zone);
  }

  _endDrag(d) {
    if (!d.started) return;
    this.ghost?.remove();
    this.ghost = null;
    (d.eq >= 0 ? this.eqEls[d.eq].r : this.cells[d.i].c).classList.remove('dragging');
    if (d.over >= 0) this.cells[d.over].c.classList.remove('drop-t', 'no-drop');
    d.mark?.classList.remove('drop-in');
    this.root.classList.remove('dragging');
    this.dropZone.classList.remove('on');
  }

  // let go of over t: on the ground (the drop zone), into the backpack or a slot, swapped with a stack - or, when none
  // of that can be, nothing, and the section it may move in says so
  _drop(d, t) {
    const cb = this.ui.cb;
    const over = t?.closest('.cell');
    if (t?.closest('.dropzone')) return this._dropRef(d.ref, 0);
    if (d.eq >= 0) {
      // a weapon out of its slot: onto the backpack (that cell if it can take it, else the first free one)
      if (t?.closest('.grid-wrap')) {
        this.ui.sound('ui_click');
        cb.onUnequip(d.eq, over && this._canDrop(d, +over.dataset.i) ? +over.dataset.i : 255);
      }
      return;
    }
    if (over) {
      const b = +over.dataset.i;
      if (b === d.i) return;
      if (!this._canSwap(d.i, b)) return this._flashSection(d.i, b);
      this.ui.sound('ui_click');
      cb.onSwapItems(d.i, b);
      // shown at once as the server will do it (ACT.SWAP_INV; its inventory overwrites this on the next set): onto a
      // stack of the same with room, that one is topped up; else the two trade places
      const sl = this.inv.slots;
      const A = sl[d.i];
      const B = sl[b];
      const max = ITEM_DEFS[A.item]?.stack || 1;
      if (A.item === B.item && max > 1 && B.count < max) {
        const move = Math.min(max - B.count, A.count);
        sl[b] = { item: B.item, count: B.count + move };
        sl[d.i] = A.count > move ? { item: A.item, count: A.count - move } : null;
      } else [sl[d.i], sl[b]] = [sl[b], sl[d.i]];
      this._syncSel();
      this._renderGrid();
      this._renderCard();
    } else if (this._dropMark(d, t)) this._useSlot(d.i); // (a weapon, vest or throwable let go over the Loadout: equipped)
  }

  // A drag from slot a onto b that cannot land: the section it may move within lights up, and says so
  _flashSection(a, b) {
    const from = secOf(this.inv.slots[a]);
    const s = this.secEls[from];
    if (!s) return;
    const label = SECTIONS.find((x) => x.id === from).label;
    s.note.textContent = this.inv.slots[b] ? `${label} stay together: swap within this section` : 'Sort keeps the free slots last';
    s.h.classList.remove('flash');
    void s.h.offsetWidth;
    s.h.classList.add('flash');
    clearTimeout(this.flashT);
    this.flashT = setTimeout(() => {
      s.h.classList.remove('flash');
      s.note.textContent = '';
    }, 1800);
  }

  // A cell the drag would land on: a stack of the same section to swap with (_canSwap), or - a weapon from its slot -
  // an empty cell, or a weapon for that same slot (the two trade places)
  _canDrop(d, b) {
    if (d.eq < 0) return this._canSwap(d.i, b);
    const s = this.inv.slots[b];
    return b >= 0 && b < this.inv.cap && (!s || WEAPONS[s.item]?.slot === d.eq);
  }

  // Over t, what lights up besides a cell: the backpack, for a weapon from its slot; the slot (or the armor) a weapon,
  // throwable or vest from the backpack would be equipped in, over the Loadout. Null: nothing
  _dropMark(d, t) {
    if (d.eq >= 0) return t?.closest('.grid-wrap') && !(d.over >= 0 && this._canDrop(d, d.over)) ? this.gridWrap : null;
    if (!t?.closest('.inv-left')) return null;
    const item = this.inv.slots[d.i]?.item;
    const cat = ITEM_DEFS[item]?.cat;
    if (cat === 'weapon') return this.eqEls[WEAPONS[item].slot]?.r || null;
    if (cat === 'throw') return this.eqEls[3].r;
    return cat === 'armor' ? this.armEl : null;
  }

  // A drag from slot a onto slot b swaps the two stacks (or tops up b, the same item) when both sit in the same section.
  // Anywhere else it would change nothing that can be seen, the grid keeping its order.
  _canSwap(a, b) {
    const sl = this.inv.slots;
    return b >= 0 && b < this.inv.cap && a !== b && !!sl[a] && !!sl[b] && secOf(sl[a]) === secOf(sl[b]);
  }

  // ------------------------------------------------------------ split / salvage popover
  // The popover on stack i: how much of it to put in a slot of its own or down on the ground for a teammate, and - for
  // anything SALVAGE lists - how much of it to tear down. A single item opens it only for that. Half the stack is
  // picked to begin with. salvage: opened for that (X): all of a single one, one of a stack. amount: for "Drop amount…"
  _openSplit(i, salvage = false, amount = false) {
    const s = this.inv.slots[i];
    if (!s || (s.count < 2 && !SALVAGE[s.item])) return;
    this._openPop({ i, from: i, item: s.item, n: salvage ? 1 : Math.max(1, s.count >> 1) }, this.cells[i].c);
    if (amount && !this.splitRow.hidden) this.splitNum.focus({ preventScroll: true });
  }

  // ...on a weapon in its slot, or the armor worn (from: SALVAGE_FROM): those can only be torn down
  _openSalvage(from, item, anchor) {
    if (SALVAGE[item]) this._openPop({ i: -1, from, item, n: 1 }, anchor);
  }

  // It sits above what it is open on, or below when there is no room there, and inside the screen either way
  _openPop(sp, anchor) {
    this._closeSplit();
    this._closeAmmo();
    this._closeMenu();
    this.tip.hide();
    this.split = { ...sp, count: 1, anchor };
    this.splitIco.innerHTML = itemIcon(sp.item);
    this.splitName.textContent = ITEM_DEFS[sp.item]?.name || '';
    this.splitEl.hidden = false;
    anchor.classList.add('splitting');
    this._syncSplit();
    if (!this.split) return;
    this._place(this.splitEl, anchor);
    // (the Salvage button is never given the focus: Space - a craft, or a jump - would press it)
    if (!this.splitRow.hidden) this.splitRange.focus({ preventScroll: true });
  }

  _place(pop, anchor) {
    const c = anchor.getBoundingClientRect();
    const o = this.root.getBoundingClientRect();
    const r = pop.getBoundingClientRect();
    const x = clamp(c.left + c.width / 2 - r.width / 2, o.left + 8, o.right - r.width - 8);
    const y = c.top - r.height - 8 >= o.top + 8 ? c.top - r.height - 8 : Math.min(c.bottom + 8, o.bottom - r.height - 8);
    pop.style.transform = `translate(${Math.round(x - o.left)}px,${Math.round(y - o.top)}px)`;
  }

  // the popover against what it is open on as the server last left it: put away when that is gone (or a stack of what
  // cannot be salvaged is down to one), and never picking more than there is
  _syncSplit() {
    const sp = this.split;
    if (!sp) return;
    if (sp.i >= 0) {
      const s = this.inv.slots[sp.i];
      if (!s || s.item !== sp.item || (s.count < 2 && !SALVAGE[s.item])) return this._closeSplit();
      sp.count = s.count;
    } else if ((sp.from === SALVAGE_FROM.ARMOR ? this.inv.armor?.item : this.inv.weapons[sp.from - SALVAGE_FROM.WEAPON]) !== sp.item) return this._closeSplit();
    const many = sp.count > 1;
    this.splitRow.hidden = this.splitBtns.hidden = !many;
    this.splitOf.textContent = many ? 'of ' + sp.count : '';
    if (many) this.splitRange.max = sp.count;
    this.salvEl.hidden = !SALVAGE[sp.item];
    this.salvEl.classList.toggle('alone', !many);
    this._setSplit(sp.n);
  }

  // typed: it came from the number field, whose text is left as it was typed
  _setSplit(n, typed = false) {
    const sp = this.split;
    if (!sp) return;
    const max = sp.count;
    const salv = !!SALVAGE[sp.item];
    sp.n = clamp(n | 0, 1, max);
    if (max > 1) {
      const free = this.inv.slots.some((s, i) => !s && i < this.inv.cap);
      this.splitRange.value = sp.n;
      this.splitRange.style.setProperty('--p', (((sp.n - 1) / (max - 1)) * 100).toFixed(1) + '%');
      if (!typed) this.splitNum.value = String(sp.n);
      this.splitDrop.textContent = 'Drop ' + sp.n;
      this.splitKeep.textContent = 'Split ' + sp.n;
      // nothing to split off a stack taken whole, and nowhere to put it with every slot taken
      this.splitKeep.disabled = sp.n >= max || !free;
      this.splitNote.textContent = sp.n >= max ? (salv ? 'The whole stack: nothing left to split off' : 'The whole stack: it can only be dropped') : free ? '' : 'No free slot to split into';
    } else this.splitNote.textContent = '';
    if (!salv) return;
    this.salvYield.textContent = '';
    for (const [id, k] of salvageOf(sp.item, sp.n)) {
      const chip = el('span', 'ing salv-ing', this.salvYield);
      svgEl('i', 'ing-ico', chip, itemIcon(id));
      el('span', 'ing-t', chip, `${ITEM_DEFS[id].name} ×${k}`);
    }
    this.salvBtn.textContent = max > 1 ? 'Salvage ' + sp.n : 'Salvage';
    this.salvNote.textContent = isFirearm(sp.item) ? 'Any rounds still in it go back into the pack' : '';
  }

  // drop: the amount picked goes on the ground; else into a free slot of its own
  _doSplit(drop) {
    const sp = this.split;
    if (!sp || sp.i < 0 || (!drop && this.splitKeep.disabled)) return;
    if (drop) this._dropRef({ kind: 'slot', i: sp.i, item: sp.item }, sp.n);
    else {
      this.ui.sound('ui_click');
      this.ui.cb.onSplitItem(sp.i, sp.n);
    }
    this._closeSplit();
  }

  // the amount picked torn down for what it is made of
  _doSalvage() {
    const sp = this.split;
    if (!sp || !SALVAGE[sp.item]) return;
    this.ui.cb.onSalvage(sp.from, sp.n);
    this._closeSplit();
  }

  _closeSplit() {
    if (!this.split) return;
    this.split.anchor.classList.remove('splitting');
    this.split = null;
    this.splitEl.hidden = true;
    // (a focused number field would keep ui.isTyping() true and swallow gameplay keys)
    if (this.splitEl.contains(document.activeElement)) document.activeElement.blur();
  }

  // ------------------------------------------------------------ the ammo popover
  _openAmmo(cal, anchor) {
    const v = this.inv.ammo[cal] | 0;
    if (v <= 0) return;
    this._closeSplit();
    this._closeMenu();
    this._closeAmmo();
    this.tip.hide();
    this.apop = { cal, n: Math.ceil(v / 2), anchor };
    this.apIco.innerHTML = itemIcon(AMMO_ITEMS[cal]);
    this.apName.textContent = `${AMMO_NAMES[cal]} rounds`;
    this.apEl.hidden = false;
    anchor.classList.add('splitting');
    this._syncAmmo();
    if (!this.apop) return;
    this._place(this.apEl, anchor);
    this.apRange.focus({ preventScroll: true });
  }

  _closeAmmo() {
    if (!this.apop) return;
    this.apop.anchor.classList.remove('splitting');
    this.apop = null;
    this.apEl.hidden = true;
    if (this.apEl.contains(document.activeElement)) document.activeElement.blur();
  }

  _syncAmmo() {
    const ap = this.apop;
    if (!ap) return;
    const v = this.inv.ammo[ap.cal] | 0;
    if (v <= 0) return this._closeAmmo();
    this.apOf.textContent = `${v} carried`;
    this.apRange.max = v;
    this.apRange.disabled = v < 2;
    this._setAmmo(ap.n);
  }

  _setAmmo(n, typed = false) {
    const ap = this.apop;
    if (!ap) return;
    const v = this.inv.ammo[ap.cal] | 0;
    ap.n = clamp(n | 0, 1, Math.max(1, v));
    this.apRange.value = ap.n;
    this.apRange.style.setProperty('--p', (v > 1 ? ((ap.n - 1) / (v - 1)) * 100 : 100).toFixed(1) + '%');
    if (!typed) this.apNum.value = String(ap.n);
    for (const p of this.apPre) p.b.classList.toggle('on', p.f(v) === ap.n);
    this.apPre[0].b.disabled = v < 10;
    this.apPre[1].b.disabled = v < 30;
    this.apDropT.textContent = `Drop ${ap.n}`;
    // after it: how many magazines' worth are left for the gun that fires it
    const gun = this._gunsFor(ap.cal).held[0];
    const mag = gun ? WEAPONS[gun].mag : 0;
    const left = v - ap.n;
    const notes = ['Lands at your feet for a teammate.'];
    if (mag > 1) notes.push(`${Math.floor(left / mag)} magazine${Math.floor(left / mag) === 1 ? '' : 's'} left for the ${ITEM_DEFS[gun].name} after this.`);
    const rec = RECIPES.find((r) => r.out === AMMO_ITEMS[ap.cal]);
    this.apCraft.hidden = !rec;
    if (rec) {
      const ok = this._craftable(rec);
      this.apCraft.textContent = `Craft +${rec.n}`;
      this.apCraft.disabled = !ok;
      if (!ok) notes.push(rec.station && !this.near[rec.station] ? `Crafting needs a ${rec.station === 'fire' ? 'campfire' : 'workbench'}.` : `Crafting it takes ${costLine(rec.cost)}.`);
    }
    this.apNote.textContent = notes.join(' ');
  }

  _dropAmmo() {
    const ap = this.apop;
    if (!ap) return;
    this._dropRef({ kind: 'ammo', cal: ap.cal, item: AMMO_ITEMS[ap.cal] }, ap.n);
    this._closeAmmo();
  }

  // can a recipe be made right now (the crafting column's word for it)
  _craftable(rec) {
    const c = this.craft.byId.get(rec.id);
    return !!c && c.group === 'ready' && c.max > 0;
  }

  // the guns that fire a calibre: the ones in their slots (held), and the ones in the backpack
  _gunsFor(cal) {
    const inv = this.inv;
    const fires = (id) => isFirearm(id) && WEAPONS[id].ammo === cal;
    const held = [inv.weapons[0], inv.weapons[1]].filter((id) => id && fires(id));
    const packed = [...new Set(inv.slots.filter((s, i) => s && i < inv.cap && fires(s.item)).map((s) => s.item))];
    return { held, packed };
  }

  // ------------------------------------------------------------ undo
  // A drop has just gone down: say what, and offer to take it back for UNDO_TIME
  _dropped(item, n) {
    if (!item || n <= 0) return;
    this.undoIco.innerHTML = itemIcon(item);
    const d = ITEM_DEFS[item];
    this.undoTxt.textContent = `Dropped ${d.cat === 'ammo' ? `${n} ${AMMO_NAMES[d.ammo]} rounds` : d.name + (n > 1 ? ' ×' + n : '')} at your feet`;
    this.undoEl.hidden = false;
    this.undoAt = performance.now();
    const bar = this.undoBar;
    bar.getAnimations().forEach((a) => a.cancel());
    bar.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: UNDO_TIME * 1000, easing: 'linear' });
    clearTimeout(this.undoT);
    this.undoT = setTimeout(() => this._hideUndo(), UNDO_TIME * 1000);
  }

  _undo() {
    if (!this.undoAt) return;
    this.ui.sound('ui_click');
    this.ui.cb.onUndoDrop();
    this._hideUndo();
  }

  _hideUndo() {
    clearTimeout(this.undoT);
    this.undoAt = 0;
    this.undoEl.hidden = true;
  }

  // ------------------------------------------------------------ backpack search
  _setQuery(text) {
    if (this.bpInput.value !== text) this.bpInput.value = text;
    this.query = norm(text);
    this.bpClear.hidden = !text;
    this.bpFind.classList.toggle('on', !!this.query);
    this._renderMarks();
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
      mags: inv.mags || [0, 0],
      throwCounts: inv.throwCounts || {},
    };
    this.counts = {};
    for (const s of this.inv.slots) if (s) this.counts[s.item] = (this.counts[s.item] || 0) + s.count;
    this._syncSel();
    this._renderAll();
    this._syncSplit();
    this._syncAmmo();
    if (this.menu && !this._refStill(this.menu.ref)) this._closeMenu();
  }

  _refStill(ref) {
    const inv = this.inv;
    if (ref.kind === 'slot') return inv.slots[ref.i]?.item === ref.item;
    if (ref.kind === 'eq') return (inv.weapons[ref.slot] | 0) === ref.item;
    if (ref.kind === 'ammo') return inv.ammo[ref.cal] > 0;
    return (ref.which === WORN.ARMOR ? inv.armor?.item : inv.backpack) === ref.item;
  }

  _renderAll() {
    this._renderGrid();
    this._renderLoadout();
    this._renderWorn();
    this._renderPouch(false);
    this._renderCard();
    this.craft.render();
    this.renderUses();
  }

  // the backpack: its cells, their order in sections, the chips' counts, the capacity
  _renderGrid() {
    const inv = this.inv;
    for (let i = 0; i < INVENTORY_MAX; i++) this._renderCell(i);
    const used = inv.slots.filter((s, i) => s && i < inv.cap).length;
    const capKey = used + '/' + inv.cap;
    if (this._capKey !== capKey) {
      this._capKey = capKey;
      this.capEl.textContent = used + ' / ' + inv.cap;
      const full = used >= inv.cap;
      const warn = !full && used >= inv.cap * CAP_WARN;
      this.capEl.classList.toggle('full', full);
      this.capEl.classList.toggle('warn', warn);
      this.capBar.classList.toggle('full', full);
      this.capBar.classList.toggle('warn', warn);
      this.capFill.style.transform = `scaleX(${clamp(used / inv.cap, 0, 1)})`;
      this.capBar.style.setProperty('--segs', inv.cap);
      this.capBar.title = full ? 'The backpack is full: pickups stay on the ground' : warn ? 'Nearly full' : `${inv.cap - used} slots free`;
      this.lockedEl.hidden = inv.cap > INVENTORY_SIZE;
    }
    // how many stacks of each kind
    const n = { all: 0 };
    for (let i = 0; i < inv.cap; i++) {
      const s = inv.slots[i];
      if (!s) continue;
      n.all++;
      const sec = secOf(s);
      n[sec] = (n[sec] || 0) + 1;
    }
    if (this.filter !== 'all' && !n[this.filter]) this.filter = 'all';
    for (const c of this.chips) {
      const v = n[c.id] || 0;
      c.b.classList.toggle('on', c.id === this.filter);
      if (c.v === v) continue;
      c.v = v;
      c.n.textContent = String(v);
      c.b.classList.toggle('zero', !v);
      c.b.disabled = !v && c.id !== 'all';
    }
    // the order: each section that has anything (all of them, or the one the chip picks) with its stacks in slot order,
    // then the free cells. The locked pockets are not shown at all
    const order = [];
    for (const s of SECTIONS) {
      const sec = this.secEls[s.id];
      const k = n[s.id] || 0;
      const show = k > 0 && (this.filter === 'all' || this.filter === s.id);
      if (sec.n !== k) {
        sec.n = k;
        sec.t.textContent = `${s.label} · ${k}`;
      }
      sec.h.hidden = !show;
      if (!show) continue;
      order.push(sec.h);
      for (let i = 0; i < inv.cap; i++) if (inv.slots[i] && secOf(inv.slots[i]) === s.id) order.push(this.cells[i].c);
    }
    if (this.filter === 'all') for (let i = 0; i < inv.cap; i++) if (!inv.slots[i]) order.push(this.cells[i].c);
    for (let i = 0; i < INVENTORY_MAX; i++) this.cells[i].c.hidden = !order.includes(this.cells[i].c);
    const key = order.map((e) => e.dataset.i ?? e.firstChild.textContent).join(',');
    if (this._orderKey !== key) {
      this._orderKey = key;
      for (const e of order) this.grid.appendChild(e);
    }
    this._renderMarks();
  }

  _renderCell(i) {
    const s = this.inv.slots[i];
    const cell = this.cells[i];
    const key = s ? s.item + ':' + s.count : '';
    if (cell.key === key) return;
    cell.key = key;
    cell.cat = s ? ITEM_DEFS[s.item]?.cat || 'res' : '';
    cell.ico.innerHTML = s ? itemIcon(s.item) : '';
    cell.n.textContent = s && s.count > 1 ? String(s.count) : '';
    cell.name.textContent = s ? shortName(s.item) : '';
    cell.cls = '';
  }

  // the cells' states: selected, a search match (or not), about to be used by the recipe in focus, under a popover
  _renderMarks() {
    const q = this.query;
    let found = 0;
    const sel = this.sel?.kind === 'slot' ? this.sel.i : -1;
    const pop = this.split?.i ?? this.menu?.ref.i ?? -1;
    for (let i = 0; i < INVENTORY_MAX; i++) {
      const cell = this.cells[i];
      const s = this.inv.slots[i];
      const hit = !!q && !!s && itemScore(s.item, q) > 0;
      if (hit && i < this.inv.cap) found++;
      const cls = 'cell' + (s ? ' c-' + cell.cat : ' empty') + (i === sel ? ' sel' : '') + (q ? (hit ? ' hit' : ' dim') : '') + (cell.take ? ' used' : '') + (i === pop ? ' splitting' : '');
      if (cell.cls !== cls) cell.c.className = cell.cls = cls;
    }
    this.bpCount.textContent = q ? (found ? `${found} found` : 'none') : '';
    this.bpCount.classList.toggle('none', !!q && !found);
    for (const q2 of this.eqEls) q2.r.classList.toggle('sel', this.sel?.kind === 'eq' && this.sel.slot === +q2.r.dataset.slot);
    this.armEl.classList.toggle('sel', this.sel?.kind === 'worn' && this.sel.which === WORN.ARMOR);
    this.packEl.classList.toggle('sel', this.sel?.kind === 'worn' && this.sel.which === WORN.BACKPACK);
  }

  // The stacks the recipe in focus (picked in the crafting column, or tracked) would be paid from, each marked with how
  // many of it it takes
  renderUses() {
    const f = this.craft?.focus();
    const takes = f ? takesOf(f.r.cost, f.n, this.inv.slots) : null;
    for (let i = 0; i < INVENTORY_MAX; i++) {
      const cell = this.cells[i];
      const t = takes?.get(i) || 0;
      if (cell.take === t) continue;
      cell.take = t;
      cell.use.textContent = t ? '−' + t : '';
    }
    this._renderMarks();
  }

  _renderLoadout() {
    const inv = this.inv;
    const w = inv.weapons;
    const tc = inv.throwCounts || {};
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
      // a gun: its calibre, what is in the magazine, and what is carried for it - low (red) under one magazine
      const gun = (i === 0 || i === 1) && isFirearm(id) ? WEAPONS[id] : null;
      const mag = gun ? inv.mags[i] | 0 : 0;
      const spare = gun ? inv.ammo[gun.ammo] | 0 : 0;
      const akey = gun ? `${id}:${mag}:${spare}` : '';
      if (q.akey === akey) return;
      q.akey = akey;
      q.ammo.hidden = !gun;
      if (!gun) return;
      q.cal.textContent = AMMO_NAMES[gun.ammo];
      q.mag.textContent = gun.mag > 1 ? `${mag}/${gun.mag}` : mag ? 'loaded' : 'empty';
      q.fill.style.transform = `scaleX(${clamp(mag / gun.mag, 0, 1)})`;
      q.spare.textContent = `· ${spare} spare`;
      q.ammo.classList.toggle('low', spare < gun.mag);
      q.ammo.title = spare < gun.mag ? `Less than one magazine of ${AMMO_NAMES[gun.ammo]} left to reload with` : '';
    });
    // other throwables to switch to
    const throws = Object.entries(tc).filter(([, n]) => n > 0);
    const twKey = (w[3] | 0) + ':' + throws.map((t) => t.join('x')).join(',');
    if (this._twKey !== twKey) {
      this._twKey = twKey;
      this.throwAlt.textContent = '';
      if (throws.length > 1 || (throws.length === 1 && +throws[0][0] !== (w[3] | 0))) {
        for (const [id, n] of throws) {
          const b = el('button', 'tw' + (+id === (w[3] | 0) ? ' on' : ''), this.throwAlt);
          b.type = 'button';
          b.dataset.item = id;
          b.title = 'Select ' + ITEM_DEFS[id]?.name;
          svgEl('i', 'tw-ico', b, itemIcon(+id));
          el('span', 'tw-n', b, '×' + n);
        }
      }
    }
  }

  _renderWorn() {
    const a = this.inv.armor;
    const armKey = a ? a.item + ':' + Math.ceil(a.points) + ':' + a.max : '';
    if (this._armKey !== armKey) {
      this._armKey = armKey;
      this.armEl.classList.toggle('empty', !a);
      if (a) {
        this.armIco.innerHTML = itemIcon(a.item);
        this.armName.textContent = ITEM_DEFS[a.item]?.name || 'Armor';
        this.armSub.textContent = `${Math.ceil(a.points)} / ${a.max} armor`;
        this.armFill.style.transform = `scaleX(${clamp(a.points / (a.max || 1), 0, 1)})`;
      } else {
        this.armIco.innerHTML = glyph('shield');
        this.armName.textContent = 'No armor';
        this.armSub.textContent = 'wear a vest or jacket';
        this.armFill.style.transform = 'scaleX(0)';
      }
    }
    const pack = this.inv.backpack;
    const pocket = this._pocketsUsed();
    const packKey = pack + ':' + pocket;
    if (this._packKey !== packKey) {
      this._packKey = packKey;
      this.packEl.classList.toggle('empty', !pack);
      this.packIco.innerHTML = itemIcon(ITEM.BACKPACK);
      this.packName.textContent = pack ? ITEM_DEFS[pack]?.name || 'Backpack' : 'No backpack';
      this.packSub.textContent = pack ? `+${BACKPACK_SLOTS} slots · ${pocket}/${BACKPACK_SLOTS} used` : `+${BACKPACK_SLOTS} slots · craft at a workbench`;
    }
  }

  // The pouch: the calibres carried, each with the gun that fires it ("no gun for it": the rounds to hand a teammate),
  // the empty ones behind "show all"
  _renderPouch(force) {
    const inv = this.inv;
    let empty = 0;
    this.calEls.forEach((q, cal) => {
      const v = inv.ammo[cal] | 0;
      if (!v) empty++;
      const { held, packed } = this._gunsFor(cal);
      const who = held.length ? held.map((id) => ITEM_DEFS[id].name).join(', ') : packed.length ? `${ITEM_DEFS[packed[0]].name} · in pack` : 'no gun for it';
      const key = `${v}|${who}|${this.showAllAmmo}`;
      if (!force && q.key === key) return;
      q.key = key;
      q.b.hidden = !v && !this.showAllAmmo;
      q.b.classList.toggle('zero', !v);
      q.n.textContent = String(v);
      q.who.textContent = who;
      q.b.classList.toggle('orphan', !!v && !held.length && !packed.length);
    });
    this.pouchHidden.textContent = this.showAllAmmo ? `${AMMO_ITEMS.length} calibres` : empty ? `+ ${empty} empty calibre${empty === 1 ? '' : 's'} hidden` : '';
    this.pouchMore.textContent = this.showAllAmmo ? 'hide empty ▴' : 'show all ▾';
    this.pouchMore.hidden = !empty;
  }

  schemOk(item) {
    return !!(this.unlocked & (1 << SCHEM_BIT[item]));
  }

  // ctx = { fire, bench, unlocked }
  setCraftContext(ctx) {
    const near = { fire: !!ctx?.fire, bench: !!ctx?.bench };
    const unlocked = ctx?.unlocked ?? this.unlocked;
    if (near.fire === this.near.fire && near.bench === this.near.bench && unlocked === this.unlocked) return;
    this.near = near;
    this.unlocked = unlocked;
    this.craft.render();
    this._renderCard();
    this._syncAmmo();
  }

  // our XP ({ xp, run, loaded, kept }, Game.onProgress): the level at the top of the loadout column
  setProgress(p) {
    this.prog = p;
    this.lvlBar.set(p ? p.xp : 0);
    if (this.open) this._askPerks();
  }
  // whether a perk is waiting is the server's to say (the picks are kept there): asked as the screen opens, at most
  // every 15 s unless the level moved on since
  _askPerks() {
    const now = performance.now();
    const moved = this.prog && lastProgress() && lastProgress().level !== levelOf(this.prog.xp);
    if (!moved && now - this.progAsked < 15000) return;
    this.progAsked = now;
    fetchProgress().catch(() => {});
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
      this._askPerks();
      this.craft.render();
    } else {
      if (this.ui.progress.visible) this.ui.progress.hide(); // (opened from here: it goes with the screen)
      // a focused search field would keep ui.isTyping() true and swallow gameplay keys
      const a = document.activeElement;
      if (a && this.root.contains(a)) a.blur();
      this.craft.dropBulk();
      this._closeSplit();
      this._closeAmmo();
      this._closeMenu();
      this._hideUndo();
      this.tip.hide();
      this.hoverEl = null;
      if (this.drag) {
        this._endDrag(this.drag);
        this.drag = null;
      }
    }
  }
}
