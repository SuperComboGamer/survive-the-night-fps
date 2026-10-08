// Dead Hand's deck builder (a view of ui/cards.js): the four deck slots the server keeps for a player (DECK_SLOTS), the
// collection to build from, and the deck being built. A card owned (the starter set and what was found:
// shared/cards.js owned) is clicked into the deck, and clicked out of it in the list on the right (or right-clicked
// in the grid); a leader is clicked to lead it, and says the faction. What is wrong with the deck is said in plain
// words as it is built (validateDeck), and Save is there once it is legal. Nothing goes to the server until Save.
// The grid only draws the pictures it shows (ui/cardart.js).
import { CARDS, cardDef, owned, validateDeck, defaultDeck, deckFaction, DECK_RULES, DECK_SLOTS, F, F_NAMES, F_PERKS, K, ROW, ROWM } from '../../shared/cards.js';
import { el, svgEl } from './dom.js';
import { glyph } from './icons.js';
import { cardFace } from './cardface.js';

const KINDS = [
  ['unit', 'Units'],
  ['special', 'Specials'],
  ['leader', 'Leaders'],
  ['all', 'All'],
];
const ROWS = [
  [-1, 'Any row'],
  [ROW.C, 'Close'],
  [ROW.R, 'Ranged'],
  [ROW.H, 'Heavy'],
];
const kindOf = (c) => (c.k === K.UNIT ? 'unit' : c.k === K.LEADER ? 'leader' : 'special');

export class DeckBuilder {
  constructor(screen, parent) {
    this.sc = screen;
    this.root = el('div', 'cd-view cd-deck', parent);
    this.slot = 0;
    this.work = null; // { name, leader, cards } being built
    this.dirty = false;
    this.filter = { f: -1, kind: 'unit', row: -1, owned: true, q: '' };

    // ---- the slots
    const slots = el('div', 'cd-slots', this.root);
    el('div', 'cd-label', slots, 'Your decks');
    this.slotList = el('div', 'cd-slot-list', slots);
    el('p', 'cd-hint', slots, 'Kept for you on the server. The one you play last is chosen next time.');

    // ---- the collection
    const coll = el('div', 'cd-coll', this.root);
    const bar = el('div', 'cd-filters', coll);
    this.segF = this.seg(bar, [[-1, 'All'], [F.NEUTRAL, 'Neutral'], [F.SURVIVORS, 'Survivors'], [F.DEAD, 'Dead']], 'f');
    this.segK = this.seg(bar, KINDS, 'kind');
    this.segR = this.seg(bar, ROWS, 'row');
    const own = el('label', 'cd-check', bar);
    this.ownBox = el('input', '', own);
    this.ownBox.type = 'checkbox';
    this.ownBox.checked = true;
    el('span', '', own, 'Owned');
    this.ownBox.addEventListener('change', () => {
      this.filter.owned = this.ownBox.checked;
      this.renderGrid();
    });
    this.search = el('input', 'cd-search', bar);
    this.search.type = 'search';
    this.search.placeholder = 'Search';
    this.search.addEventListener('input', () => {
      this.filter.q = this.search.value.trim().toLowerCase();
      this.renderGrid();
    });
    this.grid = el('div', 'cd-grid', coll);
    this.tiles = new Map(); // id -> { root, n }

    // ---- the deck
    const deck = el('div', 'cd-deckpanel', this.root);
    this.nameIn = el('input', 'cd-deckname', deck);
    this.nameIn.maxLength = 24;
    this.nameIn.placeholder = 'Name this deck';
    this.nameIn.addEventListener('input', () => {
      if (!this.work) return;
      this.work.name = this.nameIn.value;
      this.dirty = true;
      this.renderDeck();
    });
    this.leaderBox = el('div', 'cd-deckleader', deck);
    this.stats = el('div', 'cd-deckstats', deck);
    this.errors = el('ul', 'cd-errors', deck);
    this.list = el('div', 'cd-decklist', deck);
    const acts = el('div', 'cd-deckacts', deck);
    this.saveB = this.button(acts, 'btn btn-blood', 'Save', () => this.save());
    this.revertB = this.button(acts, 'btn', 'Undo changes', () => this.load(this.slot));
    this.starterB = this.button(acts, 'btn btn-ghost', 'Fill from starter', () => this.starter());
    this.clearB = this.button(acts, 'btn btn-ghost btn-danger', 'Empty slot', () => this.clear());
  }

