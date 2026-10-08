// Dead Hand, the card game, on this client: what the server says of it (S2C.CARDS, shared/protocol.js) kept in one
// store, the screen fed from it (ui/cards.js CardsScreen), and what the player does there sent back (C2S.CARDS). The
// store:
//   { loaded, kept, found: { id: n }, decks: [{ slot, name, leader, cards }], asks: [{ from, to, kind, bet, left, at }],
//     match: { opp, v, bet, view, local } | null, lastEnd, trade | null, reveals: [{ item, cards, kept }] }
// The cards a player owns are the starter set (everyone's, shared/cards.js STARTER) and what they found; only found
// cards change hands. The decks are kept by the server (DECK); the slot played last is remembered in this browser.
//
// A practice match against the computer (game/cardlocal.js) sits in the same place a match does (match.local, opp:
// CPU): the screen draws both the same way, and nothing of it ever reaches the server - no cards are won or lost.
//
// The world goes on while the cards are out. A teammate on their feet in the crosshair offers [E] (look: Game.
// updateLookTarget), which opens the chooser and sends nothing until a match or a trade is picked. With the screen shut
// the HUD has a line on what is under way (hud), and what comes in is said in a notice: a challenge, a trade asked for,
// a pack opened. The screen shuts by itself when the player falls, is downed or held by the dead.
import { CARDOP, CARDMSG, CARDNOTE } from '../../shared/protocol.js';
import { INTERACT_REACH } from '../../shared/constants.js';
import { ITEM_DEFS } from '../../shared/defs.js';
import { cardDef, cleanFound, DECK_SLOTS, F, defaultDeck, validateDeck } from '../../shared/cards.js';
import { loadoutDef } from '../../shared/loadout.js';
import { bindTag, bindLabel } from './binds.js';
import { lsGet, lsSet } from '../ui/dom.js';
import { LocalMatch } from './cardlocal.js';
import { legalMoves } from '../../shared/cardgame.js';
import { chooseMove } from '../../shared/cardai.js';

export const CPU = -1; // the practice match's opponent
const SLOT_KEY = 'stn.cards.slot'; // the deck slot played last (0-3; -1 / -2: the Survivors' / the Dead's starter deck)
export const STARTER_SLOT = { [-1]: F.SURVIVORS, [-2]: F.DEAD }; // (as the server has them: server/cards.js deckFor)
// the sounds of what happened at the table (one of a kind per message, however many cards it moved)
const EVENT_SOUND = { play: 'card_play', revive: 'card_play', pull: 'card_draw', draw: 'card_draw', redraw: 'card_flip', leader: 'card_flip', clear: 'card_flip', scorch: 'card_burn' };
// what the server's notes say (shared/protocol.js CARDNOTE: { code, arg }; who: arg as a player's name). null: nothing
// is said (the table is sent again, and that says it)
const NOTE_TEXT = {
  [CARDNOTE.CANT]: () => 'Not now',
  [CARDNOTE.GONE]: () => 'They are not here any more',
  [CARDNOTE.FAR]: () => 'Too far away: get closer',
  [CARDNOTE.OWNER]: () => 'That is you, in another tab',
  [CARDNOTE.BUSY]: () => 'One of you is in a match or a trade already',
  [CARDNOTE.ASKED]: () => 'There is an ask between you two already',
  [CARDNOTE.LIMIT]: () => 'Too many asks out: give them a moment',
  [CARDNOTE.DECK]: (a) => (a && a !== 'slot' && a !== 'empty' && a !== 'shape' ? `That deck cannot be played: ${a}` : 'That deck cannot be played: fix it in the deck builder'),
  [CARDNOTE.BET]: () => 'That card is not yours to bet',
  [CARDNOTE.NOBET]: () => 'Both bet a card, or neither does',
  [CARDNOTE.NOKEY]: () => 'Nothing of yours is kept here: sign in to bet, trade cards or keep decks',
  [CARDNOTE.LOADING]: () => 'Your cards are still on their way: try again in a moment',
  [CARDNOTE.DECLINED]: (a, who) => `${who || 'They'} said no`,
  [CARDNOTE.EXPIRED]: (a, who) => (who ? `${who} did not answer` : 'Nobody answered'),
  [CARDNOTE.STALE]: () => null,
  [CARDNOTE.MOVE]: (a) => (a ? `Not that: ${a}` : 'That move is not allowed'),
  [CARDNOTE.NOMATCH]: () => 'You have no match going',
  [CARDNOTE.NOTRADE]: () => 'You have no trade going',
  [CARDNOTE.NOTREADY]: () => 'Both of you have to be ready first',
  [CARDNOTE.CARDS]: (a) => `${cardDef(a)?.name || 'That card'} is not yours to give`,
  [CARDNOTE.ITEMS]: (a) => `${ITEM_DEFS[a]?.name || 'That'} is not in your backpack`,
  [CARDNOTE.LOADOUT]: () => 'That loadout item is not yours to give',
  [CARDNOTE.MIXED]: () => 'Trade loadout items by themselves, without cards or backpack items',
  [CARDNOTE.CROSSING]: () => 'Not on the road',
  [CARDNOTE.STORE]: () => 'The cards could not be reached: try again',
};
// why a trade ended (TRADE_END why), as said to the player
const TRADE_END_TEXT = {
  done: (who) => `Trade with ${who} done`,
  cancelled: (who) => `The trade with ${who} is off`,
  too_far: (who) => `You and ${who} went too far apart: the trade is off`,
  left: (who) => `${who} left: the trade is off`,
  no_room: () => 'No room for what was coming: the trade is off',
  not_owned: () => 'Something on the table was not there any more: the trade is off',
  changed: () => 'The trade changed under you: it is off',
  store: () => 'The cards could not be reached: the trade is off, nothing moved',
  run_over: () => 'The run is over: the trade is off',
};
// why a match was called off (MATCH_END void)
const VOID_TEXT = { left: 'they left', run_over: 'the run is over', forfeit: 'given up before it began', not_owned: 'a bet card was not there any more', store: 'the cards could not be reached' };

