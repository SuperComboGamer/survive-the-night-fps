// The stats page (/stats, client/stats/): what the match records (002_matches.sql) say about the game as a whole, for
// anyone to watch it grow, and a part only an admin sees. Everything is read from the tables the match store already
// writes, so it needs no migration; the questions 003_analytics.sql already asks are asked as they are.
//
//   publicView(range)  totals since the first match, a series a day over the range, records, breakdowns
//   adminView(range)   who comes back, how long they stay, signups, the server's health, each deploy's matches
//
// range: '7d' | '30d' | '90d' | 'all'. Days are UTC days. Each answer is kept for a while (TTL_MS) and asked for once
// however many pages ask at the same time, so the page costs the database one round of queries a minute.
// Names on it are the names players play under, as the leaderboard shows them; no game codes but those of the public
// games running now (which /api/games lists anyway), no account ids, no guest keys.
import { ITEM, ITEM_DEFS, ZTYPE, ZOMBIE_DEFS } from '../shared/defs.js';
import { DIFFICULTIES } from '../shared/difficulty.js';

export const RANGES = { '7d': 7, '30d': 30, '90d': 90, all: null };
const TTL_MS = 60_000;
const ADMIN_TTL_MS = 30_000;
// who a player is across matches: their account, else their browser's key, else their name (003_analytics.sql)
const WHO = `COALESCE(p.user_id::text, 'g:' || p.guest_key, 'n:' || p.name)`;
const DAY = (col) => `(${col} AT TIME ZONE 'UTC')::date`;

// a name in the records -> what the game calls it
const ITEM_LABEL = {};
for (const [k, v] of Object.entries(ITEM)) if (ITEM_DEFS[v]) ITEM_LABEL[k.toLowerCase()] = ITEM_DEFS[v].name;
const ZOMBIE_LABEL = {};
for (const [k, v] of Object.entries(ZTYPE)) if (ZOMBIE_DEFS[v]) ZOMBIE_LABEL[k.toLowerCase()] = ZOMBIE_DEFS[v].name;
const OTHER_LABEL = {
  turned_player: 'Turned survivor',
  survivor: 'Another survivor',
  fall: 'Falling',
  drowned: 'Drowning',
  world: 'The world',
  mounted_gun: 'Mounted gun',
  fire: 'Fire',
  explosion: 'Explosion',
  unknown: 'Unknown',
};
const DIFF_LABEL = Object.fromEntries(DIFFICULTIES.map((d) => [d.id, d.name]));
export const label = (key) => OTHER_LABEL[key] || ZOMBIE_LABEL[key] || ITEM_LABEL[key] || String(key || 'Unknown').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const num = (v) => (v === null || v === undefined ? 0 : +v || 0);
const r1 = (v) => Math.round(num(v) * 10) / 10;
const iso = (d) => (d instanceof Date ? d.toISOString() : d ? new Date(d).toISOString() : null);
const dayKey = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

export class PublicStats {
  // live: () => { games, players, list } (the lobby's, or the cluster's), asked on every request: it costs nothing
  constructor({ db, live = () => ({ games: 0, players: 0, list: [] }), log = () => {} }) {
    this.db = db;
    this.live = live;
    this.log = log;
    this.cache = new Map(); // key -> { at, value: Promise }
  }

  static since(range) {
    const days = RANGES[range];
    return days ? new Date(Date.now() - days * 86400_000) : new Date('1970-01-01T00:00:00Z');
  }

  cached(key, ttl, fn) {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.value;
    const value = fn();
    this.cache.set(key, { at: Date.now(), value });
    // (a failure is not kept: the next request asks again)
    value.catch(() => this.cache.get(key)?.value === value && this.cache.delete(key));
    return value;
  }

  q(text, params = []) {
    return this.db.query(text, params).then((r) => r.rows);
  }

  async publicView(range = '30d') {
    if (!(range in RANGES)) range = '30d';
    const data = await this.cached(`public:${range}`, TTL_MS, () => this._public(range));
    return { ...data, live: await this.live() };
  }

  async adminView(range = '30d') {
    if (!(range in RANGES)) range = '30d';
    return this.cached(`admin:${range}`, ADMIN_TTL_MS, () => this._admin(range));
  }

