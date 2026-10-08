// Dead Hand [K]: the card game's screen, over a world that goes on behind it (see-through: the valley is still there,
// and so is whatever is coming). Its views, as tabs along the head:
//   Table      the match under way (or the practice one), or how the last one ended
//   Decks      the deck builder (ui/carddeck.js)
//   Trade      a trade with a teammate, while one is open (ui/cardtrade.js)
//   Challenges the asks to you and from you
//   Practice   a match against the computer: no cards won or lost
// and two without a tab: the chooser ([E] on a teammate: a match, with a deck and maybe a card bet, or a trade) and a
// pack opened (ui/cardreveal.js).
//
// What it shows comes from game/cards.js (CardsClient: bind, render), which also takes what the player does here.
// The game opens and shuts it (Game.toggleCards: the key, the pause menu's row, [E] on a teammate) and sets onClose
// (the cross, a click outside). Esc reaches it through Game.onKey only: back() undoes the last step taken here (a
// card picked, a choice half made) and says whether it did; if not, the game shuts the screen.
//
// Keys of its own, while it is up (none of them while typing, and never one the player has bound to a menu): a digit
// picks a card of the hand, the arrows move along the hand and through the rows it may go to, Enter plays it, holding
// Space for 0.6 s passes, Backspace or a right click puts it back.
import { cardDef, AB, LA, ROW_NAMES, F, F_NAMES, DECK_SLOTS, validateDeck, rulesText, STARTER } from '../../shared/cards.js';
import { legalMoves } from '../../shared/cardgame.js';
import { el, svgEl, replay, fmtTime } from './dom.js';
import { glyph } from './icons.js';
import { cardFace, cardBack, setPow, ROW_GLYPH } from './cardface.js';
import { DeckBuilder } from './carddeck.js';
import { TradeView } from './cardtrade.js';
import { RevealView } from './cardreveal.js';
import { bindLabel, liveText, actionsOf } from '../game/binds.js';
import { ACTION } from '../../shared/binds.js';

const TABS = [
  ['table', 'Table'],
  ['lobby', 'Lobby'],
  ['deck', 'Decks'],
  ['trade', 'Trade'],
  ['asks', 'Challenges'],
  ['practice', 'Practice'],
];
const PASS_HOLD = 0.6; // seconds Space (or the Pass button) is held to pass
const FORFEIT_ARM = 3; // seconds the Give up button waits for its second click
const CPU = -1;

// a deck slot's name for a list: its own, or the leader's deck
export function deckLabel(c, slot) {
  if (slot === -1) return 'Starter deck: Survivors';
  if (slot === -2) return 'Starter deck: The Dead';
  const d = c.deckIn(slot);
  if (!d) return `Slot ${slot + 1}: empty`;
  const L = cardDef(d.leader);
  return `${d.name || (L ? `${L.name}'s deck` : `Deck ${slot + 1}`)}`;
}

// the decks a player may play: the kept slots with a legal deck, and the two starter decks. -> [[slot, label, ok]]
export function deckChoices(c) {
  const out = [];
  for (let i = 0; i < DECK_SLOTS; i++) {
    const d = c.deckIn(i);
    if (d) out.push([i, deckLabel(c, i), validateDeck(d, c.s.found).ok]);
  }
  out.push([-1, deckLabel(c, -1), true], [-2, deckLabel(c, -2), true]);
  return out;
}

// a <select> of decks, the last one played chosen
function deckSelect(parent, c, onChange = null) {
  const sel = el('select', 'cd-select', parent);
  const fill = () => {
    sel.textContent = '';
    const last = String(c.lastSlot());
    for (const [slot, label, ok] of deckChoices(c)) {
      const o = el('option', '', sel, ok ? label : `${label} (not legal)`);
      o.value = String(slot);
      o.disabled = !ok;
      if (String(slot) === last) o.selected = true;
    }
  };
  fill();
  sel.addEventListener('change', () => onChange?.(slotOf(sel.value)));
  sel.refill = fill;
  return sel;
}
export const slotOf = (v) => Number(v) | 0;

// a hold-to-confirm button: the fill runs along it while it is held, and letting go early calls it off
function holdButton(parent, cls, label, secs, run) {
  const b = el('button', `btn cd-hold ${cls}`, parent);
  b.type = 'button';
  el('span', '', b, label);
  el('i', 'cd-hold-fill', b);
  b.style.setProperty('--hold', `${secs}s`);
  let t = 0;
  const stop = () => {
    clearTimeout(t);
    b.classList.remove('holding');
  };
  b.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || b.disabled) return;
    b.classList.add('holding');
    t = setTimeout(() => {
      stop();
      run();
    }, secs * 1000);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, stop);
  b.hold = (on) => (on ? b.classList.add('holding') : stop());
  return b;
}

const drops = (parent, n, max = 2) => {
  parent.textContent = '';
  for (let i = 0; i < max; i++) svgEl('i', `cd-life${i < n ? '' : ' lost'}`, parent, glyph('drop'));
};