export class CardsClient {
  constructor(game) {
    this.g = game;
    this.screen = game.ui.cards;
    this.screen.bind(this);
    this.s = null;
    this.local = null; // the practice match, when one is under way (cardlocal.js)
    this.h = { kind: '', name: '', mine: false, secs: -1, what: '' }; // the HUD's (hud)
    this.reset();
  }

  // a new game, or none: nothing of the last one's asks, match or trade (the collection comes again with the next join)
  reset() {
    this.s = { loaded: false, kept: false, found: {}, decks: [], asks: [], match: null, lastEnd: null, trade: null, reveals: [], at: 0 };
    this.local = null;
    this.seen = 0; // the last match event this player has been shown (its seq)
    this.matchKey = '';
    this.changed('all');
  }

  get myId() {
    return this.g.myId;
  }

  name(id) {
    return id === CPU ? 'the computer' : this.g.name(id);
  }

  changed(what) {
    this.s.at = performance.now();
    this.screen.render(what);
  }

  send(op, data) {
    this.g.conn.cards(op, data);
  }

  // ------------------------------------------------------------ from the server
  onMessage({ op, data }) {
    const s = this.s;
    const now = performance.now();
    switch (op) {
      case CARDMSG.COLL:
        s.loaded = !!data.loaded;
        s.kept = !!data.kept;
        s.found = cleanFound(data.found);
        return this.changed('coll');
      case CARDMSG.DECKS:
        s.decks = Array.isArray(data.decks) ? data.decks.filter((d) => d && Number.isInteger(d.slot) && d.slot >= 0 && d.slot < DECK_SLOTS).map((d) => ({ slot: d.slot, name: String(d.name || ''), leader: d.leader | 0, cards: d.cards && typeof d.cards === 'object' ? d.cards : {} })) : [];
        return this.changed('decks');
      case CARDMSG.ASKS: {
        const before = new Set(s.asks.filter((a) => a.to === this.myId).map((a) => `${a.from}:${a.kind}`));
        s.asks = (Array.isArray(data.asks) ? data.asks : []).filter((a) => a && typeof a === 'object').map((a) => ({ from: a.from | 0, to: a.to | 0, kind: a.kind === 'trade' ? 'trade' : 'match', bet: a.bet | 0, left: +a.left || 0, at: now }));
        for (const a of s.asks) {
          if (a.to !== this.myId || before.has(`${a.from}:${a.kind}`)) continue;
          const who = this.name(a.from);
          const key = bindLabel('cards');
          const how = key === 'unbound' ? 'Answer in the menu' : `[${key}] to answer`;
          // (with the screen up, its Challenges tab says so)
          if (!this.screen.open) this.g.ui.notify(a.kind === 'trade' ? `${who} wants to trade. ${how}` : `${who} challenges you to Dead Hand${a.bet ? ', for a card' : ''}. ${how}`, 'good', 8);
          this.g.audio.playLocal('notify', { volume: 0.6 });
        }
        return this.changed('asks');
      }
      case CARDMSG.MATCH: {
        // (view null: the bets are going in, it has not begun)
        const view = data.view && typeof data.view === 'object' && Array.isArray(data.view.sides) ? data.view : null;
        const fresh = !s.match || s.match.local || s.match.opp !== data.opp || this.matchKey !== `${data.opp}`;
        if (fresh) {
          this.local = null; // (a real match takes the place of a practice one)
          this.matchKey = `${data.opp}`;
          this.seen = 0;
          s.lastEnd = null;
          if (!this.screen.open) this.g.ui.notify(`Dead Hand vs ${this.name(data.opp)}: the cards are dealt. ${this.keyText()}`, 'good', 6);
          this.g.audio.playLocal('card_shuffle', { volume: 0.4 });
        }
        s.match = { opp: data.opp | 0, me: data.me === 1 ? 1 : 0, v: data.v | 0, bet: Array.isArray(data.bet) ? data.bet.map((x) => x | 0) : [0, 0], view, local: false, at: now };
        this.events(Array.isArray(data.events) ? data.events : []);
        return this.changed(fresh ? 'match-new' : 'match');
      }
      case CARDMSG.MATCH_END: {
        const outcome = ['win', 'loss', 'draw', 'void'].includes(data.outcome) ? data.outcome : 'void';
        s.lastEnd = { opp: data.opp | 0, outcome, reason: String(data.reason || ''), bet: data.bet && typeof data.bet === 'object' ? data.bet : null, view: s.match?.view || null, local: false };
        s.match = null;
        this.matchKey = '';
        if (!this.screen.open) this.g.ui.notify(this.endText(s.lastEnd), outcome === 'win' ? 'good' : outcome === 'loss' ? 'warning' : 'toast', 6);
        if (outcome === 'win' || outcome === 'loss') this.g.audio.playLocal(outcome === 'win' ? 'card_round_win' : 'card_round_lose', { volume: 0.7 });
        return this.changed('end');
      }
      case CARDMSG.TRADE: {
        const fresh = !s.trade || s.trade.with !== data.with;
        s.trade = { with: data.with | 0, mine: offerOf(data.mine), theirs: offerOf(data.theirs), loadouts: loadoutsOf(data.loadouts), ready: pair(data.ready), ok: pair(data.ok), committing: !!data.committing };
        if (fresh && !this.screen.open) this.g.ui.notify(`Trading with ${this.name(s.trade.with)}. ${this.keyText()}`, 'good', 5);
        return this.changed(fresh ? 'trade-new' : 'trade');
      }
      case CARDMSG.TRADE_END: {
        const who = this.name(data.with | 0);
        const why = String(data.why || '');
        s.trade = null;
        this.g.ui.notify((TRADE_END_TEXT[why] || TRADE_END_TEXT.cancelled)(who), why === 'done' ? 'good' : 'toast', 4);
        if (why === 'done') this.g.audio.playLocal('card_shuffle', { volume: 0.4 });
        return this.changed('trade-end');
      }
      case CARDMSG.REVEAL: {
        const cards = (Array.isArray(data.cards) ? data.cards : []).filter((id) => cardDef(id));
        if (!cards.length) return;
        s.reveals.push({ item: data.item | 0, cards, kept: !!data.kept });
        if (!this.screen.open) this.g.ui.notify(`You found a ${ITEM_DEFS[data.item]?.name.toLowerCase() || 'card pack'}. ${this.keyText()} to open it`, 'good', 6);
        return this.changed('reveal');
      }
      case CARDMSG.NOTE: {
        const t = NOTE_TEXT[data.code];
        const text = t ? t(data.arg, Number.isInteger(data.arg) && this.g.players?.has?.(data.arg) ? this.name(data.arg) : '') : String(data.code || '');
        if (text) this.g.ui.notify(text, 'warning', 3);
        return;
      }
    }
  }

