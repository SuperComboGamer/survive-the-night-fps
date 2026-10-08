// Dead Hand in a running game (server/cards.js), in-process against a real Game whose collections are kept by a
// CardService on a store in memory (LocalCards), with what the server sends decoded as a client does (S2C.CARDS):
//   - asking: [E]'s reach on a standing teammate (accepted at its edge, refused half a metre past it), and who may
//     not be asked (down, one of the dead, dead, the same browser in another tab, during the crossing); asks lapse,
//     are withdrawn, and nobody busy is asked; the limits on asks and on messages
//   - a match: a view hides the opponent's hand; a stale move is refused; one played to the end by the engine's AI
//     (shared/cardai.js) on both sides; the clock stops while a player is away or down; a player whose grace runs out
//     loses it; the run ending voids it
//   - bets: the winner gets both cards, a forfeit pays, a void gives them back, a bet that cannot be put up calls
//     the match off; a card offered in a trade cannot also be bet
//   - packs: opened as they are picked up (no slot taken), three cards shown and kept - but not by a player the game
//     cannot know again (no browser id)
//   - trades: a change takes READY back, TRADE_BREAK apart calls it off, no room calls it off, guns and vests keep
//     their magazines and points, cards and items change hands together
//   - a save and a load in the middle of a bet match: it goes on, and pays out
//   - a real server (its worker, the network thread, PGlite): packs, a bet paid, a deck kept, all still there after a
//     restart
// usage: node scripts/test-cards.js [seed = 4242]
process.env.REJOIN_GRACE_SECONDS = '2';
process.env.HANDOFF_FREEZE_SECONDS = '0';
process.env.ARRIVE_SECONDS = '0';
const { Game } = await import('../server/game.js');
const { LocalCards } = await import('../server/cards.js');
const { CardService, MemoryCardStore } = await import('../server/usercards.js');
const { envelope, encode, decode } = await import('../server/handoff.js');
const { idKey } = await import('../server/stats.js');
const { C2S, S2C, CARDOP, CARDMSG, CARDNOTE, CARD_JSON_MAX, PROTOCOL_VERSION, Writer, Reader, writeCards, readCards } = await import('../shared/protocol.js');
const { PHASE, PICK_RADIUS, INTERACT_REACH, INTERACT_SLACK, CARD_ASK_TTL, TRADE_BREAK, SERVER_TICK_RATE, SLOT_PRIMARY } = await import('../shared/constants.js');
const { ITEM, ITEM_DEFS } = await import('../shared/defs.js');
const { F, CARDS, K, RAR, cardDef, defaultDeck } = await import('../shared/cards.js');
const CG = await import('../shared/cardgame.js');
const { chooseMove } = await import('../shared/cardai.js');
const { mulberry32 } = await import('../shared/rng.js');
const { invCap } = await import('../server/inventory.js');
const { randomUUID } = await import('node:crypto');
const { spawn } = await import('node:child_process');
const { mkdtempSync, rmSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const { createServer } = await import('node:net');

const seed = +(process.argv[2] || 4242);
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : info}`);
  if (!ok) fails.push(name);
};
const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
};

const store = new MemoryCardStore();
const service = new CardService({ store });
const quiet = () => {};
let game = new Game({ seed, godMode: true, dayLength: 3600, themes: false, log: quiet, cards: new LocalCards(service) });
const ownerOf = (pid) => `g:${idKey(pid)}`;

// a client that speaks the card game, as the browser's does
function client(name, pid = randomUUID(), g = game) {
  const c = { name, pid, id: 0, msgs: [], last: {}, notes: [], sentV: -1, ended: null };
  c.conn = {
    send(bytes) {
      const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
      const t = r.u8();
      if (t === S2C.WELCOME) c.id = r.u16();
      else if (t === S2C.CARDS) {
        const { op, data } = readCards(r);
        c.msgs.push([op, data]);
        c.last[op] = data;
        if (op === CARDMSG.NOTE) {
          c.notes.push(data.code);
          c.sentV = -1;
        }
        if (op === CARDMSG.MATCH_END) c.ended = data;
      }
    },
    congested: () => false,
    cork: (fn) => fn(),
  };
  c.session = g.onOpen(c.conn);
  const w = new Writer(128);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str(name);
  w.str(pid);
  g.onMessage(c.session, w.bytes().slice());
  c.p = () => game.players.get(c.id);
  c.send = (op, data) => {
    const w2 = new Writer(256);
    w2.u8(C2S.CARDS);
    writeCards(w2, op, data);
    game.onMessage(c.session, w2.bytes().slice());
  };
  c.got = (op) => c.msgs.filter((m) => m[0] === op).map((m) => m[1]);
  c.clear = () => {
    c.msgs.length = 0;
    c.notes.length = 0;
    c.ended = null;
  };
  c.owner = pid ? ownerOf(pid) : '';
  return c;
}
const run = async (ticks = 1) => {
  for (let i = 0; i < ticks; i++) game.update();
  await settle();
  game.update();
};
const secs = (s) => Math.round(s * SERVER_TICK_RATE);
// (the limits on asks and on messages are tested on their own: the rest of the test is not held up by them)
const fresh = (...cs) => {
  for (const c of cs) {
    const st = game.cards.ofP.get(c.id);
    if (st) {
      st.askT = -99;
      st.allow.n = 0;
    }
  }
};

// cards found before anybody joins (the store has them; a join reads them)
const BET_A = CARDS.find((c) => c.k === K.UNIT && c.r === RAR.R && c.f === F.SURVIVORS).id;
const BET_B = CARDS.find((c) => c.k === K.UNIT && c.r === RAR.R && c.f === F.DEAD).id;
const pids = { ann: randomUUID(), ben: randomUUID(), cy: randomUUID(), dee: randomUUID() };
await store.addFinds([
  [ownerOf(pids.ann), BET_A, 3],
  [ownerOf(pids.ben), BET_B, 3],
  [ownerOf(pids.cy), BET_A, 1],
]);

let A = client('Ann', pids.ann);
let B = client('Ben', pids.ben);
const C = client('Cy', pids.cy);
const N = client('Nobody', ''); // (no browser id: the game cannot know them again)
await run(2);
for (const z of [...game.zombies]) {
  z.dead = true;
  game.removeEntity(z);
}
game.zombies.length = 0;
for (const wv of game.waves) wv.queue.length = 0;

// a flat open spot near where the run began, and everyone stood around it
const sp = game.world.spawnPoints[0];
const W = game.world;
let spot = null;
for (let r = 0; r < W.half && !spot; r += 5) {
  for (let k = 0; k < 24 && !spot; k++) {
    const x = sp.x + Math.sin(k * 0.26) * r;
    const z = sp.z + Math.cos(k * 0.26) * r;
    if (Math.abs(x) > W.half - 20 || Math.abs(z) > W.half - 20) continue;
    const h = W.heightAt(x, z);
    let flat = !W.isDeepWater(x, z);
    for (let dx = -10; dx <= 10 && flat; dx += 2) for (let dz = -10; dz <= 10 && flat; dz += 2) if (Math.abs(W.heightAt(x + dx, z + dz) - h) > 1 || W.isDeepWater(x + dx, z + dz) || W.staticGrid.query(x + dx, z + dz, 1, []).length) flat = false;
    if (flat) spot = { x, z, y: h };
  }
}
check('a flat open spot to stand on', !!spot);
const place = (c, dx, dz = 0) => {
  const s = c.p().state;
  s.x = spot.x + dx;
  s.z = spot.z + dz;
  s.y = W.heightAt(s.x, s.z);
  s.vx = s.vy = s.vz = 0;
};
const gather = () => {
  place(A, 0);
  place(B, 2);
  place(C, -2);
  place(N, 0, 2);
};
gather();
await run(2);

// ---------------------------------------------------------------- joining
{
  const coll = A.last[CARDMSG.COLL];
  check('a player joining is sent their collection, kept, with what they had found', coll?.loaded === true && coll.kept === true && coll.found[BET_A] === 3, JSON.stringify(coll));
  check('...their decks and their asks', Array.isArray(A.last[CARDMSG.DECKS]?.decks) && Array.isArray(A.last[CARDMSG.ASKS]?.asks));
  check('...and one the game cannot know again keeps nothing', N.last[CARDMSG.COLL]?.kept === false && Object.keys(N.last[CARDMSG.COLL].found).length === 0);
  check('no owner key goes to a client', !JSON.stringify(A.msgs).includes(A.owner) && !JSON.stringify(A.msgs).includes(idKey(pids.ann)));
}

// ---------------------------------------------------------------- asking
const reach = Math.hypot(INTERACT_REACH, PICK_RADIUS.MATE) + INTERACT_SLACK;
{
  place(B, reach - 0.05);
  A.clear();
  B.clear();
  A.send(CARDOP.ASK, { to: B.id, kind: 'match', slot: -1, bet: 0 });
  await run();
  const asks = B.last[CARDMSG.ASKS]?.asks || [];
  check(`an ask at the edge of [E]'s reach (${(reach - 0.05).toFixed(2)} m) is made, and both are told`, asks.length === 1 && asks[0].from === A.id && asks[0].to === B.id && asks[0].kind === 'match' && A.last[CARDMSG.ASKS]?.asks.length === 1, JSON.stringify(asks) + A.notes);
  A.send(CARDOP.WITHDRAW, {});
  await run();
  check('...and withdrawn', B.last[CARDMSG.ASKS]?.asks.length === 0 && A.last[CARDMSG.ASKS]?.asks.length === 0);
  fresh(A);
  place(B, reach + 0.45);
  A.clear();
  A.send(CARDOP.ASK, { to: B.id, kind: 'match', slot: -1, bet: 0 });
  await run();
  check('half a metre past it, refused: too far', A.notes.includes(CARDNOTE.FAR) && !game.cards.asks.length, A.notes.join());
  place(B, 2);
  const b = B.p();
  const refused = async (what, set, unset, code) => {
    fresh(A);
    set();
    A.clear();
    A.send(CARDOP.ASK, { to: B.id, kind: 'trade' });
    unset();
    await run();
    check(`an ask of a teammate ${what} is refused`, A.notes.includes(code) && !game.cards.asks.length, A.notes.join());
  };
  await refused('who is down', () => (b.downed = true), () => (b.downed = false), CARDNOTE.CANT);
  await refused('who is one of the dead', () => (b.zombie = true), () => (b.zombie = false), CARDNOTE.CANT);
  await refused('who is dead', () => (b.alive = false), () => (b.alive = true), CARDNOTE.CANT);
  const was = game.phase;
  await refused('during the crossing', () => (game.phase = PHASE.CROSSING), () => (game.phase = was), CARDNOTE.CROSSING);
  // the same browser in a second tab
  const A2 = client('Ann2', pids.ann);
  place(A2, 1);
  await run();
  fresh(A);
  A.clear();
  A.send(CARDOP.ASK, { to: A2.id, kind: 'trade' });
  await run();
  check('...and so is one of the same browser in another tab', A.notes.includes(CARDNOTE.OWNER), A.notes.join());
  game.onClose(A2.session, 4001);
  await run();
  // lapsing
  fresh(A);
  A.send(CARDOP.ASK, { to: B.id, kind: 'trade' });
  await run(secs(CARD_ASK_TTL - 1));
  const stillThere = game.cards.asks.length === 1;
  A.clear();
  await run(secs(1.5));
  check(`an ask lapses after ${CARD_ASK_TTL} s, and its asker is told`, stillThere && !game.cards.asks.length && A.notes.includes(CARDNOTE.EXPIRED) && B.last[CARDMSG.ASKS]?.asks.length === 0, A.notes.join());
  // the limits: one between two at a time, three out at once, one every three seconds
  fresh(A);
  A.clear();
  A.send(CARDOP.ASK, { to: B.id, kind: 'trade' });
  A.send(CARDOP.ASK, { to: C.id, kind: 'trade' });
  await run();
  check('one ask every few seconds', game.cards.asks.length === 1 && A.notes.includes(CARDNOTE.LIMIT), A.notes.join());
  fresh(A);
  A.clear();
  A.send(CARDOP.ASK, { to: B.id, kind: 'match' });
  await run();
  check('one ask between the same two at a time', game.cards.asks.length === 1 && A.notes.includes(CARDNOTE.ASKED), A.notes.join());
  fresh(B);
  B.clear();
  B.send(CARDOP.ASK, { to: A.id, kind: 'trade' });
  await run();
  check('...whichever of them asks', game.cards.asks.length === 1 && B.notes.includes(CARDNOTE.ASKED), B.notes.join());
  A.send(CARDOP.WITHDRAW, {});
  await run();
}

