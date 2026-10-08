// Dead Hand's collections (shared/cards.js is the set, server/cards.js the game's side): the cards each player has
// found, the decks they built, and every move of cards from one owner to another. The network thread's: the games in
// their workers post what happens (a pack opened, a deck kept, a trade struck, a bet put up or paid) and hear back what
// an owner has now. Nothing here is ever sent to a player: owner keys stay on the server.
//
// An owner is a key: 'a:<account id>' (an account's), 'g:<sha-256 of the browser id>' (a guest's: the key their
// leaderboard record is under, stats.js idKey) or 'm:<match uuid>' (an escrow: both bets of a match, held until they go
// to the winner or back). The starter set everyone owns is never stored (shared/cards.js STARTER): only what was found.
//
// The stores (both the same face, so the tests run the service on either):
//   PgCardStore      Postgres (db/migrations/015_cards.sql: user_cards, user_decks, card_ledger)
//   MemoryCardStore  no database: the collections last as long as the process does (and the tests)
//
// CardService runs all the store's work one job at a time (a serial queue), so a load never reads between a move's
// two halves and two moves of the last copy of a card cannot both go through:
//   finds     cached at once and written in batches (FLUSH_MS), duplicates added up, an account deleted meanwhile left
//             out (it would fail the batch for good), a batch that fails tried again (RETRY_MS). PACK_CAP packs an hour
//             per owner at most.
//   transfer  { id, kind, moves: [[from, to, card, n]] } all or nothing, once: the ledger row is the move's id (a second
//             with the same id is told it went through, and changes nothing). Finds are written first.
//   decks     checked again against what the owner has (validateDeck) before they are kept
//   guests    signing in brings a guest's cards and decks onto the account (mergeGuest: added up; a deck into an empty slot)
//   escrows   a game that ends without settling its bets (it crashed, or the server went down and could not hand it
//             over) has them given back (roomGone); one that nobody settles in ESCROW_MAX_AGE is given back by the sweep
//
// Between the threads (room-worker.js's header has them too). From a game:
//   { t: 'cards', op: 'enter' | 'leave', owner }       a player of that owner came into the game / left it (counted)
//   { t: 'cards', op: 'find', owner, cards }            a pack opened: these cards are theirs
//   { t: 'cards', op: 'deck', owner, deck }             { slot, name, leader, cards } kept (leader 0: the slot emptied)
//   { t: 'cards', op: 'xfer', id, kind, moves }         a move of cards: 'trade', 'lock' (bets into the escrow), 'pay', 'back'
//   { t: 'cards', op: 'escrows', ids }                  a game carried on from the last server: the escrows it holds
// To it:
//   { t: 'cards', op: 'coll', owner, ok, found: [[card, n]], decks }   what an owner has: as they come in, and after
//                                                        every change (to every game that owner is in). ok false: it
//                                                        could not be read (it is tried again)
//   { t: 'cards', op: 'xfered', id, ok, why }           a move went through, or not (why: 'not_owned', 'store', 'refused', 'busy')
//
// What a game says is checked as if it could be wrong (a bug there must not mint cards): owner keys, card ids and
// counts; a trade only moves cards between owners that game has in it; a lock only into a new escrow of its own; pay
// and back only out of that game's escrows to the owners its lock named; at most MOVES_MAX moves a transfer and
// INFLIGHT_MAX transfers under way per game. Every handler is wrapped: a throw on the network thread would end every
// game on the server.
import { idKey } from './stats.js';
import { cardDef, validateDeck, cleanDeck, PACK_SIZE, DECK_SLOTS } from '../shared/cards.js';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const OWNER_RE = new RegExp(`^(a:${UUID}|g:[0-9a-f]{64})$`); // a player's (an account's, a guest's)
export const ESCROW_RE = new RegExp(`^m:${UUID}$`); // a match's bets
const XFER_RE = new RegExp(`^(${UUID}):(lock|pay|back|trade)$`);
const USER_RE = new RegExp(`^${UUID}$`);
const N_MAX = 9999; // copies of a card an owner can have (the table's check)
const MOVE_N_MAX = 99; // ...and move in one go
export const MOVES_MAX = 32;
export const INFLIGHT_MAX = 8;
const FLUSH_MS = 200;
const RETRY_MS = 5000;
export const PACK_CAP = 30; // packs an owner may open in an hour (server/cards.js stops a game short of it too)
const PACK_WINDOW_MS = 3600e3;
export const ESCROW_MAX_AGE = 24 * 3600; // s: a bet held this long is given back by the sweep
const NAME_MAX = 24;