// ================================================================ the screen
export class CardsScreen {
  constructor(ui, parent) {
    this.ui = ui;
    this.open = false;
    this.onClose = null; // the game's
    this.c = null; // game/cards.js CardsClient (bind)
    this.view = 'table';
    this.target = 0; // the chooser's teammate
    this.dirty = true;

    this.root = el('div', 'cdscr', parent);
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Dead Hand');
    const bg = el('div', 'cd-bg', this.root);
    const frame = (this.frame = el('div', 'cd-frame', this.root));
    const head = el('div', 'map-head cd-head', frame);
    const title = el('span', 'map-title cd-title', head);
    svgEl('i', 'cd-title-ico', title, glyph('cards'));
    el('span', '', title, 'Dead Hand');
    const seg = el('div', 'set-seg cd-tabs', head);
    this.tabs = new Map();
    for (const [id, label] of TABS) {
      const b = el('button', 'seg-btn cd-tab', seg);
      b.type = 'button';
      el('span', '', b, label);
      const n = el('b', 'cd-badge', b, '');
      n.hidden = true;
      b.addEventListener('click', () => this.show(id));
      this.tabs.set(id, { b, n });
    }
    this.count = el('span', 'map-coords cd-count', head, '');
    const close = (this.close = svgEl('button', 'set-close btn-icon map-close', head, glyph('xmark')));
    close.type = 'button';
    close.setAttribute('aria-label', 'Close Dead Hand');
    liveText(close, () => `Close (${bindLabel('cards')})`, 'title');
    close.addEventListener('click', () => this.onClose?.());

    const body = (this.body = el('div', 'cd-body', frame));
    this.views = {
      table: new TableView(this, body),
      deck: new DeckBuilder(this, body),
      trade: new TradeView(this, body),
      asks: new AsksView(this, body),
      lobby: new LobbyTablesView(this, body),
      practice: new PracticeView(this, body),
      chooser: new ChooserView(this, body),
      reveal: new RevealView(this, body),
    };
    for (const v of Object.values(this.views)) v.root.hidden = true;

    this.keys = el('div', 'map-keys cd-keys', frame);

    // a click outside the frame shuts it; a right click anywhere on it puts the card picked back
    this.root.addEventListener('pointerdown', (e) => {
      if (e.button === 0 && (e.target === bg || e.target === this.root)) this.onClose?.();
    });
    this.root.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.views.table.deselect();
    });
    // the focus goes round inside it
    this.root.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const all = [...this.root.querySelectorAll('button:not(:disabled), select, input')].filter((b) => b.offsetParent !== null);
      const first = all[0];
      const last = all[all.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    });
    this.onKeyDown = (e) => this.key(e, true);
    this.onKeyUp = (e) => this.key(e, false);
  }

  bind(client) {
    this.c = client;
  }

  setOpen(open, view = null) {
    open = !!open;
    if (open === this.open) {
      if (open && view) this.show(view);
      return;
    }
    this.open = open;
    this.root.hidden = !open;
    this.ui.root.classList.toggle('cards-open', open);
    if (open) {
      window.addEventListener('keydown', this.onKeyDown);
      window.addEventListener('keyup', this.onKeyUp);
      this.returnFocus = document.activeElement;
      this.show(view || this.pickView(), true);
      this.close.focus({ preventScroll: true });
    } else {
      window.removeEventListener('keydown', this.onKeyDown);
      window.removeEventListener('keyup', this.onKeyUp);
      this.views.table.cancelHolds();
      this.views.table.deselect(false);
      if (this.returnFocus?.isConnected && !this.returnFocus.closest?.('[hidden]')) this.returnFocus.focus({ preventScroll: true });
      this.returnFocus = null;
    }
  }

  // the view to open on: a pack to open, the trade, the match, an ask waiting, else the table
  pickView() {
    const s = this.c?.s;
    if (!s) return 'table';
    if (s.reveals.length) return 'reveal';
    if (s.trade) return 'trade';
    if (s.match) return 'table';
    if (this.c?.isLobby) return 'lobby';
    if (s.asks.some((a) => a.to === this.c.myId)) return 'asks';
    return this.view === 'chooser' || this.view === 'reveal' || this.view === 'trade' ? 'table' : this.view;
  }

  show(view, force = false) {
    if (!this.views[view]) view = 'table';
    if (view === 'lobby' && !this.c?.isLobby) view = 'table';
    if (view === 'trade' && !this.c?.s.trade) view = 'table';
    if (view === this.view && !force && !this.dirty) return this.render('view');
    if (this.view !== view) this.views[this.view]?.leave?.();
    this.view = view;
    for (const [id, v] of Object.entries(this.views)) v.root.hidden = id !== view;
    this.root.dataset.view = view;
    this.dirty = true;
    this.render('view');
  }

  // the store changed (what: which part of it): only drawn while the screen is up
  render(what = 'all') {
    if (!this.c) return;
    if (!this.open) {
      this.dirty = true;
      return;
    }
    const s = this.c.s;
    // (a new match takes the screen to the table; a new trade to the trade; a pack to its reveal, once nothing is
    // under way at the table)
    if (what === 'match-new' && this.view !== 'deck') return this.show('table');
    if (what === 'trade-new' && this.view !== 'table') return this.show('trade');
    if (what === 'trade-end' && this.view === 'trade') return this.show('table');
    if (what === 'reveal' && !s.match && this.view !== 'deck' && this.view !== 'trade') return this.show('reveal');
    this.dirty = false;
    const mine = s.asks.filter((a) => a.to === this.c.myId).length;
    this.tabs.get('trade').b.hidden = !s.trade;
    this.tabs.get('lobby').b.hidden = !this.c.isLobby;
    const asks = this.tabs.get('asks');
    asks.n.hidden = !mine;
    asks.n.textContent = String(mine);
    const tb = this.tabs.get('table');
    tb.n.hidden = !s.match;
    tb.n.textContent = s.match ? (s.match.local ? 'practice' : 'live') : '';
    const lb = this.tabs.get('lobby');
    lb.n.hidden = !this.c.isLobby || !s.tables?.length;
    lb.n.textContent = String(s.tables?.length || 0);
    for (const [id, t] of this.tabs) t.b.classList.toggle('on', id === this.view);
    const found = Object.values(s.found).reduce((a, n) => a + n, 0);
    const all = Object.values(STARTER).reduce((a, n) => a + n, 0) + found;
    this.count.textContent = `${all} cards · ${found} found${s.loaded ? (s.kept ? ' · kept' : ' · not kept: sign in to keep them') : ''}`;
    this.views[this.view].render(what);
    this.renderKeys();
  }

  renderKeys() {
    const k = this.keys;
    const key = this.view + (this.views.table.sel ? 's' : '');
    if (k.dataset.key === key) return;
    k.dataset.key = key;
    k.textContent = '';
    const add = (caps, t) => {
      const s = el('span', 'gh', k);
      for (const c of caps) el('span', 'kbd sm', s, c);
      el('span', '', s, t);
    };
    if (this.view === 'table') {
      add(['1', '…', '0'], 'pick a card');
      add(['←', '→'], 'move');
      add(['↑', '↓'], 'choose a row');
      add(['Enter'], 'play');
      add(['Space'], 'hold to pass');
      add(['Backspace'], 'put back');
    }
    add([bindLabel('cards')], 'close');
    add(['Esc'], this.view === 'table' && this.views.table.sel ? 'put back' : 'close');
  }

  animate(evs) {
    if (this.open && this.view === 'table') this.views.table.animate(evs);
  }

  // every frame while it is up: the clocks (DOM only when a second ticks over)
  tick() {
    if (this.view === 'table') this.views.table.tick();
    else if (this.view === 'asks' || this.view === 'chooser') this.views[this.view].tick?.();
  }

  // something hurt the player while the cards were out: the frame's edge goes red
  hurt() {
    replay(this.frame, 'hurt');
  }

  // Esc: undo the last step taken here -> whether there was one (if not, the game shuts the screen)
  back() {
    if (this.view === 'table') return this.views.table.back();
    if (this.view === 'deck') return this.views.deck.back();
    return false;
  }

  // the screen's own keys (window, while it is up)
  key(e, down) {
    if (this.ui.isTyping()) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'SELECT' || tag === 'INPUT') return;
    if (actionsOf(e.code).some((a) => ACTION[a]?.menu)) return; // (the player's menu keys are the game's: they shut it)
    if (this.view === 'table') this.views.table.key(e, down);
    else if (this.view === 'reveal' && down && (e.code === 'Enter' || e.code === 'Space')) {
      e.preventDefault();
      this.views.reveal.next();
    }
  }
}

