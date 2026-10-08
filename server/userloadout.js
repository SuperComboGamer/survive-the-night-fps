// Permanent loadout item collections (shared/loadout.js is the catalog): each owned copy has its own id, because later
// features will move individual copies between owners. The network thread keeps the store; games ask it for collections
// and grants through a small service, as Dead Hand does for cards.
import { randomUUID } from 'node:crypto';
import { idKey } from './stats.js';
import { LOADOUT_SLOTS, cleanLoadoutSlots, loadoutDef } from '../shared/loadout.js';
import { AUCTION, SKULL_EARN, auctionFee } from '../shared/economy.js';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const OWNER_RE = new RegExp(`^(a:${UUID}|g:[0-9a-f]{64})$`);
const USER_RE = new RegExp(`^${UUID}$`);
const GRANT_RE = /^[0-9a-zA-Z:_.-]{1,96}$/;
const XFER_RE = new RegExp(`^${UUID}:loadout_trade$`);
const ITEM_RE = new RegExp(`^${UUID}$`);
const MOVES_MAX = 24;
const INFLIGHT_MAX = 8;
const isOwner = (o) => typeof o === 'string' && OWNER_RE.test(o);
const ACCOUNT_OWNER_RE = new RegExp(`^a:${UUID}$`);
const isAccountOwner = (o) => typeof o === 'string' && ACCOUNT_OWNER_RE.test(o);
const isItemId = (id) => typeof id === 'string' && ITEM_RE.test(id);
const userOf = (owner) => (owner.startsWith('a:') ? owner.slice(2) : null);
const asJson = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
const nowMs = (v) => new Date(v).getTime();
const cleanPrice = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= AUCTION.PRICE_MIN && n <= AUCTION.PRICE_MAX ? n : 0;
};
const marketErr = (code, message = code) => Object.assign(new Error(message), { code });
const notOwned = (owner, item) => Object.assign(new Error(`${owner} does not own loadout item ${item}`), { code: 'not_owned' });

export const ownerKey = (accountId, guestId) => {
  if (typeof accountId === 'string' && USER_RE.test(accountId)) return `a:${accountId}`;
  if (typeof guestId === 'string' && USER_RE.test(guestId)) return `g:${idKey(guestId)}`;
  return '';
};

function coll(items, slots) {
  const ids = new Set(items.map((it) => it.id));
  return { items, slots: cleanLoadoutSlots(slots, ids) };
}

function rowsToColl(itemRows, slotRows) {
  return coll(
    itemRows
      .map((r) => ({ id: r.id, catalog: r.catalog_id, source: asJson(r.source) || {}, acquiredAt: new Date(r.acquired_at).getTime() }))
      .filter((it) => loadoutDef(it.catalog))
      .sort((a, b) => a.acquiredAt - b.acquiredAt || a.id.localeCompare(b.id)),
    Array.from({ length: LOADOUT_SLOTS }, (_, slot) => slotRows.find((r) => r.slot === slot)?.item_id || null)
  );
}

function rowToListing(r) {
  if (!r) return null;
  const def = loadoutDef(r.catalog_id);
  if (!def) return null;
  return {
    id: r.id,
    itemId: r.item_id,
    sellerName: r.seller_name || '',
    catalog: r.catalog_id,
    price: r.price,
    status: r.status,
    createdAt: nowMs(r.created_at),
    expiresAt: nowMs(r.expires_at),
    closedAt: r.closed_at ? nowMs(r.closed_at) : 0,
  };
}

// ---------------------------------------------------------------- Postgres
export class PgLoadoutStore {
  constructor(db) {
    this.db = db;
  }

  async load(owner) {
    const [items, slots] = await Promise.all([
      this.db.query(
        `SELECT id, catalog_id, source, acquired_at
           FROM loadout_items li
          WHERE owner = $1
            AND NOT EXISTS (SELECT 1 FROM loadout_auction_listings al WHERE al.item_id = li.id AND al.status = 'active')
          ORDER BY acquired_at, id`,
        [owner]
      ),
      this.db.query('SELECT slot, item_id FROM loadout_slots WHERE owner = $1 ORDER BY slot', [owner]),
    ]);
    return rowsToColl(items.rows, slots.rows);
  }

  async grant({ id, owner, catalog, source = {} }) {
    const itemId = randomUUID();
    const res = await this.db.tx(async (t) => {
      const fresh = (await t.query('INSERT INTO loadout_ledger (id, kind, entries) VALUES ($1, $2, $3::jsonb) ON CONFLICT (id) DO NOTHING RETURNING id', [id, 'grant', JSON.stringify([{ owner, catalog, source }])])).rows.length > 0;
      let granted = null;
      if (fresh) {
        const r = await t.query(
          `INSERT INTO loadout_items (id, owner, user_id, catalog_id, source)
             SELECT $1, $2, $3::uuid, $4, $5::jsonb
              WHERE $3::uuid IS NULL OR EXISTS (SELECT 1 FROM users WHERE id = $3::uuid)
           RETURNING id, catalog_id, source, acquired_at`,
          [itemId, owner, userOf(owner), catalog, JSON.stringify(source)]
        );
        granted = r.rows[0] ? rowsToColl(r.rows, []).items[0] : null;
      }
      return { fresh, granted };
    });
    return { ...res, ...(await this.load(owner)) };
  }