  get c() {
    return this.sc.c;
  }

  button(parent, cls, label, run) {
    const b = el('button', cls, parent, label);
    b.type = 'button';
    b.addEventListener('click', run);
    return b;
  }

  seg(parent, opts, field) {
    const s = el('div', 'set-seg cd-seg', parent);
    for (const [v, label] of opts) {
      const b = el('button', 'seg-btn' + (this.filter[field] === v ? ' on' : ''), s, label);
      b.type = 'button';
      b.dataset.v = v;
      b.addEventListener('click', () => {
        this.filter[field] = v;
        for (const x of s.children) x.classList.toggle('on', x === b);
        this.renderGrid();
      });
    }
    return s;
  }

  setSeg(s, v) {
    for (const x of s.children) x.classList.toggle('on', x.dataset.v === String(v));
  }

  // ------------------------------------------------------------ the slots
  load(slot) {
    this.slot = slot;
    const d = this.c.deckIn(slot);
    this.work = d ? { name: d.name, leader: d.leader, cards: { ...d.cards } } : { name: '', leader: 0, cards: {} };
    this.dirty = false;
    const f = deckFaction(this.work);
    this.filter.f = f >= 0 ? f : -1;
    this.filter.kind = f >= 0 ? 'unit' : 'leader';
    this.setSeg(this.segF, this.filter.f);
    this.setSeg(this.segK, this.filter.kind);
    this.render('load');
  }

  render(what) {
    if (!this.c) return;
    if (!this.work || (what === 'decks' && !this.dirty)) return this.load(this.work ? this.slot : this.firstSlot());
    this.renderSlots();
    this.renderGrid();
    this.renderDeck();
  }

  firstSlot() {
    const s = this.c.lastSlot();
    return s >= 0 ? s : 0;
  }

  renderSlots() {
    const box = this.slotList;
    box.textContent = '';
    for (let i = 0; i < DECK_SLOTS; i++) {
      const d = this.c.deckIn(i);
      const b = el('button', 'cd-slot' + (i === this.slot ? ' on' : ''), box);
      b.type = 'button';
      const L = d ? cardDef(d.leader) : null;
      if (L) b.appendChild(cardFace(L, { mini: true }));
      else svgEl('i', 'cd-slot-empty', b, glyph('plus'));
      const t = el('span', 'cd-slot-t', b);
      el('b', '', t, d ? d.name || `${L?.name || 'A'}'s deck` : `Slot ${i + 1}`);
      const n = d ? Object.values(d.cards).reduce((a, x) => a + x, 0) : 0;
      el('span', '', t, d ? `${F_NAMES[L?.f] || ''} · ${n} cards${validateDeck(d, this.c.s.found).ok ? '' : ' · not legal'}` : 'Empty');
      if (i === this.slot && this.dirty) el('i', 'cd-slot-dirty', b, '●').title = 'Not saved';
      b.addEventListener('click', () => {
        if (i === this.slot) return;
        this.load(i);
      });
    }
  }

