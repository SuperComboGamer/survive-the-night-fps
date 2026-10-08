// Dead Hand in a game: survivors play each other at cards, trade, and bet (shared/cards.js is the set, shared/cardgame.js
// the rules, server/usercards.js the collections they keep from run to run). Game.cards; everything a client says
// about it comes in as C2S.CARDS (onMessage) and everything it is told goes out as S2C.CARDS, to that player alone, in
// the same write as the tick's snapshot (send, from Game.sendTick) - and only when it changed: a client whose socket
// is backed up keeps what it is owed until it clears (Game.sendSnapshots skips it).
//
// - Asking. [E] on a standing teammate in reach (Game.reachOf: PICK_RADIUS.MATE at MATE_PICK_Y) asks them for a match
//   (with a deck, and maybe a found card bet) or a trade. An ask lapses after CARD_ASK_TTL; one between the same two
//   at a time, ASK_MAX out at once, one every ASK_EVERY seconds. Both must be survivors on their feet, here, in the
//   day or the night, of different owners (one browser in two tabs is one owner), and neither in a match or a trade.
//   A match is answered whatever has become of the one asked since (they might be down by then).
// - A match. With bets both bet or neither does; the two cards go into an escrow ('m:<match uuid>') before it starts
//   (phase 'locking': the network thread moves them, usercards.js) - one that cannot be had calls it off. Then 'live':
//   shared/cardgame.js plays it, MOVE by MOVE, each naming the version of the table it answers (ver: a stale one is
//   refused and the table sent again). A side's clock stops while that player is away (dropped) or down. It ends as
//   the rules end it, by a forfeit, or by the player leaving (their grace run out, or "Leave game": a forfeit);
//   the bets go to the winner (':pay'), or back on a draw (':back'). The run ending, or the game, voids it: back.
//   MATCH_END goes out once the bets are where they belong ('paying' until then).
// - A trade. Both put found cards and backpack items on their side (OFFER, all of it every time: stored as card ids
//   and ITEM ids with counts, since a backpack's slots move on every pickup); any change takes both sides' READY and
//   CONFIRM back. Struck when both have confirmed: everything is checked again (TRADE_REACH, the cards still theirs,
//   the items still there and room for what comes), the items are taken into the trade's keeping (each with its own
//   magazine or armour points), and the cards are moved by the network thread ('committing') before the items are
//   handed over - or handed back, when that fails. One that is only items is struck at once. TRADE_BREAK apart, or
//   either of them down, dead, one of the dead or away, and it is called off.
// - Packs (ITEM.CARD_PACK, SEALED_PACK: Game.giveItem) are opened as they are picked up: three cards each (rollPack),
//   which go into the finder's collection; they take no room in the backpack. A player with no owner key (no account
//   and no browser id) sees what was in it, and keeps nothing.
//
// Owners: a player's is their rejoinKey ('a:<account id>' or 'g:<sha-256 of the browser id>', Game.handleJoin). The
// network thread is told who is in the game (enter / leave, counted) and answers with each owner's collection (coll),
// which this keeps a copy of (own): what a player may bet, offer or build a deck from is checked against that copy,
// less what they have offered or bet here already (reserved). The network thread checks it all again; a transfer
// that does not hold there is refused and nothing moves. Owner keys never go to a client: players are named by their
// entity id.
//
// Saved with the game (save / load, gamestate.js): the asks, the matches (their engine state is plain JSON), the
// trades being committed (with what they hold) and the transfers under way, which the next server sends again under
// the same id (the ledger applies each once). Not saved: trades still being haggled over (called off), the copies of
// the collections (read again), who has been sent what (everything is sent again as they come back).
// Its own random stream (packs, the boss's sealed pack, the matches' seeds), from the OS's random source: never from
// the map's seed or the tick, which every client is told (WELCOME) - a stream seeded by them would let a player work
// out the seed of their match from their own hand, and from it the other hand and both decks' order. The game's
// (game.rng) is never drawn from either, so a seeded game plays the same with or without cards in it. (A test may
// hand the link a seeded one: link.rng.)
//
// Once the game is saved for the next server (room-worker.js 'save', freeze), nothing a player sends is acted on
// and no pack is opened here: what happened after the save would be lost with this game, while what the network
// thread had been told (cards found, cards traded) would stand.
import { randomUUID, randomBytes } from 'node:crypto';
import { S2C, CARDOP, CARDMSG, CARDNOTE, CARD_JSON_MAX, Writer, readCards, writeCards } from '../shared/protocol.js';
import { PHASE, CARD_ASK_TTL, TRADE_REACH, TRADE_BREAK } from '../shared/constants.js';
import { ITEM, ITEM_DEFS, WEAPONS, BOSS_PACK_CHANCE } from '../shared/defs.js';
import { cardDef, validateDeck, defaultDeck, rollPack, cleanDeck, cleanFound, F, DECK_SLOTS } from '../shared/cards.js';
import * as CG from '../shared/cardgame.js';
import { eyeHeight } from '../shared/playersim.js';
import { invCap, addItem, freeSlot } from './inventory.js';
import { CardService, MemoryCardStore, PACK_CAP } from './usercards.js';
import { isLoadoutStack } from './loadouts.js';

const cryptoRand = () => randomBytes(4).readUInt32LE(0) / 0x100000000;
const ALLOW_BURST = 20; // C2S.CARDS a player may send in a row...
const ALLOW_EVERY = 0.2; // ...then one every this many seconds
const ASK_MAX = 3; // asks a player may have out at once
const ASK_EVERY = 3; // s between two asks of theirs
const OFFER_CARDS_MAX = 16; // kinds of card on one side of a trade (both sides' moves stay within usercards.js MOVES_MAX)
const OFFER_ITEMS_MAX = 12; // kinds of item
const OFFER_LOADOUT_MAX = 12; // permanent loadout item instances
const OFFER_N_MAX = 99;
const OUT_MAX = 24; // one-off messages held for a player (a client away gets them when it is back)
const EVENTS_MAX = 200; // a match's events held for a player between two MATCHes (more: the table alone says it)
const NAME_MAX = 24;
const RETRY_MAX = 60; // s: a payout that failed is tried again after 2, 4, 8 ... up to this
const D = { COLL: 1, DECKS: 2, ASKS: 4, MATCH: 8, TRADE: 16, ALL: 31 };
// deck slots an ask or an answer may name besides the four kept ones: the starter decks everyone has
const STARTER_SLOTS = new Map([
  [-1, F.SURVIVORS],
  [-2, F.DEAD],
]);
const DECK_EVERY = 1; // s: a player's decks go to the database at most this often (the latest of each slot; deckQ)
// what may be done during the crossing (the cutscene): nothing that starts anything
const CROSSING_OK = new Set([CARDOP.WITHDRAW, CARDOP.FORFEIT, CARDOP.DECK, CARDOP.CLOSE, CARDOP.SYNC]);
const MOVE_T = new Set(['redraw', 'keep', 'play', 'leader', 'choose', 'pass', 'forfeit']);
const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const LOADOUT_ITEM_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STAKE_MAX = 12;
const tradeCount = (inv, item) => inv.reduce((n, s) => n + (s && !isLoadoutStack(s) && s.item === item ? s.count : 0), 0);
function removeTradeItem(inv, item, count) {
  let left = count;
  for (let i = inv.length - 1; i >= 0 && left > 0; i--) {
    const s = inv[i];
    if (!s || isLoadoutStack(s) || s.item !== item) continue;
    const take = Math.min(s.count, left);
    s.count -= take;
    left -= take;
    if (s.count <= 0) inv[i] = null;
  }
  return count - left;
}

// A move as the engine takes it, built only of what a move has (shared/cardgame.js): null when it is not one
export function cleanMove(m) {
  if (!m || typeof m !== 'object' || !MOVE_T.has(m.t)) return null;
  const out = { t: m.t };
  for (const k of ['uid', 'row', 'target', 'pick']) {
    if (m[k] === undefined || m[k] === null) continue;
    if (!int(m[k], -1, 65535)) return null;
    out[k] = m[k];
  }
  if (m.discard !== undefined && m.discard !== null) {
    if (!Array.isArray(m.discard) || m.discard.length > 2 || !m.discard.every((v) => int(v, 0, 65535))) return null;
    out.discard = [...m.discard];
  }
  return out;
}

