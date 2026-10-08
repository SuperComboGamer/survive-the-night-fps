// Dead Hand: one match of the card game (the cards: shared/cards.js). Pure and deterministic: the state is plain JSON
// (no Map, Set, closure or Date), every random draw comes from the u32 in state.rng (mulberry32, stepped here: the one
// in shared/rng.js keeps its state in a closure, which a saved match could not hold), so a seed and the moves played
// give the same match to the last bit on the server (server/cards.js, which holds the real one), in a save
// (server/gamestate.js) and in the client's practice match (client/game/cardlocal.js). Nothing here throws on what a
// player sends: a move is checked in full before anything is touched, and a refused one leaves the state as it was.
//
// The rules (Gwent, as The Witcher 3 plays it): best of 3 rounds, 2 lives each. Both draw 10 and may send back up to 2
// (a new card is drawn first, then the old one is shuffled into the deck), at the same time. Then a turn is one card
// played, or the leader used, or a pass; a side that passed is out of the round, and the other keeps the turn until it
// passes too. The higher total takes the round and the other loses a life; a tie costs both a life (the Survivors win
// a tie against the Dead). The round's winner leads the next one (after a tie, whoever went second). After each round
// everything on the board goes to the discard of the side it stood on (weather to its owner's), but the Dead keep one
// unit of theirs, chosen at random (both do in a Dead mirror), and Survivors who took the round scavenge: they draw a
// card. (Without that the Dead's horde and their kept unit won 7 matches in 10 between the starter decks.) A side at
// 0 lives has lost; both at 0 is a draw.
// A side with nothing to do but pass passes by itself.
//
// Clocks: TURN_TIME for each turn, then the side's BANK_TIME for the match; with both spent the side passes (or its
// pending choice is made for it) and that is a timeout; the MAX_TIMEOUTS-th forfeits the match. The redraw has
// REDRAW_TIME, after which whoever has not finished keeps their hand. tick() runs the clock of the side to act, or the
// redraw's, and not while that side is paused (the server pauses a player who dropped or is downed).
//
// ---------------------------------------------------------------- the state
// {
//   v: 1, rng: u32, seq: the last event's seq,
//   phase: 'redraw' | 'play' | 'over', round: 1.., turn: the side to act (-1 in the redraw and once over), lead: the
//   side that led this round, clock: seconds left on the turn (or the redraw), bank: [s, s], timeouts: [n, n],
//   lives: [2, 2], passed: [b, b], rounds: [{ totals: [a, b], winner: -1 | 0 | 1 }],
//   result: null | { winner: -1 | 0 | 1, reason: 'lives' | 'forfeit' | 'timeout' },
//   weather: [{ uid, card, owner }],
//   pending: null | { side, kind: 'revive', options: [uid] }   a Medic's choice: it holds the turn until it is made
//   log: [event] (the last LOG_MAX),
//   p: [{                                                       a side (0, 1)
//     leader: { card, used, cancelled }, faction,
//     deck: [{ uid, card }] (the top first), hand: [{ uid, card }], discard: [{ uid, card }],
//     rows: [[{ uid, card, from }] x3]  Close, Ranged, Heavy of this side's board; from: the side that played it there
//                                       (a Bitten card stands on the other side's)
//     horn: [null | { uid, card } x3]   a row's horn slot: a Dusk Horn, or a leader's horn ({ uid: 0, card: leader })
//     redraws: left, redrawDone,
//     known: [uid]                      cards of this hand the opponent has seen (in the order they were shown)
//   }, ...]
// }
// card: a card id (cards.js). uid: a card's own number for the match, 1..n over both decks, given out by a seeded
// shuffle so it says nothing about where the card is in a deck or whose it is.
//
// ---------------------------------------------------------------- what a player sees: viewFor(state, me)
// {
//   me, phase, round, turn, lead, clock, bank: [a, b], timeouts: [a, b], lives: [a, b], passed: [a, b],
//   rounds: [{ totals, winner }], result, seq,
//   weather: [{ uid, card, owner }],
//   pending: null | { kind: 'revive', options: [uid] }   mine only; pendingSide: whose choice is pending (-1: none)
//   redraw: { left: my redraws left, done: [a, b] },
//   sides: [{                                                 both sides, by side number (sides[me] is mine)
//     leader: { card, used, cancelled }, faction,
//     deckCount, deck: mine { id: n } (never the order), theirs null,
//     handCount, hand: mine [{ uid, card }]; theirs only the cards I have seen, in the order I saw them
//     known: uids of this hand the other side has seen,
//     discard: [{ uid, card }],
//     rows: [[{ uid, card, from, pow }] x3]  pow: its strength now
//     horns: [null | { uid, card } x3], totals: [c, r, h], total
//   }, x2],
//   log: [event]   the last events, as eventsFor(log, me) gives them
// }
// Never in a view: rng, the seed, a deck's order, a card of the opponent's hand they have not shown.
//
// ---------------------------------------------------------------- moves: applyMove(state, side, move)
//   { t: 'redraw', uid }       send a card of the hand back (the redraw)
//   { t: 'keep' }              done with the redraw
//   { t: 'play', uid, row?, target? }  a card from the hand. A unit: row (needed only when it may stand in two); a
//                              Dusk Horn: row (of mine, its slot empty); a Noise Maker: target (a unit on my side, not
//                              a legend: it may be a Bitten the opponent put there); weather, Dawn, Molotov: nothing
//   { t: 'leader', pick?, discard?, row? }  use the leader. pick: Triage, Brood: a uid of my discard; Salvage: a uid of
//                              theirs; Harvest, Read the Sky / Miasma: a card id in my deck. discard: Harvest's 2 hand
//                              uids. row: Brood's unit, when it may stand in two
//   { t: 'choose', uid, row? } the pending revive: one of its options
//   { t: 'pass' }   { t: 'forfeit' } (any time, by either side)
// -> { ok: true, events } | { ok: false, error }
//
// ---------------------------------------------------------------- events: { seq, t, ... }
//   start   { lead, leaders: [a, b], cancelled: [a, b] }   the match set up (then a draw for each side)
//   draw    { side, cards: [{ uid, card }] }               to the opponent: { side, n }
//   redraw  { side, out: { uid, card }, in: { uid, card } } to the opponent: { side }
//   keep    { side, auto? }                                its redraw is over
//   begin   { round, lead }                                a round starts (the turn is the lead's)
//   play    { side, uid, card, row?, to?, target? }        a card from the hand. A unit: to the side whose board it
//                                                          went on. A Noise Maker: target { uid, card } is back in hand
//   revive  { side, uid, card, row, to }                   a unit from the discard, by a Medic or Brood
//   pull    { side, cards: [{ uid, card, row }] }          a Horde's group out of the deck
//   pending { side, kind: 'revive', options: [uid] }
//   scorch  { side, by, dead: [{ uid, card, side, row }] } by: the card or leader that burned them
//   clear   { side, cards: [{ uid, card, owner }] }        the weather gone, to its owners' discards
//   leader  { side, card, ... }  seen: [{ uid, card }] (Trail Sense) | row (a horn) | took: { uid, card } (Triage,
//           Salvage) | discard: [{ uid, card }], drew: { uid, card } (Harvest: drew is not told to the opponent) |
//           weather: { uid, card } (Read the Sky, Miasma). A scorch or a revive it makes follows as its own event
//   pass    { side, auto? }   timeout { side, n }   forfeit { side }
//   round   { round, totals, winner, lives, kept: [{ side, uid, card, row }] }
//   over    { winner, reason }
import { cardDef, F, K, ROW, AB, LA, cleanDeck, defaultDeck } from './cards.js';

