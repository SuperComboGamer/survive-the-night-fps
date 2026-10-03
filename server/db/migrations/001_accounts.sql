-- Accounts, sign-in sessions, lifetime stats, friends and direct messages (server/auth.js, server/dbstats.js,
-- server/social.js).

-- A player who registered: an email address and a password. username is the name they play under.
CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             text NOT NULL,                 -- as typed, trimmed; unique whatever its case
  username          text NOT NULL,                 -- unique whatever its case
  password_hash     text NOT NULL,                 -- scrypt, see auth.js hashPassword
  email_verified_at timestamptz,                   -- (nothing sets it yet: the server sends no mail)
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_login_at     timestamptz,
  last_seen_at      timestamptz
);
CREATE UNIQUE INDEX users_email_lower ON users (lower(email));
CREATE UNIQUE INDEX users_username_lower ON users (lower(username));

-- A signed-in browser. The cookie carries a random token; only its SHA-256 is kept here.
CREATE TABLE sessions (
  token_hash   text PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  ip           text,
  user_agent   text
);
CREATE INDEX sessions_user ON sessions (user_id);
CREATE INDEX sessions_expires ON sessions (expires_at);

-- Lifetime stats, the leaderboard's. An account's are under 'u:<user id>'; a guest's (not signed in) under
-- 'g:<SHA-256 of the id their browser made up>', moved onto their account when they register or sign in from it.
-- kills, nights, wins and revives are the board's (as they happen); the rest are added up as each match ends.
CREATE TABLE player_stats (
  key          text PRIMARY KEY,
  user_id      uuid UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  name         text NOT NULL,
  kills        integer NOT NULL DEFAULT 0,
  nights       integer NOT NULL DEFAULT 0,
  wins         integer NOT NULL DEFAULT 0,
  revives      integer NOT NULL DEFAULT 0,
  games        integer NOT NULL DEFAULT 0,     -- matches played in (a rejoin of the same one is not another)
  deaths       integer NOT NULL DEFAULT 0,
  downs        integer NOT NULL DEFAULT 0,
  headshots    integer NOT NULL DEFAULT 0,
  boss_kills   integer NOT NULL DEFAULT 0,
  best_day     integer NOT NULL DEFAULT 0,     -- the furthest day of any match they were in
  play_seconds integer NOT NULL DEFAULT 0,
  first_seen   timestamptz NOT NULL DEFAULT now(),
  last_seen    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX player_stats_kills ON player_stats (kills DESC) WHERE kills > 0;
CREATE INDEX player_stats_nights ON player_stats (nights DESC) WHERE nights > 0;
CREATE INDEX player_stats_wins ON player_stats (wins DESC) WHERE wins > 0;
CREATE INDEX player_stats_revives ON player_stats (revives DESC) WHERE revives > 0;

-- Friends: a request until it is accepted, then a friendship, kept both ways round (one row for each of them).
CREATE TABLE friend_requests (
  from_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  to_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (from_id, to_id),
  CHECK (from_id <> to_id)
);
CREATE INDEX friend_requests_to ON friend_requests (to_id);

CREATE TABLE friendships (
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  friend_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, friend_id),
  CHECK (user_id <> friend_id)
);

-- Direct messages between two friends.
CREATE TABLE direct_messages (
  id           bigserial PRIMARY KEY,
  sender_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body         text NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
  created_at   timestamptz NOT NULL DEFAULT now(),
  read_at      timestamptz
);
CREATE INDEX direct_messages_pair ON direct_messages (LEAST(sender_id, recipient_id), GREATEST(sender_id, recipient_id), id DESC);
CREATE INDEX direct_messages_unread ON direct_messages (recipient_id, sender_id) WHERE read_at IS NULL;