// ---------------------------------------------------------------- the message allowance
{
  fresh(A);
  A.clear();
  for (let i = 0; i < 50; i++) A.send(CARDOP.MOVE, { v: 1, move: { t: 'pass' } });
  await run();
  const first = A.notes.filter((n) => n === CARDNOTE.NOMATCH).length;
  A.clear();
  await run(secs(1));
  for (let i = 0; i < 50; i++) A.send(CARDOP.MOVE, { v: 1, move: { t: 'pass' } });
  await run();
  const then = A.notes.filter((n) => n === CARDNOTE.NOMATCH).length;
  check('a flood of card messages: 20 in a row, then 5 a second', first === 20 && then >= 4 && then <= 6, `${first}, then ${then}`);
  const w = new Writer(CARD_JSON_MAX + 64);
  w.u8(C2S.CARDS);
  writeCards(w, CARDOP.ASK, { to: B.id, kind: 'trade', pad: 'x'.repeat(CARD_JSON_MAX) });
  fresh(A);
  game.onMessage(A.session, w.bytes().slice());
  await run();
  check('...and one past CARD_JSON_MAX is not read', !game.cards.asks.length);
}

// ---------------------------------------------------------------- a match
// both ask and answer, as their clients would: -> the match
const challenge = async (a, b, ask = {}, ans = {}) => {
  fresh(a, b);
  a.send(CARDOP.ASK, { to: b.id, kind: 'match', slot: -1, bet: 0, ...ask });
  await run();
  b.send(CARDOP.ANSWER, { from: a.id, kind: 'match', yes: true, slot: -2, bet: 0, ...ans });
  await run();
  return [...game.cards.matches.values()].find((m) => m.sides.some((s) => s.pid === a.id));
};
// both sides played by the AI until it is over (or `until` says stop)
const rand = mulberry32(seed);
const playOut = async (cs, until = null, max = 3000) => {
  for (let step = 0; step < max; step++) {
    if (cs.every((c) => c.ended) || until?.()) return true;
    for (const c of cs) {
      const m = c.last[CARDMSG.MATCH];
      if (!m?.view || m.view.phase === 'over' || c.sentV === m.v || c.ended) continue;
      const mv = chooseMove(m.view, { rand });
      if (!mv) continue;
      c.sentV = m.v;
      c.send(CARDOP.MOVE, { v: m.v, move: mv });
    }
    game.update();
    await settle();
  }
  return false;
};
{
  A.clear();
  B.clear();
  const m = await challenge(A, B);
  const va = A.last[CARDMSG.MATCH];
  const vb = B.last[CARDMSG.MATCH];
  check('a challenge answered: both are sent the table', m?.phase === 'live' && va?.view && vb?.view && va.me !== vb.me && va.opp === B.id && vb.opp === A.id && va.v === m.ver, JSON.stringify({ phase: m?.phase, v: va?.v }));
  const theirs = va.view.sides[1 - va.me];
  check("...and neither sees the other's hand (only how many), nor the seed or a deck's order", theirs.hand.length === 0 && theirs.handCount >= 10 && theirs.deck === null && va.view.sides[va.me].hand.length >= 10 && !('rng' in va.view) && !JSON.stringify(va).includes('"rng"'), JSON.stringify(theirs).slice(0, 200));
  check('...and they are busy: nobody may ask them', game.cards.busy(A.id) && game.cards.busy(B.id));
  fresh(C);
  C.clear();
  C.send(CARDOP.ASK, { to: A.id, kind: 'trade' });
  await run();
  check('...an ask of one of them is refused', C.notes.includes(CARDNOTE.BUSY), C.notes.join());
  // a stale move
  B.clear();
  B.send(CARDOP.MOVE, { v: m.ver - 1, move: { t: 'keep' } });
  await run();
  check('a move for an older table is refused, and the table sent again', B.notes.includes(CARDNOTE.STALE) && B.got(CARDMSG.MATCH).length >= 1 && !m.state.p[vb.me].redrawDone, B.notes.join());
  B.clear();
  B.send(CARDOP.MOVE, { v: m.ver, move: { t: 'play', uid: 99999 } });
  await run();
  check('...and one the rules refuse is refused', B.notes.includes(CARDNOTE.MOVE), B.notes.join());
  // through the redraw, then the clock: stopped while the side to act is away, or down
  A.clear();
  B.clear();
  await playOut([A, B], () => m.state.phase === 'play' && m.state.turn >= 0 && !m.state.pending);
  const side = m.state.turn;
  const [mover, other] = m.sides[0].pid === A.id ? (side === 0 ? [A, B] : [B, A]) : side === 0 ? [B, A] : [A, B];
  const clock0 = m.state.clock;
  await run(secs(2));
  const ran = clock0 - m.state.clock;
  game.onClose(mover.session, 1006); // (a drop: held)
  const held = m.state.clock;
  await run(secs(1.5)); // (inside their grace: REJOIN_GRACE_SECONDS)
  check('a match clock runs, and stops while the side to act is away', ran > 1.5 && Math.abs(m.state.clock - held) < 1e-9 && m.phase === 'live', `ran ${ran.toFixed(2)}, held ${held.toFixed(2)} -> ${m.state.clock.toFixed(2)}`);
  const back = client(mover.name, mover.pid);
  await run();
  check('...the one back is given their own body, and sent the match again', back.id === mover.id && back.last[CARDMSG.MATCH]?.v === m.ver && back.last[CARDMSG.MATCH].view, JSON.stringify(back.last[CARDMSG.MATCH])?.slice(0, 80));
  if (mover === A) A = back;
  else B = back;
  const mp = game.players.get(back.id);
  game.goDown(mp);
  const down = m.state.clock;
  await run(secs(2));
  const still = m.state.clock;
  game.revive(mp, null);
  await run(secs(1));
  check('...and while they are down; it runs again once they are up', Math.abs(still - down) < 1e-9 && m.state.clock < still - 0.5, `${down} -> ${still} -> ${m.state.clock}`);
  // played to the end
  const done = await playOut([A, B]);
  const ea = A.ended;
  const eb = B.ended;
  const fair = ea && eb && ((ea.outcome === 'win' && eb.outcome === 'loss') || (ea.outcome === 'loss' && eb.outcome === 'win') || (ea.outcome === 'draw' && eb.outcome === 'draw'));
  check('a match played to the end by the AI on both sides: one wins, the other loses (or both draw)', done && fair && ea.bet.paid === true && !game.cards.matches.size, JSON.stringify({ ea, eb }));
  const lastA = A.got(CARDMSG.MATCH).at(-1);
  check('...the last table they are sent is the one it ended on', lastA?.view?.phase === 'over' && lastA.view.result, JSON.stringify(lastA?.view?.result));
  check('...and they may ask again', !game.cards.busy(A.id) && !game.cards.busy(B.id));
}