  keyText() {
    const k = bindLabel('cards');
    return k === 'unbound' ? '(Dead Hand, in the menu)' : `[${k}]`;
  }

  endText(e) {
    const who = this.name(e.opp);
    if (e.outcome === 'void') return `The match with ${who} is off${VOID_TEXT[e.reason] ? `: ${VOID_TEXT[e.reason]}` : ''}`;
    const head = e.outcome === 'win' ? `You beat ${who} at Dead Hand` : e.outcome === 'loss' ? `${who} beat you at Dead Hand` : `Dead Hand with ${who}: a draw`;
    const b = e.bet;
    if (!b || e.local) return head;
    const won = b.paid && e.outcome === 'win' && cardDef(b.theirs);
    const lost = b.paid && e.outcome === 'loss' && cardDef(b.mine);
    return won ? `${head}, and won their ${won.name}` : lost ? `${head}, and lost your ${lost.name}` : head;
  }

  // The match's new events: heard (one of each kind), and handed to the screen to show
  events(evs) {
    const me = this.s.match?.view?.me ?? 0;
    const heard = new Set();
    const shown = [];
    for (const e of evs) {
      if (!e || typeof e !== 'object' || !(e.seq > this.seen)) continue;
      this.seen = e.seq;
      shown.push(e);
      let snd = EVENT_SOUND[e.t];
      if (e.t === 'draw' && e.side !== me) snd = '';
      if (e.t === 'round') snd = e.winner === me ? 'card_round_win' : e.winner < 0 ? 'card_flip' : 'card_round_lose';
      if (snd && !heard.has(snd)) {
        heard.add(snd);
        this.g.audio.playLocal(snd, { volume: this.screen.open ? 0.8 : 0.45 });
      }
    }
    if (shown.length) this.screen.animate(shown);
  }