  // ---------------------------------------------------------------- what anyone sees
  async _public(range) {
    const since = PublicStats.since(range);
    const [totals, daily, base, online, heat, outcomes, funnel, kinds, weapons, causes, bosses, teams, modes, records, top, recent] = await Promise.all([
      this.totals(),
      this.daily(since),
      this.before(since),
      this.online24h(),
      this.heatmap(since),
      this.q(`SELECT COALESCE(outcome, 'playing') AS outcome, count(*) AS n FROM matches WHERE started_at >= $1 GROUP BY 1 ORDER BY 2 DESC`, [since]),
      this.q(`SELECT night, reached, survived, wiped, escaped, survive_pct, avg_horde FROM analytics_night_funnel($1) WHERE night <= 30`, [since]),
      this.q(`SELECT zombie, kills, share_pct FROM analytics_kills_by_type($1) LIMIT 12`, [since]),
      this.q(`SELECT weapon, shots, hits, accuracy_pct, kills FROM analytics_weapons($1) WHERE kills > 0 OR shots > 0 LIMIT 10`, [since]),
      this.q(`SELECT cause, deaths, downs FROM analytics_death_causes($1) LIMIT 8`, [since]),
      this.q(`SELECT boss, nights, killed, kill_pct, wipe_pct FROM analytics_bosses($1)`, [since]),
      this.q(`SELECT team, matches, victory_pct, avg_nights_survived, avg_minutes FROM analytics_by_team_size($1) WHERE team IS NOT NULL`, [since]),
      this.q(
        `SELECT COALESCE(settings->>'difficulty', 'nightfall') AS mode, count(*) AS matches, count(*) FILTER (WHERE outcome = 'victory') AS victories,
                round(avg(nights_survived), 1) AS avg_nights
           FROM matches WHERE started_at >= $1 GROUP BY 1 ORDER BY 2 DESC`,
        [since]
      ),
      this.records(),
      this.topPlayers(since),
      this.q(
        `SELECT ended_at, outcome, peak_players, last_day, nights_survived, kills, deaths, duration_s, COALESCE(settings->>'difficulty', 'nightfall') AS mode
           FROM matches WHERE ended_at IS NOT NULL AND outcome NOT IN ('handoff') AND peak_players > 0 ORDER BY ended_at DESC LIMIT 12`
      ),
    ]);
    return {
      enabled: true,
      generatedAt: new Date().toISOString(),
      range,
      since: range === 'all' ? null : since.toISOString(),
      totals,
      base,
      daily,
      online24h: online,
      heatmap: heat,
      outcomes: outcomes.map((r) => ({ outcome: r.outcome, n: num(r.n) })),
      nights: funnel.map((r) => ({ night: r.night, reached: num(r.reached), survived: num(r.survived), wiped: num(r.wiped), escaped: num(r.escaped), survivePct: r.survive_pct === null ? null : num(r.survive_pct), avgHorde: num(r.avg_horde) })),
      killsByType: kinds.map((r) => ({ key: r.zombie, label: label(r.zombie), kills: num(r.kills), pct: num(r.share_pct) })),
      weapons: weapons.map((r) => ({ key: r.weapon, label: label(r.weapon), shots: num(r.shots), hits: num(r.hits), accuracy: r.accuracy_pct === null ? null : num(r.accuracy_pct), kills: num(r.kills) })),
      deathCauses: causes.map((r) => ({ key: r.cause, label: label(r.cause), deaths: num(r.deaths), downs: num(r.downs) })),
      bosses: bosses.map((r) => ({ key: r.boss, label: label(r.boss), nights: num(r.nights), killed: num(r.killed), killPct: num(r.kill_pct), wipePct: num(r.wipe_pct) })),
      teams: teams.map((r) => ({ team: r.team, matches: num(r.matches), victoryPct: num(r.victory_pct), avgNights: num(r.avg_nights_survived), avgMinutes: num(r.avg_minutes) })),
      modes: modes.map((r) => ({ key: r.mode, label: DIFF_LABEL[r.mode] || label(r.mode), matches: num(r.matches), victories: num(r.victories), avgNights: num(r.avg_nights) })),
      records,
      topPlayers: top,
      recent: recent.map((r) => ({ endedAt: iso(r.ended_at), outcome: r.outcome, players: num(r.peak_players), lastDay: num(r.last_day), nights: num(r.nights_survived), kills: num(r.kills), deaths: num(r.deaths), minutes: r1(num(r.duration_s) / 60), mode: DIFF_LABEL[r.mode] || label(r.mode) })),
    };
  }

