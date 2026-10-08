// Dead Hand's rules (shared/cards.js, shared/cardgame.js, shared/cardai.js), with no server and no browser:
//   - the cards: ids and keys pinned, every field sound, a leader for every character and boss, every Horde group more
//     than one card, both starter decks legal; deck validation and its refusals; packs; cleaning what comes from outside
//   - a match: the setup and the redraw (deterministic per seed), turns, passing, strength (with the worked example),
//     every ability, special card and leader, rounds and the factions' perks, the clocks, what each side may see
//   - legality: every move legalMoves offers is taken, junk is refused and changes nothing, nothing ever throws
//   - replays and a JSON round trip mid-match give the same match to the last bit
//   - AI against AI (300 matches, 2000 with --long): cards are never made or lost, no strength below 0, at most 3
//     rounds, every match ends; the two starter decks against each other, and the normal AI against the easy one
import { CARDS, cardDef, F, K, ROW, ROWM, AB, LA, RAR, GROUPS, STARTER, DECK_RULES, DECK_SLOTS, PACK_SIZE, validateDeck, defaultDeck, rollPack, cleanFound, cleanDeck, rulesText, deckFaction, owned } from '../shared/cards.js';
import { newMatch, applyMove, tick, viewFor, eventsFor, legalMoves, movesFor, strengths, stateFromView, hashState, cloneState, TURN_TIME, BANK_TIME, REDRAW_TIME, MAX_TIMEOUTS } from '../shared/cardgame.js';
import { chooseMove } from '../shared/cardai.js';
import { mulberry32 } from '../shared/rng.js';
import { CHARACTERS } from '../shared/characters.js';
import { ITEM, ZTYPE } from '../shared/defs.js';

const LONG = process.argv.includes('--long');
const t0 = Date.now();
let passed = 0;
const fails = [];
function check(name, ok, detail = '') {
  if (ok) passed++;
  else fails.push(name);
  if (!ok) console.log(`FAIL  ${name} ${detail}`);
}

// ---------------------------------------------------------------- helpers
// A match in play with exactly these cards (card ids; uids from 1000): hands, decks, discards, rows [[C, R, H], ...],
// weather [[id, owner]]
function rig(o = {}) {
  const st = newMatch({ seed: o.seed ?? 1, decks: [0, 1].map((s) => ({ leader: o.leaders?.[s] ?? [402, 450][s], cards: {} })) });
  let uid = 1000;
  const mk = (id) => ({ uid: uid++, card: id });
  for (let s = 0; s < 2; s++) {
    const P = st.p[s];
    P.hand = (o.hands?.[s] || []).map(mk);
    P.deck = (o.decks?.[s] || []).map(mk);
    P.discard = (o.discards?.[s] || []).map(mk);
    P.rows = [0, 1, 2].map((r) => (o.rows?.[s]?.[r] || []).map((id) => ({ ...mk(id), from: s })));
    P.redraws = 0;
    P.redrawDone = true;
  }
  st.weather = (o.weather || []).map(([id, owner]) => ({ ...mk(id), owner }));
  st.phase = 'play';
  st.turn = o.turn ?? 0;
  st.lead = st.turn;
  st.passed = o.passed ? [...o.passed] : [false, false];
  st.lives = o.lives ? [...o.lives] : [2, 2];
  st.clock = TURN_TIME;
  st.log = [];
  return st;
}
const H = (st, s, id, n = 0) => st.p[s].hand.filter((c) => c.card === id)[n]?.uid;
const inPile = (st, s, pile, id) => st.p[s][pile].some((c) => c.card === id);
const row = (st, s, r) => st.p[s].rows[r].map((x) => x.card);
const T = (st) => strengths(st).totals;
const play = (st, s, id, x = {}) => applyMove(st, s, { t: 'play', uid: H(st, s, id), ...x });
const ok = (r) => r && r.ok === true;
const refused = (st, s, m) => {
  const h = hashState(st);
  const r = applyMove(st, s, m);
  return r.ok === false && typeof r.error === 'string' && hashState(st) === h;
};
const evOf = (r, t) => (r.ok ? r.events.filter((e) => e.t === t) : []);
// every card of a match by uid, wherever it is
function census(st) {
  const uids = [];
  for (const P of st.p) {
    for (const pile of [P.deck, P.hand, P.discard]) for (const c of pile) uids.push(c.uid);
    for (const r of P.rows) for (const x of r) uids.push(x.uid);
    for (const h of P.horn) if (h && h.uid) uids.push(h.uid);
  }
  for (const w of st.weather) uids.push(w.uid);
  return uids.sort((a, b) => a - b);
}
const ALL = Object.fromEntries(CARDS.map((c) => [c.id, 9])); // a collector who owns everything