// ---------------------------------------------------------------- decks
{
  const deck = defaultDeck(F.SURVIVORS);
  A.clear();
  A.send(CARDOP.DECK, { slot: 0, name: 'My\u0007 deck', leader: deck.leader, cards: deck.cards });
  await run();
  await service.flush();
  const kept = (await store.load(A.owner)).decks;
  check('a deck kept goes into the store and back to its player', A.last[CARDMSG.DECKS]?.decks.some((d) => d.slot === 0 && d.leader === deck.leader && d.name === 'My deck') && kept.length === 1 && kept[0].name === 'My deck', JSON.stringify(kept));
  A.clear();
  A.send(CARDOP.DECK, { slot: 1, name: 'Thin', leader: deck.leader, cards: { 100: 2 } });
  await run();
  check('...a deck the rules refuse is not kept, and its player is told why', A.notes.includes(CARDNOTE.DECK) && A.last[CARDMSG.NOTE]?.arg && !game.cards.own.get(A.owner).decks.some((d) => d.slot === 1), JSON.stringify(A.last[CARDMSG.NOTE]));
  A.clear();
  A.send(CARDOP.DECK, { slot: 0, name: '', leader: 101, cards: deck.cards });
  await run();
  check('...nor one with a leader that is not one', A.notes.includes(CARDNOTE.DECK));
  N.clear();
  N.send(CARDOP.DECK, { slot: 0, name: 'x', leader: deck.leader, cards: deck.cards });
  await run();
  check('...nor anything of a player the game cannot know again', N.notes.includes(CARDNOTE.NOKEY));
  fresh(A);
  A.clear();
  A.send(CARDOP.ASK, { to: B.id, kind: 'match', slot: 1 });
  await run();
  check('an ask with an empty deck slot is refused', A.notes.includes(CARDNOTE.DECK) && !game.cards.asks.length, A.notes.join());
  const m = await challenge(A, B, { slot: 0 }, { slot: -1 });
  check('...one with a kept deck is played with it', m?.phase === 'live' && m.state.p[0].leader.card === deck.leader);
  A.send(CARDOP.FORFEIT, {});
  await run();
  check('a forfeit ends it: the other side wins', A.ended?.outcome === 'loss' && B.ended?.outcome === 'win' && B.ended.reason === 'forfeit', JSON.stringify([A.ended, B.ended]));
  A.clear();
  A.send(CARDOP.DECK, { slot: 0, leader: 0 });
  await run();
  check('...kept for the player at once', A.last[CARDMSG.DECKS]?.decks.length === 0);
  await run(secs(1)); // (a player's decks are written at most once a second: cards.js DECK_EVERY)
  await service.flush();
  check('...and a slot is emptied with leader 0', !(await store.load(A.owner)).decks.length && A.last[CARDMSG.DECKS]?.decks.length === 0);
}