// ================================================================ the table
class TableView {
  constructor(screen, parent) {
    this.sc = screen;
    this.root = el('div', 'cd-view cd-table', parent);
    this.sel = 0; // the hand card picked (its uid)
    this.focus = 0; // which of the picked card's places the keys point at
    this.faces = new Map(); // uid -> its face on the table
    this.fresh = new Set(); // uids just played: they come down onto the table
    this.legalKey = '';
    this.legal = [];
    this.clockS = -1;

    // ---- the head: who against whom, the round, whose turn and the clock, giving up
    const st = (this.status = el('div', 'cd-status', this.root));
    this.vs = el('div', 'cd-vs', st);
    this.turn = el('div', 'cd-turn', st);
    this.turnT = el('span', 'cd-turn-t', this.turn);
    this.clock = el('b', 'cd-clock', this.turn, '');
    this.give = el('button', 'btn btn-ghost cd-give', st, 'Give up');
    this.give.type = 'button';
    this.give.addEventListener('click', () => this.forfeit());

    // ---- the sides (left): theirs on top, mine below
    const left = el('div', 'cd-left', this.root);
    this.side = [this.sidePanel(left, 'opp'), this.sidePanel(left, 'me')];

    // ---- the board
    const board = (this.board = el('div', 'cd-board', this.root));
    this.rows = [[], []]; // [opp, me] -> [C, R, H] { root, horn, cards, total }
    const mk = (who, r) => {
      const row = el('div', `cd-row ${who} r${r}`, board);
      row.dataset.who = who;
      row.dataset.row = r;
      const horn = el('div', 'cd-horn', row);
      svgEl('i', 'cd-horn-ico', horn, glyph('horn'));
      const cards = el('div', 'cd-cards', row);
      const tot = el('div', 'cd-rt', row);
      svgEl('i', 'cd-rt-ico', tot, glyph(ROW_GLYPH[r]));
      const n = el('b', '', tot, '0');
      el('i', 'cd-wx', row);
      const R = { root: row, horn, cards, total: n, who, r };
      row.addEventListener('click', (e) => this.clickRow(R, e));
      horn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.clickRow(R, e, true);
      });
      return R;
    };
    for (const r of [2, 1, 0]) this.rows[0][r] = mk('opp', r);
    const mid = (this.mid = el('div', 'cd-mid', board));
    this.midOpp = el('b', 'cd-mid-n opp', mid, '0');
    this.rounds = el('div', 'cd-rounds', mid);
    this.midMe = el('b', 'cd-mid-n me', mid, '0');
    for (const r of [0, 1, 2]) this.rows[1][r] = mk('me', r);
    this.banner = el('div', 'cd-banner', board);
    this.banner.hidden = true;
    this.over = el('div', 'cd-over', board); // the redraw, a choice to make, how it ended
    this.over.hidden = true;

    // ---- the right: the weather, the piles, the card looked at
    const right = el('div', 'cd-right', this.root);
    const wx = el('div', 'cd-wxzone', right);
    el('span', 'cd-label', wx, 'Weather');
    this.weather = el('div', 'cd-wxcards', wx);
    this.piles = [this.pileRow(right, 'opp'), null];
    this.detail = el('div', 'cd-detail', right);
    this.piles[1] = this.pileRow(right, 'me');

    // ---- my hand
    this.hand = el('div', 'cd-hand', this.root);
    this.handFaces = new Map();

    // ---- nothing under way
    this.empty = el('div', 'cd-empty', this.root);

    // the rows' cards overlap as they fill: worked out again when the board changes size
    this.ro = new ResizeObserver(() => this.fit());
    this.ro.observe(this.board);
    this.ro.observe(this.hand);
  }

  sidePanel(parent, who) {
    const p = el('div', `cd-side ${who}`, parent);
    const top = el('div', 'cd-side-top', p);
    const leader = el('div', 'cd-leader', top);
    const info = el('div', 'cd-side-info', top);
    const name = el('b', 'cd-name', info, '');
    const lives = el('div', 'cd-lives', info);
    const counts = el('div', 'cd-counts', info);
    const total = el('b', 'cd-total', top, '0');
    const passed = el('span', 'cd-passed', p, 'Passed');
    passed.hidden = true;
    const known = el('div', 'cd-known', p); // (their cards I have seen)
    const P = { root: p, leader, name, lives, counts, total, passed, known, leaderId: 0 };
    if (who === 'me') {
      const acts = el('div', 'cd-acts', p);
      P.use = el('button', 'btn cd-use', acts, 'Use leader');
      P.use.type = 'button';
      P.use.addEventListener('click', () => this.useLeader());
      P.pass = holdButton(acts, 'cd-pass', 'Pass', PASS_HOLD, () => this.move({ t: 'pass' }));
    }
    leader.addEventListener('pointerenter', () => P.leaderId && this.peek(P.leaderId));
    leader.addEventListener('pointerleave', () => this.peek(0));
    return P;
  }

  pileRow(parent, who) {
    const p = el('div', `cd-piles ${who}`, parent);
    const deck = el('div', 'cd-pile deck', p);
    deck.appendChild(cardBack({ mini: true }));
    const dn = el('b', 'cd-pile-n', deck, '0');
    el('span', 'cd-pile-l', deck, 'deck');
    const disc = el('div', 'cd-pile discard', p);
    const top = el('div', 'cd-pile-top', disc);
    const xn = el('b', 'cd-pile-n', disc, '0');
    el('span', 'cd-pile-l', disc, 'discard');
    disc.addEventListener('click', () => this.showDiscard(who));
    return { deck: dn, disc: xn, top, topId: -1 };
  }

  get c() {
    return this.sc.c;
  }

  get M() {
    return this.c?.s.match || null;
  }

  // ------------------------------------------------------------ drawing
  render() {
    const c = this.c;
    const M = this.M;
    const v = M ? M.view : c?.s.lastEnd?.view || null;
    this.root.classList.toggle('none', !v);
    this.root.classList.toggle('done', !M && !!v);
    if (!v) return this.renderEmpty(M);
    this.empty.hidden = true;
    const me = v.me;
    const opp = 1 - me;
    const live = !!M && v.phase !== 'over';
    // what I may do now (worked out again only when the match moved)
    const lk = `${M?.v}:${v.seq}:${v.phase}:${v.turn}:${v.pendingSide}`;
    if (lk !== this.legalKey) {
      this.legalKey = lk;
      this.legal = live ? legalMoves(v) : [];
      if (this.sel && !v.sides[me].hand.some((h) => h.uid === this.sel)) this.sel = 0;
    }
    const oppName = M ? c.name(M.opp) : c.name(c.s.lastEnd.opp);
    // the head
    this.vs.textContent = '';
    el('b', '', this.vs, `vs ${oppName}`);
    if (M?.local) el('span', 'cd-tag', this.vs, 'practice');
    const bet = M?.bet || [0, 0];
    if (bet[0] || bet[1]) {
      const bm = cardDef(bet[me]);
      const bt = cardDef(bet[opp]);
      el('span', 'cd-bet', this.vs, `for ${bt ? 'their ' + bt.name : 'a card'}${bm ? ` · your ${bm.name}` : ''}`);
    }
    this.give.hidden = !live;
    // the sides
    this.renderSide(this.side[0], v, opp, M?.local || c.s.lastEnd?.local ? 'Computer' : oppName);
    this.renderSide(this.side[1], v, me, 'You');
    // the board
    const wx = new Set(v.weather.map((w) => cardDef(w.card)?.wRow).filter((r) => r !== undefined));
    for (const [k, s] of [
      [0, opp],
      [1, me],
    ])
      for (let r = 0; r < 3; r++) this.renderRow(this.rows[k][r], v, s, r, wx.has(r));
    this.midOpp.textContent = String(v.sides[opp].total);
    this.midMe.textContent = String(v.sides[me].total);
    this.midOpp.classList.toggle('lead', v.sides[opp].total > v.sides[me].total);
    this.midMe.classList.toggle('lead', v.sides[me].total > v.sides[opp].total);
    this.rounds.textContent = '';
    for (let i = 0; i < 3; i++) {
      const r = v.rounds[i];
      const d = el('i', 'cd-round' + (r ? (r.winner === me ? ' won' : r.winner === opp ? ' lost' : ' tie') : i === v.round - 1 && live ? ' now' : ''), this.rounds);
      d.title = r ? `Round ${i + 1}: ${r.totals[me]} to ${r.totals[opp]}` : `Round ${i + 1}`;
    }
    // the weather
    this.weather.textContent = '';
    for (const w of v.weather) this.weather.appendChild(cardFace(w.card, { mini: true }));
    if (!v.weather.length) el('span', 'cd-none', this.weather, 'Clear');
    // the piles
    this.renderPiles(this.piles[0], v.sides[opp]);
    this.renderPiles(this.piles[1], v.sides[me]);
    // my hand
    this.renderHand(v, live);
    this.renderStatus(v, oppName, live);
    this.renderOver(v, oppName, live);
    this.renderDetail();
    this.light();
    this.fit();
  }

  // nothing on the table: how to get a match going; or (M, its view not in yet) a match whose bets are going in
  renderEmpty(M = null) {
    const c = this.c;
    this.empty.hidden = false;
    this.root.classList.add('none');
    const key = M ? `wait:${M.opp}` : `${!!c}`;
    if (this.empty.dataset.key === key) return;
    this.empty.dataset.key = key;
    this.empty.textContent = '';
    const box = el('div', 'cd-empty-box paper', this.empty);
    if (M) {
      el('div', 'cd-empty-h', box, `Dead Hand vs ${c.name(M.opp)}`);
      el('p', '', box, 'The bets are going in. The cards come out in a moment.');
      return;
    }
    el('div', 'cd-empty-h', box, 'No match on the table');
    el('p', '', box, `To play a teammate, aim at one standing near you and press ${bindLabel('interact')}: a match (bet a card if you like) or a trade.`);
    el('p', '', box, 'Cards turn up in duffel bags, lockers, trunks and cabinets, and on the bosses. Whatever you find is yours to keep.');
    const row = el('div', 'cd-empty-acts', box);
    const p = el('button', 'btn btn-blood cd-go', row, 'Practice');
    p.type = 'button';
    p.addEventListener('click', () => this.sc.show('practice'));
    const d = el('button', 'btn', row, 'Build a deck');
    d.type = 'button';
    d.addEventListener('click', () => this.sc.show('deck'));
  }

  renderSide(P, v, s, name) {
    const S = v.sides[s];
    P.name.textContent = name;
    drops(P.lives, v.lives[s]);
    P.counts.textContent = `Hand ${S.handCount} · Deck ${S.deckCount}`;
    P.total.textContent = String(S.total);
    P.passed.hidden = !v.passed[s] || v.phase !== 'play';
    P.root.classList.toggle('turn', v.phase === 'play' && (v.pendingSide >= 0 ? v.pendingSide === s : v.turn === s));
    if (P.leaderId !== S.leader.card) {
      P.leaderId = S.leader.card;
      P.leader.textContent = '';
      P.leader.appendChild(cardFace(S.leader.card, { mini: true }));
    }
    const L = cardDef(S.leader.card);
    P.leader.classList.toggle('used', !!S.leader.used || !!S.leader.cancelled);
    P.leader.title = L ? `${L.name} · ${L.lname}${S.leader.cancelled ? ' (cancelled)' : S.leader.used ? ' (used)' : L.passive ? ' (always on)' : ''}` : '';
    if (P.use) {
      P.use.parentElement.hidden = !this.M || v.phase === 'over';
      const can = this.legal.some((m) => m.t === 'leader');
      P.use.textContent = L?.passive ? 'Passive' : S.leader.cancelled ? 'Cancelled' : S.leader.used ? 'Used' : 'Use leader';
      P.use.disabled = !can;
      P.pass.disabled = !this.legal.some((m) => m.t === 'pass');
    }
    // their cards I have seen
    P.known.textContent = '';
    if (s !== v.me) for (const h of S.hand) P.known.appendChild(cardFace(h.card, { mini: true, cls: 'known' }));
  }

  renderRow(R, v, s, r, wx) {
    const S = v.sides[s];
    const row = S.rows[r];
    R.total.textContent = String(S.totals[r]);
    R.root.classList.toggle('wx', wx);
    R.root.classList.toggle(['wx-c', 'wx-r', 'wx-h'][r], wx);
    const horn = S.horns[r];
    const hk = horn ? horn.card : 0;
    if (+R.horn.dataset.card !== hk) {
      R.horn.dataset.card = hk;
      R.horn.querySelector('.cdf')?.remove();
      if (horn) R.horn.appendChild(cardFace(horn.card, { mini: true }));
    }
    R.horn.classList.toggle('full', !!horn);
    // the cards, each kept by its uid (its picture is not drawn again)
    const want = [];
    for (const x of row) {
      let f = this.faces.get(x.uid);
      if (!f || +f.dataset.id !== x.card) {
        f = cardFace(x.card, { mini: true, pow: x.pow });
        f.dataset.uid = x.uid;
        this.faces.set(x.uid, f);
        f.addEventListener('pointerenter', () => this.peek(+f.dataset.id, +f.dataset.uid));
        f.addEventListener('pointerleave', () => this.peek(0));
        f.addEventListener('click', (e) => this.clickTarget(+f.dataset.uid, e));
      } else setPow(f, x.pow);
      f.classList.toggle('bitten', x.from !== s);
      want.push(f);
    }
    sync(R.cards, want);
  }

  renderPiles(p, S) {
    p.deck.textContent = String(S.deckCount);
    p.disc.textContent = String(S.discard.length);
    const top = S.discard.length ? S.discard[S.discard.length - 1].card : 0;
    if (top !== p.topId) {
      p.topId = top;
      p.top.textContent = '';
      p.top.appendChild(top ? cardFace(top, { mini: true }) : cardBack({ mini: true, cls: 'ghost' }));
    }
  }

  renderHand(v, live) {
    const S = v.sides[v.me];
    const want = [];
    S.hand.forEach((h, i) => {
      let f = this.handFaces.get(h.uid);
      if (!f) {
        f = cardFace(h.card);
        f.dataset.uid = h.uid;
        el('i', 'cd-num', f, '');
        this.handFaces.set(h.uid, f);
        f.addEventListener('click', () => this.pick(+f.dataset.uid));
        f.addEventListener('pointerenter', () => this.peek(+f.dataset.id, +f.dataset.uid));
        f.addEventListener('pointerleave', () => this.peek(0));
        if (this.handInit) this.fresh.add(h.uid);
      }
      f.querySelector('.cd-num').textContent = i < 10 ? String((i + 1) % 10) : '';
      f.classList.toggle('sel', h.uid === this.sel);
      f.classList.toggle('playable', live && this.legal.some((m) => m.t === 'play' && m.uid === h.uid));
      want.push(f);
    });
    this.handInit = true;
    for (const [uid, f] of this.handFaces) if (!want.includes(f)) this.handFaces.delete(uid);
    sync(this.hand, want);
    for (const uid of this.fresh) (this.handFaces.get(uid) || this.faces.get(uid))?.classList.add('fresh');
    this.fresh.clear();
  }

  renderStatus(v, oppName, live) {
    const me = v.me;
    let t;
    let mine = false;
    if (!live) t = v.result ? (v.result.winner === me ? 'You won' : v.result.winner < 0 ? 'A draw' : `${oppName} won`) : 'Over';
    else if (v.phase === 'redraw') {
      mine = !v.redraw.done[me];
      t = mine ? `Redraw: up to ${v.redraw.left} more` : `${oppName} is redrawing`;
    } else if (v.pendingSide >= 0) {
      mine = v.pendingSide === me;
      t = mine ? 'Choose a card to bring back' : `${oppName} is choosing`;
    } else {
      mine = v.turn === me;
      t = `Round ${v.round} · ${mine ? 'your turn' : `${oppName}'s turn`}${v.passed[1 - me] ? ` · ${oppName} passed` : ''}`;
    }
    this.turnT.textContent = t;
    this.turn.classList.toggle('mine', live && mine);
    this.root.classList.toggle('myturn', live && mine && v.phase === 'play');
    this.clockS = -2;
    this.tick();
  }

  tick() {
    const M = this.M;
    const left = M?.view && M.view.phase !== 'over' ? this.c.clockLeft(M) : -1;
    const s = left < 0 ? -1 : Math.ceil(left);
    if (s === this.clockS) return;
    this.clockS = s;
    this.clock.textContent = s < 0 ? '' : fmtTime(s);
    const v = M?.view;
    const bank = v && v.phase === 'play' && left >= 0 && v.clock - (M.local ? 0 : (performance.now() - M.at) / 1000) <= 0;
    this.clock.classList.toggle('bank', !!bank);
    this.clock.classList.toggle('low', s >= 0 && s <= 10);
    this.clock.title = bank ? 'On the bank: the time the whole match has left' : 'Time left on this turn';
  }

  // ------------------------------------------------------------ the overlays: the redraw, a choice, how it ended
  renderOver(v, oppName, live) {
    const o = this.over;
    const me = v.me;
    let key = '';
    if (!live) key = `end:${v.seq}`;
    else if (v.phase === 'redraw' && !v.redraw.done[me]) key = `redraw:${v.redraw.left}:${v.sides[me].hand.map((h) => h.uid).join()}`;
    else if (v.phase === 'redraw') key = 'redraw-wait';
    else if (v.pending && v.pendingSide === me) key = `pending:${v.pending.options.join()}:${this.legal.length}`;
    else if (this.picker) key = this.picker.key;
    o.hidden = !key;
    if (key && key !== 'redraw-wait') this.banner.hidden = true; // (a word on the round would only show through it)
    if (o.dataset.key === key) return;
    o.dataset.key = key;
    o.textContent = '';
    o.className = 'cd-over';
    if (!key) return;
    if (key.startsWith('end')) return this.renderEnd(v, oppName);
    if (key === 'redraw-wait') {
      o.classList.add('slim');
      el('div', 'cd-over-h', o, `Waiting for ${oppName} to finish their redraw`);
      return;
    }
    if (key.startsWith('redraw')) {
      const box = el('div', 'cd-over-box', o);
      el('div', 'cd-over-h', box, 'Your opening hand');
      el('p', 'cd-over-p', box, `Send back up to ${v.redraw.left} more: click a card to swap it for one off the deck.`);
      const cards = el('div', 'cd-over-cards', box);
      for (const h of v.sides[me].hand) {
        const f = cardFace(h.card);
        f.classList.add('pickable');
        f.addEventListener('click', () => this.move({ t: 'redraw', uid: h.uid }));
        f.addEventListener('pointerenter', () => this.peek(h.card));
        cards.appendChild(f);
      }
      const acts = el('div', 'cd-over-acts', box);
      const keep = el('button', 'btn btn-blood', acts, 'Keep this hand');
      keep.type = 'button';
      keep.addEventListener('click', () => this.move({ t: 'keep' }));
      return;
    }
    if (key.startsWith('pending')) {
      // (the Medic's choice holds the turn: no cancelling it; made again only when the choice itself changes)
      if (this.picker?.pending !== key) this.picker = { title: 'Bring a unit back from your discard', moves: this.legal.filter((m) => m.t === 'choose'), field: 'uid', ids: false, cancel: false, discard: [], picked: null, key, pending: key };
      return this.renderPicker(o);
    }
    this.renderPicker(o);
  }

  renderEnd(v, oppName) {
    const o = this.over;
    const c = this.c;
    const e = c.s.lastEnd;
    const me = v.me;
    const box = el('div', 'cd-over-box cd-end', o);
    const w = v.result?.winner;
    const outcome = e?.outcome || (w === me ? 'win' : w === 1 - me ? 'loss' : 'draw');
    box.classList.add(`o-${outcome}`);
    el('div', 'cd-over-h big', box, outcome === 'win' ? 'You won' : outcome === 'loss' ? `${oppName[0].toUpperCase()}${oppName.slice(1)} won` : outcome === 'void' ? 'Called off' : 'A draw');
    const reason = e?.reason || v.result?.reason || '';
    const why = { lives: '', forfeit: outcome === 'win' ? `${oppName} gave up.` : 'You gave up.', timeout: 'Out of time.' }[reason] ?? reason;
    const rounds = v.rounds.map((r) => `${r.totals[me]} – ${r.totals[1 - me]}`).join(' · ');
    el('p', 'cd-over-p', box, `${why ? why + ' ' : ''}${rounds ? `Rounds: ${rounds}.` : ''}`);
    if (e?.bet && !e.local) {
      const won = cardDef(e.bet.theirs);
      const lost = cardDef(e.bet.mine);
      if (e.bet.paid && outcome === 'win' && won) {
        el('p', 'cd-over-p good', box, `${won.name} is yours now.`);
        box.appendChild(cardFace(won)).classList.add('cd-prize');
      } else if (e.bet.paid && outcome === 'loss' && lost) el('p', 'cd-over-p bad', box, `Your ${lost.name} went to ${oppName}.`);
      else if (won || lost) el('p', 'cd-over-p', box, 'The bet stands down: nobody pays.');
    } else if (e?.local) el('p', 'cd-over-p', box, 'Practice: no cards change hands.');
    const acts = el('div', 'cd-over-acts', box);
    if (e?.local) {
      const again = el('button', 'btn btn-blood', acts, 'Again');
      again.type = 'button';
      again.addEventListener('click', () => this.sc.views.practice.deal());
    }
    const done = el('button', 'btn', acts, 'Done');
    done.type = 'button';
    done.addEventListener('click', () => {
      c.s.lastEnd = null;
      this.sc.render('all');
    });
  }

  // A choice of several moves that differ by what they pick (a card of a discard, of the deck, two of the hand to throw
  // away) and maybe a row: made a step at a time (field: the move's field naming the card picked; ids: it names a card
  // by its id - one of the deck's - not by its uid)
  openPicker(title, moves, field = 'pick', ids = false, cancel = true) {
    if (!moves.length) return;
    this.picker = { title, moves, field, ids, cancel, discard: [], picked: null, key: `pick:${title}:${moves.length}:${Math.random()}` };
    this.over.dataset.key = '';
    this.render();
  }

  closePicker() {
    if (!this.picker) return false;
    this.picker = null;
    this.render();
    return true;
  }

  renderPicker(o) {
    const P = this.picker;
    if (!P) return;
    const v = this.M.view;
    const me = v.me;
    const box = el('div', 'cd-over-box pick', o);
    el('div', 'cd-over-h', box, P.title);
    let moves = P.moves;
    // (Harvest: two of the hand to throw away first)
    if (moves[0].discard && P.discard.length < 2) {
      el('p', 'cd-over-p', box, `Pick 2 cards of your hand to discard (${P.discard.length} of 2).`);
      const cards = el('div', 'cd-over-cards', box);
      for (const h of v.sides[me].hand) {
        const f = cardFace(h.card);
        f.classList.add('pickable');
        f.classList.toggle('sel', P.discard.includes(h.uid));
        f.addEventListener('click', () => {
          const i = P.discard.indexOf(h.uid);
          if (i >= 0) P.discard.splice(i, 1);
          else P.discard.push(h.uid);
          P.key += '.';
          this.over.dataset.key = '';
          this.render();
        });
        cards.appendChild(f);
      }
    } else {
      if (moves[0].discard) moves = moves.filter((m) => m.discard.includes(P.discard[0]) && m.discard.includes(P.discard[1]));
      const picks = [...new Set(moves.map((m) => m[P.field]))];
      if (P.picked === null && picks.length > 1) {
        el('p', 'cd-over-p', box, 'Pick one.');
        const cards = el('div', 'cd-over-cards', box);
        for (const p of picks) {
          const id = P.ids ? p : this.cardOf(p);
          const f = cardFace(id);
          f.classList.add('pickable');
          f.addEventListener('click', () => {
            P.picked = p;
            this.pickerStep();
          });
          f.addEventListener('pointerenter', () => this.peek(id));
          cards.appendChild(f);
        }
      } else {
        if (P.picked === null) P.picked = picks[0];
        const left = moves.filter((m) => m[P.field] === P.picked);
        if (left.length > 1) {
          el('p', 'cd-over-p', box, 'Which row?');
          const acts = el('div', 'cd-over-acts rows', box);
          for (const m of left) {
            const b = svgEl('button', 'btn cd-rowbtn', acts, glyph(ROW_GLYPH[m.row]));
            b.type = 'button';
            el('span', '', b, ROW_NAMES[m.row]);
            b.addEventListener('click', () => this.finishPicker(m));
          }
        } else if (left.length === 1) {
          queueMicrotask(() => this.finishPicker(left[0]));
        }
      }
    }
    if (P.cancel) {
      const acts = el('div', 'cd-over-acts', box);
      const b = el('button', 'btn btn-ghost', acts, 'Cancel');
      b.type = 'button';
      b.addEventListener('click', () => this.closePicker());
    }
  }

  pickerStep() {
    if (!this.picker) return;
    this.picker.key += '.';
    this.over.dataset.key = '';
    this.render();
  }

  finishPicker(m) {
    this.picker = null;
    this.move(m);
  }

  // the card a uid of a discard stands for
  cardOf(uid) {
    for (const S of this.M.view.sides) for (const x of S.discard) if (x.uid === uid) return x.card;
    return 0;
  }

  // ------------------------------------------------------------ what the player does
  move(m) {
    this.deselect(false);
    this.picker = null;
    this.c.move(m);
  }

  pick(uid) {
    if (this.sel === uid) return this.deselect();
    this.sel = uid;
    this.focus = 0;
    const opts = this.options();
    // (a card that goes nowhere in particular - weather, Dawn, a Molotov - is played by picking it again or Enter)
    this.c.g.audio?.playLocal?.('card_flip', { volume: 0.25 });
    this.render();
    return opts;
  }

  deselect(redraw = true) {
    if (!this.sel) return false;
    this.sel = 0;
    if (redraw) this.render();
    return true;
  }

  back() {
    if (this.closePicker()) return true;
    if (this.deselect()) return true;
    return false;
  }

  // the picked card's moves, with where each goes: [{ m, el }] (el: a row, a horn slot, a unit to take back; null: the
  // card just goes)
  options() {
    if (!this.sel || !this.M?.view) return [];
    const v = this.M.view;
    const moves = this.legal.filter((m) => m.t === 'play' && m.uid === this.sel);
    const h = v.sides[v.me].hand.find((x) => x.uid === this.sel);
    const d = cardDef(h?.card);
    return moves.map((m) => {
      let target = null;
      if (m.target !== undefined) target = this.faces.get(m.target) || null;
      else if (m.row !== undefined && d?.ab === AB.HORN) target = this.rows[1][m.row].horn;
      else if (m.row !== undefined) target = this.rows[d?.ab === AB.BITTEN ? 0 : 1][m.row].root;
      return { m, el: target };
    });
  }

  // lights up where the picked card may go
  light() {
    for (const k of [0, 1]) for (const R of this.rows[k]) R.root.classList.remove('lit', 'focus'), R.horn.classList.remove('lit', 'focus');
    for (const f of this.faces.values()) f.classList.remove('lit', 'focus');
    this.detail.classList.remove('ready');
    const opts = this.options();
    if (!opts.length) return;
    this.focus = ((this.focus % opts.length) + opts.length) % opts.length;
    opts.forEach((o, i) => {
      if (!o.el) return;
      o.el.classList.add('lit');
      if (i === this.focus) o.el.classList.add('focus');
    });
    if (opts.some((o) => !o.el)) this.detail.classList.add('ready');
  }

  clickRow(R, e, horn = false) {
    const opts = this.options();
    const o = opts.find((x) => x.el === (horn ? R.horn : R.root)) || (horn ? opts.find((x) => x.el === R.root) : opts.find((x) => x.el === R.horn));
    if (o) {
      e?.stopPropagation();
      this.move(o.m);
    }
  }

  clickTarget(uid, e) {
    const o = this.options().find((x) => x.m.target === uid);
    if (o) {
      e.stopPropagation();
      this.move(o.m);
    }
  }

  // Enter: the picked card where the keys point (or where it just goes)
  play() {
    const opts = this.options();
    if (!opts.length) return false;
    this.move(opts[this.focus % opts.length].m);
    return true;
  }

  useLeader() {
    const moves = this.legal.filter((m) => m.t === 'leader');
    if (!moves.length) return;
    if (moves.length === 1) return this.move(moves[0]);
    const L = cardDef(this.M.view.sides[this.M.view.me].leader.card);
    const title = { [LA.TRIAGE]: 'Triage: a unit back to your hand', [LA.SALVAGE]: "Salvage: a unit from their discard", [LA.BROOD]: 'Brood: a unit back onto the board', [LA.WEATHER]: 'A weather card from your deck', [LA.HARVEST]: 'Harvest' }[L?.la];
    this.openPicker(title || (L ? L.lname : 'Your leader'), moves, 'pick', L?.la === LA.WEATHER || L?.la === LA.HARVEST);
  }

  forfeit() {
    const b = this.give;
    if (!b.classList.contains('armed')) {
      b.classList.add('armed');
      b.textContent = 'Sure? Give up';
      clearTimeout(this.giveT);
      this.giveT = setTimeout(() => {
        b.classList.remove('armed');
        b.textContent = 'Give up';
      }, FORFEIT_ARM * 1000);
      return;
    }
    clearTimeout(this.giveT);
    b.classList.remove('armed');
    b.textContent = 'Give up';
    this.c.forfeit();
  }

  showDiscard(who) {
    const v = this.M?.view;
    if (!v) return;
    const S = v.sides[who === 'me' ? v.me : 1 - v.me];
    if (!S.discard.length) return;
    this.discardOpen = this.discardOpen === who ? null : who;
    this.renderDetail();
  }

  // the card looked at (hovered), or picked, large, with what it does
  peek(id, uid = 0) {
    this.peekId = id;
    this.peekUid = uid;
    this.renderDetail();
  }

  renderDetail() {
    const d = this.detail;
    const v = this.M?.view || this.c?.s.lastEnd?.view;
    let id = this.peekId || 0;
    let pow;
    if (!id && this.sel && v) id = v.sides[v.me].hand.find((h) => h.uid === this.sel)?.card || 0;
    if (this.peekUid && v) for (const S of v.sides) for (const row of S.rows) for (const x of row) if (x.uid === this.peekUid) pow = x.pow;
    const key = `${id}:${pow}:${this.sel}:${this.discardOpen || ''}`;
    this.root.classList.toggle('sheet', !!id || !!this.discardOpen); // (a small screen: the card looked at comes up from the bottom)
    if (d.dataset.key === key) return;
    d.dataset.key = key;
    d.textContent = '';
    if (this.discardOpen && v && !id) {
      const S = v.sides[this.discardOpen === 'me' ? v.me : 1 - v.me];
      el('div', 'cd-label', d, this.discardOpen === 'me' ? 'Your discard' : 'Their discard');
      const list = el('div', 'cd-disc', d);
      for (const x of S.discard) {
        const f = cardFace(x.card, { mini: true });
        f.addEventListener('pointerenter', () => this.peek(x.card));
        list.appendChild(f);
      }
      return;
    }
    if (!id) {
      el('div', 'cd-detail-none', d, 'Point at a card to read it');
      return;
    }
    const c = cardDef(id);
    d.appendChild(cardFace(id, { pow }));
    const rt = rulesText(c);
    if (rt) el('p', 'cd-rules', d, rt);
    if (this.sel && !this.peekId) {
      const opts = this.options();
      const go = opts.find((o) => !o.el);
      if (go) {
        const b = el('button', 'btn btn-blood cd-play', d, 'Play it');
        b.type = 'button';
        b.addEventListener('click', () => this.move(go.m));
      } else if (opts.length) el('p', 'cd-hint', d, opts.length > 1 ? 'Click where it goes, or ↑ ↓ and Enter' : 'Click where it goes, or Enter');
      else el('p', 'cd-hint', d, this.M?.view?.phase === 'play' && this.M.view.turn !== this.M.view.me ? 'Not your turn' : 'It cannot be played now');
    }
  }

  // ------------------------------------------------------------ what happened (game/cards.js events)
  animate(evs) {
    const me = this.M?.view?.me ?? 0;
    for (const e of evs) {
      if (e.t === 'play' || e.t === 'revive') this.fresh.add(e.uid);
      else if (e.t === 'pull') for (const x of e.cards || []) this.fresh.add(x.uid);
      else if (e.t === 'draw' && e.side === me) for (const x of e.cards || []) this.fresh.add(x.uid);
      else if (e.t === 'scorch') {
        const rows = new Set((e.dead || []).map((x) => `${x.side === me ? 1 : 0}:${x.row}`));
        for (const k of rows) {
          const [w, r] = k.split(':').map(Number);
          const R = this.rows[w]?.[r];
          if (R) replay(R.root, 'scorched');
        }
        if (e.dead?.length) this.say(`Scorched: ${e.dead.map((x) => cardDef(x.card)?.name).join(', ')}`, 'bad');
      } else if (e.t === 'round') {
        const v = this.M?.view;
        const t = e.totals || [0, 0];
        this.say(`Round ${e.round}: ${e.winner === me ? 'yours' : e.winner < 0 ? 'a tie' : 'theirs'}, ${t[me]} to ${t[1 - me]}`, e.winner === me ? 'good' : e.winner < 0 ? '' : 'bad');
        if (v && e.kept?.length) this.fresh.add(e.kept[0].uid);
      } else if (e.t === 'begin' && e.round > 1) this.say(`Round ${e.round}: ${e.lead === me ? 'you lead' : 'they lead'}`, '');
      else if (e.t === 'pass' && e.side !== me) this.say(`${this.c.name(this.M?.opp)} passed`, '');
      else if (e.t === 'timeout') this.say(e.side === me ? `Out of time (${e.n} of 3)` : `${this.c.name(this.M?.opp)} ran out of time`, 'bad');
      else if (e.t === 'leader' && e.side !== me) {
        const L = cardDef(e.card);
        if (L) this.say(`${L.name}: ${L.lname}`, '');
      }
    }
  }

  say(text, tone) {
    const b = this.banner;
    b.textContent = text;
    b.className = 'cd-banner' + (tone ? ' ' + tone : '');
    b.hidden = false;
    replay(b, 'show');
    clearTimeout(this.sayT);
    this.sayT = setTimeout(() => (b.hidden = true), 2600);
  }

  // ------------------------------------------------------------ the keys
  key(e, down) {
    const code = e.code;
    if (code === 'Space') {
      e.preventDefault();
      if (e.repeat) return;
      const P = this.side[1].pass;
      if (!down) return void P.hold(false);
      if (P.disabled) return;
      P.hold(true);
      clearTimeout(this.spaceT);
      this.spaceT = setTimeout(() => {
        P.hold(false);
        if (!P.disabled) this.move({ t: 'pass' });
      }, PASS_HOLD * 1000);
      return;
    }
    if (!down) return;
    const v = this.M?.view;
    const digit = /^(Digit|Numpad)([0-9])$/.exec(code);
    if (digit && v) {
      const i = (Number(digit[2]) + 9) % 10;
      const h = v.sides[v.me].hand[i];
      if (h) this.pick(h.uid);
      e.preventDefault();
      return;
    }
    if (code === 'ArrowLeft' || code === 'ArrowRight') {
      if (!v) return;
      const hand = v.sides[v.me].hand;
      if (!hand.length) return;
      const i = hand.findIndex((h) => h.uid === this.sel);
      const n = i < 0 ? (code === 'ArrowLeft' ? hand.length - 1 : 0) : (i + (code === 'ArrowLeft' ? -1 : 1) + hand.length) % hand.length;
      this.sel = hand[n].uid;
      this.focus = 0;
      this.render();
      e.preventDefault();
      return;
    }
    if (code === 'ArrowUp' || code === 'ArrowDown') {
      const opts = this.options();
      if (opts.length > 1) {
        this.focus = (this.focus + (code === 'ArrowUp' ? -1 : 1) + opts.length) % opts.length;
        this.light();
      }
      e.preventDefault();
      return;
    }
    if (code === 'Enter' || code === 'NumpadEnter') {
      e.preventDefault();
      if (this.sel) this.play();
      return;
    }
    if (code === 'Backspace') {
      e.preventDefault();
      this.back();
    }
  }

  cancelHolds() {
    clearTimeout(this.spaceT);
    this.side[1].pass.hold(false);
  }

  // The cards of a row (and the hand) overlap once they would not fit side by side: --ov, the step from one to the next
  fit() {
    const fitIn = (box) => {
      const kids = box.children;
      const n = kids.length;
      if (!n) return;
      const w = kids[0].offsetWidth;
      const room = box.clientWidth;
      const gap = 4;
      const step = n > 1 && n * (w + gap) > room ? Math.max(w * 0.18, (room - w) / (n - 1)) : w + gap;
      box.style.setProperty('--ov', `${(step - w).toFixed(1)}px`);
    };
    for (const k of [0, 1]) for (const R of this.rows[k]) fitIn(R.cards);
    fitIn(this.hand);
  }
}