const isOwner = (o) => typeof o === 'string' && OWNER_RE.test(o);
const isEscrow = (o) => typeof o === 'string' && ESCROW_RE.test(o);
const isCard = (id) => Number.isInteger(id) && id > 0 && id < 32768 && !!cardDef(id);
const userOf = (owner) => (owner.startsWith('a:') ? owner.slice(2) : null);
const notOwned = (owner, card) => Object.assign(new Error(`${owner} has too few of card ${card}`), { code: 'not_owned' });
const asJson = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

// What a list of moves comes to per owner and card: [[owner, card, delta]], in (owner, card) order - so every
// transfer takes its rows in the same order (no two can deadlock), and one that sends a card both ways nets out.
export function netMoves(moves) {
  const net = new Map();
  for (const [from, to, card, n] of moves) {
    const kf = `${from}\u0000${card}`;
    const kt = `${to}\u0000${card}`;
    net.set(kf, (net.get(kf) || 0) - n);
    net.set(kt, (net.get(kt) || 0) + n);
  }
  return [...net]
    .filter(([, d]) => d !== 0)
    .map(([k, d]) => {
      const [owner, card] = k.split('\u0000');
      return [owner, +card, d];
    })
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
}
// the players' owners a transfer touches (not its escrows), each once
const playersOf = (moves) => [...new Set(moves.flatMap((m) => [m[0], m[1]]))].filter((o) => !isEscrow(o));
const decksOf = (rows) =>
  rows
    .map((r) => ({ slot: r.slot, name: r.name || '', leader: r.leader, cards: asJson(r.cards) || {} }))
    .sort((a, b) => a.slot - b.slot);

// ---------------------------------------------------------------- Postgres
export class PgCardStore {
  constructor(db) {
    this.db = db;
  }

  // -> { found: { card: n }, decks: [{ slot, name, leader, cards }] }
  async load(owner) {
    const c = await this.db.query('SELECT card, n FROM user_cards WHERE owner = $1 AND n > 0', [owner]);
    const d = await this.db.query('SELECT slot, name, leader, cards FROM user_decks WHERE owner = $1 ORDER BY slot', [owner]);
    const found = {};
    for (const r of c.rows) found[r.card] = r.n;
    return { found, decks: decksOf(d.rows) };
  }

  // rows: [[owner, card, n]], one per (owner, card). An account deleted meanwhile is left out: its row would fail the
  // batch, and the batch again, for good (as userbestiary.js does)
  async addFinds(rows) {
    if (!rows.length) return;
    await this.db.query(
      `INSERT INTO user_cards (owner, user_id, card, n)
         SELECT x.owner, x.user_id, x.card, LEAST(${N_MAX}, x.n)
           FROM jsonb_to_recordset($1::jsonb) AS x(owner text, user_id uuid, card smallint, n integer)
          WHERE x.user_id IS NULL OR EXISTS (SELECT 1 FROM users u WHERE u.id = x.user_id)
       ON CONFLICT (owner, card) DO UPDATE SET n = LEAST(${N_MAX}, user_cards.n + EXCLUDED.n), updated_at = now()`,
      [JSON.stringify(rows.map(([owner, card, n]) => ({ owner, user_id: userOf(owner), card, n })))]
    );
  }

