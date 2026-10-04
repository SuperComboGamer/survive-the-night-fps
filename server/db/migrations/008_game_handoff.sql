-- Deploys without ending the games (server/handoff.js). A server going down saves each game being played here, one
-- row per game, and NOTIFYs game_handoff with its code; the next server claims the row (DELETE ... RETURNING: only one
-- server gets it) and carries the game on under the same code. A row nobody claims is swept after a few minutes.
-- (Additive only: the old server is still running when the new one migrates.)

CREATE TABLE game_handoff (
  code        text PRIMARY KEY,
  saved_at    timestamptz NOT NULL DEFAULT now(),
  build       text NOT NULL DEFAULT '',  -- RAILWAY_GIT_COMMIT_SHA of the server that saved it
  format      integer NOT NULL,          -- the envelope's shape (handoff.js FORMAT)
  state_ver   integer NOT NULL,          -- STATE_VERSION of the server that saved it
  bytes       integer NOT NULL,
  meta        jsonb NOT NULL,            -- the room: name, host, invite only, seats, when it was made, its match
  body        bytea NOT NULL             -- the game: the gzipped JSON envelope
);

-- A match outcome is now also 'handoff': the server went down for a deploy and the next one carried the game on, as a
-- new match whose `continues` names this one (002 lists the others: victory | wipe | abandoned | interrupted).
ALTER TABLE matches ADD COLUMN continues uuid;

-- (as in 003, with the halves of a game a deploy split left out too: neither is a whole run)
CREATE OR REPLACE FUNCTION analytics_by_team_size(since timestamptz DEFAULT '-infinity')
RETURNS TABLE (team smallint, matches bigint, victory_pct numeric, wipe_pct numeric, abandoned_pct numeric,
               avg_last_day numeric, avg_nights_survived numeric, avg_minutes numeric)
LANGUAGE sql STABLE AS $$
  SELECT peak_players, count(*),
         round(100.0 * count(*) FILTER (WHERE outcome = 'victory') / count(*), 1),
         round(100.0 * count(*) FILTER (WHERE outcome = 'wipe') / count(*), 1),
         round(100.0 * count(*) FILTER (WHERE outcome = 'abandoned') / count(*), 1),
         round(avg(last_day), 2), round(avg(nights_survived), 2), round(avg(duration_s)::numeric / 60, 1)
    FROM matches
   WHERE started_at >= since AND outcome IS NOT NULL AND outcome NOT IN ('interrupted', 'handoff') AND continues IS NULL
   GROUP BY peak_players ORDER BY peak_players
$$;