// children of box made exactly `want`, in order (each kept, not rebuilt)
function sync(box, want) {
  let i = 0;
  for (; i < want.length; i++) if (box.children[i] !== want[i]) box.insertBefore(want[i], box.children[i] || null);
  while (box.children.length > want.length) box.lastChild.remove();
}

// ================================================================ the challenges: asks to me, and mine
class AsksView {
  constructor(screen, parent) {
    this.sc = screen;
    this.root = el('div', 'cd-view cd-asks', parent);
    this.secs = new Map();
  }

  get c() {
    return this.sc.c;
  }

  render() {
    const c = this.c;
    const s = c.s;
    const r = this.root;
    const key = JSON.stringify([s.asks.map((a) => [a.from, a.to, a.kind, a.bet]), s.found, s.decks.length, !!s.match]);
    if (r.dataset.key === key) return this.tick();
    r.dataset.key = key;
    r.textContent = '';
    this.secs.clear();
    const box = el('div', 'cd-asks-box paper', r);
    el('div', 'fr-h', box, 'Asked of you');
    const mine = s.asks.filter((a) => a.to === c.myId);
    if (!mine.length) el('p', 'cd-none', box, 'Nobody is waiting on you.');
    for (const a of mine) this.incoming(box, a);
    el('div', 'fr-h', box, 'Asked by you');
    const out = s.asks.filter((a) => a.from === c.myId);
    if (!out.length) el('p', 'cd-none', box, `Aim at a teammate and press ${bindLabel('interact')} to ask them for a match or a trade.`);
    for (const a of out) {
      const row = el('div', 'cd-ask out', box);
      el('b', '', row, a.kind === 'trade' ? `A trade with ${c.name(a.to)}` : `A match with ${c.name(a.to)}${a.bet ? ', for a card' : ''}`);
      this.secs.set(el('span', 'cd-ask-t', row, ''), a);
      const b = el('button', 'btn btn-ghost', row, 'Withdraw');
      b.type = 'button';
      b.addEventListener('click', () => c.withdraw());
    }
    this.tick();
  }

