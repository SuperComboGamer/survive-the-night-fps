// Accounts' achievements, kept in Postgres (db/migrations/006_achievements.sql; the list and its rules are
// shared/achievements.js). The network thread's: the games post what an account earned (room-worker.js, rooms.js
// Room 'ach'), this adds it up and works out what it unlocked, and the room's game is told (Room.achieved).
//
// What comes in is queued per account and written every couple of seconds in one transaction, a statement per table
// for everybody (as dbstats.js writes the board): the counts added (the new totals come back and decide the counters),
// the feats, the friendships asked about (a revive of a stranger, a friend in the same game), and the unlocks -
// ON CONFLICT DO NOTHING ... RETURNING says which were new. A feat is written within SOON_MS, so its banner comes
// promptly. A write that fails is put back in the queue for the next one.
//
// The HTTP side (server/index.js): an account's record for its profile page (forUser), a friend's too, and a
// browser's guest record merged in when it signs in (merge: the greater of each count, every unlock of either). The
// merge is taken on trust - a browser can say anything - so it only ever reaches these two tables, never the board.
import { ACH_STATS, ACH_STAT_MAX, ACHIEVEMENTS, ACH_BY_ID, isFeat, sanitizeProgress } from '../shared/achievements.js';
import { HttpError } from './http.js';
import { Allowance } from './allowance.js';

const FLUSH_MS = 2000;
const SOON_MS = 120;
const DAY = 86400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const whole = (v) => (typeof v === 'number' && v > 0 ? Math.min(Math.floor(v), ACH_STAT_MAX) : 0);

const blank = () => ({ add: {}, feats: new Set(), strangers: new Set(), together: new Set(), day: false, rooms: new Set() });

export class AchievementStore {
  constructor({ db, log = () => {} }) {
    this.db = db;
    this.log = log;
    this.q = new Map(); // account id -> what came in for it since the last write (blank)
    this.flushing = null;
    this.soonT = null;
    this.merges = new Allowance(10, 30); // per account: guest records merged in (one per sign-in, near enough)
    this.timer = setInterval(() => this.flush().catch(() => {}), FLUSH_MS);
    this.timer.unref?.();
  }

  entry(userId, room) {
    const id = String(userId || '').toLowerCase();
    if (!UUID.test(id)) return null;
    let e = this.q.get(id);
    if (!e) this.q.set(id, (e = blank()));
    if (room) e.rooms.add(room);
    return e;
  }

  // ---------------------------------------------------------------- what the games say (rooms.js)
  // An account earned counts (stat -> n), feats (ids), and revived these accounts (strangers, unless they are friends)
  add(userId, add, feats, strangers, room) {
    const e = this.entry(userId, room);
    if (!e) return;
    for (const k of ACH_STATS) {
      const n = whole(add?.[k]);
      if (n) e.add[k] = Math.min(ACH_STAT_MAX, (e.add[k] || 0) + n);
    }
    for (const id of feats || []) if (isFeat(id)) e.feats.add(id);
    for (const u of strangers || []) if (UUID.test(u) && u !== userId) e.strangers.add(u);
    if (e.feats.size || e.strangers.size) this.soon();
  }

  // An account came into a game: another calendar day played on, if it is one
  played(userId, room) {
    const e = this.entry(userId, room);
    if (e) e.day = true;
  }

  // An account came into a game these accounts are in: a friend among them is Better Together, for both
  together(userId, others, room) {
    const e = this.entry(userId, room);
    if (!e) return;
    for (const u of others) if (UUID.test(u) && u !== userId) e.together.add(u);
    this.soon();
  }

  soon() {
    if (this.soonT) return;
    this.soonT = setTimeout(() => {
      this.soonT = null;
      this.flush().catch(() => {});
    }, SOON_MS);
    this.soonT.unref?.();
  }

  // ---------------------------------------------------------------- writing it
  async flush() {
    if (this.flushing) return this.flushing;
    if (!this.q.size) return;
    const batch = this.q;
    this.q = new Map();
    this.flushing = this.write(batch)
      .then(
        ({ unlocked, routes }) => {
          for (const [user, ids] of unlocked) for (const room of routes.get(user) || []) room.achieved?.(user, ids);
        },
        (err) => {
          this.log(`achievements: could not write ${batch.size} account(s) (${err.message}); trying again`);
          this.requeue(batch);
        }
      )
      .finally(() => {
        this.flushing = null;
        for (const e of this.q.values()) if (e.feats.size || e.strangers.size || e.together.size) return this.soon();
      });
    return this.flushing;
  }