// ---------------------------------------------------------------- the cards
{
  // pinned: ids and keys are kept (user_cards, decks, the wire). New cards may be added; these never change
  const PINNED = '1:nightfall 2:fog 3:downpour 4:dawn 5:dusk_horn 6:molotov 7:noise_maker 8:bitten_stranger 9:stray_cat 10:radio_voice 11:spooked_stag 12:hermit 13:doc_halloway 100:scavenger 101:slugger 102:brawler 103:machete_drifter 104:road_crew 105:nunchuck_kid 106:bitten_neighbour 107:clinic_orderly 108:sheriffs_posse 109:shotgun_guard 110:crossbow_hunter 111:rifleman 112:marksman 113:guardsman 114:flare_gunner 115:field_medic 116:pipe_bomber 117:grenadier 118:flamethrower 119:rpg_gunner 120:pickup_truck 121:old_tractor 122:school_bus 123:mounted_gun 124:escape_car 125:at_rifle_sniper 126:kevlar_veteran 200:walker 201:crawler 202:runner 203:screamer 204:zombie_dog 205:pack_hound 206:leaper 207:shade 208:bat 209:spitter 210:roper 211:grave_rouser 212:bitten_hiker 213:boomer 214:pile_up 215:undead_stag 216:tank 217:patient_zero 218:the_swarm 219:acid_spitter 220:howler 400:dale 401:rosa 402:grace 403:walt 404:earl 405:maya 406:marcus 407:hank 408:jess 409:luis 450:brute 451:alpha 452:bloater 453:abomination 454:hive_queen';
  const moved = PINNED.split(' ').filter((p) => {
    const [id, key] = p.split(':');
    return cardDef(+id)?.key !== key;
  });
  check(`the ${PINNED.split(' ').length} pinned cards keep their ids and keys`, !moved.length, moved.join());
  check('76 cards, ids and keys unique', CARDS.length === 76 && new Set(CARDS.map((c) => c.id)).size === 76 && new Set(CARDS.map((c) => c.key)).size === 76);
  const span = (c) => (c.k === K.LEADER ? (c.f === F.SURVIVORS ? c.id >= 400 && c.id < 450 : c.id >= 450 && c.id < 500) : c.f === F.NEUTRAL ? c.id >= 1 && c.id <= 99 : c.f === F.SURVIVORS ? c.id >= 100 && c.id <= 199 : c.id >= 200 && c.id <= 299);
  check("every id is in its faction's span", CARDS.every(span), CARDS.filter((c) => !span(c)).map((c) => c.id).join());
  const items = new Set(Object.values(ITEM));
  const ztypes = new Set(Object.values(ZTYPE));
  const artOk = (a) =>
    Array.isArray(a) &&
    ((a[0] === 'z' && ztypes.has(a[1]) && Number.isInteger(a[2])) ||
      (a[0] === 's' && Number.isInteger(a[1]) && items.has(a[2]) && a[2] !== ITEM.NONE) ||
      (a[0] === 'c' && CHARACTERS.some((c) => c.id === a[1])) ||
      (a[0] === 'p' && typeof a[1] === 'string') ||
      (a[0] === 'd' && Number.isInteger(a[1])) ||
      (a[0] === 'cat' && a.length === 1) ||
      (a[0] === 'g' && typeof a[1] === 'string') ||
      (a[0] === 'i' && items.has(a[1])));
  const abs = new Set(Object.values(AB));
  const sound = (c) => {
    if (!c.name || typeof c.line !== 'string' || c.line.length < 10 || c.line.length > 80 || !artOk(c.art)) return false;
    if (![F.NEUTRAL, F.SURVIVORS, F.DEAD].includes(c.f) || ![RAR.C, RAR.R, RAR.L].includes(c.r) || !abs.has(c.ab)) return false;
    if (c.k === K.UNIT) {
      if (![1, 2, 4, 3].includes(c.rows) || !Number.isInteger(c.pow) || c.pow < 1) return false;
      if ((c.ab === AB.HORDE || c.ab === AB.CREW) !== !!GROUPS[c.grp]) return false;
      if ((c.ab === AB.AGILE) !== (c.rows === 3)) return false;
      if ((c.ab === AB.SCORCH_ROW) !== [0, 1, 2].includes(c.sRow)) return false;
      if (c.legend && c.r !== RAR.L) return false;
      return [AB.NONE, AB.HORDE, AB.CREW, AB.BITTEN, AB.MEDIC, AB.MORALE, AB.HORN_UNIT, AB.SCORCH_ROW, AB.AGILE, AB.CLEAR].includes(c.ab);
    }
    if (c.k === K.SPECIAL) return c.f === F.NEUTRAL && c.pow === 0 && c.rows === 0 && [AB.WEATHER, AB.CLEAR, AB.HORN, AB.SCORCH, AB.DECOY].includes(c.ab) && (c.ab === AB.WEATHER) === [0, 1, 2].includes(c.wRow);
    if (c.k === K.LEADER) {
      if (c.f === F.NEUTRAL || c.r !== RAR.R || !Object.values(LA).includes(c.la) || !c.lname) return false;
      if ((c.la === LA.HORN) !== [0, 1, 2].includes(c.hRow) || (c.la === LA.SCORCH) !== [0, 1, 2].includes(c.sRow)) return false;
      return !!c.passive === (c.la === LA.DRAW || c.la === LA.BADGE);
    }
    return false;
  };
  check('every card is sound: faction, kind, rows, strength, ability and what it needs, rarity, art, a line', CARDS.every(sound), CARDS.filter((c) => !sound(c)).map((c) => c.id).join());
  check('every card is frozen', CARDS.every((c) => Object.isFrozen(c) && Object.isFrozen(c.art)) && Object.isFrozen(CARDS));
  const noText = CARDS.filter((c) => !rulesText(c) && (c.k !== K.UNIT || c.ab || c.legend || c.dark));
  check('every card that does something says so (rulesText)', !noText.length && rulesText(400).includes('Trail Sense') && rulesText(104).includes('Road Crew') && rulesText(cardDef(1)).includes('Close'), noText.map((c) => c.id).join());
  check('rulesText of anything else is empty, not a throw', rulesText(null) === '' && rulesText(99999) === '' && rulesText('x') === '');
  const chars = CHARACTERS.filter((ch) => {
    const c = cardDef(400 + ch.id);
    return c?.k === K.LEADER && c.f === F.SURVIVORS && c.art[0] === 'c' && c.art[1] === ch.id && c.name === ch.name;
  });
  check(`every character (${CHARACTERS.length}) leads the Survivors, as 400 + their id`, chars.length === CHARACTERS.length);
  const bosses = Object.entries(ZTYPE).filter(([k]) => k.startsWith('BOSS_'));
  const led = bosses.filter(([, t]) => CARDS.some((c) => c.k === K.LEADER && c.f === F.DEAD && c.art[0] === 'z' && c.art[1] === t));
  check(`every boss (${bosses.length}) leads the Dead`, led.length === bosses.length && bosses.length === 5);
  const groups = {};
  for (const c of CARDS) if (c.grp) (groups[c.grp] = groups[c.grp] || []).push(c);
  const lonely = Object.entries(groups).filter(([, cs]) => cs.reduce((n, c) => n + DECK_RULES.copies[c.r], 0) < 2);
  check('every Horde and Crew group has room for 2 or more in a deck', !lonely.length && Object.keys(groups).every((g) => GROUPS[g]), lonely.map(([g]) => g).join());
  const hordes = Object.values(groups).filter((cs) => cs[0].ab === AB.HORDE);
  check('a group is all Horde or all Crew, of one faction', Object.values(groups).every((cs) => cs.every((c) => c.ab === cs[0].ab && c.f === cs[0].f)) && hordes.length === 4);
  check('ROW and ROWM agree', ROWM.C === 1 << ROW.C && ROWM.R === 1 << ROW.R && ROWM.H === 1 << ROW.H && DECK_SLOTS === 4 && PACK_SIZE === 3);

  // the starter set and the starter decks
  const S = defaultDeck(F.SURVIVORS);
  const D = defaultDeck(F.DEAD);
  const units = (d) => Object.entries(d.cards).reduce((n, [id, k]) => n + (cardDef(+id).k === K.UNIT ? k : 0), 0);
  check('the Survivors starter deck is legal: 24 units, 7 specials', validateDeck(S).ok && units(S) === 24 && validateDeck(S).specials === 7 && deckFaction(S) === F.SURVIVORS, JSON.stringify(validateDeck(S)));
  check('the Dead starter deck is legal: 23 units, 7 specials', validateDeck(D).ok && units(D) === 23 && validateDeck(D).specials === 7 && deckFaction(D) === F.DEAD, JSON.stringify(validateDeck(D)));
  check('the starter set has Hank and Rosa, the Alpha and the Brute', [407, 401, 451, 450].every((id) => STARTER[id] === 1) && Object.keys(STARTER).filter((id) => cardDef(+id).k === K.LEADER).length === 4);
  check('both starter leaders of each faction make a legal deck', validateDeck({ ...S, leader: 407 }).ok && validateDeck({ ...D, leader: 451 }).ok);
  check('defaultDeck gives a fresh deck each time', defaultDeck(F.DEAD) !== defaultDeck(F.DEAD) && defaultDeck(F.SURVIVORS).cards !== S.cards);
  check('owned: the starter set plus what was found', owned(104, {}) === 3 && owned(104, { 104: 2 }) === 5 && owned(12, {}) === 0 && owned(12, { 12: 1 }) === 1 && owned(12, { 12: 'x' }) === 0 && owned(12, null) === 0);
}

// ---------------------------------------------------------------- deck validation
{
  const S = defaultDeck(F.SURVIVORS);
  const bad = (deck, found, word) => {
    const v = validateDeck(deck, found);
    return !v.ok && v.errors.some((e) => e.toLowerCase().includes(word));
  };
  const plus = (d, id, n) => ({ leader: d.leader, cards: { ...d.cards, [id]: (d.cards[id] || 0) + n } });
  check('no leader is refused', bad({ cards: S.cards }, {}, 'leader') && bad({ leader: 104, cards: S.cards }, {}, 'leader'));
  check('a leader not owned is refused, and taken once found', bad({ ...S, leader: 400 }, {}, 'own') && validateDeck({ ...S, leader: 400 }, { 400: 1 }).ok);
  check("a card of the other faction is refused", bad(plus(S, 202, 1), ALL, 'plays for'));
  check('more copies than its rarity allows are refused (3 common, 2 rare, 1 legendary)', bad(plus(S, 6, 2), ALL, 'at most 2') && bad(plus(S, 104, 1), ALL, 'at most 3') && bad(plus(S, 12, 2), ALL, 'at most 1') && validateDeck(plus(S, 6, 1), ALL).ok);
  check('more than owned is refused', bad(plus(S, 6, 1), {}, 'you own 1') && bad(plus(S, 12, 1), {}, 'you own 0'));
  const thin = { leader: S.leader, cards: { ...S.cards, 100: 0, 101: 0, 104: 1 } };
  check('fewer than 22 units is refused', bad(thin, {}, 'at least 22') && validateDeck(thin).units === 18);
  check('more than 10 specials is refused', bad({ leader: S.leader, cards: { ...S.cards, 1: 3, 2: 3, 3: 3, 4: 3 } }, ALL, 'at most 10 special'));
  const fat = { leader: S.leader, cards: { ...S.cards } };
  for (const id of [103, 105, 112, 113, 115, 118, 119, 120, 122, 123, 124]) fat.cards[id] = cardDef(id).r === RAR.C ? 3 : cardDef(id).r === RAR.R ? 2 : 1;
  check('more than 40 cards is refused', bad(fat, ALL, 'at most 40'));
  check('a card that does not exist, a leader among the cards, a count that is not one: refused', bad(plus(S, 999, 1), ALL, 'does not exist') && bad(plus(S, 400, 1), ALL, 'leads a deck') && bad({ leader: S.leader, cards: { ...S.cards, 100: 1.5 } }, ALL, 'not a number') && bad({ leader: S.leader, cards: { ...S.cards, 100: -1 } }, ALL, 'not a number'));
  check('anything that is not a deck is refused, not thrown', [null, 5, 'x', [], {}, { leader: 402 }, { leader: 402, cards: [] }].every((d) => validateDeck(d).ok === false));
  check('cleanFound: unknown ids dropped, counts whole and clamped', JSON.stringify(cleanFound({ 1: 2, 999: 3, 104: 2.7, 12: -1, 5: 'x', 6: 1e9, '07': 1, x: 1 })) === JSON.stringify({ 1: 2, 6: 9999, 104: 2 }) && JSON.stringify(cleanFound(null)) === '{}' && JSON.stringify(cleanFound([1, 2])) === '{}');
  const cd = cleanDeck({ leader: 402, cards: { 100: 2, 101: 0 }, name: 'My\u0007 deck that has a very long name indeed' });
  check('cleanDeck keeps a deck of the right shape', cd && cd.leader === 402 && JSON.stringify(cd.cards) === '{"100":2}' && cd.name === 'My deck that has a very');
  check('cleanDeck: leader 0 is an empty slot', JSON.stringify(cleanDeck({ leader: 0, cards: { 100: 3 } })) === '{"leader":0,"cards":{},"name":""}');
  check('cleanDeck refuses what is not a deck', [null, [], 'x', { leader: 104 }, { leader: '402', cards: {} }, { leader: 402, cards: [] }, { leader: 402, cards: { 999: 1 } }, { leader: 402, cards: { 400: 1 } }, { leader: 402, cards: { 100: 1.5 } }, { leader: 402, cards: { 100: 99 } }].every((d) => cleanDeck(d) === null));
  check('deckFaction', deckFaction({ leader: 450 }) === F.DEAD && deckFaction({ leader: 402 }) === F.SURVIVORS && deckFaction({ leader: 104 }) === -1 && deckFaction(null) === -1);
}