  // every number since the first match, as the stints add them up
  async totals() {
    const [p, m] = await Promise.all([
      this.q(
        `SELECT count(DISTINCT ${WHO}) AS players, count(DISTINCT p.user_id) AS accounts,
                COALESCE(sum(p.seconds), 0) / 3600 AS hours, COALESCE(sum(p.kills), 0) AS kills, COALESCE(sum(p.headshots), 0) AS headshots,
                COALESCE(sum(p.shots), 0) AS shots, COALESCE(sum(p.boss_kills), 0) AS boss_kills, COALESCE(sum(p.nights_survived), 0) AS nights,
                COALESCE(sum(p.deaths), 0) AS deaths, COALESCE(sum(p.downs), 0) AS downs, COALESCE(sum(p.revives_given), 0) AS revives,
                COALESCE(sum(p.built), 0) AS built, COALESCE(sum(p.distance_m), 0) / 1000 AS km, COALESCE(sum(p.crafted), 0) AS crafted,
                COALESCE(sum(p.caches_searched), 0) AS searched, COALESCE(sum(p.supplies_installed), 0) AS supplies,
                COALESCE(sum(p.damage_dealt), 0) AS damage, COALESCE(sum(p.items_used), 0) AS used,
                COALESCE(sum((p.stats->>'deerKilled')::numeric), 0) AS deer, count(*) FILTER (WHERE p.outcome = 'escaped') AS escaped
           FROM match_players p`
      ),
      this.q(
        `SELECT count(*) AS matches, count(*) FILTER (WHERE outcome = 'victory') AS victories, min(started_at) AS first,
                COALESCE(sum(structures_lost), 0) AS lost, max(peak_players) AS peak
           FROM matches`
      ),
    ]);
    const a = p[0] || {};
    const b = m[0] || {};
    return {
      players: num(a.players),
      accounts: num(a.accounts),
      guests: Math.max(0, num(a.players) - num(a.accounts)),
      hours: r1(a.hours),
      zombiesKilled: num(a.kills),
      headshots: num(a.headshots),
      shots: num(a.shots),
      bossesKilled: num(a.boss_kills),
      nightsSurvived: num(a.nights),
      deaths: num(a.deaths),
      downs: num(a.downs),
      revives: num(a.revives),
      built: num(a.built),
      lost: num(b.lost),
      km: r1(a.km),
      crafted: num(a.crafted),
      searched: num(a.searched),
      supplies: num(a.supplies),
      damage: Math.round(num(a.damage)),
      itemsUsed: num(a.used),
      deer: num(a.deer),
      escaped: num(a.escaped),
      matches: num(b.matches),
      victories: num(b.victories),
      peakInOneGame: num(b.peak),
      firstMatchAt: iso(b.first),
    };
  }

  // what came before the range, so the page can draw running totals from the first match on
  async before(since) {
    const rows = await this.q(
      `SELECT (SELECT count(*) FROM (SELECT ${WHO} FROM match_players p GROUP BY 1 HAVING min(p.joined_at) < $1) x) AS players,
              (SELECT COALESCE(sum(kills), 0) FROM match_players WHERE joined_at < $1) AS kills,
              (SELECT count(*) FROM matches WHERE started_at < $1) AS matches,
              (SELECT COALESCE(sum(seconds), 0) / 3600 FROM match_players WHERE joined_at < $1) AS hours`,
      [since]
    );
    const r = rows[0] || {};
    return { players: num(r.players), kills: num(r.kills), matches: num(r.matches), hours: r1(r.hours) };
  }

