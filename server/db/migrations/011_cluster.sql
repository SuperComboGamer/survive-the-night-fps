-- Several game servers behind the proxy (server/cluster.js, server/proxy/). Each server keeps its own row up to date
-- every few seconds, a row per game it runs, and a row per account it has a /social socket or a player of; the proxy
-- reads them to send each request to the server that has what it asks for. A server that stops refreshing its row is
-- gone, and so is everything that names it. Only used with CLUSTER=1: a server on its own never touches them.
-- (Additive only: the old server is still running when the new one migrates.)

CREATE TABLE cluster_servers (
  id          text PRIMARY KEY,          -- CLUSTER_ID, RAILWAY_REPLICA_ID, or host:port
  addr        text NOT NULL,             -- where the proxy reaches it (a private address)
  port        integer NOT NULL,
  deployment  text NOT NULL DEFAULT '',  -- the deploy it came with: new games go to the newest one's servers
  build       text NOT NULL DEFAULT '',  -- the client build it serves (api/version)
  started_at  timestamptz NOT NULL DEFAULT now(),
  seen_at     timestamptz NOT NULL DEFAULT now(),
  draining    boolean NOT NULL DEFAULT false, -- going down: nothing new is sent to it
  games       integer NOT NULL DEFAULT 0,
  players     integer NOT NULL DEFAULT 0,
  max_games   integer NOT NULL DEFAULT 0,
  info        jsonb NOT NULL DEFAULT '{}' -- what the lobby says of it besides: { defaultPlayers, maxPlayers }
);

CREATE TABLE cluster_games (
  code        text PRIMARY KEY,
  server_id   text NOT NULL,             -- the server it is on (on a deploy: the one it is being handed to)
  invite_only boolean NOT NULL,
  info        jsonb NOT NULL,            -- Room.info(): what the lobby's list and a friend's presence show of it
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cluster_games_server ON cluster_games (server_id);

-- An account on a server: a /social socket open there (online) and/or playing in one of its games (code)
CREATE TABLE cluster_presence (
  user_id     uuid NOT NULL,
  server_id   text NOT NULL,
  online      boolean NOT NULL,
  code        text,
  at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, server_id)
);
CREATE INDEX cluster_presence_server ON cluster_presence (server_id);