  async transfer({ id, kind, moves }) {
    const owners = [...new Set(moves.flatMap((m) => [m[0], m[1]]))];
    const res = await this.db.tx(async (t) => {
      const fresh = (await t.query('INSERT INTO loadout_ledger (id, kind, entries) VALUES ($1, $2, $3::jsonb) ON CONFLICT (id) DO NOTHING RETURNING id', [id, kind, JSON.stringify(moves)])).rows.length > 0;
      const moved = [];
      if (fresh) {
        for (const [from, to, item] of moves) {
          const r = await t.query(
            `UPDATE loadout_items
                SET owner = $2, user_id = $3::uuid, updated_at = now()
              WHERE id = $1 AND owner = $4
                AND ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM users WHERE id = $3::uuid))
                AND NOT EXISTS (SELECT 1 FROM loadout_auction_listings al WHERE al.item_id = loadout_items.id AND al.status = 'active')
              RETURNING id`,
            [item, to, userOf(to), from]
          );
          if (!r.rowCount) throw notOwned(from, item);
          moved.push(item);
        }
        if (moved.length) await t.query('DELETE FROM loadout_slots WHERE item_id = ANY($1::uuid[])', [moved]);
      }
      return { fresh };
    });
    const colls = {};
    for (const owner of owners) colls[owner] = await this.load(owner);
    return { ...res, colls };
  }

  async saveSlots(owner, slots) {
    await this.db.tx(async (t) => {
      const owned = new Set(
        (
          await t.query(
            `SELECT id
               FROM loadout_items li
              WHERE owner = $1
                AND NOT EXISTS (SELECT 1 FROM loadout_auction_listings al WHERE al.item_id = li.id AND al.status = 'active')`,
            [owner]
          )
        ).rows.map((r) => r.id)
      );
      const clean = cleanLoadoutSlots(slots, owned);
      await t.query('DELETE FROM loadout_slots WHERE owner = $1', [owner]);
      for (let slot = 0; slot < LOADOUT_SLOTS; slot++) {
        if (!clean[slot]) continue;
        await t.query('INSERT INTO loadout_slots (owner, user_id, slot, item_id) VALUES ($1, $2::uuid, $3, $4::uuid)', [owner, userOf(owner), slot, clean[slot]]);
      }
    });
    return this.load(owner);
  }

  async balance(owner) {
    if (!isOwner(owner)) return 0;
    return (await this.db.query('SELECT balance FROM loadout_skull_balances WHERE owner = $1', [owner])).rows[0]?.balance || 0;
  }
  async balanceIn(t, owner) {
    return (await t.query('SELECT balance FROM loadout_skull_balances WHERE owner = $1', [owner])).rows[0]?.balance || 0;
  }

  async applySkulls(t, id, kind, entries, meta = {}) {
    const clean = entries
      .map((e) => ({ owner: e.owner, delta: e.delta | 0 }))
      .filter((e) => isOwner(e.owner) && e.delta !== 0);
    const fresh = (await t.query('INSERT INTO loadout_skull_ledger (id, kind, meta) VALUES ($1, $2, $3::jsonb) ON CONFLICT (id) DO NOTHING RETURNING id', [id, kind, JSON.stringify(meta)])).rows.length > 0;
    if (!fresh) return { fresh: false };
    for (const e of clean) {
      await t.query('INSERT INTO loadout_skull_entries (ledger_id, owner, user_id, delta) VALUES ($1, $2, $3::uuid, $4)', [id, e.owner, userOf(e.owner), e.delta]);
      if (e.delta > 0) {
        await t.query(
          `INSERT INTO loadout_skull_balances (owner, user_id, balance)
             SELECT $1, $2::uuid, $3 WHERE $2::uuid IS NULL OR EXISTS (SELECT 1 FROM users WHERE id = $2::uuid)
           ON CONFLICT (owner) DO UPDATE SET balance = loadout_skull_balances.balance + EXCLUDED.balance, updated_at = now()`,
          [e.owner, userOf(e.owner), e.delta]
        );
      } else {
        const r = await t.query('UPDATE loadout_skull_balances SET balance = balance + $2, updated_at = now() WHERE owner = $1 AND balance >= $3', [e.owner, e.delta, -e.delta]);
        if (!r.rowCount) throw marketErr('insufficient_skulls', 'Not enough Zombie Skulls.');
      }
    }
    return { fresh: true };
  }

  async earnSkulls({ id, owner, amount, source = {}, cap = SKULL_EARN.HOURLY_CAP }) {
    amount = Math.max(0, amount | 0);
    if (!isOwner(owner) || !GRANT_RE.test(String(id || '')) || amount <= 0) return { fresh: false, amount: 0, balance: await this.balance(owner) };
    return this.db.tx(async (t) => {
      const fresh = (await t.query('INSERT INTO loadout_skull_ledger (id, kind, meta) VALUES ($1, $2, $3::jsonb) ON CONFLICT (id) DO NOTHING RETURNING id', [id, 'earn', JSON.stringify({ source, requested: amount, cap })])).rows.length > 0;
      if (!fresh) return { fresh: false, amount: 0, balance: await this.balanceIn(t, owner) };
      const earned =
        (
          await t.query(
            `SELECT COALESCE(sum(e.delta), 0) AS n
               FROM loadout_skull_entries e
               JOIN loadout_skull_ledger l ON l.id = e.ledger_id
              WHERE e.owner = $1 AND e.delta > 0 AND l.kind = 'earn' AND l.at > now() - make_interval(secs => 3600)`,
            [owner]
          )
        ).rows[0]?.n || 0;
      const grant = Math.max(0, Math.min(amount, cap - earned));
      if (grant > 0) {
        await t.query('INSERT INTO loadout_skull_entries (ledger_id, owner, user_id, delta) VALUES ($1, $2, $3::uuid, $4)', [id, owner, userOf(owner), grant]);
        await t.query(
          `INSERT INTO loadout_skull_balances (owner, user_id, balance)
             SELECT $1, $2::uuid, $3 WHERE $2::uuid IS NULL OR EXISTS (SELECT 1 FROM users WHERE id = $2::uuid)
           ON CONFLICT (owner) DO UPDATE SET balance = loadout_skull_balances.balance + EXCLUDED.balance, updated_at = now()`,
          [owner, userOf(owner), grant]
        );
      }
      return { fresh: true, amount: grant, balance: await this.balanceIn(t, owner) };
    });
  }