// ---------------------------------------------------------------- bets
const count = async (c, card) => (await store.load(c.owner)).found[card] || 0;
{
  A.clear();
  B.clear();
  fresh(A, B);
  A.send(CARDOP.ASK, { to: B.id, kind: 'match', bet: BET_A });
  await run();
  B.send(CARDOP.ANSWER, { from: A.id, kind: 'match', yes: true, slot: -2, bet: 0 });
  await run();
  check('a bet must be met: answered without one, refused', B.notes.includes(CARDNOTE.NOBET) && !game.cards.matches.size, B.notes.join());
  B.send(CARDOP.ANSWER, { from: A.id, kind: 'match', yes: true, slot: -2, bet: BET_A });
  await run();
  check('...nor with a card not theirs', B.notes.includes(CARDNOTE.BET) && !game.cards.matches.size, B.notes.join());
  B.send(CARDOP.ANSWER, { from: A.id, kind: 'match', yes: true, slot: -2, bet: BET_B });
  await run();
  const m = [...game.cards.matches.values()][0];
  const inEscrow = (await store.load(`m:${m?.id}`)).found;
  check('a bet met: both cards go into the escrow, and the match begins', m?.phase === 'live' && inEscrow[BET_A] === 1 && inEscrow[BET_B] === 1 && (await count(A, BET_A)) === 2 && (await count(B, BET_B)) === 2, JSON.stringify(inEscrow));
  check('...and the collections the players are sent say so', A.last[CARDMSG.COLL]?.found[BET_A] === 2 && B.last[CARDMSG.COLL]?.found[BET_B] === 2, JSON.stringify(A.last[CARDMSG.COLL]));
  await playOut([A, B]);
  const win = A.ended?.outcome === 'win' ? A : B.ended?.outcome === 'win' ? B : null;
  const lose = win === A ? B : win === B ? A : null;
  if (win) {
    const wa = await count(win, BET_A);
    const wb = await count(win, BET_B);
    check('the winner of a bet match gets both cards', win.ended.bet.paid && ((win === A && wa === 3 && wb === 1) || (win === B && wa === 1 && wb === 3)) && (await count(lose, win === A ? BET_B : BET_A)) === 2 && !(await store.load(`m:${m.id}`)).found[BET_A], `${win.name}: ${wa} / ${wb}`);
  } else {
    check('a drawn bet match gives both cards back', A.ended?.outcome === 'draw' && (await count(A, BET_A)) === 3 && (await count(B, BET_B)) === 3);
  }
}
{
  // a forfeit pays the other side
  const a0 = await count(A, BET_A);
  const b0 = await count(B, BET_B);
  A.clear();
  B.clear();
  const m = await challenge(A, B, { bet: BET_A }, { bet: BET_B });
  check('(a second bet match)', m?.phase === 'live');
  B.send(CARDOP.FORFEIT, {});
  await run();
  check('a forfeit pays the bets to the other side', A.ended?.outcome === 'win' && A.ended.bet.paid && (await count(A, BET_A)) === a0 && (await count(A, BET_B)) >= 1 && (await count(B, BET_B)) === b0 - 1, JSON.stringify(A.ended));
}
{
  // the run ending voids it: back
  const a0 = await count(A, BET_A);
  const b0 = await count(B, BET_B);
  A.clear();
  B.clear();
  const m = await challenge(A, B, { bet: BET_A }, { bet: BET_B });
  const escrowed = (await count(A, BET_A)) === a0 - 1;
  game.gameOver();
  await run();
  check('the run ending voids a match and gives the bets back', escrowed && m.phase === 'paying' && A.ended?.outcome === 'void' && B.ended?.outcome === 'void' && A.ended.reason === 'run_over' && (await count(A, BET_A)) === a0 && (await count(B, BET_B)) === b0, JSON.stringify(A.ended));
  game.startGame();
  for (const z of [...game.zombies]) {
    z.dead = true;
    game.removeEntity(z);
  }
  game.zombies.length = 0;
  await run();
  gather();
}
{
  // a bet that cannot be put up (the collection here was out of date): called off
  const a0 = await count(A, BET_A);
  store.rows.get(A.owner).get(BET_A).n = 0; // (spent elsewhere, the game not told)
  A.clear();
  B.clear();
  await challenge(A, B, { bet: BET_A }, { bet: BET_B });
  await run();
  check('a bet that cannot be put up calls the match off, and nothing moves', A.ended?.outcome === 'void' && A.ended.reason === 'not_owned' && !game.cards.matches.size && (await count(B, BET_B)) >= 1 && A.notes.includes(CARDNOTE.BET), JSON.stringify(A.ended) + A.notes);
  store.rows.get(A.owner).get(BET_A).n = a0;
  service.reload([A.owner]);
  await run();
}

