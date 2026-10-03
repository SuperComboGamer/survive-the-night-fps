-- Questions for tuning the game, asked of the match records (002_matches.sql). Each is a function of when to
-- count from, so the same question can be asked of the last week, or of everything since a balance change:
--   SELECT * FROM analytics_night_funnel(now() - interval '7 days');
--   SELECT * FROM analytics_weapons((SELECT min(started_at) FROM matches WHERE build LIKE 'abc123%'));
-- `npm run report` (scripts/analytics-report.js) prints them all. A player is their account, or a guest's
-- browser, or failing both their name.

-- one row: how much the game is played, and how it goes
CREATE FUNCTION analytics_overview(since timestamptz DEFAULT '-infinity')
RETURNS TABLE (matches bigint, finished bigint, victories bigint, wipes bigint, abandoned bigint, interrupted bigint,
               players bigint, accounts bigint, guests bigint, avg_team numeric, player_hours numeric,
               avg_minutes numeric, avg_last_day numeric, best_day smallint)
LANGUAGE sql STABLE AS $$
  WITH m AS (SELECT * FROM matches WHERE started_at >= since),
       p AS (SELECT mp.* FROM match_players mp JOIN m ON m.id = mp.match_id)
  SELECT
    (SELECT count(*) FROM m),
    (SELECT count(*) FROM m WHERE outcome IS NOT NULL),
    (SELECT count(*) FROM m WHERE outcome = 'victory'),
    (SELECT count(*) FROM m WHERE outcome = 'wipe'),
    (SELECT count(*) FROM m WHERE outcome = 'abandoned'),
    (SELECT count(*) FROM m WHERE outcome = 'interrupted'),
    (SELECT count(DISTINCT COALESCE(user_id::text, 'g:' || guest_key, 'n:' || name)) FROM p),
    (SELECT count(DISTINCT user_id) FROM p),
    (SELECT count(DISTINCT guest_key) FROM p),
    (SELECT round(avg(peak_players), 2) FROM m WHERE outcome IS NOT NULL),
    (SELECT round(sum(seconds)::numeric / 3600, 1) FROM p),
    (SELECT round(avg(duration_s)::numeric / 60, 1) FROM m WHERE outcome IS NOT NULL),
    (SELECT round(avg(last_day), 2) FROM m WHERE outcome IS NOT NULL),
    (SELECT max(last_day) FROM m)
$$;

-- per day: who played and how far they got
CREATE FUNCTION analytics_daily(since timestamptz DEFAULT '-infinity')
RETURNS TABLE (day date, matches bigint, players bigint, player_hours numeric, victories bigint, wipes bigint, avg_last_day numeric)
LANGUAGE sql STABLE AS $$
  WITH d AS (SELECT started_at::date AS day, count(*) AS matches, count(*) FILTER (WHERE outcome = 'victory') AS victories,
                    count(*) FILTER (WHERE outcome = 'wipe') AS wipes, round(avg(last_day), 2) AS avg_last_day
               FROM matches WHERE started_at >= since GROUP BY 1),
       p AS (SELECT m.started_at::date AS day, count(DISTINCT COALESCE(p.user_id::text, 'g:' || p.guest_key, 'n:' || p.name)) AS players,
                    round(sum(p.seconds)::numeric / 3600, 1) AS hours
               FROM match_players p JOIN matches m ON m.id = p.match_id WHERE m.started_at >= since GROUP BY 1)
  SELECT d.day, d.matches, COALESCE(p.players, 0), COALESCE(p.hours, 0), d.victories, d.wipes, d.avg_last_day
    FROM d LEFT JOIN p USING (day) ORDER BY d.day DESC
$$;

-- how it goes by the size of the team (the most there were at once)
CREATE FUNCTION analytics_by_team_size(since timestamptz DEFAULT '-infinity')
RETURNS TABLE (team smallint, matches bigint, victory_pct numeric, wipe_pct numeric, abandoned_pct numeric,
               avg_last_day numeric, avg_nights_survived numeric, avg_minutes numeric)
LANGUAGE sql STABLE AS $$
  SELECT peak_players, count(*),
         round(100.0 * count(*) FILTER (WHERE outcome = 'victory') / count(*), 1),
         round(100.0 * count(*) FILTER (WHERE outcome = 'wipe') / count(*), 1),
         round(100.0 * count(*) FILTER (WHERE outcome = 'abandoned') / count(*), 1),
         round(avg(last_day), 2), round(avg(nights_survived), 2), round(avg(duration_s)::numeric / 60, 1)
    FROM matches
   WHERE started_at >= since AND outcome IS NOT NULL AND outcome <> 'interrupted'
   GROUP BY peak_players ORDER BY peak_players
$$;