  async listItem(owner, itemId, price, listingId = randomUUID()) {
    if (!isAccountOwner(owner)) throw marketErr('guest_market', 'Sign in to use the auction house.');
    if (!USER_RE.test(String(itemId || '')) || !USER_RE.test(String(listingId || ''))) throw marketErr('bad_listing', 'That listing is not valid.');
    price = cleanPrice(price);
    if (!price) throw marketErr('bad_price', `Pick a price from ${AUCTION.PRICE_MIN} to ${AUCTION.PRICE_MAX} Zombie Skulls.`);
    try {
      const row = await this.db.tx(async (t) => {
        const item = (await t.query('SELECT id, owner, catalog_id FROM loadout_items WHERE id = $1 FOR UPDATE', [itemId])).rows[0];
        if (!item || item.owner !== owner || !loadoutDef(item.catalog_id)) throw marketErr('not_owned', 'You do not own that item.');
        const active = (await t.query("SELECT id FROM loadout_auction_listings WHERE item_id = $1 AND status = 'active'", [itemId])).rows[0];
        if (active) throw marketErr('listed', 'That item is already listed.');
        await t.query('INSERT INTO loadout_ledger (id, kind, entries) VALUES ($1, $2, $3::jsonb) ON CONFLICT (id) DO NOTHING', [`auction:list:${listingId}`, 'auction_list', JSON.stringify([{ owner, item: itemId, price }])]);
        await t.query('DELETE FROM loadout_slots WHERE item_id = $1', [itemId]);
        const r = await t.query(
          `INSERT INTO loadout_auction_listings (id, item_id, seller, seller_user_id, catalog_id, price, expires_at, ledger_id)
             VALUES ($1, $2, $3, $4::uuid, $5, $6, now() + make_interval(days => $7), $8)
           RETURNING *`,
          [listingId, itemId, owner, userOf(owner), item.catalog_id, price, AUCTION.LISTING_DAYS, `auction:list:${listingId}`]
        );
        return r.rows[0];
      });
      return rowToListing(row);
    } catch (err) {
      if (err.code === '23505') throw marketErr('listed', 'That item is already listed.');
      throw err;
    }
  }

  async cancelListing(owner, listingId) {
    if (!isAccountOwner(owner)) throw marketErr('guest_market', 'Sign in to use the auction house.');
    if (!USER_RE.test(String(listingId || ''))) throw marketErr('bad_listing', 'That listing is not valid.');
    const row = await this.db.tx(async (t) => {
      const listing = (await t.query("SELECT * FROM loadout_auction_listings WHERE id = $1 AND status = 'active' FOR UPDATE", [listingId])).rows[0];
      if (!listing || listing.seller !== owner) throw marketErr('not_listing_owner', 'That active listing is not yours.');
      await t.query('INSERT INTO loadout_ledger (id, kind, entries) VALUES ($1, $2, $3::jsonb) ON CONFLICT (id) DO NOTHING', [`auction:cancel:${listingId}`, 'auction_cancel', JSON.stringify([{ owner, item: listing.item_id }])]);
      return (
        await t.query("UPDATE loadout_auction_listings SET status = 'cancelled', closed_at = now(), ledger_id = $2 WHERE id = $1 RETURNING *", [listingId, `auction:cancel:${listingId}`])
      ).rows[0];
    });
    return rowToListing(row);
  }

  async expireListings(limit = 100) {
    return this.db.tx(async (t) => {
      const rows = (await t.query("SELECT * FROM loadout_auction_listings WHERE status = 'active' AND expires_at <= now() ORDER BY expires_at, id LIMIT $1 FOR UPDATE", [limit])).rows;
      for (const r of rows) {
        const ledger = `auction:expire:${r.id}`;
        await t.query('INSERT INTO loadout_ledger (id, kind, entries) VALUES ($1, $2, $3::jsonb) ON CONFLICT (id) DO NOTHING', [ledger, 'auction_expire', JSON.stringify([{ owner: r.seller, item: r.item_id }])]);
        await t.query("UPDATE loadout_auction_listings SET status = 'expired', closed_at = now(), ledger_id = $2 WHERE id = $1 AND status = 'active'", [r.id, ledger]);
      }
      return rows.length;
    });
  }

  async auctionListings(owner = '') {
    const active = await this.db.query(
      `SELECT al.*, u.username AS seller_name
         FROM loadout_auction_listings al
         LEFT JOIN users u ON u.id = al.seller_user_id
        WHERE al.status = 'active' AND al.expires_at > now()
        ORDER BY al.created_at DESC, al.id DESC
        LIMIT $1`,
      [AUCTION.PAGE_SIZE]
    );
    const mine = isAccountOwner(owner)
      ? await this.db.query('SELECT * FROM loadout_auction_listings WHERE seller = $1 ORDER BY created_at DESC LIMIT $2', [owner, AUCTION.PAGE_SIZE])
      : { rows: [] };
    return { listings: active.rows.map(rowToListing).filter(Boolean), mine: mine.rows.map(rowToListing).filter(Boolean) };
  }