// ---------------------------------------------------------------- packs
{
  const a = A.p();
  const inv = JSON.stringify(a.inv);
  const before = { ...game.cards.own.get(A.owner).found };
  A.clear();
  const took = game.giveItem(a, ITEM.CARD_PACK, 1);
  await run();
  const rev = A.last[CARDMSG.REVEAL];
  check('a pack picked up is opened: three cards shown and kept, and it takes no slot', took === 1 && rev?.item === ITEM.CARD_PACK && rev.cards.length === 3 && rev.cards.every((id) => cardDef(id)) && rev.kept === true && JSON.stringify(a.inv) === inv, JSON.stringify(rev));
  const after = A.last[CARDMSG.COLL]?.found || {};
  check('...the cards are in the collection the player is sent', rev.cards.every((id) => (after[id] || 0) > (before[id] || 0) - 0) && Object.values(after).reduce((x, y) => x + y, 0) === Object.values(before).reduce((x, y) => x + y, 0) + 3, JSON.stringify(after));
  await service.flush();
  const kept = (await store.load(A.owner)).found;
  check('...and written to the store', rev.cards.every((id) => kept[id] >= (after[id] || 0)), JSON.stringify(kept));
  // walked over: picked up by itself
  const e = game.spawnItem(ITEM.SEALED_PACK, 1, a.state.x + 0.3, a.state.y + 0.05, a.state.z);
  A.clear();
  await run(8);
  const sealed = A.last[CARDMSG.REVEAL];
  const rarest = sealed && Math.max(...sealed.cards.map((id) => cardDef(id).r));
  check('a sealed pack walked over is picked up and opened: one card of it rare or better', e.removed && sealed?.item === ITEM.SEALED_PACK && sealed.cards.length === 3 && cardDef(sealed.cards[2]).r >= RAR.R, JSON.stringify(sealed) + rarest);
  // somebody the game cannot know again
  N.clear();
  const n = N.p();
  game.giveItem(n, ITEM.CARD_PACK, 1);
  await run();
  check('a player with no browser id sees what was in it, and keeps nothing', N.last[CARDMSG.REVEAL]?.kept === false && N.last[CARDMSG.REVEAL].cards.length === 3 && !N.got(CARDMSG.COLL).some((c) => Object.keys(c.found).length));
  // a container's pack
  const b = B.p();
  const invB = JSON.stringify(b.inv);
  B.clear();
  game.giveOrDrop(b, ITEM.CARD_PACK, 2);
  await run();
  check('two packs from a search: both opened, nothing dropped, no "inventory full"', B.got(CARDMSG.REVEAL).length === 2 && JSON.stringify(b.inv) === invB && !game.items.some((it) => it.item === ITEM.CARD_PACK));
}