  // a row for every UTC day of the range (from the first match, if that is later), days without a match included
  async daily(since) {
    const rows = await this.q(
      `WITH lo AS (SELECT GREATEST($1::timestamptz, COALESCE((SELECT min(started_at) FROM matches), now())) AS at),
            days AS (SELECT generate_series(${DAY('(SELECT at FROM lo)')}, ${DAY('now()')}, interval '1 day')::date AS day),
            m AS (SELECT ${DAY('started_at')} AS day, count(*) AS matches, count(*) FILTER (WHERE outcome = 'victory') AS victories
                    FROM matches WHERE started_at >= $1 GROUP BY 1),
            p AS (SELECT ${DAY('p.joined_at')} AS day, count(DISTINCT ${WHO}) AS players, sum(p.seconds) / 3600 AS hours,
                         sum(p.kills) AS kills, sum(p.deaths) AS deaths, sum(p.nights_survived) AS nights
                    FROM match_players p WHERE p.joined_at >= $1 GROUP BY 1),
            f AS (SELECT ${DAY('min(p.joined_at)')} AS day FROM match_players p GROUP BY ${WHO}),
            n AS (SELECT day, count(*) AS new_players FROM f GROUP BY 1),
            b AS (SELECT s.match_id, to_timestamp(floor(extract(epoch FROM s.at) / 120) * 120) AS at, max(s.players) AS n
                    FROM match_samples s WHERE s.at >= $1 GROUP BY 1, 2),
            c AS (SELECT ${DAY('at')} AS day, max(t) AS peak FROM (SELECT at, sum(n) AS t FROM b GROUP BY at) x GROUP BY 1)
       SELECT days.day, COALESCE(m.matches, 0) AS matches, COALESCE(m.victories, 0) AS victories, COALESCE(p.players, 0) AS players,
              COALESCE(n.new_players, 0) AS new_players, COALESCE(p.hours, 0) AS hours, COALESCE(p.kills, 0) AS kills,
              COALESCE(p.deaths, 0) AS deaths, COALESCE(p.nights, 0) AS nights, COALESCE(c.peak, 0) AS peak
         FROM days LEFT JOIN m USING (day) LEFT JOIN p USING (day) LEFT JOIN n USING (day) LEFT JOIN c USING (day)
        ORDER BY days.day`,
      [since]
    );
    return rows.map((r) => ({
      day: dayKey(r.day),
      matches: num(r.matches),
      victories: num(r.victories),
      players: num(r.players),
      newPlayers: num(r.new_players),
      hours: r1(r.hours),
      kills: num(r.kills),
      deaths: num(r.deaths),
      nights: num(r.nights),
      peak: num(r.peak),
    }));
  }

  // players in a game, every 15 minutes of the last 24 hours (the most in each, from the 30 s samples)
  async online24h() {
    const rows = await this.q(
      `WITH slots AS (SELECT generate_series(to_timestamp(floor(extract(epoch FROM now() - interval '24 hours') / 900) * 900),
                                             to_timestamp(floor(extract(epoch FROM now()) / 900) * 900), interval '15 minutes') AS at),
            b AS (SELECT s.match_id, to_timestamp(floor(extract(epoch FROM s.at) / 900) * 900) AS at, max(s.players) AS n
                    FROM match_samples s WHERE s.at >= now() - interval '25 hours' GROUP BY 1, 2),
            c AS (SELECT at, sum(n) AS n FROM b GROUP BY at)
       SELECT slots.at, COALESCE(c.n, 0) AS n FROM slots LEFT JOIN c USING (at) ORDER BY slots.at`
    );
    return rows.map((r) => ({ at: iso(r.at), players: num(r.n) }));
  }

  // when people sit down to play: stints begun in each hour of the week (UTC), Monday 00:00 first, 168 of them
  async heatmap(since) {
    const rows = await this.q(
      `SELECT (extract(isodow FROM joined_at AT TIME ZONE 'UTC')::int - 1) * 24 + extract(hour FROM joined_at AT TIME ZONE 'UTC')::int AS h, count(*) AS n
         FROM match_players WHERE joined_at >= $1 AND first_stint GROUP BY 1`,
      [since]
    );
    const out = new Array(168).fill(0);
    for (const r of rows) if (r.h >= 0 && r.h < 168) out[r.h] = num(r.n);
    return out;
  }