// What goes on one side of a trade: { cards: { id: n }, items: [[item, n]] } (duplicates added up), or null
function cleanOffer(d) {
  const cards = {};
  const items = new Map();
  const loadouts = [];
  const loadoutSeen = new Set();
  if (d.cards !== undefined) {
    if (!d.cards || typeof d.cards !== 'object' || Array.isArray(d.cards)) return null;
    const keys = Object.keys(d.cards);
    if (keys.length > OFFER_CARDS_MAX) return null;
    for (const k of keys) {
      const id = +k;
      const n = d.cards[k];
      if (!int(id, 1, 32767) || !cardDef(id) || !int(n, 0, OFFER_N_MAX)) return null;
      if (n) cards[id] = n;
    }
  }
  if (d.items !== undefined) {
    if (!Array.isArray(d.items) || d.items.length > OFFER_ITEMS_MAX) return null;
    for (const row of d.items) {
      if (!Array.isArray(row) || row.length !== 2) return null;
      const [item, n] = row;
      const def = int(item, 1, 255) ? ITEM_DEFS[item] : null;
      if (!def || def.cat === 'card' || def.cat === 'schem' || def.cat === 'ammo' || !int(n, 1, 9999)) return null;
      items.set(item, (items.get(item) || 0) + n);
    }
  }
  if (d.loadouts !== undefined) {
    if (!Array.isArray(d.loadouts) || d.loadouts.length > OFFER_LOADOUT_MAX) return null;
    for (const id of d.loadouts) {
      if (typeof id !== 'string' || !LOADOUT_ITEM_RE.test(id) || loadoutSeen.has(id)) return null;
      loadoutSeen.add(id);
      loadouts.push(id);
    }
  }
  return { cards, items: [...items], loadouts };
}

function cleanStakeItems(d) {
  const raw = Array.isArray(d?.stake) ? d.stake : Array.isArray(d?.items) ? d.items : [];
  if (raw.length > STAKE_MAX) return null;
  const out = [];
  const seen = new Set();
  for (const id of raw) {
    if (typeof id !== 'string' || !LOADOUT_ITEM_RE.test(id) || seen.has(id)) return null;
    seen.add(id);
    out.push(id);
  }
  return out;
}

// ---------------------------------------------------------------- the link to the collections
// A game in a worker posts to the network thread (room-worker.js RemoteCards). One made in this thread (the tests,
// the sims, a plain `new Game()`) keeps them here: LocalCards, a CardService of its own on a store in memory - or one
// shared with other games (the tests: two games of one server, a game and the one it is handed to).
export class LocalCards {
  constructor(service = null) {
    this.service = service || new CardService({ store: new MemoryCardStore() });
    this.cards = null;
    // (what the service sends back comes as from another thread would: after this turn)
    this.room = { closed: false, code: 'local', worker: { postMessage: (m) => queueMicrotask(() => !this.room.closed && this.cards?.fromStore(m)) } };
  }
  attach(cards) {
    this.cards = cards;
  }
  post(m) {
    this.service.fromRoom(this.room, { t: 'cards', ...m });
  }
  // the game is gone, as Room.shut has it (handedOff: the next server carries it on)
  gone(handedOff = false) {
    this.room.closed = true;
    this.service.roomGone(this.room, handedOff);
  }
}

export class Cards {
  // link: where the collections are kept (RemoteCards in a room's worker); none, a LocalCards
  constructor(game, link = null) {
    this.game = game;
    this.link = link || new LocalCards();
    this.link.attach?.(this);
    this.rng = this.link.rng || cryptoRand;
    this.frozen = false; // saved for the next server: nothing more is done here (freeze)
    this.cw = new Writer(2048);
    // saved
    this.seq = 0; // (the trades' ids)
    this.asks = []; // [{ from, to, kind, slot, bet, until }]: players by id, until in game time
    this.matches = new Map(); // id (uuid) -> { id, sides: [{ pid, owner, name, bet }], state, phase, ver, seed, decks, voided, reason }
    this.trades = new Map(); // id -> { id, sides: [{ pid, owner, name, offer, ready, ok, x, y, z }], phase, escrow, xfer }
    this.pending = new Map(); // transfer id -> { id, kind, moves, ref, retryAt (0: under way), tries }
    // not saved
    this.own = new Map(); // owner -> { found: { card: n }, decks, loaded, n (players and trades of it here) }
    this.ofP = new Map(); // player id -> { dirty, out: [[op, data]], events, allow, askT, entered }
    this.packT = new Map(); // owner -> [game time of each pack they opened this last hour]
  }

  // ---------------------------------------------------------------- players
  st(p) {
    let st = this.ofP.get(p.id);
    if (!st) this.ofP.set(p.id, (st = { dirty: 0, out: [], events: [], allow: { n: 0, t: this.game.time }, askT: -99, deckT: -99, deckQ: null, entered: false }));
    return st;
  }
  dirty(pid, bits) {
    const st = this.ofP.get(pid);
    if (st) st.dirty |= bits;
  }
  dirtyOwner(owner, bits) {
    for (const p of this.game.players.values()) if (p.rejoinKey === owner) this.dirty(p.id, bits);
  }
  loadoutsChanged(owner) {
    this.dirtyOwner(owner, D.COLL | D.MATCH | D.TRADE);
  }
  out(p, op, data) {
    const st = p && this.ofP.get(p.id);
    if (!st) return;
    st.out.push([op, data]);
    if (st.out.length > OUT_MAX) st.out.shift();
  }
  note(p, code, arg = '') {
    this.out(p, CARDMSG.NOTE, { code, arg });
  }
  // a side's player, if they are still here (an id is given out again in time: the owner and name must match too)
  present(side) {
    const p = this.game.players.get(side.pid);
    return p && p.rejoinKey === side.owner && p.name === side.name ? p : null;
  }
  // on their feet, here, playing, in the day or the night: may ask, trade, offer
  standing(p) {
    const ph = this.game.phase;
    return !!p && p.alive && !p.zombie && !p.downed && !p.away && (ph === PHASE.DAY || ph === PHASE.NIGHT);
  }
  // [E] on them would reach (Game.interact's test, with a standing mate's reach and height: Game.reachOf / pickY)
  inReach(p, q) {
    const g = this.game;
    const s = p.state;
    const d = Math.hypot(q.x - s.x, q.z - s.z);
    const dy = g.pickY(q) - (s.y + eyeHeight(s));
    const reach = g.reachOf(q);
    return d <= reach && Math.abs(dy) <= reach && g.canReachEnt(p, q);
  }
  apart(a, b) {
    return Math.hypot(a.x - b.x, a.z - b.z);
  }

  // an owner is in this game (a player of it, or a trade of theirs being committed): the network thread is told the
  // first time, and sends their collection
  use(owner) {
    let o = this.own.get(owner);
    if (!o) {
      this.own.set(owner, (o = { found: {}, decks: [], loaded: false, n: 0 }));
      this.link.post({ op: 'enter', owner });
    }
    o.n++;
  }
  unuse(owner) {
    const o = this.own.get(owner);
    if (!o || --o.n > 0) return;
    this.own.delete(owner);
    this.link.post({ op: 'leave', owner });
  }