// ---------------------------------------------------------------- packs
{
  const rand = mulberry32(42);
  const n = 30000;
  const tally = [{}, {}, {}];
  let sealedLeg = 0;
  let fine = true;
  for (let i = 0; i < n; i++) {
    const p = rollPack(rand);
    if (p.length !== PACK_SIZE || !p.every((id) => cardDef(id))) fine = false;
    p.forEach((id, k) => (tally[k][cardDef(id).r] = (tally[k][cardDef(id).r] || 0) + 1));
    const s = rollPack(rand, { sealed: true });
    if (cardDef(s[2]).r === RAR.L) sealedLeg++;
    if (cardDef(s[2]).r === RAR.C) fine = false;
  }
  const pct = (k, r) => (tally[k][r] || 0) / n;
  check('a pack is 3 real cards', fine);
  check('cards 1-2 of a pack: common 68 / rare 27 / legendary 5', Math.abs(pct(0, RAR.C) - 0.68) < 0.015 && Math.abs(pct(1, RAR.R) - 0.27) < 0.015 && Math.abs(pct(0, RAR.L) - 0.05) < 0.007, `${pct(0, RAR.C)} ${pct(1, RAR.R)} ${pct(0, RAR.L)}`);
  check('the 3rd is rare or better (27 : 5)', !tally[2][RAR.C] && Math.abs(pct(2, RAR.L) - 5 / 32) < 0.015, `${pct(2, RAR.L)}`);
  check("a Sealed Pack's 3rd is legendary 1 time in 3", Math.abs(sealedLeg / n - 1 / 3) < 0.015, `${sealedLeg / n}`);
  const seen = new Set();
  const r2 = mulberry32(7);
  for (let i = 0; i < 4000; i++) rollPack(r2).forEach((id) => seen.add(id));
  check('every card can come out of a pack (leaders as rares)', seen.size === CARDS.length, `${seen.size}`);
  check('a broken rand still gives a pack', rollPack(() => NaN).length === 3 && rollPack(() => 1).every((id) => cardDef(id)));
}

// ---------------------------------------------------------------- the setup and the redraw
{
  const decks = [defaultDeck(F.SURVIVORS), defaultDeck(F.DEAD)];
  const a = newMatch({ seed: 99, decks });
  const b = newMatch({ seed: 99, decks });
  const c = newMatch({ seed: 100, decks });
  check('the same seed sets up the same match; another does not', hashState(a) === hashState(b) && hashState(a) !== hashState(c));
  const n = 31 + 30;
  check('uids are 1..n over both decks, each once', JSON.stringify(census(a)) === JSON.stringify(Array.from({ length: n }, (_, i) => i + 1)));
  check('both draw 10, the redraw is on, its clock running, no turn yet', a.p.every((P) => P.hand.length === 10 && P.redraws === 2) && a.phase === 'redraw' && a.clock === REDRAW_TIME && a.turn === -1 && a.bank.every((x) => x === BANK_TIME));
  // a uid says nothing about where a card is, or whose
  let sortedDecks = 0;
  let lowSide0 = 0;
  const firsts = new Set();
  for (let s = 1; s <= 40; s++) {
    const m = newMatch({ seed: s * 7919, decks });
    const u = m.p[0].deck.map((x) => x.uid);
    if (u.every((x, i) => !i || x > u[i - 1])) sortedDecks++;
    if (Math.max(...census({ ...m, p: [m.p[0], { deck: [], hand: [], discard: [], rows: [[], [], []], horn: [] }], weather: [] })) <= 31) lowSide0++;
    firsts.add(m.p[0].deck[0].uid);
  }
  check("a uid says nothing about a card's place in the deck, or whose it is", sortedDecks === 0 && lowSide0 === 0 && firsts.size > 20);
  const leads = new Set();
  for (let s = 0; s < 20; s++) leads.add(newMatch({ seed: s, decks }).lead);
  check('the coin for the first lead is seeded, and lands both ways', leads.size === 2);

  // the redraw: the new card first, the old one shuffled back in
  const st = newMatch({ seed: 5, decks });
  const P = st.p[0];
  const out = P.hand[3];
  const top = P.deck[0];
  const r = applyMove(st, 0, { t: 'redraw', uid: out.uid });
  check('a redraw: the top card comes in where the old one was, the old one goes into the deck', ok(r) && P.hand[3].uid === top.uid && P.deck.some((x) => x.uid === out.uid) && P.hand.length === 10 && P.deck.length === 21 && P.redraws === 1);
  check('the opponent is told only that a card was sent back', JSON.stringify(eventsFor(r.events, 1)) === JSON.stringify([{ t: 'redraw', side: 0, seq: r.events[0].seq }]) && eventsFor(r.events, 0)[0].in.uid === top.uid);
  check('a card not in the hand cannot be sent back; a play is not a redraw', refused(st, 0, { t: 'redraw', uid: out.uid }) && refused(st, 0, { t: 'play', uid: P.hand[0].uid, row: 0 }) && refused(st, 0, { t: 'pass' }));
  const r2 = applyMove(st, 0, { t: 'redraw', uid: P.hand[0].uid });
  check('the second redraw ends it', ok(r2) && P.redrawDone && evOf(r2, 'keep').length === 1 && refused(st, 0, { t: 'redraw', uid: P.hand[1].uid }) && refused(st, 0, { t: 'keep' }) && st.phase === 'redraw');
  const r3 = applyMove(st, 1, { t: 'keep' });
  check('both done: play begins, the lead to move, its clock running', ok(r3) && st.phase === 'play' && st.turn === st.lead && st.clock === TURN_TIME && evOf(r3, 'begin').length === 1);
  // the redraw's clock: whoever has not finished keeps; it stands still while a side still redrawing is away
  const w = newMatch({ seed: 6, decks });
  applyMove(w, 0, { t: 'keep' });
  check('the redraw clock stands still while a side still redrawing is away', tick(w, 100, [false, true]).length === 0 && w.clock === REDRAW_TIME && w.phase === 'redraw');
  const ev = tick(w, REDRAW_TIME - 1);
  check('...and runs otherwise', !ev.length && w.clock === 1);
  const ev2 = tick(w, 1.5);
  check('when it runs out, the hand is kept and play begins (the rest of the time runs on the turn)', w.phase === 'play' && ev2.some((e) => e.t === 'keep' && e.side === 1 && e.auto) && Math.abs(w.clock - (TURN_TIME - 0.5)) < 1e-9 && w.timeouts.every((x) => x === 0));
}

// ---------------------------------------------------------------- the leaders that work by themselves
{
  const dk = (leader) => ({ ...defaultDeck(cardDef(leader).f), leader });
  const maya = newMatch({ seed: 3, decks: [dk(405), dk(450)] });
  check('Maya starts with 11 cards; her leader is spent, and cannot be played', maya.p[0].hand.length === 11 && maya.p[0].leader.used && maya.p[1].hand.length === 10);
  const mm = newMatch({ seed: 3, decks: [dk(406), dk(405)] });
  check("the Badge cancels Maya before she draws: 10 cards", mm.p[1].hand.length === 10 && mm.p[1].leader.cancelled && !mm.p[1].leader.used && mm.p[0].leader.used && !mm.p[0].leader.cancelled);
  const bb = newMatch({ seed: 3, decks: [dk(406), dk(406)] });
  check('two Badges cancel each other', bb.p.every((P) => P.leader.cancelled && !P.leader.used));
  const st = rig({ leaders: [406, 402], hands: [[100], [101]], discards: [[], [102]], turn: 1 });
  st.p[1].leader.cancelled = true;
  check("a cancelled leader cannot be used; a passive one is never a move", refused(st, 1, { t: 'leader', pick: st.p[1].discard[0].uid }) && !legalMoves(viewFor(st, 1)).some((m) => m.t === 'leader') && (st.turn = 0) === 0 && refused(st, 0, { t: 'leader' }));
}

// ---------------------------------------------------------------- turns
{
  const st = rig({ hands: [[100, 101, 102], [200, 202, 202]], turn: 0 });
  const r = play(st, 0, 100);
  check('a card played: the turn goes over, its clock starts again', ok(r) && st.turn === 1 && st.clock === TURN_TIME && row(st, 0, 0).join() === '100');
  check("not your turn: refused, nothing changes", refused(st, 0, { t: 'play', uid: H(st, 0, 101), row: 0 }) && refused(st, 0, { t: 'pass' }));
  applyMove(st, 1, { t: 'pass' });
  check('after the other passes, you keep the turn', st.turn === 0 && st.passed[1]);
  play(st, 0, 101);
  check('a side that passed can do nothing more', refused(st, 1, { t: 'play', uid: H(st, 1, 202), row: 0 }));
  // the last card: nothing left to do but pass (no card, and Triage has no unit to bring back), so it passes by itself
  const rl = play(st, 0, 102);
  check('...card after card, and with nothing left to play the round ends by itself', ok(rl) && rl.events.some((e) => e.t === 'pass' && e.side === 0 && e.auto) && st.round === 2 && st.rounds[0].winner === 0 && st.turn === 0);

  const a = rig({ hands: [[], [100, 101]], turn: 1 });
  a.p[0].leader.used = true;
  const ra = play(a, 1, 100);
  check('a side with nothing but a pass to play passes by itself, and the other keeps the turn', ok(ra) && ra.events.some((e) => e.t === 'pass' && e.side === 0 && e.auto) && a.turn === 1 && a.passed[0]);
  const dcy = rig({ hands: [[7], [100, 101]], turn: 1 });
  dcy.p[0].leader.used = true;
  check('...as does one whose only card has nothing to work on (a Noise Maker with no unit of its own)', ok(play(dcy, 1, 100)) && dcy.passed[0]);
  const g = rig({ hands: [[100], [200]], discards: [[102, 101], []], turn: 0 });
  const rg = applyMove(g, 0, { t: 'leader', pick: g.p[0].discard[0].uid });
  check('using the leader is the turn', ok(rg) && g.turn === 1 && g.p[0].leader.used && inPile(g, 0, 'hand', 102));
  check('a leader is used once a match', (applyMove(g, 1, { t: 'pass' }), refused(g, 0, { t: 'leader', pick: g.p[0].discard[0]?.uid })));
}