  async buyListing(owner, listingId) {
    if (!isAccountOwner(owner)) throw marketErr('guest_market', 'Sign in to buy from the auction house.');
    if (!USER_RE.test(String(listingId || ''))) throw marketErr('bad_listing', 'That listing is not valid.');
    return this.db.tx(async (t) => {
      const listing = (await t.query("SELECT * FROM loadout_auction_listings WHERE id = $1 AND status = 'active' FOR UPDATE", [listingId])).rows[0];
      if (!listing) throw marketErr('sold', 'That listing is no longer available.');
      if (new Date(listing.expires_at).getTime() <= Date.now()) {
        const ledger = `auction:expire:${listing.id}`;
        await t.query('INSERT INTO loadout_ledger (id, kind, entries) VALUES ($1, $2, $3::jsonb) ON CONFLICT (id) DO NOTHING', [ledger, 'auction_expire', JSON.stringify([{ owner: listing.seller, item: listing.item_id }])]);
        await t.query("UPDATE loadout_auction_listings SET status = 'expired', closed_at = now(), ledger_id = $2 WHERE id = $1 AND status = 'active'", [listing.id, ledger]);
        throw marketErr('expired', 'That listing has expired.');
      }
      if (listing.seller === owner) throw marketErr('own_listing', 'You cannot buy your own listing.');
      const item = (await t.query('SELECT id FROM loadout_items WHERE id = $1 FOR UPDATE', [listing.item_id])).rows[0];
      if (!item) throw marketErr('sold', 'That item is gone.');
      const owners = [owner, listing.seller].sort();
      for (const o of owners) {
        await t.query(
          `INSERT INTO loadout_skull_balances (owner, user_id, balance)
             SELECT $1, $2::uuid, 0 WHERE $2::uuid IS NULL OR EXISTS (SELECT 1 FROM users WHERE id = $2::uuid)
           ON CONFLICT (owner) DO NOTHING`,
          [o, userOf(o)]
        );
      }
      await t.query('SELECT owner FROM loadout_skull_balances WHERE owner = ANY($1::text[]) FOR UPDATE', [owners]);
      const fee = auctionFee(listing.price);
      const net = listing.price - fee;
      const ledger = `auction:buy:${listing.id}`;
      await this.applySkulls(t, ledger, 'auction_buy', [{ owner, delta: -listing.price }, { owner: listing.seller, delta: net }], { listing: listing.id, item: listing.item_id, price: listing.price, fee });
      await t.query('INSERT INTO loadout_ledger (id, kind, entries) VALUES ($1, $2, $3::jsonb) ON CONFLICT (id) DO NOTHING', [ledger, 'auction_buy', JSON.stringify([{ from: listing.seller, to: owner, item: listing.item_id, price: listing.price, fee }])]);
      await t.query('DELETE FROM loadout_slots WHERE item_id = $1', [listing.item_id]);
      await t.query('UPDATE loadout_items SET owner = $1, user_id = $2::uuid, updated_at = now() WHERE id = $3', [owner, userOf(owner), listing.item_id]);
      const sold = (
        await t.query("UPDATE loadout_auction_listings SET status = 'sold', buyer = $2, buyer_user_id = $3::uuid, closed_at = now(), ledger_id = $4 WHERE id = $1 RETURNING *", [listing.id, owner, userOf(owner), ledger])
      ).rows[0];
      return { listing: rowToListing(sold), balance: await this.balanceIn(t, owner), sellerBalance: await this.balanceIn(t, listing.seller), fee };
    });
  }

  async mergeGuest(account, guest) {
    return this.db.tx(async (t) => {
      const moved = (await t.query('UPDATE loadout_items SET owner = $1, user_id = $2::uuid, updated_at = now() WHERE owner = $3 RETURNING id', [account, userOf(account), guest])).rows.map((r) => r.id);
      const guestSlots = (await t.query('DELETE FROM loadout_slots WHERE owner = $1 RETURNING slot, item_id', [guest])).rows;
      if (guestSlots.length) {
        const taken = new Set((await t.query('SELECT slot FROM loadout_slots WHERE owner = $1', [account])).rows.map((r) => r.slot));
        const free = [...Array(LOADOUT_SLOTS).keys()].filter((s) => !taken.has(s));
        for (const row of guestSlots.sort((a, b) => a.slot - b.slot)) {
          if (!moved.includes(row.item_id)) continue;
          const slot = free.shift();
          if (slot === undefined) break;
          await t.query('INSERT INTO loadout_slots (owner, user_id, slot, item_id) VALUES ($1, $2::uuid, $3, $4::uuid) ON CONFLICT (owner, slot) DO NOTHING', [account, userOf(account), slot, row.item_id]);
        }
      }
      let skulls = 0;
      const gb = (await t.query('DELETE FROM loadout_skull_balances WHERE owner = $1 RETURNING balance', [guest])).rows[0]?.balance || 0;
      if (gb > 0) {
        const id = `guest-merge:${guest}:${account}`;
        const fresh = (await t.query('INSERT INTO loadout_skull_ledger (id, kind, meta) VALUES ($1, $2, $3::jsonb) ON CONFLICT (id) DO NOTHING RETURNING id', [id, 'guest_merge', JSON.stringify({ guest, account })])).rows.length > 0;
        if (fresh) {
          await t.query('INSERT INTO loadout_skull_entries (ledger_id, owner, user_id, delta) VALUES ($1, $2, NULL, $3), ($1, $4, $5::uuid, $6)', [id, guest, -gb, account, userOf(account), gb]);
          await t.query(
            `INSERT INTO loadout_skull_balances (owner, user_id, balance) VALUES ($1, $2::uuid, $3)
             ON CONFLICT (owner) DO UPDATE SET balance = loadout_skull_balances.balance + EXCLUDED.balance, updated_at = now()`,
            [account, userOf(account), gb]
          );
          skulls = gb;
        }
      }
      return { items: moved.length, slots: guestSlots.length, skulls };
    });
  }
}