  // A player joined, or came back (Game.handleJoin, resume): everything is sent to them again
  join(p) {
    const st = this.st(p);
    if (p.rejoinKey && !st.entered) {
      st.entered = true;
      this.use(p.rejoinKey);
    }
    st.dirty = D.ALL;
    st.events.length = 0; // (the table goes out whole)
  }
  // Dropped (Game.hold): their trade and asks are called off; a match waits for them, its clock stopped
  hold(p) {
    for (const t of [...this.trades.values()]) if (t.phase === 'open' && t.sides.some((s) => s.pid === p.id)) this.endTrade(t, 'left');
    this.dropAsks((a) => a.from === p.id || a.to === p.id);
  }
  // Gone (Game.removePlayer: their grace ran out, or they left): a match they were playing is theirs lost, one still
  // being put up is called off; a trade being committed goes through all the same (what comes to them is left where
  // they were)
  leave(p) {
    const st = this.ofP.get(p.id);
    if (st) this.writeDecks(st);
    this.hold(p);
    for (const t of this.trades.values()) {
      const side = t.sides.find((s) => s.pid === p.id);
      if (side) Object.assign(side, { x: p.state.x, y: p.state.y, z: p.state.z });
    }
    for (const m of [...this.matches.values()]) {
      const side = m.sides.findIndex((s) => s.pid === p.id);
      if (side < 0 || m.voided) continue;
      if (m.phase === 'live') {
        const r = CG.applyMove(m.state, side, { t: 'forfeit' });
        if (r.ok) this.changed(m, r.events);
        if (m.state.phase === 'over') this.end(m);
        else this.void(m, 'left');
      } else if (m.phase === 'locking' || m.phase === 'staking') this.void(m, 'left');
    }
    if (st?.entered) this.unuse(p.rejoinKey);
    this.ofP.delete(p.id);
  }
  // The run is over (or a new one begins): every match is voided (bets back), trades and asks are called off
  runEnded() {
    for (const m of [...this.matches.values()]) this.void(m, 'run_over');
    for (const t of [...this.trades.values()]) this.endTrade(t, 'run_over');
    this.dropAsks(() => true);
  }
  // The car leaves the island (Game.cross): nobody trades through the cutscene; matches wait, their clocks stopped
  crossing() {
    for (const t of [...this.trades.values()]) this.endTrade(t, 'cancelled');
    this.dropAsks(() => true);
  }

  // ---------------------------------------------------------------- from a client (C2S.CARDS)
  onMessage(p, r) {
    if (this.frozen) return;
    const g = this.game;
    const st = this.st(p);
    if (!g.allow(st.allow, ALLOW_BURST, ALLOW_EVERY)) return;
    let msg;
    try {
      msg = readCards(r, CARD_JSON_MAX);
    } catch {
      return;
    }
    const { op, data: d } = msg;
    if (op !== CARDOP.SYNC) p.arriving = null; // (whoever does something is playing: Game.resume. A SYNC may come from a page still building its valley)
    if (g.phase === PHASE.CROSSING && !CROSSING_OK.has(op)) return this.note(p, CARDNOTE.CROSSING);
    switch (op) {
      case CARDOP.ASK:
        return this.ask(p, d);
      case CARDOP.ANSWER:
        return this.answer(p, d);
      case CARDOP.WITHDRAW:
        return this.dropAsks((a) => a.from === p.id);
      case CARDOP.MOVE:
        return this.move(p, d);
      case CARDOP.FORFEIT:
        return this.forfeit(p);
      case CARDOP.DECK:
        return this.saveDeck(p, d);
      case CARDOP.OFFER:
        return this.offer(p, d);
      case CARDOP.READY:
        return this.ready(p, d);
      case CARDOP.CONFIRM:
        return this.confirm(p);
      case CARDOP.STAKE:
        return this.stake(p, d);
      case CARDOP.STAKE_CONFIRM:
        return this.stakeConfirm(p, d);
      case CARDOP.CLOSE: {
        const t = this.tradeOf(p.id);
        if (t && t.phase === 'open') this.endTrade(t, 'cancelled');
        return;
      }
      case CARDOP.SYNC:
        st.dirty = D.ALL;
        st.events.length = 0;
        return;
    }
  }

  // ---------------------------------------------------------------- asks
  dropAsks(which) {
    const keep = [];
    for (const a of this.asks) {
      if (!which(a)) keep.push(a);
      else {
        this.dirty(a.from, D.ASKS);
        this.dirty(a.to, D.ASKS);
      }
    }
    this.asks = keep;
  }
  busy(pid) {
    for (const m of this.matches.values()) if ((m.phase === 'staking' || m.phase === 'live' || m.phase === 'locking') && !m.voided && m.sides.some((s) => s.pid === pid)) return true;
    for (const t of this.trades.values()) if (t.sides.some((s) => s.pid === pid)) return true;
    return false;
  }

  // The deck a player plays with: one of their four (slot 0-3, checked against what they have) or a starter deck
  // (slot -1 the Survivors', -2 the Dead's). -> { deck } or { error: CARDNOTE, arg }
  deckFor(p, slot) {
    if (slot === undefined || slot === null) slot = -1;
    if (STARTER_SLOTS.has(slot)) return { deck: defaultDeck(STARTER_SLOTS.get(slot)) };
    if (!int(slot, 0, DECK_SLOTS - 1)) return { error: CARDNOTE.DECK, arg: 'slot' };
    if (!p.rejoinKey) return { error: CARDNOTE.NOKEY };
    const o = this.own.get(p.rejoinKey);
    if (!o?.loaded) return { error: CARDNOTE.LOADING };
    const kept = o.decks.find((dk) => dk.slot === slot);
    if (!kept) return { error: CARDNOTE.DECK, arg: 'empty' };
    const deck = { leader: kept.leader, cards: { ...kept.cards } };
    const v = validateDeck(deck, o.found);
    return v.ok ? { deck } : { error: CARDNOTE.DECK, arg: String(v.errors?.[0] || 'invalid') };
  }
  // What an owner has offered or bet here already, card -> n (except: a trade left out, when its offer is replaced).
  // A bet being put up counts; once it is in the escrow the collection no longer has it.
  reserved(owner, except = null) {
    const r = {};
    for (const m of this.matches.values()) if (m.phase === 'locking') for (const s of m.sides) if (s.owner === owner && s.bet) r[s.bet] = (r[s.bet] || 0) + 1;
    for (const t of this.trades.values()) {
      if (t === except) continue;
      for (const s of t.sides) if (s.owner === owner) for (const [card, n] of Object.entries(s.offer.cards)) r[card] = (r[card] || 0) + n;
    }
    return r;
  }
  reservedLoadouts(owner, except = null) {
    const r = new Set();
    for (const m of this.matches.values()) {
      if (m === except) continue;
      if (!['staking', 'locking'].includes(m.phase) || m.voided) continue;
      for (const s of m.sides) if (s.owner === owner) for (const id of s.stake || []) r.add(id);
    }
    for (const t of this.trades.values()) {
      if (t === except) continue;
      for (const s of t.sides) if (s.owner === owner) for (const id of s.offer.loadouts || []) r.add(id);
    }
    return r;
  }
  // copies of a found card that are theirs to give (the starter set never is)
  spare(owner, card, except = null) {
    const o = this.own.get(owner);
    return o ? (o.found[card] || 0) - (this.reserved(owner, except)[card] || 0) : 0;
  }
  loadoutColl(owner) {
    return this.game.loadouts?.own?.get(owner) || null;
  }
  hasLoadout(owner, id, except = null) {
    const o = this.loadoutColl(owner);
    if (!o?.loaded || this.reservedLoadouts(owner, except).has(id)) return false;
    return o.items.some((it) => it.id === id);
  }
  // a bet: 0 (none) or a found card of theirs -> { bet } or { error }
  betFor(p, bet) {
    if (!bet) return { bet: 0 };
    if (!int(bet, 1, 32767) || !cardDef(bet)) return { error: CARDNOTE.BET };
    if (!p.rejoinKey) return { error: CARDNOTE.NOKEY };
    if (!this.own.get(p.rejoinKey)?.loaded) return { error: CARDNOTE.LOADING };
    return this.spare(p.rejoinKey, bet) >= 1 ? { bet } : { error: CARDNOTE.BET };
  }
  stakeFor(p, raw, except = null) {
    const items = cleanStakeItems({ items: raw });
    if (!items) return { error: CARDNOTE.LOADOUT };
    if (!items.length) return { items };
    if (!p.rejoinKey) return { error: CARDNOTE.NOKEY };
    if (!this.loadoutColl(p.rejoinKey)?.loaded) return { error: CARDNOTE.LOADING };
    for (const id of items) if (!this.hasLoadout(p.rejoinKey, id, except)) return { error: CARDNOTE.LOADOUT };
    return { items };
  }