  requeue(batch) {
    for (const [user, b] of batch) {
      const e = this.entry(user);
      for (const [k, n] of Object.entries(b.add)) e.add[k] = Math.min(ACH_STAT_MAX, (e.add[k] || 0) + n);
      for (const s of ['feats', 'strangers', 'together', 'rooms']) for (const x of b[s]) e[s].add(x);
      e.day ||= b.day;
    }
  }

  // -> { unlocked: Map(account -> [id] newly unlocked), routes: Map(account -> the rooms to tell) }
  async write(batch) {
    const unlocked = new Map();
    const routes = new Map();
    const route = (user, rooms) => {
      let r = routes.get(user);
      if (!r) routes.set(user, (r = new Set()));
      for (const room of rooms) r.add(room);
    };
    await this.db.tx(async (t) => {
      // a calendar day played on: the account's day mark moves forward, and the count of days with it
      const days = [...batch].filter(([, e]) => e.day).map(([u]) => u);
      if (days.length) {
        const r = await t.query(
          `INSERT INTO user_achievement_stats (user_id, stat, value)
             SELECT u::uuid, 'day_mark', $2 FROM jsonb_array_elements_text($1::jsonb) AS u
           ON CONFLICT (user_id, stat) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
             WHERE user_achievement_stats.value < EXCLUDED.value
           RETURNING user_id`,
          [JSON.stringify(days), Math.floor(Date.now() / DAY)]
        );
        for (const row of r.rows) {
          const e = batch.get(row.user_id);
          if (e) e.add.days = (e.add.days || 0) + 1;
        }
      }
      // the counts: added, and the totals back
      const rows = [];
      for (const [user, e] of batch) for (const k of ACH_STATS) if (e.add[k] > 0) rows.push({ user_id: user, stat: k, n: e.add[k] });
      const totals = new Map();
      if (rows.length) {
        const r = await t.query(
          `INSERT INTO user_achievement_stats (user_id, stat, value)
             SELECT user_id, stat, n FROM jsonb_to_recordset($1::jsonb) AS x(user_id uuid, stat text, n bigint)
           ON CONFLICT (user_id, stat) DO UPDATE SET value = LEAST(${ACH_STAT_MAX}, user_achievement_stats.value + EXCLUDED.value), updated_at = now()
           RETURNING user_id, stat, value`,
          [JSON.stringify(rows)]
        );
        for (const row of r.rows) {
          if (!totals.has(row.user_id)) totals.set(row.user_id, {});
          totals.get(row.user_id)[row.stat] = Number(row.value);
        }
      }
      // the friendships asked about
      const pairs = [];
      for (const [user, e] of batch) for (const o of [...e.strangers, ...e.together]) pairs.push({ a: user, b: o });
      const friends = new Set();
      if (pairs.length) {
        const r = await t.query(`SELECT f.user_id, f.friend_id FROM friendships f JOIN jsonb_to_recordset($1::jsonb) AS x(a uuid, b uuid) ON f.user_id = x.a AND f.friend_id = x.b`, [JSON.stringify(pairs)]);
        for (const row of r.rows) friends.add(`${row.user_id} ${row.friend_id}`);
      }
      // what may have unlocked; the table says which of it is new
      const want = new Map(); // `user id` -> { user_id, id }
      const wish = (user, id) => want.set(`${user} ${id}`, { user_id: user, id });
      for (const [user, e] of batch) {
        route(user, e.rooms);
        for (const id of e.feats) wish(user, id);
        for (const o of e.strangers) if (!friends.has(`${user} ${o}`)) wish(user, 'stranger');
        for (const o of e.together) {
          if (!friends.has(`${user} ${o}`)) continue;
          wish(user, 'friend');
          wish(o, 'friend');
          route(o, e.rooms);
        }
        const vals = totals.get(user);
        if (vals) for (const a of ACHIEVEMENTS) if (a.stat && vals[a.stat] >= a.goal) wish(user, a.id);
      }
      if (!want.size) return;
      const r = await t.query(
        `INSERT INTO user_achievements (user_id, achievement_id)
           SELECT user_id, id FROM jsonb_to_recordset($1::jsonb) AS x(user_id uuid, id text)
         ON CONFLICT DO NOTHING
         RETURNING user_id, achievement_id`,
        [JSON.stringify([...want.values()])]
      );
      for (const row of r.rows) {
        if (!unlocked.has(row.user_id)) unlocked.set(row.user_id, []);
        unlocked.get(row.user_id).push(row.achievement_id);
      }
    });
    return { unlocked, routes };
  }