// ---------------------------------------------------------------- strength
{
  // three Road Crew under the Nightfall, a morale unit with them and a horn on the row: each (1 x 3 + 1) x 2 = 8
  const st = rig({ rows: [[[104, 104, 104, 9]], []], weather: [[1, 1]] });
  st.p[0].horn[0] = { uid: 5000, card: 5 };
  const S = strengths(st);
  const crew = st.p[0].rows[0].filter((x) => x.card === 104).map((x) => S.unit[x.uid]);
  const cat = S.unit[st.p[0].rows[0][3].uid];
  check('the worked example: three Road Crew under the Nightfall, with the Stray Cat and a horn, are 8 each', crew.join() === '8,8,8' && cat === 2 && S.rows[0][0] === 26 && S.totals[0] === 26, `${crew} cat ${cat}`);
  const lg = rig({ rows: [[[12, 9, 220]], []], weather: [[1, 0]] });
  lg.p[0].horn[0] = { uid: 5000, card: 5 };
  check('a legend is its strength whatever there is: weather, morale, horn', strengths(lg).unit[lg.p[0].rows[0][0].uid] === 15);
  const hu = rig({ rows: [[[220, 202, 202]], [[220, 220]]] });
  const Sh = strengths(hu);
  check('a Rally unit doubles the others in its row, not itself (two double each other)', Sh.rows[0][0] === 2 + 8 + 8 && Sh.rows[1][0] === 8);
  hu.p[0].horn[0] = { uid: 5000, card: 5 };
  check('a Rally unit and a horn in the same row: doubled once', strengths(hu).rows[0][0] === 4 + 8 + 8);
  const mo = rig({ rows: [[[9, 203, 202]], []] });
  const Sm = strengths(mo);
  check('Morale: +1 to every other unit in the row (two lift each other)', Sm.unit[mo.p[0].rows[0][0].uid] === 2 && Sm.unit[mo.p[0].rows[0][1].uid] === 4 && Sm.unit[mo.p[0].rows[0][2].uid] === 6);
  const dk = rig({ rows: [[[207, 200]], [[207]]], weather: [[1, 0]] });
  const Sd = strengths(dk);
  check('a dark unit shrugs off the Nightfall; the rest are 1; the weather is on both sides', Sd.unit[dk.p[0].rows[0][0].uid] === 7 && Sd.unit[dk.p[0].rows[0][1].uid] === 1 && Sd.unit[dk.p[1].rows[0][0].uid] === 7);
  const fog = rig({ rows: [[[], [207 /* (not a ranged card: a dark unit off the Close row) */, 111]], []], weather: [[2, 1]] });
  check('...only the Nightfall: in another row the weather has it too', strengths(fog).rows[0][1] === 2);
  const cr = rig({ rows: [[[104, 104], [108]], [[104]]] });
  check('Crew counts its own group, in its own row, on its own side', strengths(cr).rows[0][0] === 12 && strengths(cr).rows[0][1] === 3 && strengths(cr).rows[1][0] === 3);
}

// ---------------------------------------------------------------- abilities
{
  // Horde
  const h = rig({ hands: [[100], [200, 200]], decks: [[], [200, 201, 201, 202, 204, 208]], turn: 1 });
  const rh = play(h, 1, 200);
  check('Horde: playing a Walker brings every Walker and Crawler in the deck, not the one in hand, nor others', ok(rh) && row(h, 1, 0).sort().join() === '200,200,201,201' && h.p[1].hand.length === 1 && h.p[1].deck.map((c) => c.card).join() === '202,204,208' && evOf(rh, 'pull')[0]?.cards.length === 3);
  const h2 = rig({ hands: [[100], [204, 202]], decks: [[], [205, 205, 204, 200]], turn: 1 });
  play(h2, 1, 204);
  check('...a Zombie Dog brings the Pack Hounds too (its group), each to its row; those bring no more', row(h2, 1, 0).sort().join() === '204,204,205,205' && h2.p[1].deck.map((c) => c.card).join() === '200');
  const hr = rig({ hands: [[100], [211, 202]], discards: [[], [200]], decks: [[], [200, 201]], turn: 1 });
  play(hr, 1, 211);
  const rhr = applyMove(hr, 1, { t: 'choose', uid: hr.p[1].discard[0].uid });
  check('...and as it is brought back by a Medic', ok(rhr) && row(hr, 1, 0).sort().join() === '200,200,201,211' && !hr.p[1].deck.length && hr.turn === 0);

  // Bitten
  for (const [deck, n] of [[[100, 101, 102], 2], [[100], 1], [[], 0]]) {
    const b = rig({ hands: [[8, 100], [200]], decks: [deck, []], turn: 0 });
    const r = play(b, 0, 8);
    check(`Bitten with ${deck.length} in the deck: on their side, for them, and ${n} drawn`, ok(r) && row(b, 1, 0).join() === '8' && b.p[1].rows[0][0].from === 0 && T(b)[1] === 2 && T(b)[0] === 0 && b.p[0].hand.length === n + 1 && (n === 0 || eventsFor(r.events, 1).find((e) => e.t === 'draw').n === n));
  }
  // Medic
  const m = rig({ hands: [[107, 100], [200]], discards: [[115, 102, 12], []], turn: 0 });
  const rm = play(m, 0, 107);
  check('Medic: a choice of the units in the discard (no legend), and the turn waits for it', ok(rm) && m.pending && m.pending.side === 0 && m.pending.options.length === 2 && m.turn === 0 && evOf(rm, 'pending').length === 1);
  check('...no passing, no other card, no move of theirs until it is made', refused(m, 0, { t: 'pass' }) && refused(m, 0, { t: 'play', uid: H(m, 0, 100), row: 0 }) && refused(m, 1, { t: 'pass' }) && refused(m, 0, { t: 'choose', uid: m.p[0].discard.find((c) => c.card === 12).uid }));
  check("...and the view shows it to the side choosing, only", viewFor(m, 0).pending?.options.length === 2 && viewFor(m, 1).pending === null && viewFor(m, 1).pendingSide === 0 && legalMoves(viewFor(m, 0)).every((x) => x.t === 'choose') && legalMoves(viewFor(m, 1)).length === 0);
  const rc = applyMove(m, 0, { t: 'choose', uid: m.p[0].discard.find((c) => c.card === 115).uid });
  check('...bringing back a Medic chains: another choice', ok(rc) && row(m, 0, 1).join() === '115' && m.pending?.options.length === 1 && m.turn === 0);
  applyMove(m, 0, { t: 'choose', uid: m.pending.options[0] });
  check('...and the turn goes over once the last choice is made', !m.pending && m.turn === 1 && row(m, 0, 0).sort().join() === '102,107' && T(m)[0] === 1 + 4 + 4);
  const m0 = rig({ hands: [[107], [200]], discards: [[12], []] });
  check('a Medic with nothing to bring back: no choice, the turn goes over', ok(play(m0, 0, 107)) && !m0.pending && m0.turn === 1);

  // Scorch (a unit's): the opponent's row at 10 or more, its strongest die (all of the tied), not legends
  const sc = (theirs, extra = {}) => {
    const st = rig({ hands: [[118], []], rows: [[], [theirs]], ...extra });
    const r = play(st, 0, 118);
    return { st, dead: evOf(r, 'scorch')[0]?.dead.map((d) => d.card).sort() || [], r };
  };
  check('Scorch: their Close row at 9, nothing burns', sc([202, 202, 201]).dead.length === 0);
  const s10 = sc([202, 202, 200]);
  check('...at 10 the strongest burn, all of them tied', s10.dead.join() === '202,202' && row(s10.st, 1, 0).join() === '200' && s10.st.p[1].discard.length === 2);
  check('...a legend counts toward the 10 but never burns', sc([217, 200]).dead.join() === '200' && sc([217]).dead.length === 0);
  check('...it looks at their row only, never mine', sc([202, 202, 200], { rows: [[[103, 103]], []] }).st.p[0].rows[0].length === 2);

  // weather, Dawn, the Flare Gunner
  const w = rig({ hands: [[1, 2, 4, 114], [1]], rows: [[[100]], [[202]]], turn: 0 });
  check('weather: the row on both sides at 1', ok(play(w, 0, 1)) && T(w).join() === '1,1' && w.weather.length === 1);
  check('...the same weather twice is refused', refused(w, 1, { t: 'play', uid: H(w, 1, 1) }));
  check('...another weather is not', (applyMove(w, 1, { t: 'pass' }), ok(play(w, 0, 2))) && w.weather.length === 2);
  check('the Flare Gunner clears all weather as it lands, each to its owner', ok(play(w, 0, 114, { row: 1 })) && !w.weather.length && inPile(w, 0, 'discard', 1) && inPile(w, 0, 'discard', 2) && T(w)[0] === 2 + 2);
  check('Dawn is always legal, weather or none, and goes to the discard', ok(play(w, 0, 4)) && inPile(w, 0, 'discard', 4));

  // horns: one to a row
  const hn = rig({ leaders: [401, 450], hands: [[5, 5, 100], []], rows: [[[100], [], [121]], []], turn: 0 });
  hn.passed[1] = true;
  check('a Dusk Horn doubles a row of mine', ok(play(hn, 0, 5, { row: 2 })) && T(hn)[0] === 2 + 10);
  check('...a second on the same row is refused, on another it is not', refused(hn, 0, { t: 'play', uid: H(hn, 0, 5), row: 2 }) && refused(hn, 0, { t: 'play', uid: H(hn, 0, 5) }));
  check("...nor a leader's horn on a row that has one", refused(hn, 0, { t: 'leader' }));
  check('...and a horn needs a row of mine', ok(play(hn, 0, 5, { row: 0 })) && T(hn)[0] === 4 + 10);

  // Molotov: the strongest on the whole board, mine too
  const mol = rig({ hands: [[6, 6], []], rows: [[[102, 103]], [[202], [209]]] });
  mol.passed[1] = true;
  const rmol = play(mol, 0, 6);
  check('Molotov: the strongest on both sides burn, yours too', ok(rmol) && evOf(rmol, 'scorch')[0].dead.map((d) => `${d.side}:${d.card}`).sort().join() === '0:103,1:209' && inPile(mol, 0, 'discard', 6) && inPile(mol, 1, 'discard', 209));
  const mol2 = rig({ hands: [[6, 7], []], rows: [[[12, 100]], [[217]]] });
  mol2.passed[1] = true;
  play(mol2, 0, 7, { target: mol2.p[0].rows[0][1].uid });
  const rmol2 = play(mol2, 0, 6);
  check('...with only legends and a Noise Maker out, nothing burns (and it is still played)', ok(rmol2) && !evOf(rmol2, 'scorch').length && mol2.p[0].rows[0].length === 2 && inPile(mol2, 0, 'discard', 6));

  // the Noise Maker
  const d = rig({ hands: [[7, 7, 100], [212, 100, 101]], rows: [[[102, 12]], [[202]]], turn: 0 });
  const brawler = d.p[0].rows[0][0].uid;
  const rd = play(d, 0, 7, { target: brawler });
  check('Noise Maker: a unit of mine back to my hand, the decoy (0) in its place', ok(rd) && d.p[0].hand.some((c) => c.uid === brawler) && row(d, 0, 0).join() === '7,12' && T(d)[0] === 15 && d.turn === 1);
  check('...and the opponent sees which', viewFor(d, 1).sides[0].hand.some((c) => c.uid === brawler) && viewFor(d, 1).sides[0].known.includes(brawler) && viewFor(d, 1).sides[0].hand.length === 1);
  // their Bitten on my side, taken back: mine now, to play on theirs
  play(d, 1, 212);
  const bit = d.p[0].rows[0].find((x) => x.card === 212)?.uid;
  check('...not a legend, not their unit, not a decoy, not nothing', d.turn === 0 && refused(d, 0, { t: 'play', uid: H(d, 0, 7), target: d.p[0].rows[0][1].uid }) && refused(d, 0, { t: 'play', uid: H(d, 0, 7), target: d.p[1].rows[0][0].uid }) && refused(d, 0, { t: 'play', uid: H(d, 0, 7), target: d.p[0].rows[0][0].uid }) && refused(d, 0, { t: 'play', uid: H(d, 0, 7) }));
  const rb = play(d, 0, 7, { target: bit });
  check('...it takes back a Bitten the opponent put on my side: into my hand', ok(rb) && d.p[0].hand.some((c) => c.uid === bit) && !d.p[1].hand.some((c) => c.uid === bit) && T(d)[0] === 15);
  play(d, 1, 100);
  d.p[0].deck = [{ uid: 7001, card: 100 }, { uid: 7002, card: 101 }];
  check('...and I play it as my own Bitten, onto their side, and draw', ok(applyMove(d, 0, { t: 'play', uid: bit, row: 0 })) && d.p[1].rows[0].some((x) => x.uid === bit && x.from === 0) && d.p[0].deck.length === 0);

  // rows
  const ag = rig({ hands: [[109, 109, 100, 101], []] });
  ag.passed[1] = true;
  check('Agile: Close or Ranged, and it must say which', refused(ag, 0, { t: 'play', uid: H(ag, 0, 109) }) && refused(ag, 0, { t: 'play', uid: H(ag, 0, 109), row: 2 }) && ok(play(ag, 0, 109, { row: 1 })) && ok(play(ag, 0, 109, { row: 0 })));
  check('a unit with one row needs no row, and takes no other', refused(ag, 0, { t: 'play', uid: H(ag, 0, 100), row: 1 }) && ok(play(ag, 0, 100)) && row(ag, 0, 0).join() === '109,100');
}