// ---------------------------------------------------------------- trades
const openTrade = async (a, b) => {
  fresh(a, b);
  a.send(CARDOP.ASK, { to: b.id, kind: 'trade' });
  await run();
  b.send(CARDOP.ANSWER, { from: a.id, kind: 'trade', yes: true });
  await run();
  return game.cards.tradeOf(a.id);
};
const strike = async (a, b) => {
  a.send(CARDOP.READY, { on: true });
  b.send(CARDOP.READY, { on: true });
  await run();
  a.send(CARDOP.CONFIRM, {});
  b.send(CARDOP.CONFIRM, {});
  await run();
};
{
  gather();
  A.clear();
  B.clear();
  const t = await openTrade(A, B);
  check('a trade answered: both see it', !!t && A.last[CARDMSG.TRADE]?.with === B.id && B.last[CARDMSG.TRADE]?.with === A.id);
  A.send(CARDOP.OFFER, { items: [[ITEM.WOOD, 3]] });
  B.send(CARDOP.READY, { on: true });
  await run();
  const readyB = B.last[CARDMSG.TRADE]?.ready[0] === true && A.last[CARDMSG.TRADE]?.ready[1] === true;
  A.send(CARDOP.OFFER, { items: [[ITEM.WOOD, 4]] });
  await run();
  check('a change to an offer takes both sides back from ready', readyB && B.last[CARDMSG.TRADE]?.ready[0] === false && B.last[CARDMSG.TRADE].theirs.items[0][1] === 4, JSON.stringify(B.last[CARDMSG.TRADE]));
  A.send(CARDOP.CONFIRM, {});
  await run();
  check('...and nothing is struck before both are ready', A.notes.includes(CARDNOTE.NOTREADY));
  A.clear();
  A.send(CARDOP.OFFER, { items: [[ITEM.WOOD, 400]] });
  await run();
  check('...an offer of what is not in the backpack is refused', A.notes.includes(CARDNOTE.ITEMS));
  place(B, TRADE_BREAK + 1);
  A.clear();
  await run();
  check(`${TRADE_BREAK} m apart, it is called off`, A.last[CARDMSG.TRADE_END]?.why === 'too_far' && !game.cards.trades.size, JSON.stringify(A.last[CARDMSG.TRADE_END]));
  gather();
}
{
  // no room for what comes
  const b = B.p();
  const saved = b.inv.map((s) => s && { ...s });
  for (let i = 0; i < invCap(b); i++) b.inv[i] = { item: ITEM.SCRAP, count: ITEM_DEFS[ITEM.SCRAP].stack };
  A.clear();
  await openTrade(A, B);
  A.send(CARDOP.OFFER, { items: [[ITEM.CLOTH, 1]] });
  await run();
  await strike(A, B);
  check('a trade the other has no room for is called off', A.last[CARDMSG.TRADE_END]?.why === 'no_room' && b.inv.every((s, i) => i >= invCap(b) || s.item === ITEM.SCRAP), JSON.stringify(A.last[CARDMSG.TRADE_END]));
  saved.forEach((s, i) => (b.inv[i] = s));
}
{
  // a gun with rounds in it and a vest with points left, for planks: each keeps what it had
  const a = A.p();
  const b = B.p();
  a.state.weapons[SLOT_PRIMARY] = ITEM.AK47;
  b.state.weapons[SLOT_PRIMARY] = 0;
  const free = a.inv.findIndex((s, i) => !s && i < invCap(a));
  a.inv[free] = { item: ITEM.SHOTGUN, count: 1, mag: 2 };
  const free2 = a.inv.findIndex((s, i) => !s && i < invCap(a));
  a.inv[free2] = { item: ITEM.KEVLAR, count: 1, mag: 37 };
  const wood = (p) => p.inv.reduce((n, s) => n + (s?.item === ITEM.WOOD ? s.count : 0), 0);
  const woodA = wood(a);
  const woodB = wood(b);
  A.clear();
  B.clear();
  await openTrade(A, B);
  A.send(CARDOP.OFFER, { items: [[ITEM.SHOTGUN, 1], [ITEM.KEVLAR, 1]] });
  B.send(CARDOP.OFFER, { items: [[ITEM.WOOD, 2]] });
  await run();
  await strike(A, B);
  const vest = b.inv.find((s) => s?.item === ITEM.KEVLAR);
  check('items only: struck at once, a gun keeps its magazine and a vest its points', A.last[CARDMSG.TRADE_END]?.why === 'done' && B.last[CARDMSG.TRADE_END]?.why === 'done' && b.state.weapons[SLOT_PRIMARY] === ITEM.SHOTGUN && b.state.mags[0] === 2 && vest?.mag === 37 && !a.inv.some((s) => s?.item === ITEM.SHOTGUN || s?.item === ITEM.KEVLAR) && wood(a) === woodA + 2 && wood(b) === woodB - 2, JSON.stringify({ end: A.last[CARDMSG.TRADE_END], w: b.state.weapons[SLOT_PRIMARY], mag: b.state.mags[0], vest }));
}
{
  // cards and items together, through the store; a card offered cannot also be bet (from another tab of the same browser)
  const a0 = await count(A, BET_A);
  const b0 = await count(B, BET_A);
  const a = A.p();
  const b = B.p();
  A.clear();
  B.clear();
  const t = await openTrade(A, B);
  A.send(CARDOP.OFFER, { cards: { [BET_A]: a0 } });
  B.send(CARDOP.OFFER, { items: [[ITEM.NAILS, 2]] });
  await run();
  const A2 = client('Ann2', pids.ann);
  place(A2, 0, -2);
  await run();
  fresh(A2);
  A2.send(CARDOP.ASK, { to: C.id, kind: 'match', bet: BET_A });
  await run();
  check('a card offered in a trade cannot also be bet', A2.notes.includes(CARDNOTE.BET) && !game.cards.asks.length, A2.notes.join());
  game.onClose(A2.session, 4001);
  A.clear();
  A.send(CARDOP.OFFER, { cards: { [BET_A]: a0 + 1 } });
  await run();
  check('...nor more of a card than they have offered', A.notes.includes(CARDNOTE.CARDS));
  A.send(CARDOP.OFFER, { cards: { [BET_A]: a0 } });
  await run();
  const nailsA = a.inv.reduce((n, s) => n + (s?.item === ITEM.NAILS ? s.count : 0), 0);
  A.send(CARDOP.READY, { on: true });
  B.send(CARDOP.READY, { on: true });
  await run();
  A.send(CARDOP.CONFIRM, {});
  B.send(CARDOP.CONFIRM, {});
  game.update(); // (struck: the cards are on their way)
  const committing = t.phase === 'committing' && A.last[CARDMSG.TRADE]?.committing === true;
  await run();
  check('cards and items: committed through the store, then the items change hands', committing && A.last[CARDMSG.TRADE_END]?.why === 'done' && (await count(A, BET_A)) === 0 && (await count(B, BET_A)) === b0 + a0 && a.inv.reduce((n, s) => n + (s?.item === ITEM.NAILS ? s.count : 0), 0) === nailsA + 2 && B.last[CARDMSG.COLL]?.found[BET_A] === b0 + a0, JSON.stringify({ committing, end: A.last[CARDMSG.TRADE_END], a: await count(A, BET_A) }));
  N.clear();
  const tn = await openTrade(N, C);
  N.send(CARDOP.OFFER, { cards: { [BET_A]: 1 } });
  await run();
  check('a player the game cannot know again trades items, not cards', !!tn && N.notes.includes(CARDNOTE.NOKEY), N.notes.join());
  N.send(CARDOP.CLOSE, {});
  await run();
  check('...and a trade called off says so to both', C.last[CARDMSG.TRADE_END]?.why === 'cancelled' && !game.cards.trades.size);
}

// ---------------------------------------------------------------- leaving
{
  // B has A's cards now; give some back for the bets that follow
  await store.addFinds([[A.owner, BET_A, 2]]);
  service.reload([A.owner]);
  await run();
  const a0 = await count(A, BET_A);
  const b0 = await count(B, BET_B);
  A.clear();
  B.clear();
  const m = await challenge(A, B, { bet: BET_A }, { bet: BET_B });
  game.onClose(B.session, 1006); // a drop...
  await run(secs(1));
  check('a player dropped mid-match is waited for', m.phase === 'live' && game.cards.matches.size === 1);
  await run(secs(2.5)); // ...and their grace runs out
  check('...and once their grace runs out, the match is theirs lost: the bets go to the other', A.ended?.outcome === 'win' && A.ended.reason === 'forfeit' && (await count(A, BET_A)) === a0 && (await count(A, BET_B)) >= 1 && (await count(B, BET_B)) === b0 - 1 && !game.players.has(B.id), JSON.stringify(A.ended));
  B = client('Ben', pids.ben);
  await store.addFinds([[B.owner, BET_B, 2]]); // (more to bet)
  service.reload([B.owner]);
  await run();
  gather();
  await run();
}

