// Dead Hand's collections on the network thread (server/usercards.js), on both stores - Postgres (PGlite, with the
// migrations applied) and the one in memory a server without a database keeps:
//   - the migration; a collection read once, with the finds not written yet on top, counted once
//   - finds: written in batches (the same card twice is one row), a batch that fails tried again, an account deleted
//     meanwhile left out without holding up the rest, PACK_CAP packs an hour
//   - transfers: all or nothing (no ledger row when it fails), once per id, and of two takes of a last copy one wins
//   - what a game may ask: trades only between owners it has in it, locks only into its own new escrow, payouts only
//     out of its escrows and to whoever its lock named, MOVES_MAX moves, INFLIGHT_MAX at once
//   - decks kept (checked again), a guest's collection merged into an account (twice is once)
//   - the escrows of a game that ends unsettled given back (Room.shut, a server going down), handed on with a game
//     that goes to the next server, and swept back once they are too old
//   - two games with the same player in them both hear what changed
// usage: node scripts/test-usercards.js
import { randomUUID, createHash } from 'node:crypto';
import { openDb } from '../server/db/index.js';
import { migrate } from '../server/db/migrate.js';
import { CardService, PgCardStore, MemoryCardStore, MOVES_MAX, INFLIGHT_MAX, PACK_CAP, netMoves } from '../server/usercards.js';
import { idKey } from '../server/stats.js';
import { Auth } from '../server/auth.js';
import { CARDS, K, F, defaultDeck, cardDef } from '../shared/cards.js';