-- night by night: how many teams got to it, how many saw it through, and what it cost them
CREATE FUNCTION analytics_night_funnel(since timestamptz DEFAULT '-infinity')
RETURNS TABLE (night smallint, reached bigint, survived bigint, wiped bigint, escaped bigint, survive_pct numeric,
               avg_team numeric, avg_horde numeric, avg_deaths numeric, avg_downs numeric, avg_structures_lost numeric,
               boss_kill_pct numeric, survivors_kept_pct numeric)
LANGUAGE sql STABLE AS $$
  SELECT n.night, count(*),
         count(*) FILTER (WHERE n.outcome = 'dawn'),
         count(*) FILTER (WHERE n.outcome = 'wipe'),
         count(*) FILTER (WHERE n.outcome = 'escaped'),
         round(100.0 * count(*) FILTER (WHERE n.outcome IN ('dawn', 'escaped')) / NULLIF(count(*) FILTER (WHERE n.outcome <> 'abandoned'), 0), 1),
         round(avg(n.players_start), 2), round(avg(n.horde_size), 1), round(avg(n.deaths), 2), round(avg(n.downs), 2),
         round(avg(n.structures_lost), 1),
         round(100.0 * count(*) FILTER (WHERE n.boss_killed) / NULLIF(count(*) FILTER (WHERE n.boss IS NOT NULL), 0), 1),
         round(100.0 * sum(n.survivors_end) / NULLIF(sum(n.survivors_start), 0), 1)
    FROM match_nights n JOIN matches m ON m.id = n.match_id
   WHERE m.started_at >= since
   GROUP BY n.night ORDER BY n.night
$$;

-- each boss: how often it comes, is put down, and takes the team with it
CREATE FUNCTION analytics_bosses(since timestamptz DEFAULT '-infinity')
RETURNS TABLE (boss text, nights bigint, killed bigint, kill_pct numeric, wipe_pct numeric, avg_night numeric)
LANGUAGE sql STABLE AS $$
  SELECT n.boss, count(*), count(*) FILTER (WHERE n.boss_killed),
         round(100.0 * count(*) FILTER (WHERE n.boss_killed) / count(*), 1),
         round(100.0 * count(*) FILTER (WHERE n.outcome = 'wipe') / count(*), 1),
         round(avg(n.night), 2)
    FROM match_nights n JOIN matches m ON m.id = n.match_id
   WHERE m.started_at >= since AND n.boss IS NOT NULL
   GROUP BY n.boss ORDER BY count(*) DESC
$$;

-- what puts survivors down and kills them, and on which night on average
CREATE FUNCTION analytics_death_causes(since timestamptz DEFAULT '-infinity')
RETURNS TABLE (cause text, deaths bigint, downs bigint, death_pct numeric, avg_day numeric, at_night_pct numeric)
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(e.data->>'cause', 'unknown'),
         count(*) FILTER (WHERE e.type = 'death'),
         count(*) FILTER (WHERE e.type = 'down'),
         round(100.0 * count(*) FILTER (WHERE e.type = 'death') / NULLIF(sum(count(*) FILTER (WHERE e.type = 'death')) OVER (), 0), 1),
         round(avg(e.day), 2),
         round(100.0 * count(*) FILTER (WHERE e.phase = 'night') / count(*), 1)
    FROM match_events e JOIN matches m ON m.id = e.match_id
   WHERE m.started_at >= since AND e.type IN ('death', 'down')
   GROUP BY 1 ORDER BY 2 DESC, 3 DESC
$$;

-- where the damage survivors take comes from
CREATE FUNCTION analytics_damage_sources(since timestamptz DEFAULT '-infinity')
RETURNS TABLE (source text, damage numeric, share_pct numeric)
LANGUAGE sql STABLE AS $$
  SELECT d.key, round(sum(d.value::numeric), 0), round(100 * sum(d.value::numeric) / NULLIF(sum(sum(d.value::numeric)) OVER (), 0), 1)
    FROM match_players p JOIN matches m ON m.id = p.match_id, jsonb_each_text(COALESCE(p.damage_taken_by, '{}'::jsonb)) d
   WHERE m.started_at >= since
   GROUP BY d.key ORDER BY 2 DESC
$$;