// ---------------------------------------------------------------- leaders
{
  const L = (leader, o) => rig({ leaders: [leader, 450], ...o });
  // Dale: 3 cards of theirs he has not seen
  const dale = L(400, { hands: [[100], [200, 201, 202, 204, 206]] });
  const rd = applyMove(dale, 0, { t: 'leader' });
  const seen = rd.events[0].seen.map((c) => c.uid);
  const v0 = viewFor(dale, 0);
  check('Trail Sense: 3 cards of their hand shown to Dale, and only those', ok(rd) && seen.length === 3 && v0.sides[1].hand.map((c) => c.uid).join() === seen.join() && v0.sides[1].handCount === 5);
  play(dale, 1, dale.p[1].hand.find((c) => c.uid === seen[0]).card, { row: 0 });
  check('...shown while they stay in that hand', viewFor(dale, 0).sides[1].hand.length === 2 && !dale.p[1].known.includes(seen[0]));
  const dale2 = L(400, { hands: [[100], [200, 201]] });
  dale2.p[1].known.push(dale2.p[1].hand[0].uid);
  check('...with fewer left unseen, what is left; with none, it cannot be used', ok(applyMove(dale2, 0, { t: 'leader' })) && dale2.p[1].known.length === 2 && (dale2.p[0].leader.used = false, refused(dale2, 0, { t: 'leader' })));
  // the horn leaders
  for (const [id, r, f] of [[401, ROW.H, 0], [407, ROW.R, 0], [451, ROW.C, 1]]) {
    const st = rig({ leaders: f ? [402, id] : [id, 450], rows: [[[100], [110], [121]], [[202], [209], [215]]], hands: [[100], [200]], turn: f });
    const before = T(st)[f];
    const r1 = applyMove(st, f, { t: 'leader' });
    check(`${cardDef(id).name}'s ${cardDef(id).lname}: a horn on my ${['Close', 'Ranged', 'Heavy'][r]} row`, ok(r1) && st.p[f].horn[r]?.card === id && st.p[f].horn[r].uid === 0 && T(st)[f] === before + strengths(st).rows[f][r] / 2);
  }
  // Grace
  const gr = L(402, { hands: [[100], [200]], discards: [[102, 12], []] });
  check('Triage: not a legend', refused(gr, 0, { t: 'leader', pick: gr.p[0].discard[1].uid }) && refused(gr, 0, { t: 'leader' }));
  const rg = applyMove(gr, 0, { t: 'leader', pick: gr.p[0].discard[0].uid });
  check('Triage: a unit of my discard back to my hand, and they see which', ok(rg) && inPile(gr, 0, 'hand', 102) && viewFor(gr, 1).sides[0].hand.some((c) => c.card === 102));
  // Walt
  const wa = L(403, { hands: [[100, 101, 102], []], decks: [[121, 117, 121], []] });
  const wu = wa.p[0].hand.map((c) => c.uid);
  check('Harvest: refused without 2 cards of my hand to discard, or a card of my deck to take', refused(wa, 0, { t: 'leader', discard: [wu[0]], pick: 121 }) && refused(wa, 0, { t: 'leader', discard: [wu[0], wu[0]], pick: 121 }) && refused(wa, 0, { t: 'leader', discard: [wu[0], 5], pick: 121 }) && refused(wa, 0, { t: 'leader', discard: [wu[0], wu[1]], pick: 999 }) && refused(wa, 0, { t: 'leader', discard: [wu[0], wu[1]], pick: 102 }) && refused(wa, 0, { t: 'leader', discard: [wu[0], wu[1]], pick: wa.p[0].deck[0].uid }));
  const rw = applyMove(wa, 0, { t: 'leader', discard: [wu[0], wu[1]], pick: 121 });
  check('Harvest: 2 discarded, the card named taken from the deck', ok(rw) && wa.p[0].hand.map((c) => c.card).sort().join() === '102,121' && inPile(wa, 0, 'discard', 100) && inPile(wa, 0, 'discard', 101) && wa.p[0].deck.map((c) => c.card).sort().join() === '117,121');
  check("...the opponent is not told which card", eventsFor(rw.events, 1)[0].drew === undefined && eventsFor(rw.events, 1)[0].discard.length === 2 && eventsFor(rw.events, 0)[0].drew.card === 121);
  // the scorching leaders
  for (const [id, r] of [[404, ROW.H], [450, ROW.C], [453, ROW.H]]) {
    const f = cardDef(id).f === F.DEAD ? 1 : 0;
    const theirs = [[], [], []];
    theirs[r] = [215, 214];
    const st = rig({ leaders: f ? [402, id] : [id, 450], rows: f ? [theirs, []] : [[], theirs], hands: [[100], [200]], turn: f });
    const lowOk = refused(st, f, { t: 'leader' });
    st.p[1 - f].rows[r].push({ uid: 6000, card: 215, from: 1 - f });
    const rs = applyMove(st, f, { t: 'leader' });
    check(`${cardDef(id).lname}: refused under 10 on their ${['Close', 'Ranged', 'Heavy'][r]} row; at 10 or more, its strongest die`, lowOk && ok(rs) && evOf(rs, 'scorch')[0]?.dead.length === 2 && st.p[1 - f].rows[r].map((x) => x.card).join() === '214');
  }
  // Jess, the Bloater: a weather card of my deck
  for (const id of [408, 452]) {
    const f = cardDef(id).f === F.DEAD ? 1 : 0;
    const st = rig({ leaders: f ? [402, id] : [id, 450], decks: f ? [[], [1, 3, 100]] : [[1, 3, 100], []], hands: [[100], [200]], weather: [[3, 1 - f]], turn: f });
    const no = refused(st, f, { t: 'leader', pick: 100 }) && refused(st, f, { t: 'leader', pick: 2 }) && refused(st, f, { t: 'leader', pick: 3 }) && refused(st, f, { t: 'leader' });
    const r = applyMove(st, f, { t: 'leader', pick: 1 });
    check(`${cardDef(id).lname}: a weather card named from my deck is played (not one out already, not another card)`, no && ok(r) && st.weather.length === 2 && st.weather[1].owner === f && st.p[f].deck.length === 2);
  }
  // Luis
  const lu = L(409, { hands: [[100], [200]], discards: [[], [202, 216]] });
  check('Salvage: not a legend', refused(lu, 0, { t: 'leader', pick: lu.p[1].discard[1].uid }));
  const rl = applyMove(lu, 0, { t: 'leader', pick: lu.p[1].discard[0].uid });
  check("Salvage: a unit of their discard into my hand, and they see it there", ok(rl) && inPile(lu, 0, 'hand', 202) && !inPile(lu, 1, 'discard', 202) && viewFor(lu, 1).sides[0].hand.some((c) => c.card === 202));
  // the Hive Queen
  const hq = rig({ leaders: [402, 454], hands: [[100], [200]], discards: [[], [211, 200, 216]], decks: [[], [200, 201]], turn: 1 });
  check('Brood: not a legend', refused(hq, 1, { t: 'leader', pick: hq.p[1].discard[2].uid }));
  const rq = applyMove(hq, 1, { t: 'leader', pick: hq.p[1].discard[0].uid });
  check('Brood: a unit of my discard played, as a Medic would (it may be a Medic: another choice)', ok(rq) && row(hq, 1, 0).join() === '211' && hq.pending?.options.length === 1 && hq.turn === 1);
  applyMove(hq, 1, { t: 'choose', uid: hq.pending.options[0] });
  check('...and what it brings back does what it does (a Walker brings its Horde)', row(hq, 1, 0).sort().join() === '200,200,201,211' && hq.turn === 0);
}

