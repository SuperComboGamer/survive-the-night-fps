// Dead Hand: the computer across the table (the practice match, client/game/cardlocal.js; the fuzz in
// scripts/test-cardgame.js). It plays from a view, as a player does (shared/cardgame.js viewFor), so it knows no more
// than a player would: what it cannot see is stand-ins worth nothing (stateFromView).
//
// 'easy' plays any legal move at random. 'normal':
//   - the redraw: sends back the card it can least use (a second weather card, a Horde card whose group is already in
//     its hand, a horn with too few units to blow it for, a weak plain unit), and keeps the rest
//   - a revive to choose: a Bitten (two more cards), else a Medic (another revive), else the strongest
//   - a turn: every move is tried one step ahead on a copy and scored: how far it moves the totals its way, plus
//     6 a card it gains over the opponent, less what the card spent was worth keeping (cost)
//   - passing: once the opponent has passed, it passes when ahead, else plays the cheapest move that puts it ahead,
//     else gives the round up (unless the round decides the match, or two cards would take it and still leave it no
//     fewer cards than the opponent). Before that, while it has a life to spare: it passes when ahead by 8 or more and
//     catching up would cost the opponent more cards than they have over it (with even cards, any lead of 8); a life
//     up, it passes when ahead with no fewer cards, or behind with more; and it gives up a round it is so far behind in
//     that catching up would leave it two cards down. It never passes behind in a round it cannot afford to lose.
// It looks one move ahead and no further, and knows no more than its view: a player can beat it.
import { cardDef, K, AB, F, LA } from './cards.js';
import { stateFromView, movesFor, applyMove, strengths, cloneState } from './cardgame.js';

const D = (id) => cardDef(id) || { k: K.UNIT, rows: 0, pow: 0, ab: AB.NONE };
const LEADER_COST = 5;
const CARD = 6; // a card in hand is worth this much strength
const PASS_LEAD = 8;

// what playing a card gives up: what it would still be worth in a later round. A plain unit's strength is what it adds
// as it lands, so it scores 0; what scores is what a card does beyond that
function cost(id) {
  const d = D(id);
  if (d.k === K.SPECIAL) return { [AB.WEATHER]: 2, [AB.CLEAR]: 1, [AB.HORN]: 4, [AB.SCORCH]: 5, [AB.DECOY]: 3 }[d.ab] ?? 2;
  if (d.ab === AB.BITTEN) return 0;
  return d.pow + (d.legend ? 4 : 0) + (d.ab === AB.MEDIC || d.ab === AB.SCORCH_ROW ? 2 : 0);
}

// what a card in the opening hand is worth keeping (the redraw sends back the least, under 3)
function keepValue(hand, i) {
  const d = D(hand[i].card);
  const before = hand.slice(0, i).map((c) => D(c.card));
  if (d.k === K.SPECIAL) {
    if (d.ab === AB.WEATHER) return before.some((b) => b.k === K.SPECIAL && b.ab === AB.WEATHER) ? 0 : 3;
    if (d.ab === AB.HORN) return hand.filter((c) => D(c.card).k === K.UNIT && !D(c.card).legend).length < 3 ? 0 : 5;
    return { [AB.CLEAR]: 2, [AB.SCORCH]: 5, [AB.DECOY]: 3 }[d.ab] ?? 2;
  }
  if (d.ab === AB.HORDE) return before.some((b) => b.ab === AB.HORDE && b.grp === d.grp) ? 0 : d.pow + 3;
  if (d.ab === AB.BITTEN) return 8;
  if (d.ab === AB.MEDIC || d.ab === AB.CREW || d.ab === AB.MORALE || d.ab === AB.HORN_UNIT) return d.pow + 3;
  return d.pow;
}