// ---------------------------------------------------------------- a save and a load mid-match
{
  const a0 = await count(A, BET_A);
  const b0 = await count(B, BET_B);
  A.clear();
  B.clear();
  const m = await challenge(A, B, { bet: BET_A }, { bet: BET_B });
  check('(a bet match to hand over)', m?.phase === 'live', A.notes.join() + B.notes.join());
  await playOut([A, B], () => m.state.phase === 'play' && m.state.round === 1 && m.state.p.some((P) => P.rows.some((r) => r.length)));
  fresh(C);
  C.send(CARDOP.ASK, { to: A.id, kind: 'match' }); // (an ask that is out: it comes along)
  await run();
  const ver = m.ver;
  const hash = CG.hashState(m.state);
  const asks = JSON.stringify(game.cards.asks);
  const buf = encode(envelope(game));
  game.cards.link.gone(true); // (the old server's room: handed over)
  const old = game;
  game = new Game({ restore: decode(buf), godMode: true, dayLength: 3600, themes: false, log: quiet, cards: new LocalCards(service) });
  const m2 = game.cards.matches.get(m.id);
  check('a save and a load in the middle of a bet match: the match, its table and the ask come back as they were', m2 && m2.ver === ver && CG.hashState(m2.state) === hash && JSON.stringify(game.cards.asks) === asks && old !== game, `${m2?.ver} vs ${ver}`);
  A = client('Ann', pids.ann);
  B = client('Ben', pids.ben);
  await run();
  check('...the players back are sent it again, and play on', A.last[CARDMSG.MATCH]?.v === ver && B.last[CARDMSG.MATCH]?.view && A.last[CARDMSG.COLL]?.loaded === true, JSON.stringify(A.last[CARDMSG.MATCH])?.slice(0, 80));
  await playOut([A, B]);
  const win = A.ended?.outcome === 'win' ? A : B.ended?.outcome === 'win' ? B : null;
  const paid = win ? (win === A ? (await count(A, BET_B)) >= 1 && (await count(A, BET_A)) === a0 : (await count(B, BET_A)) >= 1 && (await count(B, BET_B)) === b0) : (await count(A, BET_A)) === a0 && (await count(B, BET_B)) === b0;
  check('...to the end, and the bets held over the handover are paid out by the new server', !!A.ended && A.ended.bet.paid && paid && !(await store.load(`m:${m.id}`)).found[BET_A], JSON.stringify(A.ended));
}

// ---------------------------------------------------------------- the network thread's rooms: a game that ends unsettled
{
  const m = await challenge(A, B, { bet: BET_A }, { bet: BET_B });
  const a0 = (await count(A, BET_A)) + 1;
  const b0 = (await count(B, BET_B)) + 1;
  check('(a bet match, live)', m?.phase === 'live');
  game.cards.link.gone(false); // the game ends here, not handed over (it crashed)
  await settle();
  check('a game that ends with a bet match unsettled gives the bets back', (await count(A, BET_A)) === a0 && (await count(B, BET_B)) === b0 && !Object.keys((await store.load(`m:${m.id}`)).found).length);
}

// ---------------------------------------------------------------- the card stream; a game saved for the next server
{
  // the stream is the OS's: WELCOME tells every client the map's seed and the tick, and a stream seeded by them would
  // give away the seed of a match (from a player's own hand), and with it the other hand and both decks' order
  const { Cards } = await import('../server/cards.js');
  const first = () => new Cards({ seed: 7, tick: 0, time: 0 }).rng();
  check("two games of one map seed draw their cards apart (packs, the matches' seeds)", first() !== first());
  // saved for the next server (room-worker.js 'save'): what still comes in is not acted on, and no pack opened here
  const pa = game.players.get(A.id);
  const had = JSON.stringify((await store.load(A.owner)).found);
  game.cards.freeze();
  const took = game.giveItem(pa, ITEM.CARD_PACK, 1);
  A.clear();
  A.send(CARDOP.DECK, { slot: 3, leader: 0 });
  A.send(CARDOP.SYNC, {});
  await run(secs(1.5));
  await service.flush();
  check('a game saved for the next server opens no pack (it is still on the ground there) and acts on nothing sent', took === 0 && JSON.stringify((await store.load(A.owner)).found) === had && !A.msgs.some((x) => x[0] === CARDMSG.COLL || x[0] === CARDMSG.DECKS), JSON.stringify(A.msgs.map((x) => x[0])));
}

await service.close();