  // ------------------------------------------------------------ to the server
  // a teammate, from the chooser: a match (deck slot, a found card bet or 0) or a trade
  ask(to, kind, slot = 0, bet = 0) {
    if (kind === 'match') this.rememberSlot(slot);
    this.send(CARDOP.ASK, kind === 'trade' ? { to, kind } : { to, kind, slot, bet });
  }

  answer(from, kind, yes, slot = 0, bet = 0) {
    if (yes && kind === 'match') this.rememberSlot(slot);
    this.send(CARDOP.ANSWER, { from, kind, yes: !!yes, slot, bet });
  }

  withdraw() {
    this.send(CARDOP.WITHDRAW, {});
  }

  move(m) {
    const M = this.s.match;
    if (!M) return;
    if (M.local) return this.local?.move(m);
    this.send(CARDOP.MOVE, { v: M.v, move: m });
  }

  forfeit() {
    const M = this.s.match;
    if (!M) return;
    if (M.local) return this.local?.move({ t: 'forfeit' });
    this.send(CARDOP.FORFEIT, {});
  }

  // keep a deck in a slot (leader 0: empty it). Shown at once; the server's DECKS has the last word
  saveDeck(slot, name, leader, cards) {
    const d = { slot, name: String(name || '').slice(0, 24), leader: leader | 0, cards: leader ? cards : {} };
    this.s.decks = this.s.decks.filter((x) => x.slot !== slot);
    if (leader) this.s.decks.push(d);
    this.s.decks.sort((a, b) => a.slot - b.slot);
    this.send(CARDOP.DECK, d);
    this.changed('decks');
  }