// ---------------------------------------------------------------- rounds
{
  const endWith = (o) => {
    const st = rig(o);
    applyMove(st, st.turn, { t: 'pass' });
    if (st.phase === 'play' && st.round === 1) applyMove(st, st.turn, { t: 'pass' });
    return st;
  };
  const a = endWith({ leaders: [402, 402], rows: [[[103]], [[102]]], hands: [[100], [100]] });
  check('the higher total takes the round, the other loses a life, the winner leads', a.rounds[0].winner === 0 && a.lives.join() === '2,1' && a.round === 2 && a.lead === 0 && a.turn === 0 && a.passed.join() === 'false,false');
  check('the board goes to the discards, the hands stay', !a.p.some((P) => P.rows.some((r) => r.length)) && inPile(a, 0, 'discard', 103) && inPile(a, 1, 'discard', 102) && a.p.every((P) => P.hand.length === 1));
  const tie = endWith({ leaders: [402, 402], rows: [[[102]], [[102]]], hands: [[100], [100]], turn: 1 });
  check('a tie costs both a life; whoever went second leads the next', tie.rounds[0].winner === -1 && tie.lives.join() === '1,1' && tie.lead === 0);
  const sd = endWith({ leaders: [402, 450], rows: [[[102]], [[202]]], hands: [[100], [200]] });
  const ds = endWith({ leaders: [450, 402], rows: [[[202]], [[102]]], hands: [[200], [100]] });
  check('the Survivors win a tie against the Dead, from either seat', sd.rounds[0].winner === 0 && sd.lives.join() === '2,1' && ds.rounds[0].winner === 1 && ds.lives.join() === '1,2');
  // the Survivors scavenge: a card for each round they take, the Dead none
  const sc = endWith({ leaders: [402, 450], rows: [[[103]], [[202]]], hands: [[100], [200]], decks: [[101, 102], [201, 203]] });
  const dc = endWith({ leaders: [402, 450], rows: [[[100]], [[202]]], hands: [[100], [200]], decks: [[101, 102], [201, 203]] });
  check('Survivors who take a round draw a card; the Dead who take one do not', sc.rounds[0].winner === 0 && sc.p[0].hand.length === 2 && sc.p[1].hand.length === 1 && dc.rounds[0].winner === 1 && dc.p[1].hand.length === 1 && dc.p[0].hand.length === 1);
  const dd = endWith({ leaders: [450, 451], rows: [[[202]], [[202]]], hands: [[200], [200]] });
  check('a Dead mirror tie costs both a life', dd.lives.join() === '1,1');
  // the Dead keep one unit, chosen by the seed; both in a mirror
  check('...and each keeps one of its units on the board', dd.p.every((P) => P.rows[0].length === 1) && dd.log.find((e) => e.t === 'round').kept.length === 2);
  const keepOf = (rng) => {
    const st = rig({ leaders: [402, 450], rows: [[[100]], [[200, 202], [209, 208], [215]]], hands: [[100], [200]] });
    st.rng = rng;
    applyMove(st, 0, { t: 'pass' });
    applyMove(st, 1, { t: 'pass' });
    return { kept: st.p[1].rows.flat().map((x) => x.card), survivor: st.p[0].rows.flat().length, hash: hashState(st) };
  };
  const k1 = keepOf(12345);
  const kinds = new Set();
  for (let s = 0; s < 40; s++) kinds.add(keepOf(s * 2654435761).kept.join());
  check('the Dead keep exactly one, the same for the same seed, and not always the same one', k1.kept.length === 1 && k1.survivor === 0 && keepOf(12345).hash === k1.hash && kinds.size >= 4, [...kinds].join(' '));
  // where things go at the round's end
  const g = rig({ leaders: [401, 402], hands: [[8, 5], [100]], rows: [[[], [], [121]], [[102]]], weather: [[1, 1]] });
  g.p[0].deck = [{ uid: 7001, card: 100 }, { uid: 7002, card: 100 }];
  play(g, 0, 8);
  applyMove(g, 1, { t: 'pass' });
  applyMove(g, 0, { t: 'leader' });
  play(g, 0, 5, { row: 0 });
  applyMove(g, 0, { t: 'pass' });
  check("a Bitten goes to the discard of the side it stood on, weather to its owner's, a Dusk Horn to its side's, a leader's horn nowhere", inPile(g, 1, 'discard', 8) && !inPile(g, 0, 'discard', 8) && inPile(g, 1, 'discard', 1) && inPile(g, 0, 'discard', 5) && !g.weather.length && g.p.every((P) => P.horn.every((x) => x === null)) && !census(g).includes(0));
  // the end
  const last = endWith({ leaders: [402, 450], rows: [[[103]], [[102]]], hands: [[100], [200]], lives: [1, 1] });
  check('a side at 0 lives has lost; the Dead keep nothing once it is over', last.phase === 'over' && last.result.winner === 0 && last.result.reason === 'lives' && last.turn === -1 && last.log.find((e) => e.t === 'round').kept.length === 0 && census(last).length === 4);
  const draw = endWith({ leaders: [402, 402], rows: [[[102]], [[102]]], hands: [[100], [100]], lives: [1, 1] });
  check('both at 0: a draw', draw.phase === 'over' && draw.result.winner === -1 && draw.result.reason === 'lives');
  check('nothing more is taken once it is over', refused(draw, 0, { t: 'pass' }) && refused(draw, 1, { t: 'forfeit' }) && tick(draw, 100).length === 0);
  const ff = rig({ hands: [[100], [200]] });
  const rf = applyMove(ff, 1, { t: 'forfeit' });
  check('a forfeit, by either side, at any time, ends it', ok(rf) && ff.result.winner === 0 && ff.result.reason === 'forfeit' && ok(applyMove(newMatch({ seed: 1 }), 0, { t: 'forfeit' })));
}