  // All or nothing, once. -> { dup, counts: { owner: { card: n } } } (the players' it touched, as they are now); throws
  // (code 'not_owned') when an owner has fewer than it gives, and nothing is changed. A deadlock is tried once more.
  async transfer({ id, kind, moves }) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.db.tx((t) => this.apply(t, id, kind, moves));
      } catch (err) {
        if (err.code === '40P01' && attempt < 1) continue;
        throw err;
      }
    }
  }
  async apply(t, id, kind, moves) {
    const fresh = (await t.query('INSERT INTO card_ledger (id, kind, moves) VALUES ($1, $2, $3::jsonb) ON CONFLICT (id) DO NOTHING RETURNING id', [id, kind, JSON.stringify(moves)])).rows.length > 0;
    if (fresh) {
      const escrows = new Set();
      for (const [owner, card, d] of netMoves(moves)) {
        if (isEscrow(owner)) escrows.add(owner);
        if (d < 0) {
          const r = await t.query('UPDATE user_cards SET n = n + $3, updated_at = now() WHERE owner = $1 AND card = $2 AND n >= $4', [owner, card, d, -d]);
          if (!r.rowCount) throw notOwned(owner, card);
        } else {
          // (to an account deleted meanwhile: nowhere - its cards went with it)
          await t.query(
            `INSERT INTO user_cards (owner, user_id, card, n)
               SELECT $1, $2::uuid, $3, LEAST(${N_MAX}, $4::int) WHERE $2::uuid IS NULL OR EXISTS (SELECT 1 FROM users WHERE id = $2::uuid)
             ON CONFLICT (owner, card) DO UPDATE SET n = LEAST(${N_MAX}, user_cards.n + EXCLUDED.n), updated_at = now()`,
            [owner, userOf(owner), card, d]
          );
        }
      }
      if (escrows.size) await t.query('DELETE FROM user_cards WHERE owner = ANY($1::text[]) AND n = 0', [[...escrows]]); // (an escrow paid out is gone)
    }
    const owners = playersOf(moves);
    const r = owners.length ? await t.query('SELECT owner, card, n FROM user_cards WHERE owner = ANY($1::text[]) AND n > 0', [owners]) : { rows: [] };
    const counts = {};
    for (const o of owners) counts[o] = {};
    for (const row of r.rows) counts[row.owner][row.card] = row.n;
    return { dup: !fresh, counts };
  }

  // deck: { slot, name, leader, cards }; leader 0 empties the slot
  async saveDeck(owner, deck) {
    if (!deck.leader) return void (await this.db.query('DELETE FROM user_decks WHERE owner = $1 AND slot = $2', [owner, deck.slot]));
    await this.db.query(
      `INSERT INTO user_decks (owner, user_id, slot, name, leader, cards)
         SELECT $1, $2::uuid, $3, $4, $5, $6::jsonb WHERE $2::uuid IS NULL OR EXISTS (SELECT 1 FROM users WHERE id = $2::uuid)
       ON CONFLICT (owner, slot) DO UPDATE SET name = EXCLUDED.name, leader = EXCLUDED.leader, cards = EXCLUDED.cards, updated_at = now()`,
      [owner, userOf(owner), deck.slot, deck.name, deck.leader, JSON.stringify(deck.cards)]
    );
  }

  // A guest's cards onto the account (added up) and their decks into the account's empty slots; the guest's rows go.
  // Run again, it finds nothing. -> { cards, decks } (how many rows came over)
  async mergeGuest(account, guest) {
    return this.db.tx(async (t) => {
      const cards = (await t.query('DELETE FROM user_cards WHERE owner = $1 RETURNING card, n', [guest])).rows.filter((r) => r.n > 0);
      if (cards.length) {
        await t.query(
          `INSERT INTO user_cards (owner, user_id, card, n)
             SELECT $1, $2::uuid, x.card, LEAST(${N_MAX}, x.n) FROM jsonb_to_recordset($3::jsonb) AS x(card smallint, n integer)
           ON CONFLICT (owner, card) DO UPDATE SET n = LEAST(${N_MAX}, user_cards.n + EXCLUDED.n), updated_at = now()`,
          [account, userOf(account), JSON.stringify(cards.map((r) => ({ card: r.card, n: r.n })))]
        );
      }
      const decks = decksOf((await t.query('DELETE FROM user_decks WHERE owner = $1 RETURNING slot, name, leader, cards', [guest])).rows);
      let moved = 0;
      if (decks.length) {
        const taken = new Set((await t.query('SELECT slot FROM user_decks WHERE owner = $1', [account])).rows.map((r) => r.slot));
        const free = [...Array(DECK_SLOTS).keys()].filter((s) => !taken.has(s));
        for (const d of decks) {
          const slot = free.shift();
          if (slot === undefined) break;
          await t.query('INSERT INTO user_decks (owner, user_id, slot, name, leader, cards) VALUES ($1, $2::uuid, $3, $4, $5, $6::jsonb)', [account, userOf(account), slot, d.name, d.leader, JSON.stringify(d.cards)]);
          moved++;
        }
      }
      return { cards: cards.length, decks: moved };
    });
  }

  // the moves that put up an escrow's bets (its ':lock' in the ledger), or null: none were
  async lockMoves(escrow) {
    const r = await this.db.query('SELECT moves FROM card_ledger WHERE id = $1', [`${escrow.slice(2)}:lock`]);
    return r.rows[0] ? asJson(r.rows[0].moves) : null;
  }

  // the escrows still holding something, last changed more than `ageS` seconds ago
  async oldEscrows(ageS) {
    const r = await this.db.query(`SELECT DISTINCT owner FROM user_cards WHERE owner LIKE 'm:%' AND n > 0 AND updated_at < now() - make_interval(secs => $1)`, [ageS]);
    return r.rows.map((row) => row.owner);
  }
}