  ask(p, d) {
    const g = this.game;
    const st = this.st(p);
    const kind = d.kind;
    if (kind !== 'match' && kind !== 'trade') return;
    if (!this.standing(p)) return this.note(p, CARDNOTE.CANT);
    const q = int(d.to, 1, 65535) ? g.players.get(d.to) : null;
    if (!q || q === p) return this.note(p, CARDNOTE.GONE);
    if (!this.standing(q)) return this.note(p, CARDNOTE.CANT);
    if (!this.inReach(p, q)) return this.note(p, CARDNOTE.FAR);
    if (p.rejoinKey && p.rejoinKey === q.rejoinKey) return this.note(p, CARDNOTE.OWNER);
    if (this.busy(p.id) || this.busy(q.id)) return this.note(p, CARDNOTE.BUSY);
    if (this.asks.some((a) => (a.from === p.id && a.to === q.id) || (a.from === q.id && a.to === p.id))) return this.note(p, CARDNOTE.ASKED);
    if (this.asks.filter((a) => a.from === p.id).length >= ASK_MAX || g.time - st.askT < ASK_EVERY) return this.note(p, CARDNOTE.LIMIT);
    let slot = -1;
    let bet = 0;
    let stake = [];
    if (kind === 'match') {
      slot = d.slot ?? -1;
      const dk = this.deckFor(p, slot);
      if (dk.error) return this.note(p, dk.error, dk.arg);
      const b = this.betFor(p, d.bet);
      if (b.error) return this.note(p, b.error);
      bet = b.bet;
      const st = this.stakeFor(p, d.stake || d.items || []);
      if (st.error) return this.note(p, st.error);
      stake = st.items;
    }
    st.askT = g.time;
    this.asks.push({ from: p.id, to: q.id, kind, slot, bet, stake, until: g.time + CARD_ASK_TTL });
    this.dirty(p.id, D.ASKS);
    this.dirty(q.id, D.ASKS);
  }

  answer(p, d) {
    const g = this.game;
    const i = this.asks.findIndex((a) => a.from === d.from && a.to === p.id && a.kind === d.kind);
    if (i < 0) return this.note(p, CARDNOTE.GONE);
    const a = this.asks[i];
    const q = g.players.get(a.from);
    const drop = () => this.dropAsks((x) => x === a);
    if (!d.yes) {
      drop();
      return q && this.note(q, CARDNOTE.DECLINED, p.id);
    }
    if (!q || q.away) {
      drop();
      return this.note(p, CARDNOTE.GONE);
    }
    if (this.busy(p.id) || this.busy(q.id)) return this.note(p, CARDNOTE.BUSY);
    if (a.kind === 'trade') {
      if (!this.standing(p) || !this.standing(q)) return this.note(p, CARDNOTE.CANT);
      if (this.apart(p, q) > TRADE_REACH) return this.note(p, CARDNOTE.FAR);
      this.dropAsks((x) => x.from === p.id || x.to === p.id || x.from === q.id || x.to === q.id);
      return this.openTrade(q, p);
    }
    // a match: what they asked with must still hold, and what is answered with
    const theirs = this.deckFor(q, a.slot);
    const theirBet = this.betFor(q, a.bet);
    if (theirs.error || theirBet.error) {
      drop();
      this.note(q, theirs.error || theirBet.error, theirs.arg || '');
      return this.note(p, CARDNOTE.GONE);
    }
    const mine = this.deckFor(p, d.slot);
    if (mine.error) return this.note(p, mine.error, mine.arg);
    const myBet = this.betFor(p, d.bet);
    if (myBet.error) return this.note(p, myBet.error);
    if (!!a.bet !== !!myBet.bet) return this.note(p, CARDNOTE.NOBET);
    const myStake = this.stakeFor(p, d.stake || d.items || []);
    if (myStake.error) return this.note(p, myStake.error);
    const theirStake = this.stakeFor(q, a.stake || []);
    if (theirStake.error) {
      drop();
      this.note(q, theirStake.error);
      return this.note(p, CARDNOTE.GONE);
    }
    this.dropAsks((x) => x.from === p.id || x.to === p.id || x.from === q.id || x.to === q.id);
    this.startMatch([q, p], [theirs.deck, mine.deck], [a.bet, myBet.bet], [theirStake.items, myStake.items]);
  }