  offer(cards, items, loadouts = []) {
    this.send(CARDOP.OFFER, { cards, items, loadouts });
  }
  ready(on) {
    this.send(CARDOP.READY, { on: !!on });
  }
  confirm() {
    this.send(CARDOP.CONFIRM, {});
  }
  closeTrade() {
    this.send(CARDOP.CLOSE, {});
  }
  sync() {
    this.send(CARDOP.SYNC, {});
  }

  // ------------------------------------------------------------ decks
  deckIn(slot) {
    return this.s.decks.find((d) => d.slot === slot) || null;
  }

  // the deck a slot stands for: a kept one, or (-1 / -2) a faction's starter deck
  deckFor(slot) {
    if (STARTER_SLOT[slot] !== undefined) return defaultDeck(STARTER_SLOT[slot]);
    const d = this.deckIn(slot);
    return d ? { leader: d.leader, cards: d.cards } : null;
  }

  // the slot played last, if it still holds a legal deck; else the first that does; else -1 (only the starter decks)
  lastSlot() {
    const v = lsGet(SLOT_KEY, '');
    const n = Number(v);
    const legal = (slot) => {
      const d = this.deckIn(slot);
      return !!d && validateDeck(d, this.s.found).ok;
    };
    if (v !== '' && Number.isInteger(n) && (legal(n) || STARTER_SLOT[n] !== undefined)) return n;
    for (let i = 0; i < DECK_SLOTS; i++) if (legal(i)) return i;
    return -1;
  }

  rememberSlot(slot) {
    lsSet(SLOT_KEY, String(slot));
  }

  // ------------------------------------------------------------ practice
  // seed: the match's (the sandbox gives one, to deal the same table every time)
  practice(slot, oppFaction, level, seed = (Math.random() * 0x100000000) >>> 0) {
    const mine = this.deckFor(slot) || defaultDeck(F.SURVIVORS);
    this.rememberSlot(slot);
    this.local = new LocalMatch({ seed, decks: [mine, defaultDeck(oppFaction === F.DEAD ? F.DEAD : F.SURVIVORS)], level, onUpdate: (view, evs) => this.onLocal(view, evs) });
    this.seen = 0;
    this.s.lastEnd = null;
    this.s.match = { opp: CPU, v: 0, bet: [0, 0], view: this.local.view(), local: true, at: performance.now() };
    this.g.audio.playLocal('card_shuffle', { volume: 0.4 });
    this.changed('match-new');
  }

  onLocal(view, evs) {
    const s = this.s;
    if (!s.match?.local) return;
    s.match.view = view;
    s.match.v++;
    s.match.at = performance.now();
    this.events(evs);
    if (view.phase === 'over') {
      const w = view.result?.winner;
      s.lastEnd = { opp: CPU, outcome: w === view.me ? 'win' : w === 1 - view.me ? 'loss' : 'draw', reason: view.result?.reason || '', bet: null, view, local: true };
      s.match = null;
      this.local = null;
      return this.changed('end');
    }
    this.changed('match');
  }

  // The computer's choice of this player's next move, made for them (scripts/e2e-cards.js plays a live match with it).
  // -> 'over' (no match), 'wait' (not ours to move), 'moved'
  autoplay(level = 'normal') {
    const M = this.s.match;
    const v = M?.view;
    if (!M) return 'over';
    if (!v || v.phase === 'over') return 'wait';
    const mine = v.phase === 'redraw' ? !v.redraw.done[v.me] : v.pendingSide >= 0 ? v.pendingSide === v.me : v.turn === v.me && !v.passed[v.me];
    if (!mine || !legalMoves(v).length) return 'wait';
    this.move(chooseMove(v, { level }));
    return 'moved';
  }

