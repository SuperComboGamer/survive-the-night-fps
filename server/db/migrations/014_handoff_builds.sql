-- A game the new build cannot carry on is carried on by the build that saved it (server/builds.js, docs/deploys.md).
-- Every server puts its own code here as it starts (server/ and shared/, gzipped: a few hundred KB), filed under a hash
-- of its contents and signed with the deploy's key; a save in game_handoff names the build its game runs on (meta.build),
-- and a server that cannot restore the save with its own code starts that game's worker from this row.
-- handoff_asset: the files of each build's client, once per content (most of them - sound, images - are the same from
-- one build to the next), served to the players of a game carried on by an older build.
-- used_at: when a server last put, fetched or ran on it; rows nobody has used for three days are swept.
-- (Additive only: the old server is still running when the new one migrates.)

CREATE TABLE handoff_build (
  id          text PRIMARY KEY,
  saved_at    timestamptz NOT NULL DEFAULT now(),
  used_at     timestamptz NOT NULL DEFAULT now(),
  bytes       integer NOT NULL,
  sig         text NOT NULL DEFAULT '',
  assets      text[] NOT NULL DEFAULT '{}',
  body        bytea NOT NULL
);

CREATE TABLE handoff_asset (
  hash        text PRIMARY KEY,
  used_at     timestamptz NOT NULL DEFAULT now(),
  bytes       integer NOT NULL,
  body        bytea NOT NULL
);