// ---------------------------------------------------------------- the clocks
{
  const st = rig({ hands: [[100, 101, 102], [200, 201, 202]], turn: 0 });
  check('the turn clock runs: 39 s, nothing', tick(st, 39).length === 0 && Math.abs(st.clock - 1) < 1e-9 && st.bank[0] === BANK_TIME);
  check('...then the bank', tick(st, 1).length === 0 && st.clock === 0 && tick(st, 89.5).length === 0 && Math.abs(st.bank[0] - 0.5) < 1e-9 && st.bank[1] === BANK_TIME);
  const ev = tick(st, 1);
  check('both spent: a timeout, and the side passes; the rest of the time runs on the other side', ev.map((e) => e.t).join() === 'timeout,pass' && ev[1].auto && st.passed[0] && st.turn === 1 && st.timeouts.join() === '1,0' && st.bank[0] === 0 && Math.abs(st.clock - (TURN_TIME - 0.5)) < 1e-9);
  const p2 = rig({ hands: [[100, 101], [200, 201]], turn: 0 });
  check("a paused side's clock does not run", tick(p2, 500, [true, false]).length === 0 && p2.clock === TURN_TIME && p2.bank[0] === BANK_TIME);
  play(p2, 0, 100);
  check("...the other side's does", tick(p2, 10, [true, false]).length === 0 && p2.clock === TURN_TIME - 10);
  const p3 = rig({ hands: [[100, 101], [200, 201]], turn: 0 });
  p3.bank = [0, BANK_TIME];
  tick(p3, TURN_TIME);
  check('with the bank spent, each turn has only its own clock', p3.timeouts[0] === 1 && p3.passed[0]);
  const f3 = rig({ hands: [[100, 101], [200, 201]], turn: 0 });
  f3.timeouts = [MAX_TIMEOUTS - 1, 0];
  const ef = tick(f3, TURN_TIME + BANK_TIME);
  check(`the ${MAX_TIMEOUTS}rd timeout forfeits the match`, f3.phase === 'over' && f3.result.winner === 1 && f3.result.reason === 'timeout' && ef.some((e) => e.t === 'over'));
  const big = rig({ hands: [[100, 101], [200, 201]], turn: 0, lives: [9, 9] });
  tick(big, 1e9);
  check('a huge tick runs every clock out, round after round, until the timeouts end it', big.phase === 'over' && big.result.reason === 'timeout' && big.result.winner === 1 && big.timeouts.join() === `${MAX_TIMEOUTS},${MAX_TIMEOUTS - 1}` && big.rounds.length === MAX_TIMEOUTS - 1);
  const big2 = rig({ hands: [[100, 101], [200, 201]], turn: 0 });
  tick(big2, 1e9);
  check('...or the lives do (the Survivors take the 0 : 0 ties from the Dead)', big2.phase === 'over' && big2.result.reason === 'lives' && big2.result.winner === 0 && big2.lives.join() === '2,0');
  // a pending choice runs out: the strongest by its base, the lowest uid of those, and on down a chain of Medics
  const pm = rig({ hands: [[107, 100], [200]], discards: [[101, 115, 101, 12], []], turn: 0 });
  play(pm, 0, 107);
  const low = Math.min(...pm.p[0].discard.filter((c) => c.card === 101).map((c) => c.uid));
  const ep = tick(pm, TURN_TIME + BANK_TIME);
  const revived = ep.filter((e) => e.t === 'revive').map((e) => e.card);
  check('a choice that runs out is made: the strongest by base (Field Medic, 4), then its own (a Slugger, the lowest uid)', revived.join() === '115,101' && pm.p[0].rows[0].some((x) => x.uid === low) && !pm.pending && pm.turn === 1 && pm.timeouts[0] === 1 && !pm.passed[0], revived.join());
  const tie = rig({ hands: [[107, 100], [200]], discards: [[101, 102, 115, 102], []], turn: 0 });
  play(tie, 0, 107);
  const lowest = Math.min(...tie.p[0].discard.filter((c) => c.card === 102 || c.card === 115).map((c) => c.uid));
  check('...tied on strength, the lowest uid', tick(tie, TURN_TIME + BANK_TIME).find((e) => e.t === 'revive')?.uid === lowest);
}

// ---------------------------------------------------------------- what each side may see
{
  const decks = [defaultDeck(F.SURVIVORS), defaultDeck(F.DEAD)];
  const st = newMatch({ seed: 2024, decks });
  const rand = mulberry32(9);
  for (let i = 0; i < 14 && st.phase !== 'over'; i++) for (const s of [0, 1]) {
    const m = chooseMove(viewFor(st, s), { rand });
    if (m) applyMove(st, s, m);
  }
  const b = cloneState(st);
  // the opponent's hand and deck differ: a card swapped between them, the deck reordered, the rng elsewhere
  const O = b.p[1];
  const hi = O.hand.findIndex((c) => !O.known.includes(c.uid));
  const di = O.deck.findIndex((c) => c.card !== O.hand[hi].card);
  [O.hand[hi], O.deck[di]] = [O.deck[di], O.hand[hi]];
  O.deck.reverse();
  b.p[0].deck.reverse();
  b.rng = 77;
  check('two matches that differ only in what side 0 cannot see look the same to it (its own deck order too)', hi >= 0 && di >= 0 && JSON.stringify(viewFor(st, 0)) === JSON.stringify(viewFor(b, 0)) && JSON.stringify(viewFor(st, 1)) !== JSON.stringify(viewFor(b, 1)));
  const v = viewFor(st, 0);
  const js = JSON.stringify(v);
  const uids = [];
  const walk = (o) => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === 'object') for (const [k, x] of Object.entries(o)) k === 'uid' ? uids.push(x) : walk(x);
  };
  walk(v);
  const hidden = new Set([...st.p[1].hand.filter((c) => !st.p[1].known.includes(c.uid)), ...st.p[1].deck, ...st.p[0].deck].map((c) => c.uid));
  check('a view holds no rng, no seed, no uid of a card it may not see', !js.includes('"rng"') && !js.includes('"seed"') && !uids.some((u) => hidden.has(u)) && v.sides[1].deck === null && !Array.isArray(v.sides[0].deck));
  check("the opponent's draws are only a number in the log", v.log.filter((e) => e.t === 'draw' && e.side === 1).every((e) => e.cards === undefined && Number.isInteger(e.n)) && v.log.filter((e) => e.t === 'draw' && e.side === 0).every((e) => e.cards.length));
  check('every event has a seq, rising; the log keeps the last 30', st.log.length <= 30 && st.log.every((e, i) => Number.isInteger(e.seq) && (!i || e.seq === st.log[i - 1].seq + 1)) && v.seq === st.seq);
  check('a view counts both decks and hands, and shows the strengths', v.sides[1].deckCount === st.p[1].deck.length && v.sides[1].handCount === st.p[1].hand.length && v.sides.every((sd, s) => sd.total === strengths(st).totals[s] && sd.rows.flat().every((x) => x.pow === strengths(st).unit[x.uid])));
  const back = stateFromView(v);
  check('stateFromView: the board, the totals and every legal move as the real match has them', JSON.stringify(strengths(back).totals) === JSON.stringify(strengths(st).totals) && JSON.stringify(movesFor(back, 0)) === JSON.stringify(movesFor(st, 0)));
}

// ---------------------------------------------------------------- junk never throws, never changes anything
{
  // (Grace leads: her Triage needs a pick, so a leader move with a junk one is junk; Hank's needs none)
  const st = newMatch({ seed: 8, decks: [{ ...defaultDeck(F.SURVIVORS), leader: 402 }, defaultDeck(F.DEAD)] });
  applyMove(st, 0, { t: 'keep' });
  applyMove(st, 1, { t: 'keep' });
  const s = st.turn;
  const u = st.p[s].hand[0].uid;
  const theirs = st.p[1 - s].hand[0].uid;
  const junkMoves = [null, undefined, 0, 1, -1, NaN, Infinity, '', 'pass', true, [], [{ t: 'pass' }], {}, { t: null }, { t: 5 }, { t: 'PASS' }, { t: 'play' }, { t: 'play', uid: String(u) }, { t: 'play', uid: u + 0.5 }, { t: 'play', uid: theirs, row: 0 }, { t: 'play', uid: 99999 }, { t: 'play', uid: u, row: 7 }, { t: 'play', uid: u, row: -1 }, { t: 'play', uid: u, row: '0' }, { t: 'play', uid: u, row: 1.5 }, { t: 'play', uid: [u] }, { t: 'play', uid: { valueOf: () => u } }, { t: 'leader', pick: {} }, { t: 'leader', pick: [] }, { t: 'leader', discard: 'xx' }, { t: 'leader', discard: [null, undefined] }, { t: 'choose', uid: u }, { t: 'redraw', uid: u }, { t: 'keep' }, { t: '__proto__' }, { t: 'constructor' }, JSON.parse('{"t":"play","__proto__":{"uid":1}}'), { t: 'toString' }];
  const h = hashState(st);
  let threw = 0;
  let took = 0;
  for (const side of [s, 1 - s, 2, -1, '0', null, undefined, 0.5]) {
    for (const m of junkMoves) {
      try {
        const r = applyMove(st, side, m);
        if (r.ok) took++;
      } catch {
        threw++;
      }
    }
  }
  check('junk moves from any side are refused, never thrown, and leave the match as it was', !threw && !took && hashState(st) === h, `${threw} threw, ${took} taken`);
  let threw2 = 0;
  const junkStates = [null, undefined, 5, 'x', [], {}, { p: [] }, { phase: 'play', p: [{}, {}] }, { phase: 'play', turn: 0, p: [{ hand: 5 }, {}], passed: [] }];
  for (const j of junkStates) {
    try {
      if (applyMove(j, 0, { t: 'pass' }).ok) threw2++;
      if (applyMove(j, 0, { t: 'play', uid: 1, row: 0 }).ok) threw2++;
      if (!Array.isArray(tick(j, 5))) threw2++;
      if (legalMoves(j).length) threw2++;
      if (chooseMove(j) !== null) threw2++;
      if (!Array.isArray(eventsFor(j, 0))) threw2++;
    } catch (e) {
      threw2++;
      console.log('threw', e.message);
    }
  }
  let threw3 = 0;
  for (const dt of [NaN, -5, 0, 'abc', null, undefined, {}, -Infinity]) {
    try {
      if (tick(st, dt, 'junk').length) threw3++;
    } catch {
      threw3++;
    }
  }
  check('junk states and junk times: nothing thrown, nothing done', !threw2 && !threw3 && hashState(st) === h);
  check('newMatch takes junk too: no decks, junk decks, junk seed', [undefined, null, 7, {}, { seed: 'x', decks: 5 }, { seed: NaN, decks: [null, { leader: 999 }] }].every((o) => newMatch(o).p.every((P) => P.hand.length === 10)));
}