  // ---------------------------------------------------------------- matches
  side(p, bet = 0, stake = []) {
    const owner = p.rejoinKey || '';
    return { pid: p.id, owner, name: p.name, bet, stake: [...(stake || [])], stakeInfo: this.stakeView(stake || [], owner), ok: false };
  }
  startMatch(players, decks, bets, stakes = [[], []]) {
    const id = randomUUID();
    const hasStake = stakes.some((s) => s?.length);
    const m = { id, sides: players.map((p, i) => this.side(p, bets[i], stakes[i])), state: null, phase: hasStake ? 'staking' : 'locking', ver: 0, seed: Math.floor(this.rng() * 0x100000000) >>> 0, decks, locks: null, pays: null, voided: '', reason: '' };
    this.matches.set(id, m);
    for (const s of m.sides) this.dirty(s.pid, D.MATCH);
    if (hasStake) return;
    this.lockMatch(m);
  }
  lockMatch(m) {
    if (m.phase !== 'locking') m.phase = 'locking';
    const cardMoves = m.sides.filter((s) => s.bet).map((s) => [s.owner, `m:${m.id}`, s.bet, 1]);
    const loadoutMoves = m.sides.flatMap((s) => (s.stake || []).map((id) => [s.owner, id]));
    m.locks = { cards: !cardMoves.length, loadouts: !loadoutMoves.length };
    for (const s of m.sides) this.dirty(s.pid, D.MATCH);
    if (!cardMoves.length && !loadoutMoves.length) return this.go(m);
    if (cardMoves.length) this.xfer(`${m.id}:lock`, 'lock', cardMoves, m.id);
    if (loadoutMoves.length) this.xfer(`${m.id}:loadout_wager_lock`, 'loadout_wager_lock', loadoutMoves, m.id);
  }
  finishLock(m, part) {
    if (!m || m.phase !== 'locking') return;
    m.locks ||= { cards: true, loadouts: true };
    m.locks[part] = true;
    if (!m.locks.cards || !m.locks.loadouts) return;
    if (m.forfeitWinner === 0 || m.forfeitWinner === 1) {
      m.phase = 'paying';
      return this.settleMatch(m, 'pay', m.forfeitWinner);
    }
    if (m.voided) {
      m.phase = 'paying';
      return this.settleMatch(m, 'back', -1);
    }
    this.go(m);
  }
  // the bets are in (or there were none): it is played
  go(m) {
    m.state = CG.newMatch({ seed: m.seed, decks: m.decks });
    m.decks = null;
    m.phase = 'live';
    m.ver = 1;
    for (const s of m.sides) this.dirty(s.pid, D.MATCH);
  }
  // the match a player is playing (or whose bets are going in), or null
  matchOf(pid) {
    for (const m of this.matches.values()) if ((m.phase === 'staking' || m.phase === 'live' || m.phase === 'locking') && !m.voided && m.sides.some((s) => s.pid === pid)) return m;
    return null;
  }
  stakeView(ids, owner = '') {
    const byId = new Map((this.loadoutColl(owner)?.items || []).map((it) => [it.id, it]));
    return (ids || []).map((id) => {
      const it = byId.get(id);
      return it ? { id: it.id, catalog: it.catalog } : { id, catalog: 0 };
    });
  }
  // ...or the one they finished, still being paid out (what MATCH shows them)
  matchFor(pid) {
    let last = null;
    for (const m of this.matches.values()) {
      if (!m.sides.some((s) => s.pid === pid)) continue;
      if ((m.phase === 'staking' || m.phase === 'live' || m.phase === 'locking') && !m.voided) return m;
      last = m;
    }
    return last;
  }
  // the table changed: a new version, and what happened to each side, which goes out with it
  changed(m, events) {
    m.ver++;
    m.sides.forEach((s, side) => {
      const st = this.ofP.get(s.pid);
      if (!st || this.game.players.get(s.pid) !== this.present(s)) return;
      st.dirty |= D.MATCH;
      const mine = events?.length ? CG.eventsFor(events, side) : [];
      if (st.events.length + mine.length > EVENTS_MAX) st.events.length = 0;
      else st.events.push(...mine);
    });
  }
  move(p, d) {
    const m = this.matchOf(p.id);
    if (!m || m.phase !== 'live') return this.note(p, CARDNOTE.NOMATCH);
    const side = m.sides.findIndex((s) => s.pid === p.id);
    if (d.v !== m.ver) {
      this.dirty(p.id, D.MATCH);
      return this.note(p, CARDNOTE.STALE);
    }
    const move = cleanMove(d.move);
    if (!move) return this.note(p, CARDNOTE.MOVE, 'bad');
    const r = CG.applyMove(m.state, side, move);
    if (!r.ok) {
      this.dirty(p.id, D.MATCH);
      return this.note(p, CARDNOTE.MOVE, String(r.error || 'refused').slice(0, 60));
    }
    this.changed(m, r.events);
    if (m.state.phase === 'over') this.end(m);
  }
  forfeit(p) {
    const m = this.matchOf(p.id);
    if (!m) return this.note(p, CARDNOTE.NOMATCH);
    if (m.phase === 'staking') return this.void(m, 'forfeit');
    if (m.phase === 'locking') {
      const side = m.sides.findIndex((s) => s.pid === p.id);
      if (m.forfeitWinner !== 0 && m.forfeitWinner !== 1) m.forfeitWinner = side === 0 ? 1 : 0;
      m.reason = 'forfeit';
      return;
    }
    const r = CG.applyMove(m.state, m.sides.findIndex((s) => s.pid === p.id), { t: 'forfeit' });
    if (r.ok) this.changed(m, r.events);
    if (m.state.phase === 'over') this.end(m);
  }
  stake(p, d) {
    const m = this.matchOf(p.id);
    if (!m || m.phase !== 'staking') return this.note(p, CARDNOTE.NOMATCH);
    const side = m.sides.findIndex((s) => s.pid === p.id);
    const st = this.stakeFor(p, d.items || d.stake || [], m);
    if (st.error) return this.note(p, st.error);
    m.sides[side].stake = st.items;
    m.sides[side].stakeInfo = this.stakeView(st.items, m.sides[side].owner);
    for (const s of m.sides) {
      s.ok = false;
      this.dirty(s.pid, D.MATCH);
    }
  }
  stakeConfirm(p, d) {
    const m = this.matchOf(p.id);
    if (!m || m.phase !== 'staking') return this.note(p, CARDNOTE.NOMATCH);
    const side = m.sides.findIndex((s) => s.pid === p.id);
    const st = this.stakeFor(p, m.sides[side].stake || [], m);
    if (st.error) return this.note(p, st.error);
    m.sides[side].ok = d.on !== false;
    for (const s of m.sides) this.dirty(s.pid, D.MATCH);
    if (!m.sides.every((s) => s.ok)) return;
    for (const s of m.sides) {
      const pl = this.present(s);
      const chk = pl ? this.stakeFor(pl, s.stake || [], m) : { error: CARDNOTE.GONE };
      if (chk.error) return this.void(m, 'not_owned');
    }
    this.lockMatch(m);
  }
  // the rules ended it: the bets to the winner, or back on a draw
  end(m) {
    if (m.phase !== 'live') return;
    const res = m.state.result || { winner: -1, reason: 'lives' };
    m.reason = res.reason || '';
    m.phase = 'paying';
    this.settleMatch(m, res.winner === 0 || res.winner === 1 ? 'pay' : 'back', res.winner);
  }
  // called off: nobody wins; bets back (once they are in: a lock still under way is waited for, onXfered)
  void(m, reason) {
    if (m.voided || m.phase === 'paying') return;
    m.voided = reason;
    m.reason = reason;
    if (m.phase === 'staking') return this.finish(m, true);
    if (m.phase === 'locking') return;
    m.phase = 'paying';
    this.settleMatch(m, 'back', -1);
  }
  settleMatch(m, how, winner = -1) {
    const hasCards = m.sides.some((s) => s.bet);
    const hasLoadouts = m.sides.some((s) => (s.stake || []).length);
    m.pays = { cards: !hasCards, loadouts: !hasLoadouts };
    if (!hasCards && !hasLoadouts) return this.finish(m, true);
    const esc = `m:${m.id}`;
    if (hasCards) {
      const moves = how === 'pay' && (winner === 0 || winner === 1) ? m.sides.map((s) => [esc, m.sides[winner].owner, s.bet, 1]) : m.sides.map((s) => [esc, s.owner, s.bet, 1]);
      this.xfer(`${m.id}:${how}`, how, moves, m.id);
    }
    if (hasLoadouts) {
      const moves = [];
      for (let i = 0; i < 2; i++) {
        const to = how === 'pay' && (winner === 0 || winner === 1) ? m.sides[winner].owner : m.sides[i].owner;
        for (const item of m.sides[i].stake || []) moves.push([m.sides[i].owner, to, item]);
      }
      this.xfer(`${m.id}:loadout_wager_${how}`, `loadout_wager_${how}`, moves, m.id);
    }
  }
  finishPay(m, part) {
    if (!m || m.phase !== 'paying') return;
    m.pays ||= { cards: true, loadouts: true };
    m.pays[part] = true;
    if (m.pays.cards && m.pays.loadouts) this.finish(m, true);
  }
  // Over and settled (paid: the bets are where the outcome sends them): the last table, then MATCH_END, to whoever of
  // the two is still here
  finish(m, paid) {
    this.matches.delete(m.id);
    const winner = m.state?.result?.winner ?? -1;
    m.sides.forEach((s, side) => {
      const p = this.present(s);
      const st = p && this.ofP.get(p.id);
      if (!st) return;
      if (st.dirty & D.MATCH && m.state && !this.matchOf(p.id)) {
        st.dirty &= ~D.MATCH;
        this.out(p, CARDMSG.MATCH, this.matchMsg(m, side, st));
      }
      const outcome = m.voided ? 'void' : winner === side ? 'win' : winner === 1 - side ? 'loss' : 'draw';
      this.out(p, CARDMSG.MATCH_END, { opp: m.sides[1 - side].pid, outcome, reason: m.reason, bet: { mine: s.bet, theirs: m.sides[1 - side].bet, paid }, stake: this.stakeEnd(m, side, paid) });
    });
  }
  matchMsg(m, side, st) {
    return { me: side, opp: m.sides[1 - side].pid, v: m.ver, bet: m.sides.map((s) => s.bet), stake: this.stakeMsg(m, side), view: m.state ? CG.viewFor(m.state, side) : null, events: st.events.splice(0) };
  }
  stakeMsg(m, side) {
    const me = m.sides[side];
    const them = m.sides[1 - side];
    return {
      phase: m.phase === 'staking' ? 'staking' : m.phase === 'locking' ? 'locking' : '',
      mine: me.stakeInfo || this.stakeView(me.stake || [], me.owner),
      theirs: them.stakeInfo || this.stakeView(them.stake || [], them.owner),
      loadouts: this.stakeView((this.loadoutColl(me.owner)?.items || []).map((it) => it.id), me.owner),
      ok: [!!me.ok, !!them.ok],
    };
  }
  stakeEnd(m, side, paid) {
    const mine = m.sides[side];
    const theirs = m.sides[1 - side];
    return { mine: mine.stakeInfo || this.stakeView(mine.stake || [], mine.owner), theirs: theirs.stakeInfo || this.stakeView(theirs.stake || [], theirs.owner), paid };
  }