const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : info}`);
  if (!ok) fails.push(name);
};
const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
};
const units = CARDS.filter((c) => c.k === K.UNIT).map((c) => c.id);
const [C1, C2, C3] = units;
const guest = () => `g:${createHash('sha256').update(randomUUID()).digest('hex')}`;
// a game as the network thread knows it (rooms.js Room): what the service tells it is kept
function room(code) {
  const r = { code, closed: false, got: [] };
  r.worker = { postMessage: (m) => r.got.push(m) };
  r.colls = (owner) => r.got.filter((m) => m.op === 'coll' && m.owner === owner);
  r.xfered = (id) => r.got.find((m) => m.op === 'xfered' && m.id === id);
  return r;
}
const found = (m) => Object.fromEntries(m?.found || []);

{
  const r = netMoves([
    ['b', 'a', 5, 1],
    ['a', 'b', 5, 1],
    ['a', 'c', 2, 2],
  ]);
  check('moves net out per owner and card, in (owner, card) order', JSON.stringify(r) === JSON.stringify([['a', 2, -2], ['c', 2, 2]]), JSON.stringify(r));
}

async function suite(name, store, { addUser, delUser, age }) {
  console.log(`\n-- ${name}`);
  const service = new CardService({ store, flushMs: 20, retryMs: 50 });
  const R1 = room('R1');
  const R2 = room('R2');
  const a = guest();
  const b = guest();

  // ---------------------------------------------------------------- reading, and finds
  service.fromRoom(R1, { t: 'cards', op: 'enter', owner: a });
  service.fromRoom(R2, { t: 'cards', op: 'enter', owner: a });
  await settle();
  check('a collection is read as its owner comes into a game: nothing found yet', R1.colls(a).length === 1 && R1.colls(a)[0].ok === true && !R1.colls(a)[0].found.length && R2.colls(a).length === 1, JSON.stringify(R1.got));
  const writes = [];
  const addFinds = store.addFinds.bind(store);
  store.addFinds = (rows) => (writes.push(rows), addFinds(rows));
  service.fromRoom(R1, { t: 'cards', op: 'find', owner: a, cards: [C1, C1, C2] });
  service.fromRoom(R1, { t: 'cards', op: 'find', owner: a, cards: [C1] });
  check('a find is in the collection at once, and both games with that player in them hear it', found(R1.colls(a).at(-1))[C1] === 3 && found(R2.colls(a).at(-1))[C1] === 3 && found(R2.colls(a).at(-1))[C2] === 1);
  await new Promise((r) => setTimeout(r, 60));
  await service.queue;
  check('...written within a moment, in one batch: the same card twice is one row', writes.length === 1 && writes[0].length === 2 && writes[0].find((x) => x[1] === C1)?.[2] === 3, JSON.stringify(writes));
  check('...and the store has it once', (await store.load(a)).found[C1] === 3);
  // a write that fails is tried again; a read while finds wait has them on top, once
  let down = 1;
  store.addFinds = (rows) => (down-- > 0 ? Promise.reject(new Error('down')) : addFinds(rows));
  service.fromRoom(R1, { t: 'cards', op: 'find', owner: a, cards: [C3] });
  service.fromRoom(R1, { t: 'cards', op: 'leave', owner: a });
  service.fromRoom(R2, { t: 'cards', op: 'leave', owner: a });
  check('(nobody of that owner in any game: their copy goes)', !service.cache.has(a));
  await new Promise((r) => setTimeout(r, 30));
  await service.queue;
  service.fromRoom(R1, { t: 'cards', op: 'enter', owner: a });
  await settle();
  const back = found(R1.colls(a).at(-1));
  check('a batch that fails is kept, and a read meanwhile has it on top of the store (once)', back[C3] === 1 && back[C1] === 3 && !(await store.load(a)).found[C3], JSON.stringify(back));
  await new Promise((r) => setTimeout(r, 120));
  await service.queue;
  check('...and it is written next time', (await store.load(a)).found[C3] === 1 && !service.finds.size);
  store.addFinds = addFinds;
  // junk, and a find for somebody not in that game
  const before = JSON.stringify(await store.load(a));
  service.fromRoom(R1, { t: 'cards', op: 'find', owner: a, cards: [99999] });
  service.fromRoom(R1, { t: 'cards', op: 'find', owner: a, cards: [C1, C1, C1, C1] });
  service.fromRoom(R1, { t: 'cards', op: 'find', owner: 'g:nope', cards: [C1] });
  service.fromRoom(R2, { t: 'cards', op: 'find', owner: a, cards: [C1] });
  service.fromRoom(R1, null);
  service.fromRoom(R1, { t: 'cards', op: 'find', owner: a, cards: 'x' });
  await service.flush();
  check('a find of no card, of more than a pack, of a key that is no key, from a game they are not in: nothing', JSON.stringify(await store.load(a)) === before);
  // the cap
  const capped = guest();
  service.fromRoom(R1, { t: 'cards', op: 'enter', owner: capped });
  await settle();
  for (let i = 0; i < PACK_CAP + 5; i++) service.fromRoom(R1, { t: 'cards', op: 'find', owner: capped, cards: [C2] });
  await service.flush();
  check(`at most ${PACK_CAP} packs an hour are kept for one owner`, (await store.load(capped)).found[C2] === PACK_CAP);
  // an account deleted meanwhile
  const uid = await addUser('keeper');
  const gone = await addUser('leaver');
  const acct = `a:${uid}`;
  const dead = `a:${gone}`;
  service.fromRoom(R1, { t: 'cards', op: 'enter', owner: acct });
  service.fromRoom(R1, { t: 'cards', op: 'enter', owner: dead });
  await settle();
  await delUser(gone);
  service.fromRoom(R1, { t: 'cards', op: 'find', owner: dead, cards: [C1] });
  service.fromRoom(R1, { t: 'cards', op: 'find', owner: acct, cards: [C1] });
  await service.flush();
  check("an account deleted meanwhile: its find is dropped, and the rest of the batch is written", !service.finds.size && (await store.load(acct)).found[C1] === 1 && !(await store.load(dead)).found[C1]);

  // ---------------------------------------------------------------- transfers
  const n = async (owner, card) => (await store.load(owner)).found[card] || 0;
  const x = guest();
  const y = guest();
  await store.addFinds([[x, C1, 3]]);
  service.fromRoom(R1, { t: 'cards', op: 'enter', owner: x });
  service.fromRoom(R1, { t: 'cards', op: 'enter', owner: y });
  await settle();
  const t1 = `${randomUUID()}:trade`;
  service.fromRoom(R1, { t: 'cards', op: 'xfer', id: t1, kind: 'trade', moves: [[x, y, C1, 1], [y, x, C2, 1]] });
  await settle();
  check('a trade the other cannot pay is refused: nothing moves, and no ledger row', R1.xfered(t1)?.ok === false && R1.xfered(t1).why === 'not_owned' && (await n(x, C1)) === 3 && !(await n(y, C1)) && !(await ledger(t1)), JSON.stringify(R1.xfered(t1)));
  await store.addFinds([[y, C2, 1]]);
  service.reload([y]);
  R1.got.length = 0;
  service.fromRoom(R1, { t: 'cards', op: 'xfer', id: t1, kind: 'trade', moves: [[x, y, C1, 1], [y, x, C2, 1]] });
  await settle();
  check('...and once it can, it goes through, both ways', R1.xfered(t1)?.ok === true && (await n(x, C1)) === 2 && (await n(y, C1)) === 1 && (await n(x, C2)) === 1 && !(await n(y, C2)) && !!(await ledger(t1)), JSON.stringify(R1.got.at(-1)));
  check('...the games are told what both have now', found(R1.colls(y).at(-1))[C1] === 1 && found(R1.colls(x).at(-1))[C1] === 2 && !found(R1.colls(y).at(-1))[C2]);
  R1.got.length = 0;
  service.fromRoom(R1, { t: 'cards', op: 'xfer', id: t1, kind: 'trade', moves: [[x, y, C1, 1], [y, x, C2, 1]] });
  await settle();
  check('the same id twice: told it went through, applied once', R1.xfered(t1)?.ok === true && (await n(x, C1)) === 2 && (await n(y, C1)) === 1);
  // two takes of a last copy at once (straight at the store: the service would queue them)
  const last = guest();
  await store.addFinds([[last, C3, 1]]);
  const takes = await Promise.allSettled([store.transfer({ id: `${randomUUID()}:trade`, kind: 'trade', moves: [[last, x, C3, 1]] }), store.transfer({ id: `${randomUUID()}:trade`, kind: 'trade', moves: [[last, y, C3, 1]] })]);
  check('two takes of the last copy at once: exactly one goes through', takes.filter((t) => t.status === 'fulfilled').length === 1 && takes.find((t) => t.status === 'rejected')?.reason.code === 'not_owned' && !(await n(last, C3)) && (await n(x, C3)) + (await n(y, C3)) === 1, takes.map((t) => t.status).join());
  // what a game may not ask
  const stranger = guest();
  const refusedXfer = async (what, m, r = R1) => {
    r.got.length = 0;
    service.fromRoom(r, { t: 'cards', op: 'xfer', ...m });
    await settle();
    check(`refused: ${what}`, r.got.some((v) => v.op === 'xfered' && v.ok === false && (v.why === 'refused' || v.why === 'not_owned')), JSON.stringify(r.got));
  };
  await refusedXfer('a trade with somebody not in that game', { id: `${randomUUID()}:trade`, kind: 'trade', moves: [[x, stranger, C1, 1]] });
  await refusedXfer('an id that is not a move of that kind', { id: `${randomUUID()}:pay`, kind: 'trade', moves: [[x, y, C1, 1]] });
  await refusedXfer('a card that does not exist', { id: `${randomUUID()}:trade`, kind: 'trade', moves: [[x, y, 99999, 1]] });
  await refusedXfer(`more than ${MOVES_MAX} moves`, { id: `${randomUUID()}:trade`, kind: 'trade', moves: Array.from({ length: MOVES_MAX + 1 }, () => [x, y, C1, 1]) });
  const mid = randomUUID();
  await refusedXfer('a lock into an escrow not its own', { id: `${mid}:lock`, kind: 'lock', moves: [[x, `m:${randomUUID()}`, C1, 1]] });
  await refusedXfer('a payout out of an escrow that game does not hold', { id: `${mid}:pay`, kind: 'pay', moves: [[`m:${mid}`, x, C1, 1]] });

  // ---------------------------------------------------------------- escrows
  // each match between two players with 5 of C3 each, in a game of its own
  const pair = async (code) => {
    const r = room(code);
    const p = [guest(), guest()];
    await store.addFinds(p.map((o) => [o, C3, 5]));
    for (const o of p) service.fromRoom(r, { t: 'cards', op: 'enter', owner: o });
    await settle();
    return [r, ...p];
  };
  const lock = async (r, id, p, q) => {
    service.fromRoom(r, { t: 'cards', op: 'xfer', id: `${id}:lock`, kind: 'lock', moves: [[p, `m:${id}`, C3, 1], [q, `m:${id}`, C3, 1]] });
    await settle();
    return r.xfered(`${id}:lock`);
  };
  const empty = async (id) => !Object.keys((await store.load(`m:${id}`)).found).length;
  {
    const [r, p, q] = await pair('E1');
    const m1 = randomUUID();
    const locked = await lock(r, m1, p, q);
    check('a lock puts both bets into the escrow', locked?.ok === true && (await n(`m:${m1}`, C3)) === 2 && (await n(p, C3)) === 4 && (await n(q, C3)) === 4, JSON.stringify(locked));
    await refusedXfer('a payout to somebody its lock did not name', { id: `${m1}:pay`, kind: 'pay', moves: [[`m:${m1}`, stranger, C3, 2]] }, r);
    await refusedXfer('a payout of that escrow from another game', { id: `${m1}:pay`, kind: 'pay', moves: [[`m:${m1}`, p, C3, 2]] }, R2);
    r.got.length = 0;
    service.fromRoom(r, { t: 'cards', op: 'xfer', id: `${m1}:pay`, kind: 'pay', moves: [[`m:${m1}`, p, C3, 1], [`m:${m1}`, p, C3, 1]] });
    await settle();
    check('the winner is paid both bets out of the escrow, which is then empty', r.xfered(`${m1}:pay`)?.ok === true && (await n(p, C3)) === 6 && (await n(q, C3)) === 4 && (await empty(m1)));
  }
  {
    // a game that ends unsettled (it crashed): the bets back
    const [r, p, q] = await pair('E2');
    const m2 = randomUUID();
    await lock(r, m2, p, q);
    r.closed = true;
    service.roomGone(r, false);
    await settle();
    await service.queue;
    check('a game that ends with bets unsettled: they go back', (await n(p, C3)) === 5 && (await n(q, C3)) === 5 && (await empty(m2)));
  }
  {
    // ...handed over to the next server: they stay, and are that game's there
    const [r, p, q] = await pair('E3');
    const m3 = randomUUID();
    await lock(r, m3, p, q);
    r.closed = true;
    service.roomGone(r, true);
    await settle();
    check('a game handed to the next server keeps its bets in the escrow', (await n(`m:${m3}`, C3)) === 2);
    const R5 = room('R5');
    service.fromRoom(R5, { t: 'cards', op: 'escrows', ids: [`m:${m3}`, 'junk'] });
    service.fromRoom(R5, { t: 'cards', op: 'xfer', id: `${m3}:back`, kind: 'back', moves: [[`m:${m3}`, p, C3, 1], [`m:${m3}`, q, C3, 1]] });
    await settle();
    await service.queue;
    check('...where the game carried on claims them, and may give them back', R5.xfered(`${m3}:back`)?.ok === true && (await n(p, C3)) === 5 && (await n(q, C3)) === 5 && (await empty(m3)), JSON.stringify(R5.got));
  }
  {
    // a lock that lands after its game went: straight back
    const [r, p, q] = await pair('E4');
    const m4 = randomUUID();
    service.fromRoom(r, { t: 'cards', op: 'xfer', id: `${m4}:lock`, kind: 'lock', moves: [[p, `m:${m4}`, C3, 1], [q, `m:${m4}`, C3, 1]] });
    r.closed = true;
    service.roomGone(r, false);
    for (let i = 0; i < 3; i++) {
      await settle();
      await service.queue;
    }
    check('a lock that goes in after its game ended comes straight back', (await n(p, C3)) === 5 && (await n(q, C3)) === 5 && (await empty(m4)));
  }
  {
    // ...unless the game went to the next server: the match goes on there, its lock sent again and found done, and the
    // escrow is that server's to claim and settle
    const [r, p, q] = await pair('E4b');
    const m = randomUUID();
    service.fromRoom(r, { t: 'cards', op: 'xfer', id: `${m}:lock`, kind: 'lock', moves: [[p, `m:${m}`, C3, 1], [q, `m:${m}`, C3, 1]] });
    r.closed = true;
    service.roomGone(r, true);
    for (let i = 0; i < 3; i++) {
      await settle();
      await service.queue;
    }
    check('...but one whose game went to the next server stays in the escrow, for that server', (await n(`m:${m}`, C3)) === 2 && (await n(p, C3)) === 4 && (await n(q, C3)) === 4 && !service.escrowAt.has(`m:${m}`));
  }
  {
    // the sweep: bets nobody settled for too long
    const [r, p, q] = await pair('E5');
    const m5 = randomUUID();
    await lock(r, m5, p, q);
    r.closed = true;
    service.roomGone(r, true); // (handed over, and never claimed)
    check('(the sweep leaves young escrows alone)', (await service.sweep()) === 0 && (await n(`m:${m5}`, C3)) === 2);
    await age(`m:${m5}`);
    const swept = await service.sweep();
    check('the sweep gives back bets left in escrow too long', swept === 1 && (await n(p, C3)) === 5 && (await n(q, C3)) === 5 && (await empty(m5)), `${swept}`);
  }
  {
    // a server going down: the games it could not hand over give their bets back, the finds are written
    const [r, p, q] = await pair('E6');
    const m6 = randomUUID();
    await lock(r, m6, p, q);
    // so many at once: busy
    const flood = [];
    for (let i = 0; i < INFLIGHT_MAX + 2; i++) {
      const id = `${randomUUID()}:trade`;
      flood.push(id);
      service.fromRoom(r, { t: 'cards', op: 'xfer', id, kind: 'trade', moves: [[p, q, C3, 1], [q, p, C3, 1]] });
    }
    const busy = flood.filter((id) => r.xfered(id)?.why === 'busy').length;
    await settle();
    check(`at most ${INFLIGHT_MAX} transfers under way per game`, busy === 2, `${busy} busy`);
    service.fromRoom(r, { t: 'cards', op: 'find', owner: p, cards: [C2] });
    await service.close([r]);
    check('a server going down: the bets of a game not handed over go back, and the finds are written', (await n(p, C3)) === 5 && (await n(q, C3)) === 5 && (await n(p, C2)) === 1 && (await empty(m6)));
  }

  // ---------------------------------------------------------------- decks, guests
  const s2 = new CardService({ store, flushMs: 20, retryMs: 50 });
  const Q = room('Q');
  const browser = randomUUID();
  const g = `g:${idKey(browser)}`;
  const acct2 = `a:${await addUser('signer')}`;
  s2.fromRoom(Q, { t: 'cards', op: 'enter', owner: g });
  s2.fromRoom(Q, { t: 'cards', op: 'enter', owner: acct2 });
  await settle();
  const sv = defaultDeck(F.SURVIVORS);
  const dd = defaultDeck(F.DEAD);
  s2.fromRoom(Q, { t: 'cards', op: 'deck', owner: g, deck: { slot: 0, name: 'Guest deck', leader: sv.leader, cards: sv.cards } });
  s2.fromRoom(Q, { t: 'cards', op: 'deck', owner: g, deck: { slot: 2, name: 'Thin', leader: sv.leader, cards: { [C1]: 1 } } });
  s2.fromRoom(Q, { t: 'cards', op: 'deck', owner: acct2, deck: { slot: 0, name: 'Account deck', leader: dd.leader, cards: dd.cards } });
  s2.fromRoom(Q, { t: 'cards', op: 'find', owner: g, cards: [C1, C2] });
  await settle();
  await s2.queue;
  const gd = (await store.load(g)).decks;
  check('a deck is kept, checked again: one the rules refuse is not', gd.length === 1 && gd[0].slot === 0 && gd[0].name === 'Guest deck' && Q.colls(g).at(-1).decks.length === 1, JSON.stringify(gd));
  await store.addFinds([[acct2, C1, 1]]);
  const merged = await s2.mergeGuest(acct2.slice(2), browser);
  await settle();
  const after = await store.load(acct2);
  check("signing in: a guest's cards go onto the account (added up), its decks into the account's empty slots", merged.cards === 2 && after.found[C1] === 2 && after.found[C2] === 1 && after.decks.length === 2 && after.decks[0].name === 'Account deck' && after.decks[1].slot === 1 && after.decks[1].name === 'Guest deck' && !Object.keys((await store.load(g)).found).length && !(await store.load(g)).decks.length, JSON.stringify(after));
  check('...and the games it is in hear it', found(Q.colls(acct2).at(-1))[C1] === 2 && !Q.colls(g).at(-1).found.length);
  const again = await s2.mergeGuest(acct2.slice(2), browser);
  check('...twice is once', again.cards === 0 && again.decks === 0 && JSON.stringify(await store.load(acct2)) === JSON.stringify(after));
  s2.fromRoom(Q, { t: 'cards', op: 'deck', owner: acct2, deck: { slot: 1, leader: 0 } });
  await settle();
  await s2.queue;
  check('a deck slot emptied (leader 0)', (await store.load(acct2)).decks.length === 1);
  await s2.close();
}

// ---------------------------------------------------------------- the two stores
let ledger = async () => null;
{
  const db = await openDb('pglite:memory');
  const r = await migrate(db);
  check('the migration applies', r.applied.includes('015_cards.sql'), r.applied.join());
  const tables = (await db.query(`SELECT table_name FROM information_schema.tables WHERE table_name IN ('user_cards', 'user_decks', 'card_ledger')`)).rows.length;
  check('...its three tables', tables === 3);
  let bad = 0;
  for (const owner of ['x:1', `a:${randomUUID()}`, 'g:abc', `m:${randomUUID()}`.toUpperCase()]) await db.query('INSERT INTO user_cards (owner, card, n) VALUES ($1, 1, 1)', [owner]).catch(() => bad++);
  check("...whose checks keep out a key that is no key, and an account's row without its account", bad === 4);
  ledger = async (id) => (await db.query('SELECT id FROM card_ledger WHERE id = $1', [id])).rows[0] || null;
  await suite('Postgres (PGlite)', new PgCardStore(db), {
    addUser: async (name) => (await db.query(`INSERT INTO users (email, username, password_hash) VALUES ($1, $2, 'x') RETURNING id`, [`${name}-${randomUUID().slice(0, 6)}@x.io`, `${name}${randomUUID().slice(0, 6)}`])).rows[0].id,
    delUser: async (id) => db.query('DELETE FROM users WHERE id = $1', [id]),
    age: async (owner) => db.query(`UPDATE user_cards SET updated_at = now() - interval '25 hours' WHERE owner = $1`, [owner]),
  });
  // signing in through auth.js: a guest with cards and no stats at all (DbStats.claimGuest has nothing to do for them)
  {
    const service = new CardService({ store: new PgCardStore(db) });
    const auth = new Auth({ db, stats: { claimGuest: async () => false }, cards: service });
    const browser = randomUUID();
    await service.store.addFinds([[`g:${idKey(browser)}`, C1, 2]]);
    const user = (await db.query(`INSERT INTO users (email, username, password_hash) VALUES ('signin@x.io', 'signin', 'x') RETURNING id, username`)).rows[0];
    await auth.claimGuest(user, browser);
    check("signing in (auth.js claimGuest) brings the guest's cards onto the account", (await service.store.load(`a:${user.id}`)).found[C1] === 2 && !(await service.store.load(`g:${idKey(browser)}`)).found[C1]);
    await service.close();
  }
  await db.close();
}
{
  const store = new MemoryCardStore();
  store.accounts = new Set();
  ledger = async (id) => store.ledger.get(id) || null;
  await suite('in memory', store, {
    addUser: async () => {
      const id = randomUUID();
      store.accounts.add(id);
      return id;
    },
    delUser: async (id) => store.accounts.delete(id),
    age: async (owner) => {
      for (const r of store.rows.get(owner)?.values() || []) r.at -= 25 * 3600e3;
    },
  });
}

console.log(`\n${fails.length ? 'FAILED: ' + fails.join(', ') : 'all collection checks passed'}`);
process.exit(fails.length ? 1 : 0);