  // the best of everything since the first match
  async records() {
    const one = (sql) => this.q(sql).then((r) => r[0] || null);
    const perMatch = (expr, extra = '') =>
      one(`SELECT max(p.name) AS name, ${expr} AS v, min(m.started_at) AS at
             FROM match_players p JOIN matches m ON m.id = p.match_id ${extra}
            GROUP BY p.match_id, ${WHO} ORDER BY 2 DESC NULLS LAST LIMIT 1`);
    const [run, kills, heads, revives, walked, life, fastest, biggest, night, horde] = await Promise.all([
      one(`SELECT m.nights_survived AS v, m.last_day, m.peak_players, m.started_at AS at, m.outcome,
                  (SELECT string_agg(DISTINCT p.name, ', ') FROM match_players p WHERE p.match_id = m.id) AS names
             FROM matches m WHERE m.outcome IS NOT NULL ORDER BY m.nights_survived DESC NULLS LAST, m.last_day DESC NULLS LAST, m.started_at LIMIT 1`),
      perMatch('sum(p.kills)'),
      perMatch('sum(p.headshots)'),
      perMatch('sum(p.revives_given)'),
      perMatch('sum(p.distance_m)'),
      perMatch(`max((p.stats->>'longestLifeS')::real)`),
      one(`SELECT m.duration_s AS v, m.peak_players, m.started_at AS at,
                  (SELECT string_agg(DISTINCT p.name, ', ') FROM match_players p WHERE p.match_id = m.id) AS names
             FROM matches m WHERE m.outcome = 'victory' AND m.duration_s > 0 ORDER BY m.duration_s LIMIT 1`),
      one(`SELECT peak_players AS v, started_at AS at FROM matches ORDER BY peak_players DESC NULLS LAST, started_at LIMIT 1`),
      one(`SELECT n.kills AS v, n.night, n.started_at AS at FROM match_nights n ORDER BY n.kills DESC NULLS LAST LIMIT 1`),
      one(`SELECT n.horde_size AS v, n.night, n.started_at AS at FROM match_nights n ORDER BY n.horde_size DESC NULLS LAST LIMIT 1`),
    ]);
    const rec = (r, extra = {}) => (r && num(r.v) > 0 ? { value: num(r.v), at: iso(r.at), ...extra } : null);
    return {
      longestRun: rec(run, run ? { day: num(run.last_day), players: num(run.peak_players), outcome: run.outcome, names: run.names || '' } : {}),
      mostKills: rec(kills, kills ? { name: kills.name } : {}),
      mostHeadshots: rec(heads, heads ? { name: heads.name } : {}),
      mostRevives: rec(revives, revives ? { name: revives.name } : {}),
      farthestWalk: rec(walked, walked ? { name: walked.name, value: Math.round(num(walked.v)) } : {}),
      longestLife: rec(life, life ? { name: life.name, value: Math.round(num(life.v)) } : {}),
      fastestEscape: rec(fastest, fastest ? { value: Math.round(num(fastest.v)), players: num(fastest.peak_players), names: fastest.names || '' } : {}),
      biggestGame: rec(biggest),
      deadliestNight: rec(night, night ? { night: num(night.night) } : {}),
      biggestHorde: rec(horde, horde ? { night: num(horde.night) } : {}),
    };
  }

  // the range's best survivors, by the dead they put down
  async topPlayers(since, limit = 10) {
    const rows = await this.q(
      `SELECT (array_agg(p.name ORDER BY p.joined_at DESC))[1] AS name, bool_or(p.user_id IS NOT NULL) AS account,
              sum(p.kills) AS kills, sum(p.headshots) AS headshots, sum(p.nights_survived) AS nights, sum(p.revives_given) AS revives,
              count(DISTINCT p.match_id) AS matches, sum(p.seconds) / 3600 AS hours
         FROM match_players p WHERE p.joined_at >= $1
        GROUP BY ${WHO} HAVING sum(p.kills) > 0 ORDER BY 3 DESC, 5 DESC LIMIT $2`,
      [since, limit]
    );
    return rows.map((r) => ({ name: r.name, account: !!r.account, kills: num(r.kills), headshots: num(r.headshots), nights: num(r.nights), revives: num(r.revives), matches: num(r.matches), hours: r1(r.hours) }));
  }