export const TURN_TIME = 40;
export const BANK_TIME = 90;
export const REDRAW_TIME = 30;
export const MAX_TIMEOUTS = 3;
export const HAND_SIZE = 10;
export const REDRAWS = 2;
export const LIVES = 2;
export const LOG_MAX = 30;
export const SCORCH_MIN = 10; // a row scorch (a unit's or a leader's) needs the row to total this much

// a card no one can see (stateFromView's stand-in for what is hidden): a unit worth 0 that cannot be played
const HIDDEN = Object.freeze({ id: 0, key: 'hidden', name: '?', f: F.NEUTRAL, k: K.UNIT, rows: 0, pow: 0, ab: AB.NONE, r: 1 });
const D = (id) => cardDef(id) || HIDDEN;
const isUnit = (d) => d.k === K.UNIT && d.rows !== 0;
const revivable = (c) => {
  const d = D(c.card);
  return isUnit(d) && !d.legend;
};

// ---------------------------------------------------------------- the random numbers: mulberry32 on state.rng
function rnd(st) {
  const a = (st.rng + 0x6d2b79f5) >>> 0;
  st.rng = a;
  let t = Math.imul(a ^ (a >>> 15), a | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rint = (st, n) => Math.floor(rnd(st) * n);
function shuffle(st, a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rint(st, i + 1);
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

/** A deep copy of a state (or of anything plain JSON). */
export function cloneState(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) {
    const a = new Array(v.length);
    for (let i = 0; i < v.length; i++) a[i] = cloneState(v[i]);
    return a;
  }
  const o = {};
  for (const k in v) o[k] = cloneState(v[k]);
  return o;
}

function emit(st, evs, ev) {
  ev.seq = ++st.seq;
  evs.push(ev);
  st.log.push(cloneState(ev));
  if (st.log.length > LOG_MAX) st.log.splice(0, st.log.length - LOG_MAX);
  return ev;
}
const pub = (c) => ({ uid: c.uid, card: c.card });
const findUid = (arr, uid) => (Number.isInteger(uid) ? arr.findIndex((c) => c.uid === uid) : -1);
const forget = (P, uid) => {
  const i = P.known.indexOf(uid);
  if (i >= 0) P.known.splice(i, 1);
};

// ---------------------------------------------------------------- a new match
// decks: [a, b], each { leader, cards: { id: n } } (validateDeck's to judge; one that is not even a deck plays the
// Survivors' starter deck). seed: any number.
export function newMatch(opts) {
  const { seed = 0, decks = [] } = opts && typeof opts === 'object' ? opts : {};
  const st = {
    v: 1,
    rng: (Number(seed) || 0) >>> 0,
    seq: 0,
    phase: 'redraw',
    round: 1,
    turn: -1,
    lead: 0,
    clock: REDRAW_TIME,
    bank: [BANK_TIME, BANK_TIME],
    timeouts: [0, 0],
    lives: [LIVES, LIVES],
    passed: [false, false],
    rounds: [],
    result: null,
    weather: [],
    pending: null,
    log: [],
    p: [],
  };
  const ds = [0, 1].map((s) => {
    const d = cleanDeck(Array.isArray(decks) ? decks[s] : null);
    return d && d.leader ? d : defaultDeck(F.SURVIVORS);
  });
  // every card of both decks, then their uids from a shuffle of 1..n
  const all = [];
  ds.forEach((d, s) => {
    for (const id of Object.keys(d.cards).map(Number).sort((a, b) => a - b)) for (let i = 0; i < d.cards[id]; i++) all.push({ s, card: id });
  });
  const uids = shuffle(st, all.map((_, i) => i + 1));
  for (let s = 0; s < 2; s++) {
    const L = D(ds[s].leader);
    st.p.push({
      leader: { card: L.id, used: false, cancelled: false },
      faction: L.f,
      deck: shuffle(st, all.flatMap((c, i) => (c.s === s ? [{ uid: uids[i], card: c.card }] : []))),
      hand: [],
      discard: [],
      rows: [[], [], []],
      horn: [null, null, null],
      redraws: REDRAWS,
      redrawDone: false,
      known: [],
    });
  }
  st.lead = rint(st, 2);
  // the passive leaders: the Badge first (it cancels the other's, two cancel each other), then the 11th card
  const la = st.p.map((P) => D(P.leader.card).la);
  for (let s = 0; s < 2; s++) {
    if (la[s] !== LA.BADGE) continue;
    st.p[s].leader.used = true;
    st.p[1 - s].leader.cancelled = true;
  }
  if (la[0] === LA.BADGE && la[1] === LA.BADGE) st.p.forEach((P) => ((P.leader.cancelled = true), (P.leader.used = false)));
  const evs = [];
  emit(st, evs, { t: 'start', lead: st.lead, leaders: st.p.map((P) => P.leader.card), cancelled: st.p.map((P) => P.leader.cancelled) });
  for (let s = 0; s < 2; s++) {
    const P = st.p[s];
    let n = HAND_SIZE;
    if (la[s] === LA.DRAW && !P.leader.cancelled) {
      P.leader.used = true;
      n++;
    }
    draw(st, s, n, evs);
  }
  return st;
}

function draw(st, s, n, evs) {
  const P = st.p[s];
  const cards = P.deck.splice(0, Math.min(n, P.deck.length));
  P.hand.push(...cards);
  if (cards.length) emit(st, evs, { t: 'draw', side: s, cards: cards.map(pub) });
}

// ---------------------------------------------------------------- strength
// base -> weather makes it 1 (a dark unit shrugs off the Nightfall) -> Crew: times the number of its group in the row
// -> +1 for every other Morale unit in the row -> x2 when the row's horn slot is filled or another Rally unit is in it
// (once, whatever there is). Legends are their base, always; a Noise Maker on the board is 0.
// -> { unit: { uid: strength }, rows: [[c, r, h], [c, r, h]], totals: [a, b] }
export function strengths(st) {
  const unit = {};
  const rows = [
    [0, 0, 0],
    [0, 0, 0],
  ];
  const totals = [0, 0];
  const wx = [false, false, false];
  for (const w of st.weather) {
    const r = D(w.card).wRow;
    if (r >= 0 && r < 3) wx[r] = true;
  }
  for (let s = 0; s < 2; s++) {
    for (let r = 0; r < 3; r++) {
      const row = st.p[s].rows[r];
      let morale = 0;
      let rally = 0;
      const crew = {};
      for (const x of row) {
        const d = D(x.card);
        if (d.k !== K.UNIT || d.legend) continue;
        if (d.ab === AB.MORALE) morale++;
        else if (d.ab === AB.HORN_UNIT) rally++;
        else if (d.ab === AB.CREW) crew[d.grp] = (crew[d.grp] || 0) + 1;
      }
      const slot = !!st.p[s].horn[r];
      for (const x of row) {
        const d = D(x.card);
        let v = 0;
        if (d.k === K.UNIT) {
          v = d.pow;
          if (!d.legend) {
            if (wx[r] && !(d.dark && r === ROW.C)) v = 1;
            if (d.ab === AB.CREW) v *= crew[d.grp];
            v += morale - (d.ab === AB.MORALE ? 1 : 0);
            if (slot || rally - (d.ab === AB.HORN_UNIT ? 1 : 0) > 0) v *= 2;
          }
        }
        unit[x.uid] = v;
        rows[s][r] += v;
      }
      totals[s] += rows[s][r];
    }
  }
  return { unit, rows, totals };
}

// ---------------------------------------------------------------- checking a move
// -> an action to carry out ({ t, ... } with what was found), or the reason it is refused (a string)
const isRow = (r) => r === 0 || r === 1 || r === 2;
// the row a unit goes to: the one asked for if it may stand there; none asked, the only one it has
function unitRow(d, row) {
  if (row === undefined || row === null) return d.rows === 1 ? 0 : d.rows === 2 ? 1 : d.rows === 4 ? 2 : -1;
  return isRow(row) && d.rows & (1 << row) ? row : -1;
}
const weatherOn = (st, wRow) => st.weather.some((w) => D(w.card).wRow === wRow);

function check(st, side, mv) {
  if (!st || typeof st !== 'object' || !Array.isArray(st.p)) return 'no match';
  if (side !== 0 && side !== 1) return 'no such side';
  if (!mv || typeof mv !== 'object' || Array.isArray(mv) || typeof mv.t !== 'string') return 'not a move';
  if (st.phase === 'over') return 'the match is over';
  const t = mv.t;
  if (t === 'forfeit') return { t };
  const P = st.p[side];
  if (st.phase === 'redraw') {
    if (P.redrawDone) return 'your redraw is done';
    if (t === 'keep') return { t };
    if (t !== 'redraw') return 'it is the redraw';
    if (P.redraws <= 0) return 'no redraws left';
    if (!P.deck.length) return 'your deck is empty';
    const i = findUid(P.hand, mv.uid);
    return i < 0 ? 'not in your hand' : { t, i };
  }
  if (st.phase !== 'play') return 'no match';
  if (st.pending) {
    if (st.pending.side !== side) return 'not your turn';
    if (t !== 'choose') return 'choose a unit to bring back first';
    if (!Number.isInteger(mv.uid) || !st.pending.options.includes(mv.uid)) return 'not one of the choices';
    const c = P.discard.find((x) => x.uid === mv.uid);
    if (!c || !revivable(c)) return 'not one of the choices';
    const row = unitRow(D(c.card), mv.row);
    return row < 0 ? 'it cannot stand there' : { t, uid: c.uid, row };
  }
  if (st.turn !== side) return 'not your turn';
  if (st.passed[side]) return 'you passed';
  if (t === 'pass') return { t };
  if (t === 'play') return checkPlay(st, side, mv);
  if (t === 'leader') return checkLeader(st, side, mv);
  return 'not a move';
}

function checkPlay(st, side, mv) {
  const P = st.p[side];
  const i = findUid(P.hand, mv.uid);
  if (i < 0) return 'not in your hand';
  const d = D(P.hand[i].card);
  if (d.k === K.UNIT) {
    const row = unitRow(d, mv.row);
    return row < 0 ? 'it cannot stand there' : { t: 'play', i, row };
  }
  if (d.k !== K.SPECIAL) return 'not a card to play';
  switch (d.ab) {
    case AB.WEATHER:
      return weatherOn(st, d.wRow) ? 'that weather is already out' : { t: 'play', i };
    case AB.CLEAR:
    case AB.SCORCH:
      return { t: 'play', i };
    case AB.HORN:
      if (!isRow(mv.row)) return 'choose a row';
      return P.horn[mv.row] ? 'that row has its horn' : { t: 'play', i, row: mv.row };
    case AB.DECOY: {
      if (!Number.isInteger(mv.target)) return 'choose a unit';
      for (let r = 0; r < 3; r++) {
        const j = P.rows[r].findIndex((x) => x.uid === mv.target);
        if (j < 0) continue;
        return revivable(P.rows[r][j]) ? { t: 'play', i, row: r, j } : 'not that one';
      }
      return 'choose a unit of yours';
    }
  }
  return 'not a card to play';
}

function checkLeader(st, side, mv) {
  const P = st.p[side];
  const O = st.p[1 - side];
  if (P.leader.used || P.leader.cancelled) return 'your leader is spent';
  const L = D(P.leader.card);
  if (L.k !== K.LEADER || L.passive) return 'your leader works by itself';
  switch (L.la) {
    case LA.PEEK:
      return O.hand.some((c) => !O.known.includes(c.uid)) ? { t: 'leader' } : 'you have seen their whole hand';
    case LA.HORN:
      return P.horn[L.hRow] ? 'that row has its horn' : { t: 'leader', row: L.hRow };
    case LA.SCORCH:
      return strengths(st).rows[1 - side][L.sRow] >= SCORCH_MIN ? { t: 'leader' } : `their row is under ${SCORCH_MIN}`;
    case LA.TRIAGE:
    case LA.BROOD: {
      const c = P.discard.find((x) => x.uid === mv.pick && Number.isInteger(mv.pick));
      if (!c || !revivable(c)) return 'choose a unit of your discard';
      if (L.la === LA.TRIAGE) return { t: 'leader', uid: c.uid };
      const row = unitRow(D(c.card), mv.row);
      return row < 0 ? 'it cannot stand there' : { t: 'leader', uid: c.uid, row };
    }
    case LA.SALVAGE: {
      const c = O.discard.find((x) => x.uid === mv.pick && Number.isInteger(mv.pick));
      return c && revivable(c) ? { t: 'leader', uid: c.uid } : 'choose a unit of their discard';
    }
    case LA.HARVEST: {
      const dis = mv.discard;
      if (!Array.isArray(dis) || dis.length !== 2 || dis[0] === dis[1]) return 'choose 2 cards to discard';
      if (findUid(P.hand, dis[0]) < 0 || findUid(P.hand, dis[1]) < 0) return 'choose 2 cards of your hand';
      const uid = deckPick(P, mv.pick, () => true);
      return uid ? { t: 'leader', discard: [dis[0], dis[1]], uid } : 'choose a card of your deck';
    }
    case LA.WEATHER: {
      const uid = deckPick(P, mv.pick, (d) => d.k === K.SPECIAL && d.ab === AB.WEATHER);
      if (!uid) return 'choose a weather card of your deck';
      return weatherOn(st, D(mv.pick).wRow) ? 'that weather is already out' : { t: 'leader', uid };
    }
  }
  return 'your leader works by itself';
}
// a card of the deck by its id (the deck's order is never shown, so a player names the card, not the uid): the lowest
// uid of that id, or 0
function deckPick(P, id, ok) {
  if (!Number.isInteger(id) || id <= 0 || !ok(D(id))) return 0;
  let best = 0;
  for (const c of P.deck) if (c.card === id && (!best || c.uid < best)) best = c.uid;
  return best;
}

// ---------------------------------------------------------------- carrying it out
/** Plays a move. -> { ok: true, events } | { ok: false, error } (the state untouched). Never throws. */
export function applyMove(st, side, mv) {
  let a;
  try {
    a = check(st, side, mv);
  } catch {
    return { ok: false, error: 'not a move' };
  }
  if (typeof a === 'string') return { ok: false, error: a };
  const snap = cloneState(st);
  const evs = [];
  try {
    act(st, side, a, evs);
  } catch (e) {
    for (const k of Object.keys(st)) delete st[k];
    Object.assign(st, snap);
    return { ok: false, error: `internal: ${e && e.message}` };
  }
  return { ok: true, events: evs };
}

function act(st, side, a, evs) {
  const P = st.p[side];
  switch (a.t) {
    case 'forfeit':
      emit(st, evs, { t: 'forfeit', side });
      finish(st, evs, 1 - side, 'forfeit');
      return;
    case 'keep':
      P.redrawDone = true;
      emit(st, evs, { t: 'keep', side });
      startPlay(st, evs);
      return;
    case 'redraw': {
      const out = P.hand[a.i];
      forget(P, out.uid);
      const inc = P.deck.shift();
      P.hand[a.i] = inc;
      P.deck.splice(rint(st, P.deck.length + 1), 0, out);
      P.redraws--;
      emit(st, evs, { t: 'redraw', side, out: pub(out), in: pub(inc) });
      if (P.redraws <= 0) {
        P.redrawDone = true;
        emit(st, evs, { t: 'keep', side });
      }
      startPlay(st, evs);
      return;
    }
    case 'pass':
      doPass(st, side, evs, false);
      settle(st, evs);
      return;
    case 'play':
      playCard(st, side, a, evs);
      break;
    case 'choose':
      revive(st, side, a.uid, a.row, evs);
      break;
    case 'leader':
      useLeader(st, side, a, evs);
      break;
  }
  afterAction(st, side, evs);
}

function startPlay(st, evs) {
  if (st.phase !== 'redraw' || !st.p[0].redrawDone || !st.p[1].redrawDone) return;
  st.phase = 'play';
  st.turn = st.lead;
  st.clock = TURN_TIME;
  emit(st, evs, { t: 'begin', round: st.round, lead: st.lead });
  settle(st, evs);
}

// a turn's card, leader or choice is done: the turn goes over (or stays, once the other has passed), unless a choice
// is still to be made
function afterAction(st, side, evs) {
  if (st.phase !== 'play' || st.pending) return;
  st.turn = st.passed[1 - side] ? side : 1 - side;
  st.clock = TURN_TIME;
  settle(st, evs);
}

function doPass(st, side, evs, auto) {
  st.passed[side] = true;
  emit(st, evs, auto ? { t: 'pass', side, auto: true } : { t: 'pass', side });
  if (!st.passed[1 - side]) {
    st.turn = 1 - side;
    st.clock = TURN_TIME;
  }
}

// the round ends once both have passed; a side with nothing but a pass to play passes
function settle(st, evs) {
  for (let g = 0; g < 32 && st.phase === 'play'; g++) {
    if (st.passed[0] && st.passed[1]) {
      endRound(st, evs);
      continue;
    }
    if (st.pending) return;
    if (st.passed[st.turn]) {
      st.turn = 1 - st.turn;
      st.clock = TURN_TIME;
    }
    if (movesFor(st, st.turn, true).length) return;
    doPass(st, st.turn, evs, true);
  }
}

function playCard(st, side, a, evs) {
  const P = st.p[side];
  const c = P.hand.splice(a.i, 1)[0];
  forget(P, c.uid);
  const d = D(c.card);
  if (d.k === K.UNIT) {
    const to = d.ab === AB.BITTEN ? 1 - side : side;
    emit(st, evs, { t: 'play', side, uid: c.uid, card: c.card, row: a.row, to });
    place(st, side, c, a.row, evs);
    return;
  }
  switch (d.ab) {
    case AB.WEATHER:
      emit(st, evs, { t: 'play', side, uid: c.uid, card: c.card });
      st.weather.push({ uid: c.uid, card: c.card, owner: side });
      return;
    case AB.CLEAR:
      emit(st, evs, { t: 'play', side, uid: c.uid, card: c.card });
      P.discard.push(c);
      clearWeather(st, side, evs);
      return;
    case AB.HORN:
      emit(st, evs, { t: 'play', side, uid: c.uid, card: c.card, row: a.row });
      P.horn[a.row] = pub(c);
      return;
    case AB.SCORCH:
      emit(st, evs, { t: 'play', side, uid: c.uid, card: c.card });
      scorch(st, side, c.card, null, evs);
      P.discard.push(c);
      return;
    case AB.DECOY: {
      const back = P.rows[a.row][a.j];
      P.rows[a.row][a.j] = { uid: c.uid, card: c.card, from: side };
      P.hand.push(pub(back));
      P.known.push(back.uid);
      emit(st, evs, { t: 'play', side, uid: c.uid, card: c.card, row: a.row, target: pub(back) });
    }
  }
}

// a unit onto the board (from the hand, or brought back), and what it does as it lands
function place(st, side, c, row, evs) {
  const d = D(c.card);
  const to = d.ab === AB.BITTEN ? 1 - side : side;
  st.p[to].rows[row].push({ uid: c.uid, card: c.card, from: side });
  switch (d.ab) {
    case AB.HORDE:
      pull(st, side, d.grp, evs);
      break;
    case AB.BITTEN:
      draw(st, side, 2, evs);
      break;
    case AB.MEDIC: {
      const options = st.p[side].discard.filter(revivable).map((x) => x.uid);
      if (options.length) {
        st.pending = { side, kind: 'revive', options };
        emit(st, evs, { t: 'pending', side, kind: 'revive', options: [...options] });
      }
      break;
    }
    case AB.SCORCH_ROW:
      scorch(st, side, c.card, d.sRow, evs);
      break;
    case AB.CLEAR:
      clearWeather(st, side, evs);
      break;
  }
}

// a Horde's group from the deck (never the hand), each to its own row (Close, for one that could stand in two); those
// do nothing more as they land
function pull(st, side, grp, evs) {
  const P = st.p[side];
  const got = [];
  P.deck = P.deck.filter((c) => {
    const d = D(c.card);
    if (d.k !== K.UNIT || d.ab !== AB.HORDE || d.grp !== grp) return true;
    const row = unitRow(d) >= 0 ? unitRow(d) : ROW.C;
    P.rows[row].push({ uid: c.uid, card: c.card, from: side });
    got.push({ uid: c.uid, card: c.card, row });
    return false;
  });
  if (got.length) emit(st, evs, { t: 'pull', side, cards: got });
}

function revive(st, side, uid, row, evs) {
  const P = st.p[side];
  const i = P.discard.findIndex((x) => x.uid === uid);
  const c = P.discard.splice(i, 1)[0];
  st.pending = null;
  const to = D(c.card).ab === AB.BITTEN ? 1 - side : side;
  emit(st, evs, { t: 'revive', side, uid: c.uid, card: c.card, row, to });
  place(st, side, c, row, evs);
}

// The strongest units (not legends) die: of the opponent's row `row` when it totals SCORCH_MIN or more (a Scorch unit,
// a scorching leader), or of the whole board (row null: the Molotov). Each goes to the discard of the side it stood on.
function scorch(st, side, by, row, evs) {
  const S = strengths(st);
  const sides = row === null ? [0, 1] : [1 - side];
  if (row !== null && S.rows[1 - side][row] < SCORCH_MIN) return;
  let top = -1;
  const cand = [];
  for (const s of sides) {
    for (let r = 0; r < 3; r++) {
      if (row !== null && r !== row) continue;
      for (const x of st.p[s].rows[r]) {
        if (!revivable(x)) continue;
        const v = S.unit[x.uid];
        if (v > top) top = v;
        cand.push({ s, r, x, v });
      }
    }
  }
  const dead = cand.filter((c) => c.v === top);
  if (!dead.length) return;
  for (const { s, r, x } of dead) {
    const P = st.p[s];
    P.rows[r].splice(P.rows[r].indexOf(x), 1);
    P.discard.push(pub(x));
  }
  emit(st, evs, { t: 'scorch', side, by, dead: dead.map(({ s, r, x }) => ({ uid: x.uid, card: x.card, side: s, row: r })) });
}

function clearWeather(st, side, evs) {
  if (!st.weather.length) return;
  const gone = st.weather;
  st.weather = [];
  for (const w of gone) st.p[w.owner].discard.push(pub(w));
  emit(st, evs, { t: 'clear', side, cards: gone.map((w) => ({ uid: w.uid, card: w.card, owner: w.owner })) });
}

function useLeader(st, side, a, evs) {
  const P = st.p[side];
  const O = st.p[1 - side];
  const L = D(P.leader.card);
  P.leader.used = true;
  const ev = { t: 'leader', side, card: L.id };
  switch (L.la) {
    case LA.PEEK: {
      const unseen = O.hand.filter((c) => !O.known.includes(c.uid));
      const seen = [];
      for (let n = 0; n < 3 && unseen.length; n++) seen.push(unseen.splice(rint(st, unseen.length), 1)[0]);
      for (const c of seen) O.known.push(c.uid);
      ev.seen = seen.map(pub);
      emit(st, evs, ev);
      return;
    }
    case LA.HORN:
      P.horn[a.row] = { uid: 0, card: L.id };
      ev.row = a.row;
      emit(st, evs, ev);
      return;
    case LA.SCORCH:
      emit(st, evs, ev);
      scorch(st, side, L.id, L.sRow, evs);
      return;
    case LA.TRIAGE:
    case LA.SALVAGE: {
      const from = L.la === LA.TRIAGE ? P : O;
      const c = from.discard.splice(from.discard.findIndex((x) => x.uid === a.uid), 1)[0];
      P.hand.push(pub(c));
      P.known.push(c.uid);
      ev.took = pub(c);
      emit(st, evs, ev);
      return;
    }
    case LA.BROOD:
      emit(st, evs, ev);
      revive(st, side, a.uid, a.row, evs);
      return;
    case LA.HARVEST: {
      ev.discard = a.discard.map((uid) => {
        const c = P.hand.splice(findUid(P.hand, uid), 1)[0];
        forget(P, uid);
        P.discard.push(c);
        return pub(c);
      });
      const c = P.deck.splice(findUid(P.deck, a.uid), 1)[0];
      P.hand.push(c);
      ev.drew = pub(c);
      emit(st, evs, ev);
      return;
    }
    case LA.WEATHER: {
      const c = P.deck.splice(findUid(P.deck, a.uid), 1)[0];
      st.weather.push({ uid: c.uid, card: c.card, owner: side });
      ev.weather = pub(c);
      emit(st, evs, ev);
    }
  }
}

function endRound(st, evs) {
  const { totals } = strengths(st);
  const f = st.p.map((P) => P.faction);
  let w = totals[0] > totals[1] ? 0 : totals[1] > totals[0] ? 1 : -1;
  if (w < 0 && f[0] === F.SURVIVORS && f[1] === F.DEAD) w = 0;
  else if (w < 0 && f[1] === F.SURVIVORS && f[0] === F.DEAD) w = 1;
  if (w < 0) st.lives = st.lives.map((n) => Math.max(0, n - 1));
  else st.lives[1 - w] = Math.max(0, st.lives[1 - w] - 1);
  st.rounds.push({ totals: [...totals], winner: w });
  const over = st.lives[0] <= 0 || st.lives[1] <= 0;
  // the Dead keep one of theirs on the board (both do, in a mirror); not once the match is over
  const kept = [];
  if (!over) {
    for (let s = 0; s < 2; s++) {
      if (f[s] !== F.DEAD) continue;
      const units = [];
      st.p[s].rows.forEach((row, r) => row.forEach((x) => D(x.card).k === K.UNIT && x.card && units.push({ x, r })));
      if (!units.length) continue;
      const { x, r } = units[rint(st, units.length)];
      kept.push({ side: s, uid: x.uid, card: x.card, row: r });
    }
  }
  for (let s = 0; s < 2; s++) {
    const P = st.p[s];
    for (let r = 0; r < 3; r++) {
      P.rows[r] = P.rows[r].filter((x) => {
        if (kept.some((k) => k.uid === x.uid)) return true;
        P.discard.push(pub(x));
        return false;
      });
      if (P.horn[r]?.uid) P.discard.push(pub(P.horn[r]));
      P.horn[r] = null;
    }
  }
  for (const w of st.weather) st.p[w.owner].discard.push(pub(w));
  st.weather = [];
  st.pending = null;
  emit(st, evs, { t: 'round', round: st.round, totals: [...totals], winner: w, lives: [...st.lives], kept });
  if (over) {
    finish(st, evs, st.lives[0] > 0 ? 0 : st.lives[1] > 0 ? 1 : -1, 'lives');
    return;
  }
  st.round++;
  st.lead = w >= 0 ? w : 1 - st.lead;
  st.turn = st.lead;
  st.passed = [false, false];
  st.clock = TURN_TIME;
  if (w >= 0 && f[w] === F.SURVIVORS) draw(st, w, 1, evs); // the Survivors' scavenge
  emit(st, evs, { t: 'begin', round: st.round, lead: st.lead });
}

function finish(st, evs, winner, reason) {
  st.phase = 'over';
  st.result = { winner, reason };
  st.turn = -1;
  st.pending = null;
  st.clock = 0;
  emit(st, evs, { t: 'over', winner, reason });
}

// ---------------------------------------------------------------- the clocks
/** Runs the clock of the side to act (both, in the redraw) by dt seconds; a side paused[s] has its clock stopped.
 *  -> events (a timeout and what it made happen). */
export function tick(st, dt, paused = [false, false]) {
  const evs = [];
  try {
    if (!st || typeof st !== 'object' || (st.phase !== 'redraw' && st.phase !== 'play')) return evs;
    dt = Math.min(Number(dt), 1e6);
    if (!(dt > 0)) return evs;
    const away = (s) => Array.isArray(paused) && !!paused[s];
    for (let g = 0; g < 64 && dt > 0; g++) {
      if (st.phase === 'redraw') {
        // one clock for both; it stands still while a side still redrawing is away
        const waiting = [0, 1].filter((s) => !st.p[s].redrawDone);
        if (waiting.some(away)) break;
        const u = Math.min(dt, st.clock);
        st.clock = st.clock - u < 1e-9 ? 0 : st.clock - u;
        dt -= u;
        if (st.clock > 0) break;
        for (const s of waiting) {
          st.p[s].redrawDone = true;
          emit(st, evs, { t: 'keep', side: s, auto: true });
        }
        startPlay(st, evs);
        continue;
      }
      if (st.phase !== 'play') break;
      const s = st.pending ? st.pending.side : st.turn;
      if ((s !== 0 && s !== 1) || away(s)) break;
      if (st.clock > 0) {
        const u = Math.min(dt, st.clock);
        st.clock = st.clock - u < 1e-9 ? 0 : st.clock - u;
        dt -= u;
      }
      if (st.clock <= 0 && st.bank[s] > 0 && dt > 0) {
        const u = Math.min(dt, st.bank[s]);
        st.bank[s] = st.bank[s] - u < 1e-9 ? 0 : st.bank[s] - u;
        dt -= u;
      }
      if (st.clock <= 0 && st.bank[s] <= 0) timeout(st, s, evs);
    }
  } catch {
    // (a state this code did not make: nothing more is done with it)
  }
  return evs;
}

function timeout(st, s, evs) {
  st.timeouts[s]++;
  emit(st, evs, { t: 'timeout', side: s, n: st.timeouts[s] });
  if (st.timeouts[s] >= MAX_TIMEOUTS) {
    finish(st, evs, 1 - s, 'timeout');
    return;
  }
  if (st.pending && st.pending.side === s) {
    // the strongest unit there is (by its base), the lowest uid of those; and again, if that was a Medic too
    for (let g = 0; g < 64 && st.pending && st.pending.side === s; g++) {
      const P = st.p[s];
      let best = null;
      for (const uid of st.pending.options) {
        const c = P.discard.find((x) => x.uid === uid);
        if (!c) continue;
        const v = D(c.card).pow;
        if (!best || v > best.v || (v === best.v && uid < best.uid)) best = { uid, v, d: D(c.card) };
      }
      if (!best) {
        st.pending = null;
        break;
      }
      revive(st, s, best.uid, unitRow(best.d) >= 0 ? unitRow(best.d) : ROW.C, evs);
    }
    afterAction(st, s, evs);
    return;
  }
  doPass(st, s, evs, true);
  settle(st, evs);
}

// ---------------------------------------------------------------- what a side may do
// Every legal move of a side (forfeit, always legal, is not listed). any: stop at the first one that is not a pass.
export function movesFor(st, side, any = false) {
  const out = [];
  if (!st || (side !== 0 && side !== 1) || st.phase === 'over') return out;
  const P = st.p[side];
  const add = (m) => {
    if (typeof check(st, side, m) === 'string') return false;
    out.push(m);
    return any;
  };
  if (st.phase === 'redraw') {
    if (P.redrawDone) return out;
    for (const c of P.hand) if (add({ t: 'redraw', uid: c.uid })) return out;
    add({ t: 'keep' });
    return out;
  }
  if (st.pending) {
    if (st.pending.side !== side) return out;
    for (const uid of st.pending.options) {
      const c = P.discard.find((x) => x.uid === uid);
      if (!c) continue;
      for (let r = 0; r < 3; r++) if (D(c.card).rows & (1 << r) && add({ t: 'choose', uid, row: r })) return out;
    }
    return out;
  }
  if (st.turn !== side || st.passed[side]) return out;
  const tryRows = (m, mask) => {
    for (let r = 0; r < 3; r++) if (mask & (1 << r) && add({ ...m, row: r })) return true;
    return false;
  };
  for (const c of P.hand) {
    const d = D(c.card);
    const m = { t: 'play', uid: c.uid };
    if (d.k === K.UNIT) {
      if (tryRows(m, d.rows)) return out;
    } else if (d.ab === AB.HORN) {
      if (tryRows(m, 7)) return out;
    } else if (d.ab === AB.DECOY) {
      for (const row of P.rows) for (const x of row) if (add({ ...m, target: x.uid })) return out;
    } else if (add(m)) return out;
  }
  const L = D(P.leader.card);
  if (!P.leader.used && !P.leader.cancelled && L.k === K.LEADER && !L.passive) {
    const m = { t: 'leader' };
    const deckIds = [...new Set(P.deck.map((c) => c.card))].sort((a, b) => a - b);
    switch (L.la) {
      case LA.TRIAGE:
        for (const c of P.discard) if (add({ ...m, pick: c.uid })) return out;
        break;
      case LA.SALVAGE:
        for (const c of st.p[1 - side].discard) if (add({ ...m, pick: c.uid })) return out;
        break;
      case LA.BROOD:
        for (const c of P.discard) if (revivable(c) && tryRows({ ...m, pick: c.uid }, D(c.card).rows)) return out;
        break;
      case LA.WEATHER:
        for (const id of deckIds) if (add({ ...m, pick: id })) return out;
        break;
      case LA.HARVEST:
        for (let i = 0; i < P.hand.length; i++)
          for (let j = i + 1; j < P.hand.length; j++) for (const id of deckIds) if (add({ ...m, discard: [P.hand[i].uid, P.hand[j].uid], pick: id })) return out;
        break;
      default:
        if (add(m)) return out;
    }
  }
  if (!any) out.push({ t: 'pass' });
  return out;
}

// ---------------------------------------------------------------- views
/** The events as `side` may see them: the cards the other side drew (or sent back, or Harvested) left out. */
export function eventsFor(events, side) {
  if (!Array.isArray(events)) return [];
  return events.map((e) => {
    if (!e || typeof e !== 'object' || e.side === side || e.side === undefined) return cloneState(e);
    if (e.t === 'draw') return { t: 'draw', side: e.side, n: Array.isArray(e.cards) ? e.cards.length : 0, seq: e.seq };
    if (e.t === 'redraw') return { t: 'redraw', side: e.side, seq: e.seq };
    const c = cloneState(e);
    if (e.t === 'leader') delete c.drew;
    return c;
  });
}

/** What side `me` may see of the match (the shape is at the top of this file). */
export function viewFor(st, me) {
  me = me === 1 ? 1 : 0;
  const S = strengths(st);
  return {
    me,
    phase: st.phase,
    round: st.round,
    turn: st.turn,
    lead: st.lead,
    clock: st.clock,
    bank: [...st.bank],
    timeouts: [...st.timeouts],
    lives: [...st.lives],
    passed: [...st.passed],
    rounds: st.rounds.map((r) => ({ totals: [...r.totals], winner: r.winner })),
    result: st.result ? { winner: st.result.winner, reason: st.result.reason } : null,
    seq: st.seq,
    weather: st.weather.map((w) => ({ uid: w.uid, card: w.card, owner: w.owner })),
    pending: st.pending && st.pending.side === me ? { kind: st.pending.kind, options: [...st.pending.options] } : null,
    pendingSide: st.pending ? st.pending.side : -1,
    redraw: { left: st.p[me].redraws, done: st.p.map((P) => P.redrawDone) },
    sides: st.p.map((P, s) => {
      let deck = null;
      if (s === me) {
        deck = {};
        for (const id of P.deck.map((c) => c.card).sort((a, b) => a - b)) deck[id] = (deck[id] || 0) + 1;
      }
      const hand = s === me ? P.hand.map(pub) : P.known.map((uid) => P.hand.find((c) => c.uid === uid)).filter(Boolean).map(pub);
      return {
        leader: { card: P.leader.card, used: P.leader.used, cancelled: P.leader.cancelled },
        faction: P.faction,
        deckCount: P.deck.length,
        deck,
        handCount: P.hand.length,
        hand,
        known: P.known.filter((uid) => P.hand.some((c) => c.uid === uid)),
        discard: P.discard.map(pub),
        rows: P.rows.map((row) => row.map((x) => ({ uid: x.uid, card: x.card, from: x.from, pow: S.unit[x.uid] }))),
        horns: P.horn.map((h) => (h ? pub(h) : null)),
        totals: [...S.rows[s]],
        total: S.totals[s],
      };
    }),
    log: eventsFor(st.log, me),
  };
}

/** A state a view could have come from: what the viewer cannot see is stand-ins worth 0 that cannot be played (card 0,
 *  uids from 100000), their own deck in an order of its own. Enough to look one move ahead (the AI), and to judge what
 *  is legal (legalMoves). */
export function stateFromView(view) {
  const me = view.me === 1 ? 1 : 0;
  let fake = 100000;
  const st = {
    v: 1,
    rng: 0x2545f491,
    seq: view.seq | 0,
    phase: view.phase,
    round: view.round,
    turn: view.turn,
    lead: view.lead,
    clock: view.clock,
    bank: [...view.bank],
    timeouts: [...view.timeouts],
    lives: [...view.lives],
    passed: [...view.passed],
    rounds: view.rounds.map((r) => ({ totals: [...r.totals], winner: r.winner })),
    result: view.result ? { ...view.result } : null,
    weather: view.weather.map((w) => ({ uid: w.uid, card: w.card, owner: w.owner })),
    pending: view.pending ? { side: me, kind: view.pending.kind, options: [...view.pending.options] } : view.pendingSide === 0 || view.pendingSide === 1 ? { side: view.pendingSide, kind: 'revive', options: [] } : null,
    log: [],
    p: view.sides.map((V, s) => {
      const hand = V.hand.map(pub);
      const known = s === me ? [...V.known] : V.hand.map((c) => c.uid);
      if (s !== me) while (hand.length < V.handCount) hand.push({ uid: fake++, card: 0 });
      const deck = [];
      if (s === me && V.deck) {
        for (const id of Object.keys(V.deck).map(Number).sort((a, b) => a - b)) for (let n = 0; n < V.deck[id]; n++) deck.push({ uid: fake++, card: id });
      } else for (let n = 0; n < V.deckCount; n++) deck.push({ uid: fake++, card: 0 });
      return {
        leader: { ...V.leader },
        faction: V.faction,
        deck,
        hand,
        discard: V.discard.map(pub),
        rows: V.rows.map((row) => row.map((x) => ({ uid: x.uid, card: x.card, from: x.from }))),
        horn: V.horns.map((h) => (h ? pub(h) : null)),
        redraws: s === me ? view.redraw.left : view.redraw.done[s] ? 0 : REDRAWS,
        redrawDone: view.redraw.done[s],
        known,
      };
    }),
  };
  return st;
}

/** Every legal move from what a side sees (forfeit not listed). */
export function legalMoves(view) {
  try {
    return movesFor(stateFromView(view), view.me === 1 ? 1 : 0);
  } catch {
    return [];
  }
}

/** A short fingerprint of a whole state (FNV-1a over its JSON), for replays and desync checks. */
export function hashState(st) {
  const s = JSON.stringify(st);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