  // ---------------------------------------------------------------- trades
  tradeOf(pid) {
    for (const t of this.trades.values()) if (t.sides.some((s) => s.pid === pid)) return t;
    return null;
  }
  openTrade(a, b) {
    const t = { id: ++this.seq, sides: [a, b].map((p) => ({ ...this.side(p), offer: { cards: {}, items: [], loadouts: [] }, ready: false, ok: false, x: p.state.x, y: p.state.y, z: p.state.z })), phase: 'open', escrow: null, xfer: '' };
    this.trades.set(t.id, t);
    for (const s of t.sides) this.dirty(s.pid, D.TRADE);
  }
  tradeMsg(t, i) {
    const me = t.sides[i];
    const them = t.sides[1 - i];
    const byOwner = (owner) => new Map((this.loadoutColl(owner)?.items || []).map((it) => [it.id, it]));
    const mineLoadouts = byOwner(me.owner);
    const theirLoadouts = byOwner(them.owner);
    const oneLoadout = (m, id) => {
      const it = m.get(id);
      return it ? { id: it.id, catalog: it.catalog } : { id, catalog: 0 };
    };
    const offer = (s, m) => ({ cards: { ...s.offer.cards }, items: s.offer.items.map((it) => [...it]), loadouts: (s.offer.loadouts || []).map((id) => oneLoadout(m, id)) });
    return {
      with: them.pid,
      mine: offer(me, mineLoadouts),
      theirs: offer(them, theirLoadouts),
      loadouts: [...mineLoadouts.values()].map((it) => ({ id: it.id, catalog: it.catalog })),
      ready: [me.ready, them.ready],
      ok: [me.ok, them.ok],
      committing: t.phase === 'committing',
    };
  }
  unready(t) {
    for (const s of t.sides) {
      s.ready = false;
      s.ok = false;
      this.dirty(s.pid, D.TRADE);
    }
  }
  offer(p, d) {
    const t = this.tradeOf(p.id);
    if (!t || t.phase !== 'open') return this.note(p, CARDNOTE.NOTRADE);
    if (!this.standing(p)) return this.note(p, CARDNOTE.CANT);
    const o = cleanOffer(d);
    if (!o) return this.note(p, CARDNOTE.ITEMS);
    const ids = Object.keys(o.cards);
    const other = t.sides.find((s) => s.pid !== p.id);
    const hasCards = ids.length || Object.keys(other.offer.cards || {}).length;
    const hasBackpackItems = o.items.length || (other.offer.items || []).length;
    const hasLoadouts = o.loadouts.length || (other.offer.loadouts || []).length;
    if (hasLoadouts && (hasCards || hasBackpackItems)) return this.note(p, CARDNOTE.MIXED);
    if (ids.length) {
      if (!p.rejoinKey) return this.note(p, CARDNOTE.NOKEY);
      if (!this.own.get(p.rejoinKey)?.loaded) return this.note(p, CARDNOTE.LOADING);
      for (const id of ids) if (this.spare(p.rejoinKey, +id, t) < o.cards[id]) return this.note(p, CARDNOTE.CARDS, +id);
    }
    if (o.loadouts.length) {
      if (!p.rejoinKey) return this.note(p, CARDNOTE.NOKEY);
      if (!this.loadoutColl(p.rejoinKey)?.loaded) return this.note(p, CARDNOTE.LOADING);
      for (const id of o.loadouts) if (!this.hasLoadout(p.rejoinKey, id, t)) return this.note(p, CARDNOTE.LOADOUT);
    }
    for (const [item, n] of o.items) if (tradeCount(p.inv, item) < n) return this.note(p, CARDNOTE.ITEMS, item);
    t.sides.find((s) => s.pid === p.id).offer = o;
    this.game.loadouts?.tradeLock(t.id, p.rejoinKey, o.loadouts || []);
    this.unready(t);
  }
  ready(p, d) {
    const t = this.tradeOf(p.id);
    if (!t || t.phase !== 'open') return this.note(p, CARDNOTE.NOTRADE);
    const s = t.sides.find((x) => x.pid === p.id);
    if (d.on) s.ready = true;
    else this.unready(t);
    for (const x of t.sides) this.dirty(x.pid, D.TRADE);
  }
  confirm(p) {
    const t = this.tradeOf(p.id);
    if (!t || t.phase !== 'open') return this.note(p, CARDNOTE.NOTRADE);
    if (!t.sides.every((s) => s.ready)) return this.note(p, CARDNOTE.NOTREADY);
    t.sides.find((x) => x.pid === p.id).ok = true;
    for (const x of t.sides) this.dirty(x.pid, D.TRADE);
    if (t.sides.every((s) => s.ok)) this.commit(t);
  }
  // could this player take these items, with those going out first? (a clone of their backpack: Game.giveItem's rules)
  fits(p, outgoing, incoming) {
    const inv = p.inv.map((s) => s && { ...s });
    const weapons = [...p.state.weapons];
    for (const [item, n] of outgoing) removeTradeItem(inv, item, n);
    const cap = invCap(p);
    for (const [item, n] of incoming) {
      if (ITEM_DEFS[item].cat === 'weapon') {
        let left = n;
        const slot = WEAPONS[item].slot;
        if (!weapons[slot]) {
          weapons[slot] = item;
          left--;
        }
        for (; left > 0; left--) {
          const i = freeSlot(inv, cap);
          if (i < 0) return false;
          inv[i] = { item, count: 1 };
        }
      } else if (addItem(inv, item, n, cap) > 0) return false;
    }
    return true;
  }
  // the items out of their backpack, into the trade's keeping: [[item, count, mag]] (a gun keeps its magazine, a vest
  // its points)
  takeItems(p, items) {
    const out = [];
    for (const [item, n] of items) {
      if ((ITEM_DEFS[item].stack || 1) > 1) {
        out.push([item, removeTradeItem(p.inv, item, n), null]);
        continue;
      }
      let left = n;
      for (let i = p.inv.length - 1; i >= 0 && left > 0; i--) {
        const s = p.inv[i];
        if (!s || isLoadoutStack(s) || s.item !== item) continue;
        p.inv[i] = null;
        out.push([item, s.count, s.mag ?? null]);
        left -= s.count;
      }
    }
    p.invDirty = p.invSort = true;
    this.game.syncThrow(p);
    return out;
  }
  // items held by a trade to whoever of that side is here, or onto the ground where they were
  handOver(side, items) {
    const g = this.game;
    const p = this.present(side);
    const live = p && p.alive && !p.zombie;
    const at = p ? p.state : side;
    for (const [item, count, mag] of items || []) {
      if (!count) continue;
      const taken = live ? g.giveItem(p, item, count, mag ?? undefined) : 0;
      if (taken > 0) g.pickupEvent(p, item, taken);
      if (taken < count) g.dropItem(item, count - taken, at.x, at.y, at.z, { spread: 0.8, mag: mag ?? undefined });
    }
  }
  commit(t) {
    const g = this.game;
    const [a, b] = t.sides.map((s) => this.present(s));
    if (!a || !b) return this.endTrade(t, 'left');
    if (!this.standing(a) || !this.standing(b)) return this.endTrade(t, 'cancelled');
    if (this.apart(a, b) > TRADE_REACH) return this.endTrade(t, 'too_far');
    for (let i = 0; i < 2; i++) {
      const s = t.sides[i];
      for (const [card, n] of Object.entries(s.offer.cards)) if (this.spare(s.owner, +card, t) < n) return this.endTrade(t, 'not_owned');
      for (const id of s.offer.loadouts || []) if (!this.hasLoadout(s.owner, id, t)) return this.endTrade(t, 'not_owned');
      for (const [item, n] of s.offer.items) if (tradeCount([a, b][i].inv, item) < n) return this.endTrade(t, 'changed');
    }
    if (t.sides.some((s) => (s.offer.loadouts || []).length) && t.sides.some((s) => Object.keys(s.offer.cards).length || s.offer.items.length)) return this.endTrade(t, 'changed');
    if (!this.fits(a, t.sides[0].offer.items, t.sides[1].offer.items) || !this.fits(b, t.sides[1].offer.items, t.sides[0].offer.items)) return this.endTrade(t, 'no_room');
    t.escrow = [this.takeItems(a, t.sides[0].offer.items), this.takeItems(b, t.sides[1].offer.items)];
    [a, b].forEach((p, i) => Object.assign(t.sides[i], { x: p.state.x, y: p.state.y, z: p.state.z }));
    const moves = [];
    for (let i = 0; i < 2; i++) for (const [card, n] of Object.entries(t.sides[i].offer.cards)) moves.push([t.sides[i].owner, t.sides[1 - i].owner, +card, n]);
    const loadoutMoves = [];
    for (let i = 0; i < 2; i++) for (const id of t.sides[i].offer.loadouts || []) loadoutMoves.push([t.sides[i].owner, t.sides[1 - i].owner, id]);
    if (!moves.length && !loadoutMoves.length) return this.closeTrade(t, true);
    t.phase = 'committing';
    this.game.loadouts?.tradeUnlock(t.id);
    t.xfers = { cards: !moves.length, loadouts: !loadoutMoves.length, loadoutApplied: false };
    for (const s of t.sides) {
      this.use(s.owner);
      this.dirty(s.pid, D.TRADE);
    }
    if (moves.length) {
      t.xfer = `${randomUUID()}:trade`;
      this.xfer(t.xfer, 'trade', moves, t.id);
    }
    if (loadoutMoves.length) {
      t.loadoutXfer = `${randomUUID()}:loadout_trade`;
      this.xfer(t.loadoutXfer, 'loadout_trade', loadoutMoves, t.id);
    }
    g.log(`trade ${t.sides[0].name} - ${t.sides[1].name}: ${moves.length} card move(s), ${loadoutMoves.length} loadout item(s) going through`);
  }
  applyLoadoutTrade(t) {
    if (t.xfers?.loadoutApplied) return;
    t.xfers.loadoutApplied = true;
    for (const s of t.sides) {
      const ids = s.offer.loadouts || [];
      if (!ids.length) continue;
      const p = this.present(s);
      if (p) this.game.loadouts?.removeRunCopies(p, ids);
    }
  }
  finishTradeXfer(t, part) {
    if (!t || t.phase !== 'committing') return;
    t.xfers ||= { cards: true, loadouts: true, loadoutApplied: false };
    t.xfers[part] = true;
    if (!t.xfers.cards || !t.xfers.loadouts) return;
    this.applyLoadoutTrade(t);
    this.closeTrade(t, true);
  }
  // struck (done: the items change hands) or not (back to whoever put them in)
  closeTrade(t, done, why = 'done') {
    this.trades.delete(t.id);
    this.game.loadouts?.tradeUnlock(t.id);
    if (t.escrow) {
      this.handOver(t.sides[0], t.escrow[done ? 1 : 0]);
      this.handOver(t.sides[1], t.escrow[done ? 0 : 1]);
    }
    if (t.phase === 'committing') for (const s of t.sides) this.unuse(s.owner);
    t.sides.forEach((s, i) => this.out(this.present(s), CARDMSG.TRADE_END, { with: t.sides[1 - i].pid, why: done ? 'done' : why }));
  }
  // called off (one being committed goes through all the same)
  endTrade(t, why) {
    if (t.phase !== 'open') return;
    this.closeTrade(t, false, why);
  }