  incoming(box, a) {
    const c = this.c;
    const row = el('div', 'cd-ask in', box);
    const who = c.name(a.from);
    const head = el('div', 'cd-ask-h', row);
    el('b', '', head, a.kind === 'trade' ? `${who} wants to trade` : `${who} challenges you to Dead Hand`);
    this.secs.set(el('span', 'cd-ask-t', head, ''), a);
    const body = el('div', 'cd-ask-b', row);
    let slot = c.lastSlot();
    let bet = 0;
    if (a.kind === 'match') {
      const deck = el('label', 'cd-field', body);
      el('span', '', deck, 'Your deck');
      deckSelect(deck, c, (v) => (slot = v));
      if (a.bet) {
        const theirs = el('div', 'cd-field', body);
        el('span', '', theirs, 'They bet');
        theirs.appendChild(cardFace(a.bet, { mini: true }));
        const pick = el('div', 'cd-field', body);
        el('span', '', pick, 'Your bet (a found card)');
        const bp = betPicker(pick, c, (id) => {
          bet = id;
          yes.disabled = !bet;
        }, false);
        if (!bp.count) el('p', 'cd-hint', pick, 'You have no found cards to bet: you cannot take this one on.');
      }
    }
    const acts = el('div', 'cd-ask-acts', row);
    const yes = el('button', 'btn btn-blood', acts, a.kind === 'trade' ? 'Trade' : 'Play');
    yes.type = 'button';
    yes.disabled = a.kind === 'match' && !!a.bet && !bet;
    yes.addEventListener('click', () => c.answer(a.from, a.kind, true, slot, bet));
    const no = el('button', 'btn btn-ghost', acts, 'No thanks');
    no.type = 'button';
    no.addEventListener('click', () => c.answer(a.from, a.kind, false));
  }