// ---------------------------------------------------------------- a real server
// The game in its worker (RemoteCards), the network thread (rooms.js -> CardService) and the database (PGlite): two
// players over WebSockets open packs, bet, and the bets are paid; the server goes down (its finds written) and comes
// back up, and what they won is still theirs.
const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const heard = async (fn, ms = 8000) => {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(40)) if (fn()) return true;
  return false;
};
const dir = mkdtempSync(join(tmpdir(), 'stn-cards-'));
async function startServer(env) {
  const port = await freePort();
  const proc = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(port), STATS_FILE: '', HANDOFF: '0', GAME_IDLE_SECONDS: '2', LOBBY_LIMITS: '0', NODE_ENV: 'test', DEV_ADMIN: '1', GODMODE: '1', SEED: String(seed), ...env }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  proc.log = () => log;
  proc.done = new Promise((r) => proc.once('exit', r));
  for (let i = 0; i < 300 && !log.includes('listening'); i++) await sleep(50);
  if (!log.includes('listening')) throw new Error(`server did not start:\n${log}`);
  return { port, proc };
}
const stop = async (srv) => {
  if (process.platform === 'win32') srv.proc.send({ t: 'shutdown' });
  else srv.proc.kill('SIGTERM');
  await srv.proc.done;
};
function wsClient(port, name, pid, code = '') {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws${code ? `?game=${code}` : ''}`);
    ws.binaryType = 'arraybuffer';
    const c = { ws, name, id: 0, code: '', last: {}, msgs: [], ended: null };
    ws.onopen = () => {
      const w = new Writer(128);
      w.u8(C2S.JOIN);
      w.u8(PROTOCOL_VERSION);
      w.str(name);
      w.str(pid);
      ws.send(w.bytes());
    };
    ws.onmessage = (m) => {
      const r = new Reader(m.data);
      const t = r.u8();
      if (t === S2C.ROOM) c.code = r.str();
      else if (t === S2C.WELCOME) {
        c.id = r.u16();
        resolve(c);
      } else if (t === S2C.CARDS) {
        const { op, data } = readCards(r);
        c.msgs.push([op, data]);
        c.last[op] = data;
        if (op === CARDMSG.MATCH_END) c.ended = data;
      }
    };
    c.send = (op, data) => {
      const w = new Writer(256);
      w.u8(C2S.CARDS);
      writeCards(w, op, data);
      ws.send(w.bytes());
    };
    c.say = (text) => {
      const w = new Writer(128);
      w.u8(C2S.CHAT);
      w.str(text);
      ws.send(w.bytes());
    };
    c.close = () => new Promise((done) => ((ws.onclose = done), ws.close(4001)));
  });
}
const sum = (found) => Object.values(found || {}).reduce((x, y) => x + y, 0);
try {
  const env = { DATABASE_URL: `pglite:${join(dir, 'db')}` };
  let srv = await startServer(env);
  let a = await wsClient(srv.port, 'Ann', pids.ann);
  let b = await wsClient(srv.port, 'Ben', pids.ben, a.code);
  check('a real server: both players are sent their collections, kept, from the database', (await heard(() => a.last[CARDMSG.COLL]?.loaded && b.last[CARDMSG.COLL]?.loaded)) && a.last[CARDMSG.COLL].kept && sum(a.last[CARDMSG.COLL].found) === 0, JSON.stringify([a.last[CARDMSG.COLL], b.last[CARDMSG.COLL]]));
  a.say('/give card pack 3');
  b.say('/give sealed pack 2');
  check('...packs opened: every card shown, kept, and in the collections they are sent', (await heard(() => sum(a.last[CARDMSG.COLL]?.found) === 9 && sum(b.last[CARDMSG.COLL]?.found) === 6)) && a.msgs.filter(([op, d]) => op === CARDMSG.REVEAL && d.kept).length === 3, JSON.stringify([a.last[CARDMSG.COLL], b.last[CARDMSG.COLL]]));
  // side by side, then a bet match, which Ben gives up
  a.say(`/tp ${spot.x.toFixed(2)} ${spot.z.toFixed(2)}`);
  b.say(`/tp ${(spot.x + 2).toFixed(2)} ${spot.z.toFixed(2)}`);
  await sleep(300);
  const betA = +Object.keys(a.last[CARDMSG.COLL].found)[0];
  const betB = +Object.keys(b.last[CARDMSG.COLL].found)[0];
  a.send(CARDOP.ASK, { to: b.id, kind: 'match', slot: -1, bet: betA });
  check('...an ask goes from one to the other', await heard(() => b.last[CARDMSG.ASKS]?.asks.some((x) => x.from === a.id && x.bet === betA)), JSON.stringify(b.last[CARDMSG.ASKS]));
  b.send(CARDOP.ANSWER, { from: a.id, kind: 'match', yes: true, slot: -2, bet: betB });
  check('...answered, the bets go in and both are sent the table', await heard(() => a.last[CARDMSG.MATCH]?.view && b.last[CARDMSG.MATCH]?.view), JSON.stringify(a.last[CARDMSG.MATCH])?.slice(0, 100));
  b.send(CARDOP.FORFEIT, {});
  check('...given up: the winner is told the bets are paid', (await heard(() => a.ended && b.ended)) && a.ended.outcome === 'win' && a.ended.bet.paid && b.ended.outcome === 'loss', JSON.stringify([a.ended, b.ended]));
  const wonA = await heard(() => sum(a.last[CARDMSG.COLL]?.found) === 10 && sum(b.last[CARDMSG.COLL]?.found) === 5);
  check("...and the loser's card is the winner's", wonA && (a.last[CARDMSG.COLL].found[betB] || 0) >= 1, JSON.stringify([a.last[CARDMSG.COLL], b.last[CARDMSG.COLL]]));
  const deck = defaultDeck(F.DEAD);
  b.send(CARDOP.DECK, { slot: 2, name: 'Graveyard', leader: deck.leader, cards: deck.cards });
  check('...a deck kept', await heard(() => b.last[CARDMSG.DECKS]?.decks.some((d) => d.slot === 2 && d.name === 'Graveyard')));
  const had = { ...b.last[CARDMSG.COLL].found };
  a.say('/give card pack 1'); // (written on the way down at the latest)
  await heard(() => sum(a.last[CARDMSG.COLL]?.found) === 13);
  const hadA = { ...a.last[CARDMSG.COLL].found };
  await Promise.all([a.close(), b.close()]);
  await stop(srv);
  const said = srv.proc.log();
  srv = await startServer(env);
  a = await wsClient(srv.port, 'Ann', pids.ann);
  b = await wsClient(srv.port, 'Ben', pids.ben, a.code);
  const back = await heard(() => a.last[CARDMSG.COLL]?.loaded && b.last[CARDMSG.COLL]?.loaded && b.last[CARDMSG.DECKS]);
  check('the server down and up again: what they found and won is still theirs, and the deck', back && JSON.stringify(a.last[CARDMSG.COLL].found) === JSON.stringify(hadA) && sum(hadA) === 13 && JSON.stringify(b.last[CARDMSG.COLL].found) === JSON.stringify(had) && b.last[CARDMSG.DECKS].decks.some((d) => d.slot === 2 && d.name === 'Graveyard'), JSON.stringify([hadA, a.last[CARDMSG.COLL], had, b.last[CARDMSG.COLL]]));
  await Promise.all([a.close(), b.close()]);
  await stop(srv);
  const all = said + srv.proc.log();
  const wrong = /cards:|failed|Error|error:/;
  check('...and the server logged nothing that went wrong', !wrong.test(all), all.split('\n').filter((l) => wrong.test(l)).join('\n'));
} catch (err) {
  fails.push('real server');
  console.log('FAIL  a real server threw', err);
}
rmSync(dir, { recursive: true, force: true });

console.log(`\n${fails.length ? 'FAILED: ' + fails.join(', ') : 'all card checks passed'}`);
process.exit(fails.length ? 1 : 0);