// one step ahead: the state after the move (a revive it leads to chosen as this AI would), or null if refused
function preview(st, me, m) {
  const s2 = cloneState(st);
  if (!applyMove(s2, me, m).ok) return null;
  for (let g = 0; g < 8 && s2.pending && s2.pending.side === me; g++) {
    const pick = reviveChoice(s2, me, movesFor(s2, me));
    if (!pick || !applyMove(s2, me, pick).ok) break;
  }
  return s2;
}

// Bitten > Medic > the strongest; for one that may stand in two rows, a row without weather
function reviveChoice(st, me, moves) {
  const choose = moves.filter((m) => m.t === 'choose');
  if (!choose.length) return null;
  const rank = (m) => {
    const c = st.p[me].discard.find((x) => x.uid === m.uid);
    const d = D(c ? c.card : 0);
    return (d.ab === AB.BITTEN ? 2000 : d.ab === AB.MEDIC ? 1000 : 0) + d.pow * 10 - (weathered(st, m.row) ? 1 : 0);
  };
  return choose.reduce((a, b) => (rank(b) > rank(a) ? b : a));
}
const weathered = (st, row) => st.weather.some((w) => D(w.card).wRow === row);

// moves that do the same thing (copies of a card, the same card on the same row) are tried once; of the Harvests, only
// the two least useful cards for the best one in the deck
function distinct(st, me, moves) {
  const P = st.p[me];
  const la = D(P.leader.card).la;
  const cardIn = (list, uid) => `c${(list.find((c) => c.uid === uid) || { card: -1 }).card}`;
  const targetOf = (uid) => {
    for (let r = 0; r < 3; r++) for (const x of P.rows[r]) if (x.uid === uid) return `${x.card}@${r}`;
    return '';
  };
  // a leader's pick: a uid of a discard (Triage, Brood: mine; Salvage: theirs), or a card id (from the deck)
  const pickOf = (m) => {
    if (m.pick === undefined) return '';
    if (la === LA.TRIAGE || la === LA.BROOD) return cardIn(P.discard, m.pick);
    if (la === LA.SALVAGE) return cardIn(st.p[1 - me].discard, m.pick);
    return `id${m.pick}`;
  };
  const seen = new Set();
  const out = [];
  let harvest = null;
  for (const m of moves) {
    if (m.discard) {
      harvest = harvest || [];
      harvest.push(m);
      continue;
    }
    const key = [m.t, m.uid !== undefined ? cardIn(P.hand, m.uid) : '', m.row ?? '', m.target !== undefined ? targetOf(m.target) : '', pickOf(m)].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  if (harvest) {
    const order = P.hand.map((c, i) => ({ uid: c.uid, v: keepValue(P.hand, i) })).sort((a, b) => a.v - b.v || a.uid - b.uid);
    const ids = [...new Set(P.deck.map((c) => c.card))].sort((a, b) => cost(b) - cost(a) || a - b);
    const want = new Set(order.slice(0, 2).map((o) => o.uid));
    out.push(harvest.find((m) => m.pick === ids[0] && m.discard.every((u) => want.has(u))) || harvest[0]);
  }
  return out;
}

/** The move to play from a view, or null when there is none for this side to play now. rand: () => [0, 1). */
export function chooseMove(view, { rand = Math.random, level = 'normal' } = {}) {
  let st;
  try {
    if (!view || view.phase === 'over') return null;
    st = stateFromView(view);
  } catch {
    return null;
  }
  const me = view.me === 1 ? 1 : 0;
  const moves = movesFor(st, me);
  if (!moves.length) return null;
  const r01 = () => {
    const x = Number(rand());
    return x >= 0 && x < 1 ? x : 0;
  };
  if (level === 'easy') return moves[Math.floor(r01() * moves.length)];
  if (st.phase === 'redraw') {
    const hand = st.p[me].hand;
    let worst = -1;
    for (let i = 0; i < hand.length; i++) if (worst < 0 || keepValue(hand, i) < keepValue(hand, worst)) worst = i;
    const m = worst >= 0 && keepValue(hand, worst) < 3 && moves.find((x) => x.t === 'redraw' && x.uid === hand[worst].uid);
    return m || { t: 'keep' };
  }
  if (st.pending) return reviveChoice(st, me, moves) || moves[0];
  return turnMove(st, me, moves, r01);
}

function turnMove(st, me, moves, r01) {
  const op = 1 - me;
  const pass = moves.find((m) => m.t === 'pass') || { t: 'pass' };
  const S0 = strengths(st);
  const diff0 = S0.totals[me] - S0.totals[op];
  const hand0 = st.p[me].hand.length;
  const ohand0 = st.p[op].hand.length;
  const winsTies = st.p[me].faction === F.SURVIVORS && st.p[op].faction === F.DEAD;
  const ahead = (d) => d > 0 || (d === 0 && winsTies);
  const last = st.lives[me] <= 1; // losing this round loses the match
  const cand = [];
  for (const m of distinct(st, me, moves.filter((x) => x.t !== 'pass'))) {
    const s2 = preview(st, me, m);
    if (!s2) continue;
    const S1 = strengths(s2);
    const diff = S1.totals[me] - S1.totals[op];
    const net = s2.p[me].hand.length - hand0 - (s2.p[op].hand.length - ohand0) + (m.t === 'play' ? 1 : 0);
    const spent = m.t === 'play' ? cost(st.p[me].hand.find((c) => c.uid === m.uid).card) : m.t === 'leader' ? LEADER_COST : 0;
    cand.push({ m, diff, gain: diff - diff0, net, spent, tie: r01() });
  }
  if (!cand.length) return pass;
  const best = (score) => cand.reduce((a, b) => (score(b) > score(a) || (score(b) === score(a) && (b.spent < a.spent || (b.spent === a.spent && b.tie > a.tie))) ? b : a)).m;
  const push = (c) => c.gain + CARD * c.net - c.spent / 4;
  const adv = hand0 - ohand0; // cards in hand over the opponent's
  if (st.passed[op]) {
    if (ahead(diff0)) return pass;
    const wins = cand.filter((c) => ahead(c.diff));
    if (wins.length) return wins.reduce((a, b) => (b.spent - CARD * b.net < a.spent - CARD * a.net || (b.spent - CARD * b.net === a.spent - CARD * a.net && b.gain < a.gain) ? b : a)).m;
    // no one card does it: keep going when the round decides the match (this side's, or theirs, if the hand can still
    // get there), or when two cards would do it and still leave this side no fewer cards; else give it up
    if (last) return best(push);
    if (st.lives[op] <= 1 && reach(st, me) > -diff0) return best(push);
    const gains = cand.map((c) => c.gain).sort((a, b) => b - a);
    if (adv >= 2 && gains.length > 1 && gains[0] + gains[1] > -diff0) return best(push);
    return pass;
  }
  if (last) return best(push);
  // a life up: ahead with no fewer cards, they must beat this and spend cards to do it; behind with more cards, let
  // them have the round and take the cards into the last one
  if (st.lives[op] < st.lives[me] && (ahead(diff0) ? adv >= 0 : adv >= 1)) return pass;
  // ahead by PASS_LEAD or more, and catching up (about a card for every CARD of the lead) would cost them at least the
  // cards they have over this side, and one: pass, and let them spend
  if (diff0 >= PASS_LEAD && adv + Math.ceil(diff0 / CARD) >= 2) return pass;
  // so far behind that catching up would leave this side two cards down: give the round up, keep the cards
  if (-diff0 > CARD * (adv + 2) + 3) return pass;
  return best((c) => c.gain + CARD * c.net - c.spent);
}

// about how much the hand can still add (its units' strength)
function reach(st, me) {
  let n = 0;
  for (const c of st.p[me].hand) {
    const d = D(c.card);
    if (d.k === K.UNIT && d.ab !== AB.BITTEN) n += d.pow;
  }
  return n;
}