// ---------------------------------------------------------------- memory
export class MemoryLoadoutStore {
  constructor() {
    this.items = new Map(); // id -> { id, owner, catalog, source, acquiredAt }
    this.slots = new Map(); // owner -> [item id|null]
    this.ledger = new Set();
    this.skulls = new Map(); // owner -> balance
    this.skullLedger = new Map(); // id -> { kind, entries, at }
    this.listings = new Map(); // id -> listing
    this.accounts = null;
  }
  exists(owner) {
    return !owner.startsWith('a:') || !this.accounts || this.accounts.has(owner.slice(2));
  }
  async load(owner) {
    const listed = new Set([...this.listings.values()].filter((l) => l.status === 'active').map((l) => l.itemId));
    const items = [...this.items.values()].filter((it) => it.owner === owner && !listed.has(it.id)).sort((a, b) => a.acquiredAt - b.acquiredAt || a.id.localeCompare(b.id));
    return coll(
      items.map(({ id, catalog, source, acquiredAt }) => ({ id, catalog, source: { ...source }, acquiredAt })),
      this.slots.get(owner) || []
    );
  }
  async grant({ id, owner, catalog, source = {} }) {
    const fresh = !this.ledger.has(id);
    let granted = null;
    if (fresh) {
      this.ledger.add(id);
      if (this.exists(owner)) {
        granted = { id: randomUUID(), owner, catalog, source: { ...source }, acquiredAt: Date.now() };
        this.items.set(granted.id, granted);
      }
    }
    return { fresh, granted: granted && { id: granted.id, catalog, source: { ...granted.source }, acquiredAt: granted.acquiredAt }, ...(await this.load(owner)) };
  }
  async transfer({ id, kind, moves }) {
    const owners = [...new Set(moves.flatMap((m) => [m[0], m[1]]))];
    const fresh = !this.ledger.has(id);
    if (fresh) {
      const listed = new Set([...this.listings.values()].filter((l) => l.status === 'active').map((l) => l.itemId));
      for (const [from, , item] of moves) {
        const it = this.items.get(item);
        if (!it || it.owner !== from || listed.has(item)) throw notOwned(from, item);
      }
      this.ledger.add(id);
      for (const [, to, item] of moves) {
        const it = this.items.get(item);
        it.owner = to;
      }
      const moved = new Set(moves.map((m) => m[2]));
      for (const [owner, slots] of this.slots) this.slots.set(owner, slots.map((item) => (moved.has(item) ? null : item)));
    }
    const colls = {};
    for (const owner of owners) colls[owner] = await this.load(owner);
    return { fresh, colls };
  }
  async saveSlots(owner, slots) {
    const listed = new Set([...this.listings.values()].filter((l) => l.status === 'active').map((l) => l.itemId));
    const owned = new Set([...this.items.values()].filter((it) => it.owner === owner && !listed.has(it.id)).map((it) => it.id));
    this.slots.set(owner, cleanLoadoutSlots(slots, owned));
    return this.load(owner);
  }
  async balance(owner) {
    return this.skulls.get(owner) || 0;
  }
  applySkullEntries(id, kind, entries, meta = {}) {
    if (this.skullLedger.has(id)) return { fresh: false };
    const clean = entries.map((e) => ({ owner: e.owner, delta: e.delta | 0 })).filter((e) => isOwner(e.owner) && e.delta !== 0);
    for (const e of clean) if (e.delta < 0 && (this.skulls.get(e.owner) || 0) < -e.delta) throw marketErr('insufficient_skulls', 'Not enough Zombie Skulls.');
    for (const e of clean) this.skulls.set(e.owner, (this.skulls.get(e.owner) || 0) + e.delta);
    this.skullLedger.set(id, { kind, entries: clean, meta: { ...meta }, at: Date.now() });
    return { fresh: true };
  }
  async earnSkulls({ id, owner, amount, source = {}, cap = SKULL_EARN.HOURLY_CAP }) {
    amount = Math.max(0, amount | 0);
    if (!isOwner(owner) || !GRANT_RE.test(String(id || '')) || amount <= 0) return { fresh: false, amount: 0, balance: await this.balance(owner) };
    if (this.skullLedger.has(id)) return { fresh: false, amount: 0, balance: await this.balance(owner) };
    const since = Date.now() - 3600_000;
    let earned = 0;
    for (const l of this.skullLedger.values()) if (l.kind === 'earn' && l.at > since) for (const e of l.entries) if (e.owner === owner && e.delta > 0) earned += e.delta;
    const grant = Math.max(0, Math.min(amount, cap - earned));
    this.applySkullEntries(id, 'earn', grant > 0 ? [{ owner, delta: grant }] : [], { source: { ...source }, requested: amount, cap });
    return { fresh: true, amount: grant, balance: await this.balance(owner) };
  }
  listingView(l) {
    return l && loadoutDef(l.catalog)
      ? { id: l.id, itemId: l.itemId, sellerName: l.sellerName || '', catalog: l.catalog, price: l.price, status: l.status, createdAt: l.createdAt, expiresAt: l.expiresAt, closedAt: l.closedAt || 0 }
      : null;
  }
  async listItem(owner, itemId, price, listingId = randomUUID()) {
    if (!isAccountOwner(owner)) throw marketErr('guest_market', 'Sign in to use the auction house.');
    if (!USER_RE.test(String(itemId || '')) || !USER_RE.test(String(listingId || ''))) throw marketErr('bad_listing', 'That listing is not valid.');
    price = cleanPrice(price);
    if (!price) throw marketErr('bad_price', `Pick a price from ${AUCTION.PRICE_MIN} to ${AUCTION.PRICE_MAX} Zombie Skulls.`);
    const it = this.items.get(itemId);
    if (!it || it.owner !== owner || !loadoutDef(it.catalog)) throw marketErr('not_owned', 'You do not own that item.');
    if ([...this.listings.values()].some((l) => l.itemId === itemId && l.status === 'active')) throw marketErr('listed', 'That item is already listed.');
    const slots = this.slots.get(owner);
    if (slots) this.slots.set(owner, slots.map((id) => (id === itemId ? null : id)));
    const at = Date.now();
    const l = { id: listingId, itemId, seller: owner, sellerName: '', catalog: it.catalog, price, status: 'active', createdAt: at, expiresAt: at + AUCTION.LISTING_DAYS * 86400_000, closedAt: 0, ledgerId: `auction:list:${listingId}` };
    this.ledger.add(l.ledgerId);
    this.listings.set(l.id, l);
    return this.listingView(l);
  }
  async cancelListing(owner, listingId) {
    if (!isAccountOwner(owner)) throw marketErr('guest_market', 'Sign in to use the auction house.');
    const l = this.listings.get(listingId);
    if (!l || l.status !== 'active' || l.seller !== owner) throw marketErr('not_listing_owner', 'That active listing is not yours.');
    l.status = 'cancelled';
    l.closedAt = Date.now();
    l.ledgerId = `auction:cancel:${listingId}`;
    this.ledger.add(l.ledgerId);
    return this.listingView(l);
  }
  async expireListings(limit = 100) {
    const now = Date.now();
    let n = 0;
    for (const l of [...this.listings.values()].sort((a, b) => a.expiresAt - b.expiresAt || a.id.localeCompare(b.id))) {
      if (n >= limit) break;
      if (l.status !== 'active' || l.expiresAt > now) continue;
      l.status = 'expired';
      l.closedAt = now;
      l.ledgerId = `auction:expire:${l.id}`;
      this.ledger.add(l.ledgerId);
      n++;
    }
    return n;
  }
  async auctionListings(owner = '') {
    const now = Date.now();
    const listings = [...this.listings.values()]
      .filter((l) => l.status === 'active' && l.expiresAt > now)
      .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
      .slice(0, AUCTION.PAGE_SIZE)
      .map((l) => this.listingView(l))
      .filter(Boolean);
    const mine = isAccountOwner(owner)
      ? [...this.listings.values()]
          .filter((l) => l.seller === owner)
          .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
          .slice(0, AUCTION.PAGE_SIZE)
          .map((l) => this.listingView(l))
          .filter(Boolean)
      : [];
    return { listings, mine };
  }
  async buyListing(owner, listingId) {
    if (!isAccountOwner(owner)) throw marketErr('guest_market', 'Sign in to buy from the auction house.');
    const l = this.listings.get(listingId);
    if (!l || l.status !== 'active') throw marketErr('sold', 'That listing is no longer available.');
    if (l.expiresAt <= Date.now()) {
      await this.expireListings();
      throw marketErr('expired', 'That listing has expired.');
    }
    if (l.seller === owner) throw marketErr('own_listing', 'You cannot buy your own listing.');
    const it = this.items.get(l.itemId);
    if (!it) throw marketErr('sold', 'That item is gone.');
    const fee = auctionFee(l.price);
    const net = l.price - fee;
    const ledger = `auction:buy:${l.id}`;
    this.applySkullEntries(ledger, 'auction_buy', [{ owner, delta: -l.price }, { owner: l.seller, delta: net }], { listing: l.id, item: l.itemId, price: l.price, fee });
    it.owner = owner;
    l.status = 'sold';
    l.closedAt = Date.now();
    l.buyer = owner;
    l.ledgerId = ledger;
    for (const o of [l.seller, owner]) {
      const slots = this.slots.get(o);
      if (slots) this.slots.set(o, slots.map((id) => (id === l.itemId ? null : id)));
    }
    this.ledger.add(ledger);
    return { listing: this.listingView(l), balance: await this.balance(owner), sellerBalance: await this.balance(l.seller), fee };
  }
  async mergeGuest(account, guest) {
    let items = 0;
    const moved = new Set();
    for (const it of this.items.values()) {
      if (it.owner !== guest) continue;
      it.owner = account;
      moved.add(it.id);
      items++;
    }
    const guestSlots = this.slots.get(guest) || [];
    this.slots.delete(guest);
    const slots = this.slots.get(account) || Array(LOADOUT_SLOTS).fill(null);
    const free = [...Array(LOADOUT_SLOTS).keys()].filter((s) => !slots[s]);
    let nslots = 0;
    for (const id of guestSlots) {
      if (!id || !moved.has(id)) continue;
      const slot = free.shift();
      if (slot === undefined) break;
      slots[slot] = id;
      nslots++;
    }
    this.slots.set(account, slots);
    let skulls = 0;
    const gb = this.skulls.get(guest) || 0;
    if (gb > 0) {
      const id = `guest-merge:${guest}:${account}`;
      if (!this.skullLedger.has(id)) {
        const movedAt = Date.now();
        this.skulls.delete(guest);
        this.skulls.set(account, (this.skulls.get(account) || 0) + gb);
        this.skullLedger.set(id, { kind: 'guest_merge', entries: [{ owner: guest, delta: -gb }, { owner: account, delta: gb }], meta: { guest, account }, at: movedAt });
        skulls = gb;
      }
    }
    return { items, slots: nslots, skulls };
  }
}