  // ---------------------------------------------------------------- what only an admin sees
  async _admin(range) {
    const since = PublicStats.since(range);
    const [actives, signups, cohorts, sessions, bounce, loyalty, health, builds, votes, pacing, quits, regulars] = await Promise.all([
      this.q(
        `SELECT count(DISTINCT ${WHO}) FILTER (WHERE p.joined_at >= now() - interval '1 day') AS dau,
                count(DISTINCT ${WHO}) FILTER (WHERE p.joined_at >= now() - interval '7 days') AS wau,
                count(DISTINCT ${WHO}) FILTER (WHERE p.joined_at >= now() - interval '30 days') AS mau,
                (SELECT count(*) FROM users) AS accounts,
                (SELECT count(*) FROM users WHERE created_at >= now() - interval '7 days') AS accounts_week
           FROM match_players p WHERE p.joined_at >= now() - interval '30 days'`
      ),
      this.q(`SELECT ${DAY('created_at')} AS day, count(*) AS n FROM users WHERE created_at >= $1 GROUP BY 1 ORDER BY 1`, [since]),
      this.q(
        `WITH s AS (SELECT ${WHO} AS id, ${DAY('p.joined_at')} AS d FROM match_players p),
              f AS (SELECT id, min(d) AS d0 FROM s GROUP BY id),
              c AS (SELECT f.id, f.d0, bool_or(s.d = f.d0 + 1) AS d1, bool_or(s.d > f.d0 AND s.d <= f.d0 + 7) AS d7, bool_or(s.d > f.d0) AS ever
                      FROM f JOIN s USING (id) GROUP BY f.id, f.d0)
         SELECT d0 AS day, count(*) AS new_players, count(*) FILTER (WHERE d1) AS d1, count(*) FILTER (WHERE d7) AS d7, count(*) FILTER (WHERE ever) AS ever
           FROM c WHERE d0 >= ${DAY('$1::timestamptz')} GROUP BY d0 ORDER BY d0`,
        [since]
      ),
      // a session: one player's time in one match, all their stints of it together
      this.q(
        `WITH s AS (SELECT sum(p.seconds) AS secs FROM match_players p WHERE p.joined_at >= $1 GROUP BY p.match_id, ${WHO})
         SELECT count(*) FILTER (WHERE secs < 60) AS b0, count(*) FILTER (WHERE secs >= 60 AND secs < 300) AS b1,
                count(*) FILTER (WHERE secs >= 300 AND secs < 900) AS b2, count(*) FILTER (WHERE secs >= 900 AND secs < 1800) AS b3,
                count(*) FILTER (WHERE secs >= 1800 AND secs < 3600) AS b4, count(*) FILTER (WHERE secs >= 3600) AS b5,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY secs) AS median, avg(secs) AS mean, count(*) AS n
           FROM s`,
        [since]
      ),
      // new players whose first match lasted under two minutes for them
      this.q(
        `WITH f AS (SELECT DISTINCT ON (${WHO}) ${WHO} AS id, p.match_id, p.joined_at FROM match_players p ORDER BY ${WHO}, p.joined_at),
              s AS (SELECT f.id, sum(p.seconds) AS secs FROM f JOIN match_players p ON p.match_id = f.match_id AND ${WHO} = f.id
                     WHERE f.joined_at >= $1 GROUP BY f.id)
         SELECT count(*) AS n, count(*) FILTER (WHERE secs < 120) AS bounced FROM s`,
        [since]
      ),
      this.q(`SELECT matches_played, players, accounts, avg_days_active, avg_hours FROM analytics_retention($1)`, [since]),
      this.q(`SELECT day, samples, avg_tick_ms, worst_tick_p99, avg_ping_ms, most_zombies, most_players FROM analytics_server_health($1) ORDER BY day`, [since]),
      this.q(
        `SELECT left(build, 7) AS build, min(started_at) AS first, max(started_at) AS last, count(*) AS matches,
                round(100.0 * count(*) FILTER (WHERE outcome = 'victory') / NULLIF(count(*) FILTER (WHERE outcome IN ('victory', 'wipe')), 0), 1) AS victory_pct,
                round(avg(nights_survived), 2) AS avg_nights, round(avg(duration_s)::numeric / 60, 1) AS avg_minutes,
                round(avg(kills)::numeric, 1) AS avg_kills
           FROM matches WHERE started_at >= $1 AND build IS NOT NULL AND build <> '' GROUP BY left(build, 7) ORDER BY min(started_at) DESC LIMIT 15`,
        [since]
      ),
      this.q(`SELECT bucket, votes, avg, too_easy, easy, just_right, hard, too_hard FROM analytics_difficulty($1)`, [since]),
      this.q(`SELECT item, matches_found, avg_found_min, matches_installed, avg_installed_min FROM analytics_supply_pacing($1)`, [since]),
      // where players walk out of a match that is still going: the day they left on, and whether it was day or night
      this.q(
        `SELECT p.left_day AS day, count(*) FILTER (WHERE p.left_phase = 'day') AS by_day, count(*) FILTER (WHERE p.left_phase IN ('night', 'final_stand')) AS by_night
           FROM match_players p WHERE p.joined_at >= $1 AND p.left_reason = 'left' AND p.left_day IS NOT NULL AND p.left_day <= 20
          GROUP BY 1 ORDER BY 1`,
        [since]
      ),
      this.q(
        `SELECT (array_agg(p.name ORDER BY p.joined_at DESC))[1] AS name, bool_or(p.user_id IS NOT NULL) AS account,
                sum(p.seconds) / 3600 AS hours, count(DISTINCT p.match_id) AS matches, count(DISTINCT ${DAY('p.joined_at')}) AS days,
                max(p.left_at) AS last_seen, min(p.joined_at) AS first_seen
           FROM match_players p WHERE p.joined_at >= $1 GROUP BY ${WHO} ORDER BY 3 DESC LIMIT 15`,
        [since]
      ),
    ]);
    const a = actives[0] || {};
    const s = sessions[0] || {};
    const bn = bounce[0] || {};
    return {
      generatedAt: new Date().toISOString(),
      range,
      actives: { dau: num(a.dau), wau: num(a.wau), mau: num(a.mau), accounts: num(a.accounts), accountsWeek: num(a.accounts_week), stickiness: num(a.mau) ? Math.round((100 * num(a.dau)) / num(a.mau)) : 0 },
      signups: signups.map((r) => ({ day: dayKey(r.day), n: num(r.n) })),
      cohorts: cohorts.map((r) => ({ day: dayKey(r.day), newPlayers: num(r.new_players), d1: num(r.d1), d7: num(r.d7), ever: num(r.ever) })),
      sessions: {
        buckets: [
          { label: '< 1 min', n: num(s.b0) },
          { label: '1-5 min', n: num(s.b1) },
          { label: '5-15 min', n: num(s.b2) },
          { label: '15-30 min', n: num(s.b3) },
          { label: '30-60 min', n: num(s.b4) },
          { label: '1 h +', n: num(s.b5) },
        ],
        medianMinutes: r1(num(s.median) / 60),
        meanMinutes: r1(num(s.mean) / 60),
        n: num(s.n),
      },
      bounce: { newPlayers: num(bn.n), bounced: num(bn.bounced), pct: num(bn.n) ? Math.round((100 * num(bn.bounced)) / num(bn.n)) : 0 },
      loyalty: loyalty.map((r) => ({ bucket: r.matches_played, players: num(r.players), accounts: num(r.accounts), avgDays: num(r.avg_days_active), avgHours: num(r.avg_hours) })),
      health: health.map((r) => ({ day: dayKey(r.day), samples: num(r.samples), tickMs: num(r.avg_tick_ms), tickP99: num(r.worst_tick_p99), pingMs: num(r.avg_ping_ms), zombies: num(r.most_zombies), players: num(r.most_players) })),
      builds: builds.map((r) => ({ build: r.build, first: iso(r.first), last: iso(r.last), matches: num(r.matches), victoryPct: r.victory_pct === null ? null : num(r.victory_pct), avgNights: num(r.avg_nights), avgMinutes: num(r.avg_minutes), avgKills: num(r.avg_kills) })),
      votes: votes.map((r) => ({ bucket: r.bucket, votes: num(r.votes), avg: num(r.avg), tooEasy: num(r.too_easy), easy: num(r.easy), justRight: num(r.just_right), hard: num(r.hard), tooHard: num(r.too_hard) })),
      pacing: pacing.map((r) => ({ key: r.item, label: label(r.item), found: num(r.matches_found), foundMin: r.avg_found_min === null ? null : num(r.avg_found_min), installed: num(r.matches_installed), installedMin: r.avg_installed_min === null ? null : num(r.avg_installed_min) })),
      quits: quits.map((r) => ({ day: num(r.day), byDay: num(r.by_day), byNight: num(r.by_night) })),
      regulars: regulars.map((r) => ({ name: r.name, account: !!r.account, hours: r1(r.hours), matches: num(r.matches), days: num(r.days), firstSeen: iso(r.first_seen), lastSeen: iso(r.last_seen) })),
    };
  }
}
