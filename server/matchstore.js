// Every match, written to the database (migrations/002): the records a game's MatchTracker (analytics.js) posts
// from its worker, by way of its Room (rooms.js), queued here and written once a second, in order - a match's row
// before anything that hangs off it, its end after. A stint of a match also goes onto the player's lifetime stats
// (DbStats.addStint).
//
// Writing them is best effort: a database that cannot be reached loses what was queued past QUEUE_MAX, and says so,
// rather than the server running out of memory. A match whose server stopped before it ended (a deploy, a crash) is
// marked 'interrupted': by its worker when the server goes down for a deploy, by its room when its worker goes, and
// by closeStale for any a crash left open.
const FLUSH_MS = 1000;
const QUEUE_MAX = 50_000;

// record field -> column, per table (the record's kind). jsonb columns are passed as they are.
const COLS = {
  match: {
    table: 'matches',
    cols: { id: 'uuid', roomCode: 'text', quick: 'boolean', inviteOnly: 'boolean', seats: 'smallint', seed: 'bigint', startDay: 'smallint', protocol: 'smallint', build: 'text', settings: 'jsonb', startedAt: 'timestamptz', continues: 'uuid' },

    conflict: 'ON CONFLICT (id) DO NOTHING',
  },
  player: {
    table: 'match_players',
    cols: {
      matchId: 'uuid', userId: 'uuid', guestKey: 'text', name: 'text', firstStint: 'boolean', joinedAt: 'timestamptz', leftAt: 'timestamptz', seconds: 'real',
      joinedDay: 'smallint', joinedPhase: 'text', leftDay: 'smallint', leftPhase: 'text', leftReason: 'text', outcome: 'text',
      kills: 'integer', zombieKills: 'integer', deaths: 'integer', downs: 'integer', revivesGiven: 'integer', revivesReceived: 'integer',
      damageDealt: 'real', damageTaken: 'real', shots: 'integer', hits: 'integer', headshots: 'integer', bossKills: 'integer',
      nightsSurvived: 'smallint', distanceM: 'real', crafted: 'integer', built: 'integer', itemsUsed: 'integer', cachesSearched: 'integer',
      suppliesFound: 'integer', suppliesInstalled: 'integer', pingAvg: 'real',
      killsByType: 'jsonb', killsByWeapon: 'jsonb', damageTakenBy: 'jsonb', shotsByWeapon: 'jsonb', hitsByWeapon: 'jsonb', craftedItems: 'jsonb', builtTypes: 'jsonb', usedItems: 'jsonb', stats: 'jsonb',
    },
  },
  night: {
    table: 'match_nights',
    cols: {
      matchId: 'uuid', night: 'smallint', startedAt: 'timestamptz', endedAt: 'timestamptz', durationS: 'real', theme: 'text', boss: 'text', bossKilled: 'boolean',
      hordeSize: 'integer', hordeHpMul: 'real', playersStart: 'smallint', survivorsStart: 'smallint', survivorsEnd: 'smallint',
      kills: 'integer', structuresLost: 'integer', downs: 'integer', deaths: 'integer', revives: 'integer', outcome: 'text',
    },
    conflict: 'ON CONFLICT (match_id, night) DO NOTHING',
  },
  event: {
    table: 'match_events',
    cols: { matchId: 'uuid', at: 'timestamptz', t: 'real', day: 'smallint', phase: 'text', type: 'text', userId: 'uuid', name: 'text', x: 'real', z: 'real', data: 'jsonb' },
  },
  sample: {
    table: 'match_samples',
    cols: { matchId: 'uuid', t: 'real', at: 'timestamptz', day: 'smallint', phase: 'text', players: 'smallint', survivors: 'smallint', downed: 'smallint', dead: 'smallint', zombies: 'smallint', tickMs: 'real', tickP99: 'real', pingAvg: 'real' },
    conflict: 'ON CONFLICT (match_id, t) DO NOTHING',
  },
};
// match_end: what the match's row is updated with
const END = {
  endedAt: 'timestamptz', outcome: 'text', lastDay: 'smallint', lastPhase: 'text', nightsSurvived: 'smallint', durationS: 'real',
  peakPlayers: 'smallint', uniquePlayers: 'smallint', playerSeconds: 'real', suppliesInstalled: 'smallint', suppliesNeeded: 'smallint',
  engineStartedS: 'real', escaped: 'smallint', kills: 'integer', deaths: 'integer', downs: 'integer', revives: 'integer',
  structuresBuilt: 'integer', structuresLost: 'integer', summary: 'jsonb',
};
const ORDER = ['match', 'night', 'player', 'event', 'sample', 'match_end'];