  // ------------------------------------------------------------ the collection
  renderGrid() {
    const found = this.c.s.found;
    const F_ = this.filter;
    const df = deckFaction(this.work);
    const list = CARDS.filter((c) => {
      if (F_.f >= 0 && c.f !== F_.f) return false;
      if (F_.kind !== 'all' && kindOf(c) !== F_.kind) return false;
      if (F_.row >= 0 && !(c.k === K.UNIT && c.rows & (1 << F_.row))) return false;
      if (F_.owned && !owned(c.id, found)) return false;
      if (F_.q && !`${c.name} ${c.lname || ''} ${c.line}`.toLowerCase().includes(F_.q)) return false;
      return true;
    });
    const want = [];
    for (const c of list) {
      let t = this.tiles.get(c.id);
      if (!t) {
        const root = el('div', 'cd-tile');
        root.appendChild(cardFace(c, { mini: false }));
        const n = el('span', 'cd-tile-n', root, '');
        root.addEventListener('click', () => this.add(c.id));
        root.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.remove(c.id);
        });
        t = { root, n };
        this.tiles.set(c.id, t);
      }
      const have = owned(c.id, found);
      const inDeck = c.k === K.LEADER ? (this.work.leader === c.id ? 1 : 0) : this.work.cards[c.id] || 0;
      const cap = c.k === K.LEADER ? 1 : Math.min(have, DECK_RULES.copies[c.r]);
      t.n.textContent = c.k === K.LEADER ? (inDeck ? 'leads' : have ? 'owned' : 'not owned') : `${inDeck} / ${cap}${have > cap ? ` (${have})` : ''}`;
      t.root.classList.toggle('none', !have);
      t.root.classList.toggle('in', inDeck > 0);
      t.root.classList.toggle('off', c.k !== K.LEADER && df >= 0 && c.f !== F.NEUTRAL && c.f !== df);
      t.root.classList.toggle('full', c.k !== K.LEADER && inDeck >= cap);
      want.push(t.root);
    }
    const g = this.grid;
    let i = 0;
    for (; i < want.length; i++) if (g.children[i] !== want[i]) g.insertBefore(want[i], g.children[i] || null);
    while (g.children.length > want.length) g.lastChild.remove();
    if (!want.length && !g.querySelector('.cd-none')) el('p', 'cd-none', g, 'Nothing here.');
  }

  add(id) {
    const c = cardDef(id);
    const w = this.work;
    if (!c || !w) return;
    const have = owned(id, this.c.s.found);
    if (!have) return this.nope(`You do not own ${c.name} yet.`);
    if (c.k === K.LEADER) {
      // (a new faction: its cards that are not neutral leave the deck)
      if (deckFaction(w) >= 0 && c.f !== deckFaction(w)) for (const k of Object.keys(w.cards)) if (cardDef(+k).f !== F.NEUTRAL) delete w.cards[k];
      w.leader = id;
      if (this.filter.kind === 'leader') {
        this.filter.kind = 'unit';
        this.setSeg(this.segK, 'unit');
      }
      this.filter.f = -1;
      this.setSeg(this.segF, -1);
    } else {
      const df = deckFaction(w);
      if (df >= 0 && c.f !== F.NEUTRAL && c.f !== df) return this.nope(`${c.name} plays for ${F_NAMES[c.f]}, and this deck for ${F_NAMES[df]}.`);
      const n = w.cards[id] || 0;
      const cap = Math.min(have, DECK_RULES.copies[c.r]);
      if (n >= cap) return this.nope(n >= DECK_RULES.copies[c.r] ? `At most ${cap} ${c.name} in a deck.` : `You own ${have} ${c.name}.`);
      w.cards[id] = n + 1;
    }
    this.dirty = true;
    this.c.g.audio?.playLocal?.('card_play', { volume: 0.25 });
    this.render('edit');
  }

  remove(id) {
    const w = this.work;
    if (!w) return;
    if (w.leader === id) w.leader = 0;
    else if (w.cards[id]) {
      if (--w.cards[id] <= 0) delete w.cards[id];
    } else return;
    this.dirty = true;
    this.render('edit');
  }

  nope(text) {
    this.c.g.ui?.notify?.(text, 'warning', 2.5);
  }

  // ------------------------------------------------------------ the deck
  renderDeck() {
    const w = this.work;
    const found = this.c.s.found;
    if (document.activeElement !== this.nameIn) this.nameIn.value = w.name || '';
    this.leaderBox.textContent = '';
    const L = cardDef(w.leader);
    if (L) {
      const f = cardFace(L, { mini: true });
      this.leaderBox.appendChild(f);
      const t = el('div', 'cd-deckleader-t', this.leaderBox);
      el('b', '', t, L.name);
      el('span', '', t, `${F_NAMES[L.f]} · ${L.lname}`);
      if (F_PERKS[L.f]) el('span', 'cd-perk', t, F_PERKS[L.f]);
      const ch = el('button', 'btn btn-ghost cd-small', t, 'Change leader');
      ch.type = 'button';
      ch.addEventListener('click', () => {
        this.filter.kind = 'leader';
        this.setSeg(this.segK, 'leader');
        this.renderGrid();
      });
    } else el('p', 'cd-hint', this.leaderBox, 'Choose a leader from the grid: it says which side the deck plays.');
    const r = validateDeck(w, found);
    const total = r.units + r.specials;
    this.stats.textContent = '';
    const stat = (label, n, ok) => {
      const s = el('span', 'cd-stat' + (ok ? '' : ' bad'), this.stats);
      el('b', '', s, String(n));
      el('span', '', s, label);
    };
    stat(`units (${DECK_RULES.minUnits}+)`, r.units, r.units >= DECK_RULES.minUnits);
    stat(`specials (${DECK_RULES.maxSpecials} max)`, r.specials, r.specials <= DECK_RULES.maxSpecials);
    stat(`cards (${DECK_RULES.maxCards} max)`, total, total <= DECK_RULES.maxCards);
    this.errors.textContent = '';
    for (const e of r.errors) el('li', '', this.errors, e);
    this.errors.hidden = r.ok;
    // the list: by kind and row, strongest first
    this.list.textContent = '';
    const ids = Object.keys(w.cards)
      .map(Number)
      .filter((id) => w.cards[id] > 0 && cardDef(id));
    const groups = [
      ['Close', (c) => c.k === K.UNIT && c.rows & ROWM.C && !(c.rows & ROWM.R)],
      ['Close or ranged', (c) => c.k === K.UNIT && c.rows & ROWM.C && c.rows & ROWM.R],
      ['Ranged', (c) => c.k === K.UNIT && c.rows === ROWM.R],
      ['Heavy', (c) => c.k === K.UNIT && c.rows & ROWM.H],
      ['Specials', (c) => c.k === K.SPECIAL],
    ];
    for (const [title, test] of groups) {
      const g = ids.filter((id) => test(cardDef(id))).sort((a, b) => cardDef(b).pow - cardDef(a).pow || a - b);
      if (!g.length) continue;
      const h = el('div', 'cd-listh', this.list);
      el('span', '', h, title);
      el('b', '', h, String(g.reduce((a, id) => a + w.cards[id], 0)));
      for (const id of g) {
        const c = cardDef(id);
        const row = el('div', 'cd-li', this.list);
        el('b', 'cd-li-pow', row, c.k === K.UNIT ? String(c.pow) : '·');
        el('span', `cd-li-name r${c.r}`, row, c.name);
        el('span', 'cd-li-n', row, `×${w.cards[id]}`);
        const minus = this.button(row, 'btn-icon cd-li-b', '', () => this.remove(id));
        minus.textContent = '−';
        minus.title = 'One fewer';
        const plus = this.button(row, 'btn-icon cd-li-b', '', () => this.add(id));
        plus.textContent = '+';
        plus.title = 'One more';
        plus.disabled = w.cards[id] >= Math.min(owned(id, found), DECK_RULES.copies[c.r]);
      }
    }
    if (!ids.length) el('p', 'cd-none', this.list, 'No cards yet: click them in the grid.');
    this.saveB.disabled = !r.ok || !this.dirty;
    this.saveB.textContent = this.dirty ? 'Save' : 'Saved';
    this.revertB.disabled = !this.dirty;
    this.clearB.disabled = !this.c.deckIn(this.slot) && !w.leader;
  }

  save() {
    const w = this.work;
    if (!validateDeck(w, this.c.s.found).ok) return;
    this.c.saveDeck(this.slot, w.name, w.leader, { ...w.cards });
    this.c.rememberSlot(this.slot);
    this.dirty = false;
    this.render('saved');
  }

  starter() {
    const f = deckFaction(this.work);
    const d = defaultDeck(f === F.DEAD ? F.DEAD : F.SURVIVORS);
    this.work.leader = this.work.leader && cardDef(this.work.leader)?.f === (f === F.DEAD ? F.DEAD : F.SURVIVORS) ? this.work.leader : d.leader;
    this.work.cards = d.cards;
    this.dirty = true;
    this.render('edit');
  }

  clear() {
    this.c.saveDeck(this.slot, '', 0, {});
    this.work = { name: '', leader: 0, cards: {} };
    this.dirty = false;
    this.render('edit');
  }

  // Esc: nothing to step back from here (the deck stays as it is, saved or not)
  back() {
    if (this.filter.q) {
      this.search.value = '';
      this.filter.q = '';
      this.renderGrid();
      return true;
    }
    return false;
  }
}