// ---------------------------------------------------------------- service
export class LoadoutService {
  constructor({ store, log = () => {}, changed = null } = {}) {
    this.store = store;
    this.log = log;
    this.changed = changed;
    this.queue = Promise.resolve();
    this.cache = new Map(); // owner -> { items, slots, state, rooms }
    this.rooms = new Map(); // room -> Map(owner -> count)
    this.inflight = new WeakMap(); // room -> count of loadout transfers under way
    this.closed = false;
  }
  run(job) {
    const p = this.queue.then(job);
    this.queue = p.catch(() => {});
    return p;
  }
  tell(room, m) {
    if (!room.closed) {
      try {
        room.worker.postMessage(m);
      } catch {}
    }
  }
  msg(owner, c) {
    return { t: 'loadout', op: 'coll', owner, ok: c.state === 'ok', items: c.items, slots: c.slots };
  }
  broadcast(owner) {
    const c = this.cache.get(owner);
    if (!c || c.state === 'loading') return;
    const m = this.msg(owner, c);
    for (const room of c.rooms) this.tell(room, m);
  }
  async collection(owner) {
    if (!isOwner(owner)) return coll([], []);
    return this.run(async () => {
      await this.store.expireListings();
      return this.store.load(owner);
    });
  }
  async profile(owner) {
    if (!isOwner(owner)) return { ...coll([], []), balance: 0 };
    return this.run(async () => {
      await this.store.expireListings();
      return { ...(await this.store.load(owner)), balance: await this.store.balance(owner) };
    });
  }
  async equip(owner, slots) {
    if (!isOwner(owner)) return coll([], []);
    const got = await this.run(async () => {
      await this.store.expireListings();
      return this.store.saveSlots(owner, slots);
    });
    this.update(owner, got);
    this.changed?.([owner]);
    return got;
  }
  async balance(owner) {
    if (!isOwner(owner)) return 0;
    return this.run(() => this.store.balance(owner));
  }
  async earnSkulls(owner, amount, source = {}, id = randomUUID()) {
    if (!isOwner(owner) || !GRANT_RE.test(id) || (amount | 0) <= 0) return null;
    const got = await this.run(() => this.store.earnSkulls({ id, owner, amount, source }));
    if (got?.fresh && got.amount > 0) this.changed?.([owner]);
    return got;
  }
  async auction(owner = '') {
    await this.run(() => this.store.expireListings());
    const got = await this.run(() => this.store.auctionListings(owner));
    return { ...got, balance: isOwner(owner) ? await this.balance(owner) : 0, canTrade: isAccountOwner(owner) };
  }
  async listItem(owner, itemId, price) {
    const got = await this.run(async () => {
      await this.store.expireListings();
      return this.store.listItem(owner, itemId, price);
    });
    this.reload([owner]);
    this.changed?.([owner]);
    return got;
  }
  async cancelListing(owner, listingId) {
    const got = await this.run(() => this.store.cancelListing(owner, listingId));
    this.reload([owner]);
    this.changed?.([owner]);
    return got;
  }
  async buyListing(owner, listingId) {
    const got = await this.run(async () => {
      await this.store.expireListings();
      return this.store.buyListing(owner, listingId);
    });
    const owners = [owner];
    this.reload(owners);
    if (owners.length) this.changed?.(owners);
    return got;
  }
  sweep() {
    return this.run(() => this.store.expireListings()).catch((err) => this.log(`loadout: auction expiry failed (${err.message})`));
  }
  async grant(owner, catalog, source = {}, id = randomUUID()) {
    if (!isOwner(owner) || !loadoutDef(catalog) || !GRANT_RE.test(id)) return null;
    const got = await this.run(() => this.store.grant({ id, owner, catalog, source }));
    this.update(owner, got);
    this.changed?.([owner]);
    return got;
  }
  update(owner, got) {
    const c = this.cache.get(owner);
    if (!c) return;
    c.items = got.items || [];
    c.slots = got.slots || Array(LOADOUT_SLOTS).fill(null);
    c.state = 'ok';
    this.broadcast(owner);
  }
  fromRoom(room, m) {
    try {
      if (this.closed || room.closed || !m || typeof m !== 'object') return;
      if (m.op === 'enter') return this.enter(room, m.owner);
      if (m.op === 'leave') return this.leave(room, m.owner);
      if (m.op === 'grant') return this.grantFromRoom(room, m);
      if (m.op === 'skulls') return this.skullsFromRoom(room, m);
      if (m.op === 'xfer') return this.xfer(room, m);
    } catch (err) {
      this.log(`loadout: a game's ${String(m?.op).slice(0, 12)} failed (${err.message})`);
    }
  }
  enter(room, owner) {
    if (!isOwner(owner)) return;
    let rs = this.rooms.get(room);
    if (!rs) this.rooms.set(room, (rs = new Map()));
    rs.set(owner, (rs.get(owner) || 0) + 1);
    let c = this.cache.get(owner);
    if (!c) {
      this.cache.set(owner, (c = { items: [], slots: Array(LOADOUT_SLOTS).fill(null), state: 'loading', rooms: new Set() }));
      this.fetch(owner, c);
    }
    c.rooms.add(room);
    if (c.state !== 'loading') this.tell(room, this.msg(owner, c));
  }
  leave(room, owner) {
    const rs = this.rooms.get(room);
    if (!rs?.has(owner)) return;
    const n = rs.get(owner) - 1;
    if (n > 0) return void rs.set(owner, n);
    rs.delete(owner);
    const c = this.cache.get(owner);
    if (c) {
      c.rooms.delete(room);
      if (!c.rooms.size) this.cache.delete(owner);
    }
  }
  fetch(owner, c = this.cache.get(owner)) {
    if (!c) return;
    this.run(() => this.store.load(owner)).then(
      (got) => {
        if (this.cache.get(owner) !== c) return;
        c.items = got.items;
        c.slots = got.slots;
        c.state = 'ok';
        this.broadcast(owner);
      },
      (err) => {
        if (this.cache.get(owner) !== c) return;
        c.state = 'failed';
        this.log(`loadout: a collection could not be read (${err.message})`);
        this.broadcast(owner);
      }
    );
  }
  grantFromRoom(room, m) {
    const rs = this.rooms.get(room);
    if (!isOwner(m.owner) || !rs?.has(m.owner) || !loadoutDef(m.catalog) || !GRANT_RE.test(String(m.id || ''))) return;
    this.grant(m.owner, m.catalog, m.source || {}, m.id).catch((err) => this.log(`loadout: grant failed (${err.message})`));
  }
  skullsFromRoom(room, m) {
    const rs = this.rooms.get(room);
    const amount = m.amount | 0;
    if (!isOwner(m.owner) || !rs?.has(m.owner) || amount <= 0 || amount > SKULL_EARN.HOURLY_CAP || !GRANT_RE.test(String(m.id || ''))) return;
    this.earnSkulls(m.owner, amount, m.source || {}, m.id).catch((err) => this.log(`loadout: skull earn failed (${err.message})`));
  }
  xfer(room, m) {
    const id = typeof m.id === 'string' ? m.id : '';
    const rs = this.rooms.get(room);
    const refuse = (why) => {
      this.log(`loadout: a trade refused (${why})`);
      if (id.length <= 64) this.tell(room, { t: 'loadout', op: 'xfered', id, ok: false, why: 'refused' });
    };
    if (!XFER_RE.test(id) || m.kind !== 'trade' || !rs) return refuse('its id');
    const moves = m.moves;
    if (!Array.isArray(moves) || !moves.length || moves.length > MOVES_MAX) return refuse('its moves');
    const seen = new Set();
    for (const mv of moves) {
      if (!Array.isArray(mv) || mv.length !== 3) return refuse('a move');
      const [from, to, item] = mv;
      if (from === to || !isOwner(from) || !isOwner(to) || !rs.has(from) || !rs.has(to) || !isItemId(item) || seen.has(item)) return refuse('a move');
      seen.add(item);
    }
    const n = this.inflight.get(room) || 0;
    if (n >= INFLIGHT_MAX) return this.tell(room, { t: 'loadout', op: 'xfered', id, ok: false, why: 'busy' });
    const clean = moves.map((mv) => [...mv]);
    this.inflight.set(room, n + 1);
    this.run(() => this.store.transfer({ id, kind: 'trade', moves: clean })).then(
      (res) => {
        for (const [owner, got] of Object.entries(res.colls || {})) {
          this.update(owner, got);
          this.changed?.([owner]);
        }
        this.tell(room, { t: 'loadout', op: 'xfered', id, ok: true });
      },
      (err) => {
        const why = err.code === 'not_owned' ? 'not_owned' : 'store';
        if (why === 'store') this.log(`loadout: a trade failed (${err.message})`);
        this.tell(room, { t: 'loadout', op: 'xfered', id, ok: false, why });
      }
    ).finally(() => this.inflight.set(room, Math.max(0, (this.inflight.get(room) || 1) - 1)));
  }
  reload(owners) {
    for (const o of Array.isArray(owners) ? owners.slice(0, 64) : []) if (isOwner(o) && this.cache.has(o)) this.fetch(o);
  }
  roomGone(room) {
    const rs = this.rooms.get(room);
    if (!rs) return;
    for (const owner of rs.keys()) {
      const c = this.cache.get(owner);
      if (c) {
        c.rooms.delete(room);
        if (!c.rooms.size) this.cache.delete(owner);
      }
    }
    this.rooms.delete(room);
  }
  async mergeGuest(accountId, guestId) {
    const account = ownerKey(accountId, '');
    const guest = ownerKey('', guestId);
    if (!account || !guest) return { items: 0, slots: 0 };
    const got = await this.run(() => this.store.mergeGuest(account, guest));
    this.reload([account]);
    this.changed?.([account, guest]);
    return got;
  }
  async close() {
    this.closed = true;
    await this.queue.catch(() => {});
  }
}