// ---------------------------------------------------------------- no database
// The same, in this process's memory: kept as long as it runs. accounts: a Set of the account ids that exist (the tests
// delete one); null, every account does.
export class MemoryCardStore {
  constructor() {
    this.rows = new Map(); // owner -> Map(card -> { n, at })
    this.decks = new Map(); // owner -> Map(slot -> deck)
    this.ledger = new Map(); // id -> { kind, moves, at }
    this.accounts = null;
  }
  exists(owner) {
    return !owner.startsWith('a:') || !this.accounts || this.accounts.has(owner.slice(2));
  }
  async load(owner) {
    const found = {};
    for (const [card, r] of this.rows.get(owner) || []) if (r.n > 0) found[card] = r.n;
    const decks = [...(this.decks.get(owner)?.values() || [])].map((d) => ({ ...d, cards: { ...d.cards } })).sort((a, b) => a.slot - b.slot);
    return { found, decks };
  }
  put(owner, card, d, at) {
    let m = this.rows.get(owner);
    if (!m) this.rows.set(owner, (m = new Map()));
    const r = m.get(card) || { n: 0, at };
    r.n = Math.max(0, Math.min(N_MAX, r.n + d));
    r.at = at;
    if (r.n === 0 && isEscrow(owner)) m.delete(card);
    else m.set(card, r);
    if (!m.size) this.rows.delete(owner);
  }
  async addFinds(rows) {
    const at = Date.now();
    for (const [owner, card, n] of rows) if (this.exists(owner)) this.put(owner, card, n, at);
  }
  counts(owners) {
    const out = {};
    for (const o of owners) {
      out[o] = {};
      for (const [card, r] of this.rows.get(o) || []) if (r.n > 0) out[o][card] = r.n;
    }
    return out;
  }
  async transfer({ id, kind, moves }) {
    const owners = playersOf(moves);
    if (this.ledger.has(id)) return { dup: true, counts: this.counts(owners) };
    const net = netMoves(moves);
    for (const [owner, card, d] of net) if (d < 0 && (this.rows.get(owner)?.get(card)?.n || 0) < -d) throw notOwned(owner, card);
    const at = Date.now();
    for (const [owner, card, d] of net) if (d < 0 || this.exists(owner)) this.put(owner, card, d, at);
    this.ledger.set(id, { kind, moves: moves.map((m) => [...m]), at });
    return { dup: false, counts: this.counts(owners) };
  }
  async saveDeck(owner, deck) {
    let m = this.decks.get(owner);
    if (!deck.leader) return void m?.delete(deck.slot);
    if (!this.exists(owner)) return;
    if (!m) this.decks.set(owner, (m = new Map()));
    m.set(deck.slot, { slot: deck.slot, name: deck.name, leader: deck.leader, cards: { ...deck.cards } });
  }
  async mergeGuest(account, guest) {
    const at = Date.now();
    const cards = [...(this.rows.get(guest) || [])].filter(([, r]) => r.n > 0);
    for (const [card, r] of cards) this.put(account, card, r.n, at);
    this.rows.delete(guest);
    const decks = [...(this.decks.get(guest)?.values() || [])].sort((a, b) => a.slot - b.slot);
    this.decks.delete(guest);
    let moved = 0;
    if (decks.length) {
      let m = this.decks.get(account);
      if (!m) this.decks.set(account, (m = new Map()));
      const free = [...Array(DECK_SLOTS).keys()].filter((s) => !m.has(s));
      for (const d of decks) {
        const slot = free.shift();
        if (slot === undefined) break;
        m.set(slot, { ...d, slot });
        moved++;
      }
    }
    return { cards: cards.length, decks: moved };
  }
  async lockMoves(escrow) {
    const l = this.ledger.get(`${escrow.slice(2)}:lock`);
    return l ? l.moves.map((m) => [...m]) : null;
  }
  async oldEscrows(ageS) {
    const before = Date.now() - ageS * 1000;
    const out = [];
    for (const [owner, m] of this.rows) if (isEscrow(owner) && [...m.values()].some((r) => r.n > 0 && r.at < before)) out.push(owner);
    return out;
  }
}