// ---------------------------------------------------------------- replays and the JSON round trip
{
  const decks = [defaultDeck(F.DEAD), defaultDeck(F.SURVIVORS)];
  const st = newMatch({ seed: 4242, decks });
  const rand = mulberry32(4242);
  const moves = [];
  const hashes = [];
  let mid = null;
  for (let g = 0; g < 400 && st.phase !== 'over'; g++) {
    for (const s of [0, 1]) {
      const m = chooseMove(viewFor(st, s), { rand });
      if (!m) continue;
      applyMove(st, s, m);
      moves.push([s, m]);
      hashes.push(hashState(st));
      if (moves.length === 12) mid = JSON.stringify(st);
    }
    if (g % 3 === 0) {
      const ev = tick(st, 7);
      moves.push(['tick', ev.length]);
      hashes.push(hashState(st));
    }
  }
  const replay = (from, start) => {
    const r = from;
    let same = true;
    for (let i = start; i < moves.length; i++) {
      const [s, m] = moves[i];
      if (s === 'tick') tick(r, 7);
      else if (!applyMove(r, s, m).ok) same = false;
      if (hashState(r) !== hashes[i]) same = false;
    }
    return same && hashState(r) === hashState(st);
  };
  check('the same seed and the same moves (and ticks) give the same match, step by step', st.phase === 'over' && replay(newMatch({ seed: 4242, decks }), 0), `${moves.length} steps`);
  check('a match through JSON mid-way carries on the same', mid && replay(JSON.parse(mid), 12));
  check('hashState: the same state the same, any change another', hashState(JSON.parse(mid)) === hashState(JSON.parse(mid)) && hashState({ ...JSON.parse(mid), clock: 1.5 }) !== hashState(JSON.parse(mid)));
}

// ---------------------------------------------------------------- AI against AI
function randomDeck(rand) {
  const f = rand() < 0.5 ? F.SURVIVORS : F.DEAD;
  const leaders = CARDS.filter((c) => c.k === K.LEADER && c.f === f);
  const pool = CARDS.filter((c) => c.k !== K.LEADER && (c.f === f || c.f === F.NEUTRAL));
  const cards = {};
  let units = 0;
  let specials = 0;
  const size = 25 + Math.floor(rand() * 16);
  for (let g = 0; g < 2000 && (units < 22 || units + specials < size) && units + specials < 40; g++) {
    const c = pool[Math.floor(rand() * pool.length)];
    if ((cards[c.id] || 0) >= DECK_RULES.copies[c.r]) continue;
    if (c.k === K.SPECIAL && (specials >= 10 || rand() < 0.5)) continue;
    cards[c.id] = (cards[c.id] || 0) + 1;
    if (c.k === K.UNIT) units++;
    else specials++;
  }
  return { leader: leaders[Math.floor(rand() * leaders.length)].id, cards };
}

// one match: -> { result, rounds, problems: [text] }
function runMatch(seed, decks, levels, { chaos = false, legality = false } = {}) {
  const rand = mulberry32(seed ^ 0x5bd1e995);
  const st = newMatch({ seed, decks });
  const all = census(st);
  const problems = [];
  const inv = () => {
    const c = census(st);
    if (c.length !== all.length || c.some((u, i) => u !== all[i])) problems.push('cards made or lost');
    const S = strengths(st);
    if (Object.values(S.unit).some((v) => !(v >= 0))) problems.push('a strength below 0');
    if (st.rounds.length > 3) problems.push('more than 3 rounds');
    if (st.lives.some((l) => l < 0)) problems.push('lives below 0');
  };
  let steps = 0;
  try {
    while (st.phase !== 'over' && steps < 3000) {
      steps++;
      if (chaos && rand() < 0.04) {
        tick(st, rand() * 300, [rand() < 0.15, rand() < 0.15]);
        inv();
        continue;
      }
      if (chaos && rand() < 0.03) {
        const h = hashState(st);
        const s = Math.floor(rand() * 2);
        const junk = [{ t: 'play', uid: Math.floor(rand() * 90), row: Math.floor(rand() * 4) }, { t: 'leader', pick: Math.floor(rand() * 500) }, { t: 'choose', uid: Math.floor(rand() * 90) }, { t: 'redraw', uid: Math.floor(rand() * 90) }][Math.floor(rand() * 4)];
        if (!applyMove(st, s, junk).ok && hashState(st) !== h) problems.push('a refused move changed the match');
        continue;
      }
      let acted = false;
      for (const s of [0, 1]) {
        const v = viewFor(st, s);
        if (legality) {
          const lm = legalMoves(v);
          if (JSON.stringify(lm) !== JSON.stringify(movesFor(st, s))) problems.push('legalMoves(view) is not what the match allows');
          for (const m of lm) if (!applyMove(cloneState(st), s, m).ok) problems.push(`a legal move refused: ${JSON.stringify(m)}`);
        }
        const m = chooseMove(v, { rand, level: levels[s] });
        if (!m) continue;
        const r = applyMove(st, s, m);
        if (!r.ok) problems.push(`the AI's move refused: ${r.error}`);
        acted = true;
        inv();
      }
      if (!acted) {
        problems.push('nobody can move');
        break;
      }
    }
  } catch (e) {
    problems.push(`threw: ${e.stack}`);
  }
  if (st.phase !== 'over') problems.push('did not end');
  return { st, problems };
}

{
  const N = LONG ? 2000 : 300;
  const rand = mulberry32(31337);
  let problems = [];
  let ended = 0;
  let maxRounds = 0;
  let decksOk = true;
  const reasons = {};
  for (let i = 0; i < N; i++) {
    const decks = [0, 1].map(() => (rand() < 0.25 ? defaultDeck(rand() < 0.5 ? F.SURVIVORS : F.DEAD) : randomDeck(rand)));
    if (!decks.every((d) => validateDeck(d, ALL).ok)) decksOk = false;
    const levels = [0, 1].map(() => (rand() < 0.3 ? 'easy' : 'normal'));
    const { st, problems: p } = runMatch(1 + i * 7907, decks, levels, { chaos: i % 2 === 1, legality: i % 3 === 0 });
    if (p.length) problems = problems.concat(p.map((x) => `match ${i}: ${x}`));
    if (st.phase === 'over') ended++;
    maxRounds = Math.max(maxRounds, st.rounds.length);
    reasons[st.result?.reason] = (reasons[st.result?.reason] || 0) + 1;
  }
  check(`${N} AI matches (random legal decks, timeouts, junk): cards conserved, no strength below 0, at most 3 rounds, all ended, nothing thrown, every legal move taken`, decksOk && !problems.length && ended === N && maxRounds <= 3, [...new Set(problems)].slice(0, 5).join(' | '));
  console.log(`      (${N} matches ended by ${Object.entries(reasons).map(([k, v]) => `${k} ${v}`).join(', ')})`);
}

{
  const N = LONG ? 2000 : 300;
  const S = defaultDeck(F.SURVIVORS);
  const D = defaultDeck(F.DEAD);
  let surv = 0;
  let dead = 0;
  let draws = 0;
  for (let i = 0; i < N; i++) {
    const flip = i % 2;
    const { st } = runMatch(500000 + i * 104729, flip ? [D, S] : [S, D], ['normal', 'normal']);
    const w = st.result.winner;
    if (w < 0) draws++;
    else if (w === flip) surv++;
    else dead++;
  }
  const rate = (surv + draws / 2) / N;
  console.log(`      (starter decks, normal AI both sides: the Survivors (${cardDef(S.leader).name}) ${surv}, the Dead (${cardDef(D.leader).name}) ${dead}, draws ${draws})`);
  check(`the two starter decks are an even match: the Survivors win ${(rate * 100).toFixed(1)}% (40-60%)`, rate >= 0.4 && rate <= 0.6);

  let normal = 0;
  let easy = 0;
  let nd = 0;
  for (let i = 0; i < N; i++) {
    const flip = i % 2;
    const fN = (i >> 1) % 2 ? F.SURVIVORS : F.DEAD;
    const decks = [defaultDeck(fN), defaultDeck(fN === F.DEAD ? F.SURVIVORS : F.DEAD)];
    const { st } = runMatch(900000 + i * 15485863, flip ? [decks[1], decks[0]] : decks, flip ? ['easy', 'normal'] : ['normal', 'easy']);
    const w = st.result.winner;
    if (w < 0) nd++;
    else if (w === flip) normal++;
    else easy++;
  }
  const nr = (normal + nd / 2) / N;
  check(`the normal AI beats the easy one ${(nr * 100).toFixed(1)}% of the time (75% or more)`, nr >= 0.75, `${normal}/${easy}/${nd}`);
}

console.log(fails.length ? `\n${fails.length} FAILED (${passed} passed): ${fails.join(' | ')}` : `\nall ${passed} card game checks passed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fails.length ? 1 : 0);
