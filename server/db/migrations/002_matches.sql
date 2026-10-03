-- Every match played, for tuning the game (server/analytics.js records them in the game's worker,
-- server/matchstore.js writes them here). A match is one run: from the first day to victory, the team wiped out, or
-- everyone leaving. Times are wall-clock; *_s columns and t are seconds of game time since the match began.

CREATE TABLE matches (
  id                  uuid PRIMARY KEY,
  room_code           text,                  -- the game it was played in (codes are reused once a game closes)
  quick               boolean,               -- a game a quick join made
  invite_only         boolean,
  seats               smallint,
  seed                bigint,
  start_day           smallint,
  protocol            smallint,
  build               text,                  -- the deployed commit, when Railway says (RAILWAY_GIT_COMMIT_SHA)
  settings            jsonb,                 -- day / night lengths and the test switches it ran with
  started_at          timestamptz NOT NULL,
  ended_at            timestamptz,
  outcome             text,                  -- victory | wipe | abandoned | interrupted (the server stopped)
  last_day            smallint,              -- how far the team got
  last_phase          text,                  -- day | night | final_stand
  nights_survived     smallint,
  duration_s          real,
  peak_players        smallint,
  unique_players      smallint,
  player_seconds      real,
  supplies_installed  smallint,
  supplies_needed     smallint,
  engine_started_s    real,
  escaped             smallint,
  kills               integer,
  deaths              integer,
  downs               integer,
  revives             integer,
  structures_built    integer,
  structures_lost     integer,
  summary             jsonb
);
CREATE INDEX matches_started ON matches (started_at DESC);
CREATE INDEX matches_open ON matches (started_at) WHERE ended_at IS NULL;

-- One row per stint: a player from when they joined the match to when they left it or it ended. A player who
-- leaves and comes back has two (first_stint on the first).
CREATE TABLE match_players (
  id                 bigserial PRIMARY KEY,
  match_id           uuid NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
  user_id            uuid REFERENCES users (id) ON DELETE SET NULL,
  guest_key          text,                   -- a guest's browser id as stats.js files it (its SHA-256), else null
  name               text,
  first_stint        boolean,
  joined_at          timestamptz,
  left_at            timestamptz,
  seconds            real,
  joined_day         smallint,
  joined_phase       text,
  left_day           smallint,
  left_phase         text,
  left_reason        text,                   -- left | match_end
  outcome            text,
  kills              integer,
  zombie_kills       integer,                -- made while turned
  deaths             integer,
  downs              integer,
  revives_given      integer,
  revives_received   integer,
  damage_dealt       real,
  damage_taken       real,
  shots              integer,
  hits               integer,
  headshots          integer,
  boss_kills         integer,
  nights_survived    smallint,
  distance_m         real,
  crafted            integer,
  built              integer,
  items_used         integer,
  caches_searched    integer,
  supplies_found     integer,
  supplies_installed integer,
  ping_avg           real,
  kills_by_type      jsonb,
  kills_by_weapon    jsonb,
  damage_taken_by    jsonb,
  shots_by_weapon    jsonb,
  hits_by_weapon     jsonb,
  crafted_items      jsonb,
  built_types        jsonb,
  used_items         jsonb,
  stats              jsonb
);
CREATE INDEX match_players_match ON match_players (match_id);
CREATE INDEX match_players_user ON match_players (user_id, joined_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX match_players_guest ON match_players (guest_key) WHERE guest_key IS NOT NULL;

-- One row per night of a match, written when it ends (dawn, the team wiped out, escaped, everyone left).
CREATE TABLE match_nights (
  match_id        uuid NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
  night           smallint NOT NULL,
  started_at      timestamptz,
  ended_at        timestamptz,
  duration_s      real,
  theme           text,
  boss            text,
  boss_killed     boolean,
  horde_size      integer,
  horde_hp_mul    real,
  players_start   smallint,
  survivors_start smallint,
  survivors_end   smallint,
  kills           integer,
  structures_lost integer,
  downs           integer,
  deaths          integer,
  revives         integer,
  outcome         text,                      -- dawn | wipe | escaped | abandoned
  PRIMARY KEY (match_id, night)
);

-- The moments worth knowing about: joins and leaves, downs and deaths (where, and to what), revives, nightfall and
-- dawn, bosses, car supplies found and installed, the engine, victory, the team wiped out...
CREATE TABLE match_events (
  id       bigserial PRIMARY KEY,
  match_id uuid NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
  at       timestamptz NOT NULL DEFAULT now(),
  t        real,
  day      smallint,
  phase    text,
  type     text NOT NULL,
  user_id  uuid REFERENCES users (id) ON DELETE SET NULL,
  name     text,
  x        real,
  z        real,
  data     jsonb
);
CREATE INDEX match_events_match ON match_events (match_id, t);
CREATE INDEX match_events_type ON match_events (type, at DESC);

-- Every 30 s of a running match: how many are in it and how the server is holding up.
CREATE TABLE match_samples (
  match_id  uuid NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
  t         real NOT NULL,
  at        timestamptz NOT NULL DEFAULT now(),
  day       smallint,
  phase     text,
  players   smallint,
  survivors smallint,
  downed    smallint,
  dead      smallint,
  zombies   smallint,
  tick_ms   real,
  tick_p99  real,
  ping_avg  real,
  PRIMARY KEY (match_id, t)
);