  // ---------------------------------------------------------------- decks
  saveDeck(p, d) {
    if (!p.rejoinKey) return this.note(p, CARDNOTE.NOKEY);
    const o = this.own.get(p.rejoinKey);
    if (!o?.loaded) return this.note(p, CARDNOTE.LOADING);
    if (!int(d.slot, 0, DECK_SLOTS - 1)) return this.note(p, CARDNOTE.DECK, 'slot');
    let deck;
    if (d.leader === 0) deck = { slot: d.slot, name: '', leader: 0, cards: {} };
    else {
      const clean = cleanDeck({ leader: d.leader, cards: d.cards });
      if (!clean) return this.note(p, CARDNOTE.DECK, 'shape');
      const v = validateDeck(clean, o.found);
      if (!v.ok) return this.note(p, CARDNOTE.DECK, String(v.errors?.[0] || 'invalid'));
      const name = typeof d.name === 'string' ? d.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, NAME_MAX) : '';
      deck = { slot: d.slot, name, leader: clean.leader, cards: clean.cards };
    }
    o.decks = o.decks.filter((x) => x.slot !== deck.slot);
    if (deck.leader) o.decks = [...o.decks, deck].sort((x, y) => x.slot - y.slot);
    // (kept here at once; written at most every DECK_EVERY, the latest of each slot: a player clicking away at the
    // deck builder is not a write to the database a click)
    const st = this.st(p);
    (st.deckQ ||= new Map()).set(deck.slot, { owner: p.rejoinKey, deck });
    if (this.game.time - st.deckT >= DECK_EVERY) this.writeDecks(st);
    this.dirtyOwner(p.rejoinKey, D.DECKS);
  }
  writeDecks(st) {
    if (!st.deckQ?.size) return;
    for (const { owner, deck } of st.deckQ.values()) this.link.post({ op: 'deck', owner, deck });
    st.deckQ = null;
    st.deckT = this.game.time;
  }

  // ---------------------------------------------------------------- packs (Game.giveItem)
  // count packs of `item`, opened: their cards into the player's collection, and what was in each shown to them.
  // -> count (all of them are taken: a pack never goes back on the ground, nor into the backpack)
  openPack(p, item, count) {
    if (this.frozen) return 0; // (the next server has this game, the pack still on the ground)
    const key = p.rejoinKey;
    const now = this.game.time;
    for (let i = 0; i < count; i++) {
      const cards = rollPack(this.rng, { sealed: item === ITEM.SEALED_PACK });
      let kept = !!key;
      if (kept) {
        const times = (this.packT.get(key) || []).filter((t) => now - t < 3600);
        kept = times.length < PACK_CAP;
        if (kept) times.push(now);
        this.packT.set(key, times);
      }
      if (kept) {
        const o = this.own.get(key);
        if (o) for (const c of cards) o.found[c] = (o.found[c] || 0) + 1;
        this.link.post({ op: 'find', owner: key, cards });
        this.dirtyOwner(key, D.COLL);
      }
      this.out(p, CARDMSG.REVEAL, { item, cards, kept });
    }
    return count;
  }
  // A boss brought down may have carried a sealed pack (combat.js): its chance, and where it falls, by this stream
  bossDrop(z) {
    const g = this.game;
    if (this.rng() >= BOSS_PACK_CHANCE) return;
    const rng = g.rng;
    g.rng = this.rng; // (Game.dropItem scatters what it drops by game.rng)
    try {
      g.dropItem(ITEM.SEALED_PACK, 1, z.x, z.y, z.z, { spread: 2 + this.rng() * 2, life: 400 });
    } finally {
      g.rng = rng;
    }
  }

  // ---------------------------------------------------------------- the clocks (Game.update: only while the run is on)
  tick(dt) {
    const g = this.game;
    for (const st of this.ofP.values()) if (st.deckQ && g.time - st.deckT >= DECK_EVERY) this.writeDecks(st);
    if (this.asks.length && this.asks.some((a) => a.until <= g.time)) {
      for (const a of this.asks) if (a.until <= g.time) this.note(g.players.get(a.from), CARDNOTE.EXPIRED, a.to);
      this.dropAsks((a) => a.until <= g.time);
    }
    for (const m of this.matches.values()) {
      if (m.phase !== 'live' || m.voided) continue;
      const paused = m.sides.map((s) => {
        const p = this.present(s);
        return !p || !!p.away || !!p.downed;
      });
      const ev = CG.tick(m.state, dt, paused);
      if (ev?.length) this.changed(m, ev);
      if (m.state.phase === 'over') this.end(m);
    }
    for (const t of this.trades.values()) {
      if (t.phase !== 'open') continue;
      const [a, b] = t.sides.map((s) => this.present(s));
      if (!a || !b) this.endTrade(t, 'left');
      else if (!this.standing(a) || !this.standing(b)) this.endTrade(t, 'cancelled');
      else if (this.apart(a, b) > TRADE_BREAK) this.endTrade(t, 'too_far');
    }
    for (const x of this.pending.values()) {
      if (!x.retryAt || g.time < x.retryAt) continue;
      x.retryAt = 0;
      if (x.kind.startsWith('loadout_')) this.game.loadouts?.xfer(x.id, x.kind.replace(/^loadout_/, ''), x.moves, x.ref);
      else this.link.post({ op: 'xfer', id: x.id, kind: x.kind, moves: x.moves });
    }
  }

  // ---------------------------------------------------------------- the network thread
  xfer(id, kind, moves, ref) {
    this.pending.set(id, { id, kind, moves, ref, retryAt: 0, tries: 0 });
    if (kind.startsWith('loadout_')) this.game.loadouts?.xfer(id, kind.replace(/^loadout_/, ''), moves, ref);
    else this.link.post({ op: 'xfer', id, kind, moves });
  }
  // what it says (room-worker.js 'cards'): an owner's collection, or how a transfer went
  fromStore(m) {
    try {
      if (m.op === 'coll') this.onColl(m);
      else if (m.op === 'xfered') this.onXfered(m);
    } catch (err) {
      this.game.log(`cards: ${m.op} failed (${err.message})`);
    }
  }
  onColl(m) {
    const o = this.own.get(m.owner);
    if (!o) return;
    o.loaded = m.ok === true;
    if (o.loaded) {
      o.found = cleanFound(Object.fromEntries(Array.isArray(m.found) ? m.found : []));
      o.decks = Array.isArray(m.decks) ? m.decks : [];
    }
    this.dirtyOwner(m.owner, D.COLL | D.DECKS);
  }
  onXfered(m) {
    const g = this.game;
    const x = this.pending.get(m.id);
    if (!x || x.retryAt) return;
    this.pending.delete(m.id);
    if (x.kind === 'trade') {
      const t = this.trades.get(x.ref);
      if (!t) return;
      if (m.ok) return this.finishTradeXfer(t, 'cards');
      // (the store failed, or this game had too many under way: the cards may have moved all the same - a commit
      // that failed as it was answered, or the last server's that went through. Sent again under the same id, which
      // the ledger applies once; only a refusal says for certain that nothing moved)
      if (this.retry(x, m)) return;
      g.log(`trade ${t.sides[0].name} - ${t.sides[1].name}: not struck (${m.why})`);
      return this.closeTrade(t, false, m.why === 'not_owned' ? 'not_owned' : 'store');
    }
    const match = this.matches.get(x.ref);
    if (!match) return;
    if (x.kind === 'lock') {
      if (!m.ok && this.retry(x, m)) return;
      if (m.ok && !match.voided) return this.finishLock(match, 'cards');
      if (m.ok) return this.finishLock(match, 'cards'); // (called off while its bets went in: wait for every lock, then back)
      match.voided ||= m.why === 'not_owned' ? 'not_owned' : 'store';
      match.reason = match.voided;
      for (const s of match.sides) this.note(this.present(s), m.why === 'not_owned' ? CARDNOTE.BET : CARDNOTE.STORE);
      return this.finish(match, true);
    }
    // a payout, or the bets back
    if (m.ok) return this.finishPay(match, 'cards');
    if (this.retry(x, m)) return;
    g.log(`cards: the bets of a match could not be ${x.kind === 'pay' ? 'paid out' : 'given back'} (${m.why})`);
    this.finish(match, false);
  }
  fromLoadoutStore(m) {
    const x = this.pending.get(m.id);
    if (!x || !x.kind.startsWith('loadout_') || x.retryAt) return;
    this.pending.delete(m.id);
    if (x.kind === 'loadout_trade') {
      const t = this.trades.get(x.ref);
      if (!t) return;
      if (m.ok) return this.finishTradeXfer(t, 'loadouts');
      if (this.retry(x, m)) return;
      this.game.log(`trade ${t.sides[0].name} - ${t.sides[1].name}: loadout items not moved (${m.why})`);
      return this.closeTrade(t, false, m.why === 'not_owned' ? 'not_owned' : 'store');
    }
    const match = this.matches.get(x.ref);
    if (!match) return;
    if (x.kind === 'loadout_wager_lock') {
      if (!m.ok && this.retry(x, m)) return;
      if (m.ok && !match.voided) return this.finishLock(match, 'loadouts');
      if (m.ok) return this.finishLock(match, 'loadouts');
      match.voided ||= m.why === 'not_owned' ? 'not_owned' : 'store';
      match.reason = match.voided;
      for (const s of match.sides) this.note(this.present(s), m.why === 'not_owned' ? CARDNOTE.LOADOUT : CARDNOTE.STORE);
      return this.finish(match, true);
    }
    if (m.ok) {
      if (x.kind === 'loadout_wager_pay') this.applyLoadoutWager(match, x.moves);
      return this.finishPay(match, 'loadouts');
    }
    if (this.retry(x, m)) return;
    this.game.log(`cards: the loadout wagers of a match could not be ${x.kind.endsWith('_pay') ? 'paid out' : 'given back'} (${m.why})`);
    this.finish(match, false);
  }
  applyLoadoutWager(match, moves) {
    for (const s of match.sides) {
      const lost = moves.filter(([from, to]) => from === s.owner && to !== s.owner).map(([, , item]) => item);
      if (!lost.length) continue;
      const p = this.present(s);
      if (p) this.game.loadouts?.removeRunCopies(p, lost);
    }
  }

  // A transfer the store could not answer for ('store': it failed; 'busy': too many of this game's under way) is sent
  // again later under its own id. -> true when it will be
  retry(x, m) {
    if (m.why !== 'store' && m.why !== 'busy') return false;
    x.tries++;
    x.retryAt = this.game.time + Math.min(RETRY_MAX, 2 ** x.tries);
    this.pending.set(x.id, x);
    return true;
  }

  // Saved for the next server (room-worker.js 'save'): from here on, nothing more (see the top)
  freeze() {
    this.frozen = true;
  }

  // ---------------------------------------------------------------- to a client (Game.sendTick)
  collFor(p) {
    const key = p.rejoinKey;
    const o = key ? this.own.get(key) : null;
    const lo = key ? this.loadoutColl(key) : null;
    return { loaded: key ? !!o?.loaded : true, kept: !!key, found: o ? { ...o.found } : {}, loadouts: lo?.loaded ? this.stakeView(lo.items.map((it) => it.id), key) : [] };
  }
  asksFor(p) {
    const g = this.game;
    return this.asks.filter((a) => a.from === p.id || a.to === p.id).map((a) => ({ from: a.from, to: a.to, kind: a.kind, bet: a.bet, stake: this.stakeView(a.stake || [], p.rejoinKey), left: Math.max(0, Math.ceil(a.until - g.time)) }));
  }
  write(conn, op, data) {
    const w = this.cw.reset();
    w.u8(S2C.CARDS);
    writeCards(w, op, data);
    conn.send(w.bytes());
    this.game.stats.bytesOut += w.o;
    this.game.stats.msgsOut++;
  }
  send(p) {
    const st = this.ofP.get(p.id);
    if (!st || p.away || (!st.dirty && !st.out.length)) return;
    const conn = p.session.conn;
    const bits = st.dirty;
    st.dirty = 0;
    if (bits & D.COLL) this.write(conn, CARDMSG.COLL, this.collFor(p));
    if (bits & D.DECKS) this.write(conn, CARDMSG.DECKS, { decks: (p.rejoinKey && this.own.get(p.rejoinKey)?.decks) || [] });
    if (bits & D.ASKS) this.write(conn, CARDMSG.ASKS, { asks: this.asksFor(p) });
    if (bits & D.MATCH) {
      const m = this.matchFor(p.id);
      if (m) this.write(conn, CARDMSG.MATCH, this.matchMsg(m, m.sides.findIndex((s) => s.pid === p.id), st));
    }
    if (bits & D.TRADE) {
      const t = this.tradeOf(p.id);
      if (t) this.write(conn, CARDMSG.TRADE, this.tradeMsg(t, t.sides.findIndex((s) => s.pid === p.id)));
    }
    for (const [op, data] of st.out) this.write(conn, op, data);
    st.out.length = 0;
  }

  // ---------------------------------------------------------------- handoff (gamestate.js)
  save() {
    return JSON.parse(
      JSON.stringify({
        seq: this.seq,
        asks: this.asks,
        matches: [...this.matches.values()],
        trades: [...this.trades.values()].filter((t) => t.phase === 'committing'),
        pending: [...this.pending.values()],
      })
    );
  }
  // Into a game just loaded (its players held, gamestate.js): the network thread is told who is here, which escrows are
  // this game's now, and every transfer under way again, under its own id (applied once whichever server sent it).
  // s: null for a save from before there were cards.
  load(s) {
    const g = this.game;
    if (s) {
      this.seq = s.seq || 0;
      this.asks = Array.isArray(s.asks) ? s.asks : [];
      this.matches = new Map((s.matches || []).map((m) => [m.id, m]));
      this.trades = new Map((s.trades || []).map((t) => [t.id, t]));
      this.pending = new Map((s.pending || []).map((x) => [x.id, x]));
    }
    for (const p of g.players.values()) {
      if (!p.rejoinKey) continue;
      this.st(p).entered = true;
      this.use(p.rejoinKey);
    }
    for (const t of this.trades.values()) for (const sd of t.sides) if (sd.owner) this.use(sd.owner);
    const escrows = [...this.matches.values()].filter((m) => m.sides.some((sd) => sd.bet)).map((m) => `m:${m.id}`);
    if (escrows.length) this.link.post({ op: 'escrows', ids: escrows });
    for (const x of this.pending.values())
      if (!x.retryAt) {
        if (x.kind.startsWith('loadout_')) this.game.loadouts?.xfer(x.id, x.kind.replace(/^loadout_/, ''), x.moves, x.ref);
        else this.link.post({ op: 'xfer', id: x.id, kind: x.kind, moves: x.moves });
      }
  }
}