// ---------------------------------------------------------------- the service
export class CardService {
  // store: PgCardStore or MemoryCardStore. changed(owners): what an owner has changed here (a server of a cluster tells
  // the others, which read it again: reload)
  constructor({ store, log = () => {}, flushMs = FLUSH_MS, retryMs = RETRY_MS, packCap = PACK_CAP, escrowMaxAge = ESCROW_MAX_AGE, changed = null } = {}) {
    this.store = store;
    this.log = log;
    this.flushMs = flushMs;
    this.retryMs = retryMs;
    this.packCap = packCap;
    this.escrowMaxAge = escrowMaxAge;
    this.changed = changed;
    this.queue = Promise.resolve(); // (the serial queue: run)
    this.cache = new Map(); // owner -> { found: Map(card -> n), decks, state: 'loading' | 'ok' | 'failed', rooms: Set }
    this.finds = new Map(); // owner -> Map(card -> n): found, not written yet
    this.packs = new Map(); // owner -> [when each pack of the last hour was opened (ms)]
    this.rooms = new Map(); // room -> { owners: Map(owner -> players of it in there), escrows: Map(escrow -> Set of the owners its lock named | null: being read), inflight }
    this.handed = new WeakSet(); // rooms whose game went to the next server (roomGone): their escrows are its
    this.escrowAt = new Map(); // escrow -> the room holding it
    this.timer = null;
    this.closed = false;
  }

  // one job at a time, in the order they came: -> its promise (the queue goes on whatever becomes of it)
  run(job) {
    const p = this.queue.then(job);
    this.queue = p.catch(() => {});
    return p;
  }

  tell(room, m) {
    if (room.closed) return;
    try {
      room.worker.postMessage(m);
    } catch {}
  }
  collMsg(owner, c) {
    return { t: 'cards', op: 'coll', owner, ok: c.state === 'ok', found: [...c.found].filter(([, n]) => n > 0), decks: c.decks };
  }
  // every game this owner is in hears what they have now
  broadcast(owner) {
    const c = this.cache.get(owner);
    if (!c || c.state === 'loading') return;
    const m = this.collMsg(owner, c);
    for (const room of c.rooms) this.tell(room, m);
  }
  roomState(room) {
    let st = this.rooms.get(room);
    if (!st) this.rooms.set(room, (st = { owners: new Map(), escrows: new Map(), inflight: 0 }));
    return st;
  }
  // what the store says an owner has, with the finds not written yet on top (the cache's found)
  withFinds(owner, found) {
    const m = new Map(Object.entries(found).map(([k, n]) => [+k, n]));
    for (const [card, n] of this.finds.get(owner) || []) m.set(card, Math.min(N_MAX, (m.get(card) || 0) + n));
    return m;
  }

  // ---------------------------------------------------------------- from a game (Room 'cards')
  fromRoom(room, m) {
    try {
      if (this.closed || room.closed || !m || typeof m !== 'object') return;
      switch (m.op) {
        case 'enter':
          return this.enter(room, m.owner);
        case 'leave':
          return this.leave(room, m.owner);
        case 'find':
          return this.find(room, m.owner, m.cards);
        case 'deck':
          return this.deck(room, m.owner, m.deck);
        case 'xfer':
          return this.xfer(room, m);
        case 'escrows':
          return this.claim(room, m.ids);
      }
    } catch (err) {
      this.log(`cards: a game's ${String(m?.op).slice(0, 12)} failed (${err.message})`);
    }
  }

  enter(room, owner) {
    if (!isOwner(owner)) return;
    const st = this.roomState(room);
    st.owners.set(owner, (st.owners.get(owner) || 0) + 1);
    let c = this.cache.get(owner);
    if (!c) {
      this.cache.set(owner, (c = { found: new Map(), decks: [], state: 'loading', rooms: new Set() }));
      this.fetch(owner, c);
    }
    c.rooms.add(room);
    if (c.state !== 'loading') this.tell(room, this.collMsg(owner, c));
  }

  leave(room, owner) {
    const st = this.rooms.get(room);
    if (!st || !st.owners.has(owner)) return;
    const n = st.owners.get(owner) - 1;
    if (n > 0) return void st.owners.set(owner, n);
    st.owners.delete(owner);
    this.forget(room, owner);
  }
  // this room has nobody of that owner in it any more (the cache goes with the last room: finds not written yet are
  // still in this.finds, and on top of whatever is read next time)
  forget(room, owner) {
    const c = this.cache.get(owner);
    if (!c) return;
    c.rooms.delete(room);
    if (!c.rooms.size) this.cache.delete(owner);
  }