  tick() {
    const now = performance.now();
    for (const [n, a] of this.secs) {
      const t = `${Math.max(0, Math.ceil(a.left - (now - a.at) / 1000))} s`;
      if (n.textContent !== t) n.textContent = t;
    }
  }
}

// a row of found cards to bet one of (or none): onPick(id | 0). -> { count }: how many there were to choose from
function betPicker(parent, c, onPick, none = true) {
  const box = el('div', 'cd-betpick', parent);
  const ids = Object.keys(c.s.found)
    .map(Number)
    .filter((id) => c.s.found[id] > 0 && cardDef(id))
    .sort((a, b) => cardDef(b).r - cardDef(a).r || a - b);
  let cur = null;
  const choose = (b, id) => {
    cur?.classList.remove('sel');
    cur = b;
    b.classList.add('sel');
    onPick(id);
  };
  if (none) {
    const b = el('button', 'btn cd-nobet sel', box, 'No bet');
    b.type = 'button';
    cur = b;
    b.addEventListener('click', () => choose(b, 0));
  }
  for (const id of ids) {
    const f = cardFace(id, { mini: true });
    f.classList.add('pickable');
    f.tabIndex = 0;
    f.title = `${cardDef(id).name} (you have ${c.s.found[id]} found)`;
    f.addEventListener('click', () => choose(f, id));
    box.appendChild(f);
  }
  return { count: ids.length };
}

