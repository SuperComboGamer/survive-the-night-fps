// Permanent loadout item collections (shared/loadout.js is the catalog): each owned copy has its own id, because later
// features will move individual copies between owners. The network thread keeps the store; games ask it for collections
// and grants through a small service, as Dead Hand does for cards.
import { randomUUID } from 'node:crypto';
import { idKey } from './stats.js';
import { LOADOUT_SLOTS, cleanLoadoutSlots, loadoutDef } from '../shared/loadout.js';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const OWNER_RE = new RegExp(`^(a:${UUID}|g:[0-9a-f]{64})$`);
const USER_RE = new RegExp(`^${UUID}$`);
const GRANT_RE = /^[0-9a-zA-Z:_.-]{1,96}$/;
const XFER_RE = new RegExp(`^${UUID}:loadout_trade$`);
const ITEM_RE = new RegExp(`^${UUID}$`);
const MOVES_MAX = 24;
const INFLIGHT_MAX = 8;
const isOwner = (o) => typeof o === 'string' && OWNER_RE.test(o);
const isItemId = (id) => typeof id === 'string' && ITEM_RE.test(id);
const userOf = (owner) => (owner.startsWith('a:') ? owner.slice(2) : null);
const asJson = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
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

// ---------------------------------------------------------------- Postgres
export class PgLoadoutStore {
  constructor(db) {
    this.db = db;
  }

  async load(owner) {
    const [items, slots] = await Promise.all([
      this.db.query('SELECT id, catalog_id, source, acquired_at FROM loadout_items WHERE owner = $1 ORDER BY acquired_at, id', [owner]),
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
      const owned = new Set((await t.query('SELECT id FROM loadout_items WHERE owner = $1', [owner])).rows.map((r) => r.id));
      const clean = cleanLoadoutSlots(slots, owned);
      await t.query('DELETE FROM loadout_slots WHERE owner = $1', [owner]);
      for (let slot = 0; slot < LOADOUT_SLOTS; slot++) {
        if (!clean[slot]) continue;
        await t.query('INSERT INTO loadout_slots (owner, user_id, slot, item_id) VALUES ($1, $2::uuid, $3, $4::uuid)', [owner, userOf(owner), slot, clean[slot]]);
      }
    });
    return this.load(owner);
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
      return { items: moved.length, slots: guestSlots.length };
    });
  }
}

// ---------------------------------------------------------------- memory
export class MemoryLoadoutStore {
  constructor() {
    this.items = new Map(); // id -> { id, owner, catalog, source, acquiredAt }
    this.slots = new Map(); // owner -> [item id|null]
    this.ledger = new Set();
    this.accounts = null;
  }
  exists(owner) {
    return !owner.startsWith('a:') || !this.accounts || this.accounts.has(owner.slice(2));
  }
  async load(owner) {
    const items = [...this.items.values()].filter((it) => it.owner === owner).sort((a, b) => a.acquiredAt - b.acquiredAt || a.id.localeCompare(b.id));
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
      for (const [from, , item] of moves) {
        const it = this.items.get(item);
        if (!it || it.owner !== from) throw notOwned(from, item);
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
    const owned = new Set([...this.items.values()].filter((it) => it.owner === owner).map((it) => it.id));
    this.slots.set(owner, cleanLoadoutSlots(slots, owned));
    return this.load(owner);
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
    return { items, slots: nslots };
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
    return this.run(() => this.store.load(owner));
  }
  async equip(owner, slots) {
    if (!isOwner(owner)) return coll([], []);
    const got = await this.run(() => this.store.saveSlots(owner, slots));
    this.update(owner, got);
    this.changed?.([owner]);
    return got;
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