  // (read now, in the queue; a read that fails is tried again while somebody of that owner is still in a game)
  fetch(owner, c = this.cache.get(owner)) {
    if (!c) return;
    this.run(() => this.store.load(owner)).then(
      (got) => {
        if (this.cache.get(owner) !== c) return;
        c.found = this.withFinds(owner, got.found);
        c.decks = got.decks;
        c.state = 'ok';
        this.broadcast(owner);
      },
      (err) => {
        if (this.cache.get(owner) !== c) return;
        this.log(`cards: a collection could not be read (${err.message}); trying again`);
        if (c.state !== 'ok') {
          c.state = 'failed';
          this.broadcast(owner);
        }
        setTimeout(() => this.cache.get(owner) === c && !this.closed && this.fetch(owner, c), this.retryMs).unref?.();
      }
    );
  }
  // read these owners again, if any game here has them (another server changed them: cluster.js)
  reload(owners) {
    try {
      for (const o of Array.isArray(owners) ? owners.slice(0, 64) : []) if (isOwner(o) && this.cache.has(o)) this.fetch(o);
    } catch (err) {
      this.log(`cards: reload failed (${err.message})`);
    }
  }

  // a pack opened in a game: these cards are the owner's
  find(room, owner, cards) {
    if (!isOwner(owner) || !this.rooms.get(room)?.owners.has(owner)) return;
    if (!Array.isArray(cards) || !cards.length || cards.length > PACK_SIZE || !cards.every(isCard)) return;
    const now = Date.now();
    const packs = (this.packs.get(owner) || []).filter((t) => now - t < PACK_WINDOW_MS);
    if (packs.length >= this.packCap) {
      this.packs.set(owner, packs);
      this.log(`cards: a pack past ${this.packCap} an hour for one owner, not kept`);
      return this.broadcast(owner); // (the game's copy of the collection had it already: put right)
    }
    packs.push(now);
    this.packs.set(owner, packs);
    let q = this.finds.get(owner);
    if (!q) this.finds.set(owner, (q = new Map()));
    const c = this.cache.get(owner);
    for (const card of cards) {
      q.set(card, (q.get(card) || 0) + 1);
      if (c) c.found.set(card, Math.min(N_MAX, (c.found.get(card) || 0) + 1));
    }
    this.broadcast(owner);
    this.soon(this.flushMs);
  }
  soon(ms) {
    if (this.timer || this.closed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush().catch(() => {});
    }, ms);
    this.timer.unref?.();
  }
  // the finds not written yet, written (in the queue)
  flush() {
    return this.run(() => this.writeFinds());
  }
  // (inside a queued job only)
  async writeFinds() {
    if (!this.finds.size) return;
    const batch = this.finds;
    this.finds = new Map();
    const rows = [];
    for (const [owner, m] of batch) for (const [card, n] of m) rows.push([owner, card, Math.min(N_MAX, n)]);
    try {
      await this.store.addFinds(rows);
    } catch (err) {
      this.log(`cards: ${rows.length} find(s) not written (${err.message}); trying again`);
      for (const [owner, m] of batch) {
        let q = this.finds.get(owner);
        if (!q) this.finds.set(owner, (q = new Map()));
        for (const [card, n] of m) q.set(card, (q.get(card) || 0) + n);
      }
      this.soon(this.retryMs);
      throw err;
    }
    this.changed?.([...batch.keys()]);
  }

  // a deck kept (leader 0: the slot emptied), checked again against what the owner has
  deck(room, owner, deck) {
    if (!isOwner(owner) || !this.rooms.get(room)?.owners.has(owner) || !deck || typeof deck !== 'object') return;
    const c = this.cache.get(owner);
    if (!c || c.state !== 'ok') return;
    const slot = deck.slot;
    if (!Number.isInteger(slot) || slot < 0 || slot >= DECK_SLOTS) return;
    const name = typeof deck.name === 'string' ? deck.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, NAME_MAX) : '';
    let kept;
    if (deck.leader === 0) kept = { slot, name: '', leader: 0, cards: {} };
    else {
      const d = cleanDeck({ leader: deck.leader, cards: deck.cards });
      if (!d || !validateDeck(d, Object.fromEntries(c.found)).ok) return this.broadcast(owner);
      kept = { slot, name, leader: d.leader, cards: d.cards };
    }
    this.run(() => this.store.saveDeck(owner, kept)).then(
      () => {
        const now = this.cache.get(owner);
        if (now) {
          now.decks = now.decks.filter((d) => d.slot !== slot);
          if (kept.leader) now.decks = [...now.decks, kept].sort((a, b) => a.slot - b.slot);
          this.broadcast(owner);
        }
        this.changed?.([owner]);
      },
      (err) => {
        this.log(`cards: a deck not kept (${err.message})`);
        this.broadcast(owner); // (the games put their copy back as it was)
      }
    );
  }

  // a move of cards: checked, then made in the queue (the finds written first)
  xfer(room, m) {
    const id = typeof m.id === 'string' ? m.id : '';
    const match = XFER_RE.exec(id);
    const st = this.rooms.get(room);
    const refuse = (why) => {
      this.log(`cards: a ${String(m.kind).slice(0, 8)} refused (${why})`);
      if (id.length <= 64) this.tell(room, { t: 'cards', op: 'xfered', id, ok: false, why: 'refused' });
    };
    if (!match || match[2] !== m.kind || !st) return refuse('its id');
    const kind = m.kind;
    const escrow = `m:${match[1]}`;
    const moves = m.moves;
    if (!Array.isArray(moves) || !moves.length || moves.length > MOVES_MAX) return refuse('its moves');
    for (const mv of moves) {
      if (!Array.isArray(mv) || mv.length !== 4) return refuse('a move');
      const [from, to, card, n] = mv;
      if (from === to || !(isOwner(from) || isEscrow(from)) || !(isOwner(to) || isEscrow(to)) || !isCard(card) || !Number.isInteger(n) || n < 1 || n > MOVE_N_MAX) return refuse('a move');
      if (kind === 'trade' && !(st.owners.has(from) && st.owners.has(to))) return refuse('a trade with somebody not in that game');
      if (kind === 'lock' && !(st.owners.has(from) && to === escrow)) return refuse('a bet not of that game into its own escrow');
      if ((kind === 'pay' || kind === 'back') && !(from === escrow && isOwner(to))) return refuse('a payout not out of its escrow');
    }
    if (kind === 'lock' && this.escrowAt.has(escrow) && this.escrowAt.get(escrow) !== room) return refuse('an escrow another game holds');
    if ((kind === 'pay' || kind === 'back') && !st.escrows.has(escrow)) return refuse('an escrow that game does not hold');
    if (st.inflight >= INFLIGHT_MAX) return this.tell(room, { t: 'cards', op: 'xfered', id, ok: false, why: 'busy' });
    st.inflight++;
    const clean = moves.map((mv) => [...mv]);
    this.run(async () => {
      if (kind === 'pay' || kind === 'back') {
        const named = st.escrows.get(escrow);
        if (!(named instanceof Set) || !clean.every((mv) => named.has(mv[1]))) throw Object.assign(new Error('a payout to somebody its bets were not from'), { code: 'refused' });
      }
      await this.writeFinds().catch(() => {});
      return this.store.transfer({ id, kind, moves: clean });
    })
      .then(
        (res) => {
          this.settled(clean, res.counts);
          if (kind === 'lock') {
            st.escrows.set(escrow, new Set(clean.map((mv) => mv[0])));
            this.escrowAt.set(escrow, room);
            // (the game went while its bets went in: they go back - unless it went to the next server, which carries
            // the match on and claims its escrow, its lock sent again and found done)
            if (room.closed || this.rooms.get(room) !== st) {
              if (!this.handed.has(room)) this.giveBack(escrow);
              else if (this.escrowAt.get(escrow) === room) this.escrowAt.delete(escrow);
            }
          } else if (kind === 'pay' || kind === 'back') {
            st.escrows.delete(escrow);
            if (this.escrowAt.get(escrow) === room) this.escrowAt.delete(escrow);
          }
          this.tell(room, { t: 'cards', op: 'xfered', id, ok: true });
        },
        (err) => {
          const why = err.code === 'not_owned' || err.code === 'refused' ? err.code : 'store';
          if (why === 'store') this.log(`cards: a ${kind} failed (${err.message})`);
          else if (why === 'refused') this.log(`cards: a ${kind} refused (${err.message})`);
          else for (const o of playersOf(clean)) if (this.cache.has(o)) this.fetch(o); // (the game's copy was out of date)
          this.tell(room, { t: 'cards', op: 'xfered', id, ok: false, why });
        }
      )
      .finally(() => st.inflight--);
  }
  // a transfer went through: the players' collections as the store has them now, to every game they are in
  settled(moves, counts) {
    const owners = playersOf(moves);
    for (const o of owners) {
      const c = this.cache.get(o);
      if (!c || !counts[o]) continue;
      c.found = this.withFinds(o, counts[o]);
      if (c.state !== 'loading') this.broadcast(o);
    }
    if (owners.length) this.changed?.(owners);
  }

  // A game carried on from the last server: the escrows it holds (its matches' bets) are its own here - to pay out or
  // give back. The owners each lock named are read from the ledger (one never locked is nobody's: its lock, sent again,
  // makes it).
  claim(room, ids) {
    if (!Array.isArray(ids)) return;
    const st = this.roomState(room);
    for (const esc of ids.slice(0, 64)) {
      if (!isEscrow(esc)) continue;
      const holder = this.escrowAt.get(esc);
      if (holder && holder !== room && !holder.closed) {
        this.log('cards: an escrow another game here holds was claimed: left with that one');
        continue;
      }
      this.escrowAt.set(esc, room);
      st.escrows.set(esc, null);
      this.run(() => this.store.lockMoves(esc)).then(
        (moves) => {
          if (st.escrows.get(esc) !== null) return;
          if (moves) st.escrows.set(esc, new Set(moves.map((mv) => mv[0])));
          else {
            st.escrows.delete(esc);
            if (this.escrowAt.get(esc) === room) this.escrowAt.delete(esc);
          }
        },
        (err) => {
          this.log(`cards: an escrow's lock could not be read (${err.message})`);
          if (st.escrows.get(esc) === null) st.escrows.delete(esc);
        }
      );
    }
  }

  // An escrow's bets back to the owners its lock took them from (its ':back', which a game giving them back would have
  // used: whichever comes first is the one). One already paid out has nothing in it: nothing happens. -> promise of
  // whether anything came back
  giveBack(esc, tries = 0) {
    return this.run(async () => {
      const lock = await this.store.lockMoves(esc);
      if (!lock) return false;
      const back = lock.map(([from, to, card, n]) => [to, from, card, n]);
      await this.writeFinds().catch(() => {});
      try {
        const res = await this.store.transfer({ id: `${esc.slice(2)}:back`, kind: 'back', moves: back });
        this.settled(back, res.counts);
        return !res.dup;
      } catch (err) {
        if (err.code === 'not_owned') return false; // (paid out, or back already)
        throw err;
      }
    }).catch((err) => {
      this.log(`cards: an escrow not given back (${err.message})${tries < 3 ? '; trying again' : ''}`);
      if (tries < 3 && !this.closed) setTimeout(() => this.giveBack(esc, tries + 1), this.retryMs).unref?.();
      return false;
    });
  }

  // A game ended here (Room.shut). handedOff: the next server carries it on, and its escrows with it; otherwise its bets
  // go back to whoever put them up.
  roomGone(room, handedOff = false) {
    try {
      if (handedOff) this.handed.add(room);
      const st = this.rooms.get(room);
      if (!st) return;
      this.rooms.delete(room);
      for (const owner of st.owners.keys()) this.forget(room, owner);
      for (const esc of st.escrows.keys()) {
        if (this.escrowAt.get(esc) !== room) continue;
        this.escrowAt.delete(esc);
        if (!handedOff) this.giveBack(esc);
      }
    } catch (err) {
      this.log(`cards: a game's end not seen to (${err.message})`);
    }
  }

  // Bets nobody settled in escrowMaxAge (their game, and every server it went to, are gone) go back. -> how many
  async sweep() {
    try {
      const old = await this.run(() => this.store.oldEscrows(this.escrowMaxAge));
      let n = 0;
      for (const esc of old) if (!this.escrowAt.has(esc) && (await this.giveBack(esc))) n++;
      if (n) this.log(`cards: ${n} bet(s) left in escrow for ${Math.round(this.escrowMaxAge / 3600)} h given back`);
      return n;
    } catch (err) {
      this.log(`cards: the escrow sweep failed (${err.message})`);
      return 0;
    }
  }

  // Signing in (auth.js): what the browser found as a guest becomes the account's. -> promise ({ cards, decks } moved)
  async mergeGuest(userId, browserId) {
    const g = idKey(browserId);
    const id = String(userId || '').toLowerCase();
    if (!g || !USER_RE.test(id)) return { cards: 0, decks: 0 };
    const account = `a:${id}`;
    const guest = `g:${g}`;
    const r = await this.run(async () => {
      await this.writeFinds().catch(() => {});
      return this.store.mergeGuest(account, guest);
    });
    for (const o of [account, guest]) if (this.cache.has(o)) this.fetch(o);
    if (r.cards || r.decks) this.changed?.([account, guest]);
    return r;
  }

  // The server is going down: the games still here (not handed over) give their bets back, and the finds are written.
  async close(rooms = []) {
    for (const room of rooms) this.roomGone(room, false);
    clearTimeout(this.timer);
    this.timer = null;
    await this.flush().catch(() => {});
    await this.queue;
    this.closed = true;
  }
}