const snake = (k) => k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME_COLS = new Set(['at', 'startedAt', 'endedAt', 'joinedAt', 'leftAt']);

// one record as a row for jsonb_to_recordset: snake_case keys, times as ISO strings, bad values as null
function rowOf(rec, cols) {
  const row = {};
  for (const [k, type] of Object.entries(cols)) {
    let v = rec[k];
    if (v === undefined) v = null;
    if (v !== null) {
      if (TIME_COLS.has(k)) v = Number.isFinite(v) ? new Date(v).toISOString() : null;
      else if (type === 'uuid') v = typeof v === 'string' && UUID_RE.test(v) ? v : null;
      else if (type === 'real' || type === 'integer' || type === 'smallint' || type === 'bigint') {
        v = Number.isFinite(+v) ? +v : null;
        if (v !== null && type !== 'real') v = Math.round(v);
        if (v !== null && type === 'smallint') v = Math.max(-32768, Math.min(32767, v));
        if (v !== null && type === 'integer') v = Math.max(-2147483648, Math.min(2147483647, v));
      } else if (type === 'boolean') v = !!v;
      else if (type === 'text') v = String(v).slice(0, 200);
      else if (type === 'jsonb' && typeof v !== 'object') v = null;
    }
    row[snake(k)] = v;
  }
  return row;
}

export class MatchStore {
  // stats: the DbStats a stint's player record goes onto. build: the commit deployed (optional)
  constructor({ db, stats = null, build = '', log = () => {} }) {
    this.db = db;
    this.stats = stats;
    this.build = build;
    this.log = log;
    this.queue = [];
    this.dropped = 0;
    this.flushing = null;
    this.timer = setInterval(() => this.flush().catch(() => {}), FLUSH_MS);
    this.timer.unref?.();
    this.staleTimer = setInterval(() => this.closeStale().catch(() => {}), 10 * 60_000);
    this.staleTimer.unref?.();
  }

  // a record from a game. room: its Room (the code and kind of game a match was played in)
  push(rec, room = null) {
    if (!rec || !COLS[rec.k] && rec.k !== 'match_end') return;
    if (rec.k === 'match') {
      // (the first match of a game brought over from the last server carries on the one that server ended as 'handoff')
      rec = { ...rec, roomCode: room?.code ?? null, quick: room ? !!room.quick : null, inviteOnly: room ? !!room.inviteOnly : null, build: this.build || null, continues: room?.continues ?? null };
      if (room) {
        room.match = rec.id;
        room.continues = null;
      }
    } else if (rec.k === 'match_end' && room && room.match === rec.matchId) room.match = null;
    if (this.queue.length >= QUEUE_MAX) {
      if (!this.dropped++) this.log('matches: the database is not keeping up - dropping records');
      return;
    }
    this.queue.push(rec);
  }

  // Writes what is queued: one statement per kind of record, in ORDER
  async flush() {
    if (this.flushing) return this.flushing;
    if (!this.queue.length) return;
    const recs = this.queue;
    this.queue = [];
    this.flushing = this._write(recs)
      .catch((err) => this.log(`matches: ${recs.length} record(s) not written (${err.message})`))
      .finally(() => {
        this.flushing = null;
      });
    return this.flushing;
  }

  async _write(recs) {
    const by = new Map(ORDER.map((k) => [k, []]));
    for (const r of recs) by.get(r.k)?.push(r);
    for (const kind of ORDER) {
      const list = by.get(kind);
      if (!list.length) continue;
      if (kind === 'match_end') {
        for (const r of list) await this._end(r);
        continue;
      }
      const { table, cols, conflict = '' } = COLS[kind];
      const names = Object.keys(cols).map(snake);
      const decl = Object.entries(cols).map(([k, type]) => `${snake(k)} ${type}`).join(', ');
      // (a record without its own time is stamped with now: at is NOT NULL)
      const picks = names.map((n) => (n === 'at' ? 'COALESCE(at, now())' : n));
      const sql = `INSERT INTO ${table} (${names.join(', ')}) SELECT ${picks.join(', ')} FROM jsonb_to_recordset($1::jsonb) AS x(${decl}) ${conflict}`;
      const rows = list.map((r) => rowOf(r, cols));
      let ok = list;
      try {
        await this.db.query(sql, [JSON.stringify(rows)]);
      } catch (err) {
        // one bad record (its match never got written: the database was down when it began) is no reason to lose
        // the rest: one at a time, then
        ok = [];
        let lost = 0;
        for (let i = 0; i < rows.length; i++) {
          try {
            await this.db.query(sql, [JSON.stringify([rows[i]])]);
            ok.push(list[i]);
          } catch {
            lost++;
          }
        }
        if (lost) this.log(`matches: ${lost} of ${list.length} ${kind} record(s) not written (${err.message})`);
      }
      if (kind === 'player' && this.stats) for (const r of ok) await this.stats.addStint(r).catch((err) => this.log(`stats: stint not added (${err.message})`));
    }
    if (this.dropped) {
      this.log(`matches: ${this.dropped} record(s) were dropped while the database was behind`);
      this.dropped = 0;
    }
  }