// ================================================================ the chooser: [E] on a teammate
class ChooserView {
  constructor(screen, parent) {
    this.sc = screen;
    this.root = el('div', 'cd-view cd-chooser', parent);
  }

  get c() {
    return this.sc.c;
  }

  render() {
    const c = this.c;
    const s = c.s;
    const id = this.sc.target;
    const out = s.asks.find((a) => a.from === c.myId && a.to === id);
    const inc = s.asks.find((a) => a.to === c.myId && a.from === id);
    const key = JSON.stringify([id, !!out, out?.kind, !!inc, !!s.match, !!s.trade, s.found, s.decks.length]);
    if (this.root.dataset.key === key) return this.tick();
    this.root.dataset.key = key;
    const r = this.root;
    r.textContent = '';
    this.out = out;
    const who = c.name(id);
    const box = el('div', 'cd-choose-box paper', r);
    el('div', 'cd-choose-h', box, who);
    if (inc) {
      const n = el('div', 'cd-ask in', box);
      el('b', '', n, inc.kind === 'trade' ? `${who} asked you to trade` : `${who} has challenged you`);
      const b = el('button', 'btn', n, 'Answer');
      b.type = 'button';
      b.addEventListener('click', () => this.sc.show('asks'));
    }
    if (out) {
      const w = el('div', 'cd-wait', box);
      el('b', '', w, out.kind === 'trade' ? `Waiting for ${who} to answer your trade` : `Waiting for ${who} to take your challenge`);
      this.left = el('span', 'cd-ask-t', w, '');
      const b = el('button', 'btn btn-ghost', w, 'Withdraw');
      b.type = 'button';
      b.addEventListener('click', () => c.withdraw());
      return this.tick();
    }
    const busy = s.match && !s.match.local ? 'You already have a match going.' : s.trade ? 'You already have a trade open.' : '';
    const cols = el('div', 'cd-choose-cols', box);
    // a match
    const m = el('div', 'cd-choose-opt', cols);
    const mh = el('div', 'cd-choose-oh', m);
    svgEl('i', '', mh, glyph('cards'));
    el('span', '', mh, 'Challenge to Dead Hand');
    el('p', 'cd-hint', m, 'Best of three rounds. Bet one of your found cards if you like: the winner keeps both.');
    let slot = c.lastSlot();
    let bet = 0;
    const f1 = el('label', 'cd-field', m);
    el('span', '', f1, 'Your deck');
    deckSelect(f1, c, (v) => (slot = v));
    const f2 = el('div', 'cd-field', m);
    el('span', '', f2, 'Your bet');
    const bp = betPicker(f2, c, (v) => (bet = v));
    if (!bp.count) el('p', 'cd-hint', f2, 'No found cards to bet yet (the starter set stays yours).');
    const go = el('button', 'btn btn-blood', m, 'Challenge');
    go.type = 'button';
    go.disabled = !!busy;
    go.addEventListener('click', () => c.ask(id, 'match', slot, bet));
    // a trade
    const t = el('div', 'cd-choose-opt', cols);
    const th = el('div', 'cd-choose-oh', t);
    svgEl('i', '', th, glyph('container'));
    el('span', '', th, 'Trade');
    el('p', 'cd-hint', t, `Swap found cards and what is in your backpacks. Both of you see both sides, and nothing changes hands until both confirm. Stay within a few steps of ${who}.`);
    const tr = el('button', 'btn', t, 'Ask to trade');
    tr.type = 'button';
    tr.disabled = !!busy;
    tr.addEventListener('click', () => c.ask(id, 'trade'));
    if (busy) el('p', 'cd-hint warn', box, busy);
  }

