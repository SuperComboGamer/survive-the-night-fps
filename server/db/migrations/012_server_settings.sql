-- Settings of the whole game, changed in the database instead of by a deploy (server/serversettings.js reads them
-- every few seconds; `npm run setting` lists and sets them). A key that is not here has its default.
--   max_total_games  the most games running at once over every server (a whole number; absent: only each server's
--                    own MAX_GAMES)
--
-- And who made each game of a cluster (011_cluster.sql): an account (u:<id>) or a guest's address (ip:<address>),
-- who may have one game going at a time. NULL for a quick join's game, which nobody made.

CREATE TABLE server_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cluster_games ADD COLUMN maker text;
CREATE INDEX cluster_games_maker ON cluster_games (maker) WHERE maker IS NOT NULL;