  // ---------------------------------------------------------------- the profile page
  // An account's record: { stats: { stat: n }, unlocked: [{ id, at (ms), source }] }
  async forUser(userId) {
    await this.flush();
    const [s, u] = await Promise.all([
      this.db.query('SELECT stat, value FROM user_achievement_stats WHERE user_id = $1', [userId]),
      this.db.query(`SELECT achievement_id, round(extract(epoch FROM unlocked_at) * 1000)::float8 AS at, source FROM user_achievements WHERE user_id = $1 ORDER BY unlocked_at`, [userId]),
    ]);
    const stats = {};
    for (const k of ACH_STATS) stats[k] = 0;
    for (const r of s.rows) if (r.stat in stats) stats[r.stat] = Number(r.value);
    const unlocked = u.rows.filter((r) => ACH_BY_ID.has(r.achievement_id)).map((r) => ({ id: r.achievement_id, at: r.at, source: r.source }));
    return { stats, unlocked };
  }

  // A browser's guest record ({ stats, unlocked: { id: ms } }) merged into the account: the greater of each count,
  // and every unlock of either (one the account has keeps its own time). -> the account's record, as forUser
  async merge(userId, body) {
    if (!this.merges.take(userId)) throw new HttpError(429, 'Merging achievements too often. Try again in a moment.');
    const g = sanitizeProgress(body);
    const now = Date.now();
    await this.flush();
    await this.db.tx(async (t) => {
      const before = {};
      for (const r of (await t.query('SELECT stat, value FROM user_achievement_stats WHERE user_id = $1', [userId])).rows) before[r.stat] = Number(r.value);
      const rows = ACH_STATS.filter((k) => g.stats[k] > (before[k] || 0)).map((k) => ({ stat: k, n: g.stats[k] }));
      if (rows.length) {
        await t.query(
          `INSERT INTO user_achievement_stats (user_id, stat, value)
             SELECT $1, stat, n FROM jsonb_to_recordset($2::jsonb) AS x(stat text, n bigint)
           ON CONFLICT (user_id, stat) DO UPDATE SET value = GREATEST(user_achievement_stats.value, EXCLUDED.value), updated_at = now()`,
          [userId, JSON.stringify(rows)]
        );
      }
      const at = (id) => (g.unlocked[id] > 1 ? g.unlocked[id] : now);
      const want = [];
      for (const id of Object.keys(g.unlocked)) if (isFeat(id)) want.push({ id, at: at(id), source: 'guest' });
      for (const a of ACHIEVEMENTS) {
        if (!a.stat) continue;
        // (a counter the account had reached by itself is the game's; one the browser's count reached, the guest's)
        if ((before[a.stat] || 0) >= a.goal) want.push({ id: a.id, at: now, source: 'game' });
        else if (g.stats[a.stat] >= a.goal) want.push({ id: a.id, at: at(a.id), source: 'guest' });
      }
      if (!want.length) return;
      await t.query(
        `INSERT INTO user_achievements (user_id, achievement_id, unlocked_at, source)
           SELECT $1, id, to_timestamp(at / 1000.0), source FROM jsonb_to_recordset($2::jsonb) AS x(id text, at float8, source text)
         ON CONFLICT DO NOTHING`,
        [userId, JSON.stringify(want)]
      );
    });
    return this.forUser(userId);
  }

  async close() {
    clearInterval(this.timer);
    clearTimeout(this.soonT);
    await this.flush();
  }
}