  tick() {
    if (!this.out || !this.left) return;
    const t = `${Math.max(0, Math.ceil(this.out.left - (performance.now() - this.out.at) / 1000))} s`;
    if (this.left.textContent !== t) this.left.textContent = t;
  }
}

// ================================================================ lobby tables: no-bet matches from the splash
class LobbyTablesView {
  constructor(screen, parent) {
    this.sc = screen;
    this.root = el('div', 'cd-view cd-lobby', parent);
    this.slot = 0;
  }

  get c() {
    return this.sc.c;
  }

  render() {
    const c = this.c;
    const s = c.s;
    const mine = s.tables?.find((t) => t.host === c.myId) || null;
    const key = JSON.stringify([s.tables || [], s.decks, s.found, !!s.match, c.myId]);
    if (this.root.dataset.key === key) return;
    this.root.dataset.key = key;
    const r = this.root;
    r.textContent = '';
    const box = el('div', 'cd-lobby-box paper', r);
    el('div', 'cd-choose-h', box, 'Lobby tables');
    el('p', 'cd-hint', box, 'Open a no-bet table from the title screen, or join one that another player is waiting at. Found cards never change hands here.');

    if (s.match && !s.match.local) {
      const live = el('div', 'cd-lobby-live', box);
      el('b', '', live, `You are playing ${c.name(s.match.opp)}`);
      const back = el('button', 'btn btn-blood', live, 'Back to table');
      back.type = 'button';
      back.addEventListener('click', () => this.sc.show('table'));
      const leave = el('button', 'btn btn-ghost', live, 'Give up');
      leave.type = 'button';
      leave.addEventListener('click', () => c.leaveTable());
      return;
    }

    const mineBox = el('div', 'cd-lobby-open', box);
    el('div', 'fr-h', mineBox, mine ? 'Your open table' : 'Open a table');
    if (mine) {
      el('p', 'cd-hint', mineBox, `Waiting for someone to join with ${deckLabel(c, mine.slot)}.`);
      const cancel = el('button', 'btn btn-ghost', mineBox, 'Cancel table');
      cancel.type = 'button';
      cancel.addEventListener('click', () => c.leaveTable());
    } else {
      this.slot = c.lastSlot();
      const f = el('label', 'cd-field', mineBox);
      el('span', '', f, 'Your deck');
      deckSelect(f, c, (v) => (this.slot = v));
      const open = el('button', 'btn btn-blood', mineBox, 'Open table');
      open.type = 'button';
      open.disabled = !s.loaded;
      open.addEventListener('click', () => c.openTable(this.slot));
      if (!s.loaded) el('p', 'cd-hint warn', mineBox, 'Your collection is still loading.');
    }

    const list = el('div', 'cd-lobby-list', box);
    el('div', 'fr-h', list, 'Open tables');
    const others = (s.tables || []).filter((t) => t.host !== c.myId);
    if (!others.length) el('p', 'cd-none', list, mine ? 'Nobody else is waiting at a table.' : 'No open tables yet. Start one and other lobby players can join.');
    for (const t of others) {
      const row = el('div', 'cd-lobby-row', list);
      const who = el('div', 'cd-lobby-who', row);
      el('b', '', who, t.name || c.name(t.host));
      el('span', '', who, `waiting with ${this.tableDeck(t)}`);
      const join = el('button', 'btn btn-ghost', row, 'Join');
      join.type = 'button';
      join.disabled = !s.loaded || !!mine;
      join.addEventListener('click', () => {
        const slot = c.lastSlot();
        c.joinTable(t.id, slot);
      });
    }
  }

  tableDeck(t) {
    if (t.host === this.c.myId) return deckLabel(this.c, t.slot);
    if (t.slot === -1) return 'the Survivors starter deck';
    if (t.slot === -2) return 'the Dead starter deck';
    return 'a saved deck';
  }
}

// ================================================================ practice: against the computer
class PracticeView {
  constructor(screen, parent) {
    this.sc = screen;
    this.root = el('div', 'cd-view cd-practice', parent);
    this.level = 'normal';
    this.opp = F.DEAD;
  }

  get c() {
    return this.sc.c;
  }

  render() {
    const c = this.c;
    const key = JSON.stringify([c.s.decks, !!c.s.match, c.s.found]);
    if (this.root.dataset.key === key) return;
    this.root.dataset.key = key;
    const r = this.root;
    r.textContent = '';
    const box = el('div', 'cd-practice-box paper', r);
    el('div', 'cd-choose-h', box, 'Practice vs the computer');
    el('p', 'cd-hint', box, 'A match for the practice: no cards are won or lost. It waits while the screen is shut.');
    this.slot = c.lastSlot();
    const f1 = el('label', 'cd-field', box);
    el('span', '', f1, 'Your deck');
    deckSelect(f1, c, (v) => (this.slot = v));
    const f2 = el('div', 'cd-field', box);
    el('span', '', f2, 'The computer plays');
    const seg = el('div', 'set-seg', f2);
    for (const [f, label] of [
      [F.SURVIVORS, F_NAMES[F.SURVIVORS]],
      [F.DEAD, F_NAMES[F.DEAD]],
    ]) {
      const b = el('button', 'seg-btn' + (f === this.opp ? ' on' : ''), seg, label);
      b.type = 'button';
      b.addEventListener('click', () => {
        this.opp = f;
        for (const x of seg.children) x.classList.toggle('on', x === b);
      });
    }
    const f3 = el('div', 'cd-field', box);
    el('span', '', f3, 'How hard');
    const seg2 = el('div', 'set-seg', f3);
    for (const [lv, label] of [
      ['easy', 'Easy'],
      ['normal', 'Normal'],
    ]) {
      const b = el('button', 'seg-btn' + (lv === this.level ? ' on' : ''), seg2, label);
      b.type = 'button';
      b.addEventListener('click', () => {
        this.level = lv;
        for (const x of seg2.children) x.classList.toggle('on', x === b);
      });
    }
    const acts = el('div', 'cd-over-acts', box);
    const go = el('button', 'btn btn-blood', acts, c.s.match?.local ? 'Deal again' : 'Deal');
    go.type = 'button';
    go.disabled = !!(c.s.match && !c.s.match.local);
    go.addEventListener('click', () => this.deal());
    if (c.s.match && !c.s.match.local) el('p', 'cd-hint warn', box, 'Finish your match first.');
  }

  deal() {
    const c = this.c;
    if (c.s.match && !c.s.match.local) return;
    c.practice(this.slot ?? c.lastSlot(), this.opp, this.level);
    this.sc.show('table');
  }
}
