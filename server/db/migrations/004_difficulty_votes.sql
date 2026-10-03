-- How hard a run felt, asked of every player on its end screen (client/ui/menus.js EndScreen, server/feedback.js).
-- One vote per player per match: a second click while the end screen is up changes it. The vote carries what the
-- match and the voter's own part in it were as it was cast, so the votes can be split by them without joining
-- (the match's full row and stints are in 002_matches.sql).
--   rating  1 too easy, 2 easy, 3 just right, 4 hard, 5 too hard

CREATE TABLE difficulty_votes (
  match_id         uuid NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
  voter            text NOT NULL,          -- 'u:<user id>' or 'g:<guest key>', as dbstats.js files them
  rating           smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  outcome          text,                   -- the match's: victory | wipe
  last_day         smallint,
  nights_survived  smallint,
  players          smallint,               -- the most players at once in the match
  build            text,                   -- the deployed commit the match was played on
  my_outcome       text,                   -- the voter's, at the match's end: escaped | left_behind | dead | turned
  my_seconds       real,                   -- how long they played of it
  my_kills         integer,
  my_deaths        integer,
  my_downs         integer,
  my_matches       integer,                -- matches they had played, this one included: how new they are to the game
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, voter)
);
CREATE INDEX difficulty_votes_created ON difficulty_votes (created_at DESC);

-- How hard the game is, and for whom: the votes since then, overall and split by how the run went, how far it got,
-- the team's size and the voter's experience. avg is 1 (too easy) .. 5 (too hard), 3 just right; the rest are the
-- share of the votes on each answer, in percent.
CREATE FUNCTION analytics_difficulty(since timestamptz DEFAULT '-infinity')
RETURNS TABLE (bucket text, votes bigint, avg numeric, too_easy numeric, easy numeric, just_right numeric, hard numeric, too_hard numeric)
LANGUAGE sql STABLE AS $$
  WITH v AS (SELECT * FROM difficulty_votes WHERE created_at >= since),
  b AS (
    SELECT 0 AS o, 0 AS s, 'all' AS bucket, rating FROM v
    UNION ALL SELECT 1, 0, 'run: ' || COALESCE(outcome, '?'), rating FROM v
    UNION ALL SELECT 2, COALESCE(nights_survived, -1), 'nights survived: ' || COALESCE(nights_survived::text, '?'), rating FROM v
    UNION ALL SELECT 3, CASE WHEN players <= 1 THEN 1 WHEN players <= 3 THEN 2 ELSE 3 END,
                     CASE WHEN players <= 1 THEN 'team: solo' WHEN players <= 3 THEN 'team: 2-3' ELSE 'team: 4+' END, rating FROM v
    UNION ALL SELECT 4, CASE WHEN my_outcome IN ('escaped', 'left_behind') THEN 1 ELSE 2 END,
                     CASE WHEN my_outcome IN ('escaped', 'left_behind') THEN 'me: alive at the end' ELSE 'me: dead or turned' END, rating FROM v
    UNION ALL SELECT 5, CASE WHEN my_matches <= 1 THEN 1 WHEN my_matches <= 5 THEN 2 ELSE 3 END,
                     CASE WHEN my_matches <= 1 THEN 'played: first match' WHEN my_matches <= 5 THEN 'played: 2-5 matches' ELSE 'played: 6+ matches' END, rating FROM v
  )
  SELECT bucket, count(*), round(avg(rating), 2),
         round(100.0 * count(*) FILTER (WHERE rating = 1) / count(*), 1),
         round(100.0 * count(*) FILTER (WHERE rating = 2) / count(*), 1),
         round(100.0 * count(*) FILTER (WHERE rating = 3) / count(*), 1),
         round(100.0 * count(*) FILTER (WHERE rating = 4) / count(*), 1),
         round(100.0 * count(*) FILTER (WHERE rating = 5) / count(*), 1)
    FROM b GROUP BY o, s, bucket ORDER BY o, s
$$;