  async _end(r) {
    const row = rowOf(r, END);
    const sets = Object.keys(END).map((k, i) => `${snake(k)} = $${i + 2}`);
    const vals = Object.keys(END).map((k) => {
      const v = row[snake(k)];
      return END[k] === 'jsonb' && v !== null ? JSON.stringify(v) : v;
    });
    // (only a match still open: an 'interrupted' written by its room going does not get written over, nor the other way)
    await this.db.query(`UPDATE matches SET ${sets.join(', ')} WHERE id = $1 AND ended_at IS NULL`, [r.matchId, ...vals]);
  }

  // A room's worker went before its match ended: what was written of it stands, marked interrupted
  async interrupt(matchId) {
    if (!matchId) return;
    await this.flush();
    await this.db
      .query(`UPDATE matches SET ended_at = now(), outcome = 'interrupted', duration_s = EXTRACT(EPOCH FROM now() - started_at) WHERE id = $1 AND ended_at IS NULL`, [matchId])
      .catch((err) => this.log(`matches: ${matchId} not marked interrupted (${err.message})`));
  }

  // The matches a process that went away left open (it crashed, or was killed before it could end them): ones nothing
  // has been heard from for `idleMin` minutes - a match being played sends a sample every 30 s, and on a deploy the
  // old server is still playing its matches while the new one starts. Run on start and every so often after.
  async closeStale(idleMin = 5) {
    const r = await this.db.query(
      `WITH last AS (
         SELECT m.id, GREATEST(m.started_at, (SELECT max(at) FROM match_events e WHERE e.match_id = m.id), (SELECT max(at) FROM match_samples s WHERE s.match_id = m.id)) AS at
           FROM matches m WHERE m.ended_at IS NULL)
       UPDATE matches m SET outcome = 'interrupted', ended_at = last.at
         FROM last WHERE m.id = last.id AND last.at < now() - make_interval(mins => $1)`,
      [idleMin]
    );
    if (r.rowCount) this.log(`matches: ${r.rowCount} left open by a server that stopped marked interrupted`);
  }

  // An account's last matches, newest first: what the team did and what they did in it (their stints added up)
  async recentFor(userId, limit = 10) {
    const r = await this.db.query(
      `SELECT m.id, m.started_at, m.ended_at, m.outcome, m.last_day, m.last_phase, m.peak_players,
              sum(p.kills)::int AS kills, sum(p.deaths)::int AS deaths, sum(p.revives_given)::int AS revives,
              max(p.nights_survived)::int AS nights, sum(p.seconds)::real AS seconds,
              (array_agg(p.outcome ORDER BY p.joined_at DESC))[1] AS my_outcome
         FROM match_players p JOIN matches m ON m.id = p.match_id
        WHERE p.user_id = $1
        GROUP BY m.id
        ORDER BY max(p.joined_at) DESC
        LIMIT $2`,
      [userId, limit]
    );
    return r.rows.map((x) => ({
      id: x.id,
      startedAt: x.started_at,
      endedAt: x.ended_at,
      outcome: x.outcome, // (null: still being played)
      lastDay: x.last_day,
      lastPhase: x.last_phase,
      players: x.peak_players,
      kills: x.kills || 0,
      deaths: x.deaths || 0,
      revives: x.revives || 0,
      nights: x.nights || 0,
      seconds: Math.round(x.seconds || 0),
      myOutcome: x.my_outcome,
    }));
  }

  async close() {
    clearInterval(this.timer);
    clearInterval(this.staleTimer);
    await this.flush();
    if (this.queue.length) await this.flush();
  }
}
