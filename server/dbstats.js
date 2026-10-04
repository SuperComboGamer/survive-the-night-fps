// The leaderboard and every player's lifetime stats, kept in Postgres (player_stats, migrations/001). The same
// face to the games as the file-kept one (stats.js PlayerStats): enter / leave / bump / board, from the records the
// worker of each game posts (room-worker.js RemoteRecords, rooms.js Room.record).
//
// A player signed in to an account is filed under 'u:<user id>'. A guest - not signed in, as anybody can play - is
// filed under 'g:<SHA-256 of their browser's id>' as before there were accounts, and that record moves onto their
// account when they register or sign in from that browser (claimGuest). The browser id itself is never kept.
//
// The board's stats (kills, nights, wins, revives) and XP are counted as they happen and written every couple of
// seconds, a row per player at most per write (flush). The rest - games, deaths, downs, headshots, the furthest day,
// time played - come with each stint of a match as it ends (addStint, from matchstore.js).
import { BOARD_STATS, BOARDF, BOARD_TOP } from '../shared/protocol.js';
import { levelOf } from '../shared/progress.js';
import { idKey, cleanPerks } from './stats.js';

const FLUSH_MS = 2000;
const STAT_MAX = 0x7fffffff;
const cleanName = (v) => (typeof v === 'string' ? v.replace(/[^\p{L}\p{N} _\-.#]/gu, '').trim().slice(0, 16) : '') || 'Survivor';

export class DbStats {
  constructor({ db, log = () => {} }) {
    this.db = db;
    this.log = log;
    this.recs = new Map(); // key -> { key, userId, name, on, add: { kills, ... } }: the players in a game, and what is not written yet
    this.dirty = new Set();
    this.flushing = null;
    this.timer = setInterval(() => this.flush().catch(() => {}), FLUSH_MS);
    this.timer.unref?.();
  }

  // ---------------------------------------------------------------- what a game asks for
  // userId: their account's (signed in), else id: the browser's (a guest). null for nobody: nothing is kept
  enter(id, name, userId = '') {
    const key = userId ? `u:${userId}` : idKey(id) ? `g:${idKey(id)}` : '';
    if (!key) return null;
    let rec = this.recs.get(key);
    if (!rec) {
      rec = { key, userId: userId || null, name: cleanName(name), on: 0, add: {}, touched: false };
      this.recs.set(key, rec);
    }
    rec.name = cleanName(name);
    rec.on++;
    return rec;
  }

  leave(rec) {
    if (!rec) return;
    rec.on--;
    if (rec.on <= 0 && !this.dirty.has(rec)) this.recs.delete(rec.key);
  }

  // stat: one of BOARD_STATS, or 'xp'
  bump(rec, stat, n = 1) {
    if (!rec || !(stat === 'xp' || BOARD_STATS.includes(stat))) return;
    rec.add[stat] = Math.min(STAT_MAX, (rec.add[stat] || 0) + n);
    this.dirty.add(rec);
  }

  // they saw dawn on this day: the furthest day on their record, if it is further (written with the next flush)
  best(rec, day) {
    if (!rec || !(day > 0)) return;
    rec.add.best = Math.max(rec.add.best || 0, Math.min(STAT_MAX, day | 0));
    this.dirty.add(rec);
  }

  // ---------------------------------------------------------------- progress (shared/progress.js)
  // What a game needs to know of a player as they join -> Promise of { xp, perks, best }. What is counted for them and
  // not written yet is in it.
  async progress(rec) {
    if (!rec) return null;
    await this.flushing;
    const r = (await this.db.query('SELECT xp, perks, best_day FROM player_stats WHERE key = $1', [rec.key])).rows[0];
    const xp = Math.min(STAT_MAX, (r?.xp || 0) + (rec.add.xp || 0));
    return { xp, perks: cleanPerks(r?.perks, xp), best: Math.max(r?.best_day || 0, rec.add.best || 0) };
  }

  // A player's progress for the API, by who asks (signed in: userId, else guestId, the browser's id) -> Promise of
  // { key, xp, perks, respecs }, all nothing for someone with nothing on record; null for nobody
  async progressOf({ userId, guestId }) {
    const key = userId ? `u:${userId}` : idKey(guestId) ? `g:${idKey(guestId)}` : '';
    if (!key) return null;
    await this.flush();
    const r = (await this.db.query('SELECT xp, perks, respecs FROM player_stats WHERE key = $1', [key])).rows[0];
    const xp = r?.xp || 0;
    return { key, xp, perks: cleanPerks(r?.perks, xp), respecs: r?.respecs || 0, stored: r ? r.perks.map(Number) : [] };
  }

  // Their picks are these now (checked by the caller: server/progress.js), if they are still what progressOf read:
  // two picks at once do not both go in. -> Promise of true when written
  async setPerks(prog, perks, respecs) {
    const r = await this.db.query('UPDATE player_stats SET perks = $2::smallint[], respecs = $3 WHERE key = $1 AND perks = $4::smallint[] AND respecs = $5', [prog.key, perks, respecs, prog.stored, prog.respecs]);
    return r.rowCount === 1;
  }

  // Writes what was counted since the last time: one statement for every player who scored. A write that fails
  // keeps its counts for the next one.
  async flush() {
    if (this.flushing) return this.flushing;
    if (!this.dirty.size) return;
    const recs = [...this.dirty];
    this.dirty.clear();
    const rows = recs.map((r) => ({ key: r.key, user_id: r.userId, name: r.name, kills: r.add.kills || 0, nights: r.add.nights || 0, wins: r.add.wins || 0, revives: r.add.revives || 0, xp: r.add.xp || 0, best_day: r.add.best || 0 }));
    const taken = recs.map((r) => r.add);
    for (const r of recs) r.add = {};
    this.flushing = this.db
      .query(
        `INSERT INTO player_stats (key, user_id, name, kills, nights, wins, revives, xp, best_day)
         SELECT key, user_id, name, kills, nights, wins, revives, xp, best_day
           FROM jsonb_to_recordset($1::jsonb) AS x(key text, user_id uuid, name text, kills int, nights int, wins int, revives int, xp int, best_day int)
         ON CONFLICT (key) DO UPDATE SET
           name = EXCLUDED.name,
           kills = LEAST(${STAT_MAX}, player_stats.kills + EXCLUDED.kills),
           nights = LEAST(${STAT_MAX}, player_stats.nights + EXCLUDED.nights),
           wins = LEAST(${STAT_MAX}, player_stats.wins + EXCLUDED.wins),
           revives = LEAST(${STAT_MAX}, player_stats.revives + EXCLUDED.revives),
           xp = LEAST(${STAT_MAX}, player_stats.xp + EXCLUDED.xp),
           best_day = GREATEST(player_stats.best_day, EXCLUDED.best_day),
           last_seen = now()`,
        [JSON.stringify(rows)]
      )
      .then(
        () => {
          for (const r of recs) if (r.on <= 0 && !this.dirty.has(r)) this.recs.delete(r.key);
        },
        (err) => {
          this.log(`stats: could not write ${recs.length} record(s) (${err.message}); trying again`);
          recs.forEach((r, i) => {
            for (const [k, v] of Object.entries(taken[i])) r.add[k] = k === 'best' ? Math.max(r.add[k] || 0, v) : (r.add[k] || 0) + v;
            this.dirty.add(r);
          });
        }
      )
      .finally(() => {
        this.flushing = null;
      });
    return this.flushing;
  }

  // The board as one player gets it (as PlayerStats.board): the best BOARD_TOP by each stat, everybody here and me,
  // each once, with my place in each stat on my own row. -> Promise of { total, rows }
  async board(me, here) {
    await this.flush();
    const want = [...here].map((r) => r.key);
    if (me) want.push(me.key);
    const tops = BOARD_STATS.map((k) => `(SELECT key FROM player_stats WHERE ${k} > 0 ORDER BY ${k} DESC, last_seen DESC LIMIT ${BOARD_TOP})`).join(' UNION ');
    const [rows, total, ranks] = await Promise.all([
      this.db.query(`SELECT key, name, xp, ${BOARD_STATS.join(', ')} FROM player_stats WHERE key IN (${tops}) OR key = ANY($1::text[])`, [want]),
      this.db.query(`SELECT count(*)::int AS n FROM player_stats WHERE ${BOARD_STATS.map((k) => `${k} > 0`).join(' OR ')}`),
      me ? this.db.query(`SELECT ${BOARD_STATS.map((k) => `(SELECT count(*)::int FROM player_stats o WHERE o.${k} > s.${k}) AS ${k}`).join(', ')}, ${BOARD_STATS.map((k) => `s.${k} AS my_${k}`).join(', ')} FROM player_stats s WHERE s.key = $1`, [me.key]) : null,
    ]);
    const hereKeys = new Set([...here].map((r) => r.key));
    const out = [];
    const seen = new Set();
    const row = (key, name, vals) => {
      seen.add(key);
      const r = { name, flags: (me && key === me.key ? BOARDF.ME : 0) | (hereKeys.has(key) ? BOARDF.HERE : 0), level: levelOf(vals.xp | 0) };
      for (const k of BOARD_STATS) r[k] = Math.max(0, vals[k] | 0);
      if (r.flags & BOARDF.ME) {
        const mine = ranks?.rows[0];
        r.ranks = BOARD_STATS.map((k) => (mine && mine[`my_${k}`] > 0 ? mine[k] + 1 : 0));
      }
      out.push(r);
    };
    for (const r of rows.rows) row(r.key, this.recs.get(r.key)?.name || r.name, r);
    // whoever is here or me with nothing on record yet: on the list with nothing
    for (const r of [...here, ...(me ? [me] : [])]) if (!seen.has(r.key)) row(r.key, r.name, {});
    return { total: total.rows[0]?.n || 0, rows: out };
  }

  // ---------------------------------------------------------------- the rest of a player's stats
  // A stint of a match ended (analytics.js 'player' record): what goes on the record of whoever played it.
  async addStint(rec) {
    const key = rec.userId ? `u:${rec.userId}` : rec.guestKey ? `g:${rec.guestKey}` : '';
    if (!key) return;
    const n = (v) => Math.max(0, Math.min(STAT_MAX, Math.round(+v || 0)));
    await this.db.query(
      `INSERT INTO player_stats (key, user_id, name, games, deaths, downs, headshots, boss_kills, best_day, play_seconds)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (key) DO UPDATE SET
         games = player_stats.games + EXCLUDED.games,
         deaths = player_stats.deaths + EXCLUDED.deaths,
         downs = player_stats.downs + EXCLUDED.downs,
         headshots = player_stats.headshots + EXCLUDED.headshots,
         boss_kills = player_stats.boss_kills + EXCLUDED.boss_kills,
         best_day = GREATEST(player_stats.best_day, EXCLUDED.best_day),
         play_seconds = LEAST(${STAT_MAX}, player_stats.play_seconds + EXCLUDED.play_seconds),
         last_seen = now()`,
      [key, rec.userId || null, cleanName(rec.name), rec.firstStint === false ? 0 : 1, n(rec.deaths), n(rec.downs), n(rec.headshots), n(rec.bossKills), n(rec.leftDay), n(rec.seconds)]
    );
  }

  // ---------------------------------------------------------------- accounts
  // A guest's record (by their browser's id) goes onto the account: added to what it has, or becoming it.
  async claimGuest(userId, username, browserId) {
    const g = idKey(browserId);
    if (!g) return false;
    await this.flush();
    return this.db.tx(async (t) => {
      const guest = (await t.query('DELETE FROM player_stats WHERE key = $1 RETURNING *', [`g:${g}`])).rows[0];
      if (!guest) return false;
      // (XP adds up; the account keeps its own picks if it has any, else takes the guest's - valid either way, since
      // the XP only grew)
      await t.query(
        `INSERT INTO player_stats (key, user_id, name, kills, nights, wins, revives, games, deaths, downs, headshots, boss_kills, best_day, play_seconds, first_seen, xp, perks, respecs)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         ON CONFLICT (key) DO UPDATE SET
           xp = LEAST(${STAT_MAX}, player_stats.xp + EXCLUDED.xp),
           perks = CASE WHEN cardinality(player_stats.perks) > 0 THEN player_stats.perks ELSE EXCLUDED.perks END,
           respecs = GREATEST(player_stats.respecs, EXCLUDED.respecs),
           kills = player_stats.kills + EXCLUDED.kills, nights = player_stats.nights + EXCLUDED.nights,
           wins = player_stats.wins + EXCLUDED.wins, revives = player_stats.revives + EXCLUDED.revives,
           games = player_stats.games + EXCLUDED.games, deaths = player_stats.deaths + EXCLUDED.deaths,
           downs = player_stats.downs + EXCLUDED.downs, headshots = player_stats.headshots + EXCLUDED.headshots,
           boss_kills = player_stats.boss_kills + EXCLUDED.boss_kills, best_day = GREATEST(player_stats.best_day, EXCLUDED.best_day),
           play_seconds = player_stats.play_seconds + EXCLUDED.play_seconds, first_seen = LEAST(player_stats.first_seen, EXCLUDED.first_seen)`,
        [`u:${userId}`, userId, username, guest.kills, guest.nights, guest.wins, guest.revives, guest.games, guest.deaths, guest.downs, guest.headshots, guest.boss_kills, guest.best_day, guest.play_seconds, guest.first_seen, guest.xp, guest.perks, guest.respecs]
      );
      // the matches they played as a guest are theirs too
      await t.query('UPDATE match_players SET user_id = $1, guest_key = NULL WHERE guest_key = $2', [userId, g]);
      return true;
    });
  }

  // an account's lifetime stats, and its place in the board's: { kills, ..., ranks: { kills: n } } or null
  async forUser(userId) {
    const key = `u:${userId}`;
    await this.flush();
    const r = (await this.db.query(`SELECT *, ${BOARD_STATS.map((k) => `(SELECT count(*)::int FROM player_stats o WHERE o.${k} > s.${k}) AS rank_${k}`).join(', ')} FROM player_stats s WHERE key = $1`, [key])).rows[0];
    if (!r) return null;
    const ranks = {};
    for (const k of BOARD_STATS) ranks[k] = r[k] > 0 ? r[`rank_${k}`] + 1 : 0;
    return { xp: r.xp, kills: r.kills, nights: r.nights, wins: r.wins, revives: r.revives, games: r.games, deaths: r.deaths, downs: r.downs, headshots: r.headshots, bossKills: r.boss_kills, bestDay: r.best_day, playSeconds: r.play_seconds, firstSeen: r.first_seen, ranks };
  }

  // An account's public profile by its name (any case): what the board shows of it, its level and its perks. null for
  // nobody by that name
  async profile(username) {
    const name = typeof username === 'string' ? username.trim().slice(0, 32) : '';
    if (!name) return null;
    await this.flush();
    const r = (await this.db.query(`SELECT u.username, u.created_at, s.* FROM users u LEFT JOIN player_stats s ON s.key = 'u:' || u.id WHERE lower(u.username) = lower($1)`, [name])).rows[0];
    if (!r) return null;
    const xp = r.xp || 0;
    const n = (v) => Math.max(0, v | 0);
    return {
      username: r.username,
      since: r.created_at,
      xp,
      level: levelOf(xp),
      perks: cleanPerks(r.perks, xp),
      stats: { kills: n(r.kills), nights: n(r.nights), wins: n(r.wins), revives: n(r.revives), games: n(r.games), deaths: n(r.deaths), downs: n(r.downs), headshots: n(r.headshots), bossKills: n(r.boss_kills), bestDay: n(r.best_day), playSeconds: n(r.play_seconds) },
    };
  }

  async close() {
    clearInterval(this.timer);
    await this.flush();
  }
}