  // ------------------------------------------------------------ in the world
  // [E] on a teammate on their feet (updateLookTarget, nothing else in the crosshair): sets the look target and the
  // prompt and says so, or false
  look(ox, oy, oz, dx, dy, dz, reachTop) {
    const g = this.g;
    const e = g.entities.pickMate(ox, oy, oz, dx, dy, dz, INTERACT_REACH, reachTop);
    if (!e) return false;
    g.lookTarget = e;
    const M = this.s.match;
    g.prompt = M && !M.local && M.opp === e.id ? `${bindTag('interact')} Back to your match with ${g.name(e.id)}` : `${bindTag('interact')} Dead Hand · trade with ${g.name(e.id)}`;
    return true;
  }

  // [E] on one: the chooser, for them (nothing goes out until the player picks a match or a trade)
  chooser(id) {
    const M = this.s.match;
    if (M && !M.local && M.opp === id) return this.g.toggleCards(true, true, 'table');
    this.screen.target = id;
    this.g.toggleCards(true, true, 'chooser');
  }

  // every frame: the practice match's clock and the computer's moves; the screen shut on a fall; its clocks shown
  update(dt) {
    const g = this.g;
    if (this.local) this.local.tick(dt, !this.screen.open);
    if (!this.screen.open) return;
    const st = g.prediction.state;
    if (!g.self.alive || st.zombie || st.downed || st.pinned) {
      g.toggleCards(false);
      return;
    }
    this.screen.tick();
  }

  // the HUD's line (hud2.js CardsLine): what is under way, with the screen shut; null when there is nothing (or it is
  // open). The same object, changed in place
  hud() {
    if (this.screen.open) return null;
    const s = this.s;
    const h = this.h;
    const M = s.match;
    if (M && !M.view) {
      h.kind = 'match';
      h.name = this.name(M.opp);
      h.mine = false;
      h.secs = -1;
      h.what = 'the bets go in';
      return h;
    }
    if (M?.view && M.view.phase !== 'over') {
      const v = M.view;
      const me = v.me;
      h.kind = 'match';
      h.name = M.local ? 'the computer' : this.name(M.opp);
      if (v.phase === 'redraw') {
        h.mine = !v.redraw.done[me];
        h.what = h.mine ? 'redraw' : 'waiting';
      } else {
        h.mine = v.pendingSide === me || (v.pendingSide < 0 && v.turn === me);
        h.what = '';
      }
      h.secs = h.mine && !M.local ? this.clockLeft(M) : -1;
      return h;
    }
    if (s.trade) {
      h.kind = 'trade';
      h.name = this.name(s.trade.with);
      h.mine = false;
      h.secs = -1;
      h.what = '';
      return h;
    }
    const a = s.asks.find((x) => x.to === this.myId);
    if (a) {
      h.kind = 'ask';
      h.name = this.name(a.from);
      h.mine = false;
      h.secs = -1;
      h.what = a.kind;
      return h;
    }
    return null;
  }

  // seconds left on the turn (and then the bank) of the side to act, counted on from the last word on it
  clockLeft(M = this.s.match) {
    if (!M?.view) return -1;
    if (M.local) return this.local ? this.local.clockLeft() : -1;
    const v = M.view;
    const gone = (performance.now() - M.at) / 1000;
    let left = v.clock - gone;
    const side = v.phase === 'redraw' ? -1 : v.pendingSide >= 0 ? v.pendingSide : v.turn;
    if (left < 0 && side >= 0) left = Math.max(0, v.bank[side] + left);
    return Math.max(0, left);
  }
}

const pair = (a) => (Array.isArray(a) ? [!!a[0], !!a[1]] : [false, false]);
function offerOf(o) {
  const cards = o && typeof o.cards === 'object' && o.cards ? cleanFound(o.cards) : {};
  const items = o && Array.isArray(o.items) ? o.items.filter((x) => Array.isArray(x) && ITEM_DEFS[x[0]] && x[1] > 0).map((x) => [x[0] | 0, x[1] | 0]) : [];
  return { cards, items, loadouts: loadoutsOf(o?.loadouts) };
}
function loadoutsOf(rows) {
  return Array.isArray(rows)
    ? rows
        .filter((x) => x && typeof x.id === 'string')
        .map((x) => ({ id: x.id, catalog: loadoutDef(x.catalog)?.id || 0 }))
        .filter((x) => x.catalog)
    : [];
}