-- each weapon: rounds fired, hits, kills
CREATE FUNCTION analytics_weapons(since timestamptz DEFAULT '-infinity')
RETURNS TABLE (weapon text, shots numeric, hits numeric, accuracy_pct numeric, kills numeric, kills_per_100_shots numeric, players bigint)
LANGUAGE sql STABLE AS $$
  WITH p AS (SELECT mp.* FROM match_players mp JOIN matches m ON m.id = mp.match_id WHERE m.started_at >= since),
       s AS (SELECT key, sum(value::numeric) AS n, count(DISTINCT p.id) AS who FROM p, jsonb_each_text(COALESCE(p.shots_by_weapon, '{}'::jsonb)) GROUP BY key),
       h AS (SELECT key, sum(value::numeric) AS n FROM p, jsonb_each_text(COALESCE(p.hits_by_weapon, '{}'::jsonb)) GROUP BY key),
       k AS (SELECT key, sum(value::numeric) AS n FROM p, jsonb_each_text(COALESCE(p.kills_by_weapon, '{}'::jsonb)) GROUP BY key)
  SELECT w.key, COALESCE(s.n, 0), COALESCE(h.n, 0), round(100 * h.n / NULLIF(s.n, 0), 1), COALESCE(k.n, 0), round(100 * k.n / NULLIF(s.n, 0), 1), COALESCE(s.who, 0)
    FROM (SELECT key FROM s UNION SELECT key FROM h UNION SELECT key FROM k) w
    LEFT JOIN s USING (key) LEFT JOIN h USING (key) LEFT JOIN k USING (key)
   ORDER BY COALESCE(k.n, 0) DESC, COALESCE(s.n, 0) DESC
$$;

-- the dead put down, by kind
CREATE FUNCTION analytics_kills_by_type(since timestamptz DEFAULT '-infinity')
RETURNS TABLE (zombie text, kills numeric, share_pct numeric)
LANGUAGE sql STABLE AS $$
  SELECT d.key, sum(d.value::numeric), round(100 * sum(d.value::numeric) / NULLIF(sum(sum(d.value::numeric)) OVER (), 0), 1)
    FROM match_players p JOIN matches m ON m.id = p.match_id, jsonb_each_text(COALESCE(p.kills_by_type, '{}'::jsonb)) d
   WHERE m.started_at >= since
   GROUP BY d.key ORDER BY 2 DESC
$$;

-- pacing: how long into a match each car supply is first found, and first installed
CREATE FUNCTION analytics_supply_pacing(since timestamptz DEFAULT '-infinity')
RETURNS TABLE (item text, matches_found bigint, avg_found_min numeric, matches_installed bigint, avg_installed_min numeric)
LANGUAGE sql STABLE AS $$
  WITH f AS (SELECT e.match_id, e.data->>'item' AS item, min(e.t) AS t FROM match_events e JOIN matches m ON m.id = e.match_id
              WHERE m.started_at >= since AND e.type = 'supply_found' GROUP BY 1, 2),
       i AS (SELECT e.match_id, e.data->>'item' AS item, min(e.t) AS t FROM match_events e JOIN matches m ON m.id = e.match_id
              WHERE m.started_at >= since AND e.type = 'supply_install' GROUP BY 1, 2)
  SELECT COALESCE(f.item, i.item), count(f.t), round(avg(f.t)::numeric / 60, 1), count(i.t), round(avg(i.t)::numeric / 60, 1)
    FROM f FULL JOIN i ON i.match_id = f.match_id AND i.item = f.item
   GROUP BY 1 ORDER BY 3 NULLS LAST
$$;

-- do people come back? players by how many matches they have played in
CREATE FUNCTION analytics_retention(since timestamptz DEFAULT '-infinity')
RETURNS TABLE (matches_played text, players bigint, accounts bigint, avg_days_active numeric, avg_hours numeric)
LANGUAGE sql STABLE AS $$
  WITH who AS (
    SELECT COALESCE(p.user_id::text, 'g:' || p.guest_key, 'n:' || p.name) AS id, bool_or(p.user_id IS NOT NULL) AS account,
           count(DISTINCT p.match_id) AS n, count(DISTINCT p.joined_at::date) AS days, sum(p.seconds) AS secs
      FROM match_players p JOIN matches m ON m.id = p.match_id
     WHERE m.started_at >= since
     GROUP BY 1)
  SELECT CASE WHEN n = 1 THEN '1' WHEN n <= 3 THEN '2-3' WHEN n <= 9 THEN '4-9' ELSE '10+' END,
         count(*), count(*) FILTER (WHERE account), round(avg(days), 2), round(avg(secs)::numeric / 3600, 2)
    FROM who GROUP BY 1 ORDER BY min(n)
$$;

-- is the server keeping up: tick times and pings from the 30 s samples, per day
CREATE FUNCTION analytics_server_health(since timestamptz DEFAULT '-infinity')
RETURNS TABLE (day date, samples bigint, avg_tick_ms numeric, worst_tick_p99 numeric, avg_ping_ms numeric, most_zombies smallint, most_players smallint)
LANGUAGE sql STABLE AS $$
  SELECT s.at::date, count(*), round(avg(s.tick_ms)::numeric, 2), round(max(s.tick_p99)::numeric, 1),
         round(avg(s.ping_avg)::numeric, 0), max(s.zombies), max(s.players)
    FROM match_samples s JOIN matches m ON m.id = s.match_id
   WHERE m.started_at >= since
   GROUP BY 1 ORDER BY 1 DESC
$$;
