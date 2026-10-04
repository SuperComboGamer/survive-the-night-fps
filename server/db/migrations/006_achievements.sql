-- Achievements (shared/achievements.js has the list, server/userachievements.js keeps them): an account's lifetime
-- counts and what it has unlocked. A guest's are kept in their browser and merged in here when they sign in. None of
-- this feeds the leaderboard (player_stats): a merge brings what a browser says it earned, and a browser can say
-- anything.

-- One row per account and count (ACH_STATS: kills, nights, escapes, ...). 'day_mark' is not a count: the last day
-- (days since 1970, UTC) the account played on, for the 'days' count.
CREATE TABLE user_achievement_stats (
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  stat       text NOT NULL,
  value      bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, stat)
);

-- What an account has unlocked, and when. A counter's progress is its stat's row above.
--   source  'game': the server saw it earned on this account; 'guest': it came over from a browser's guest record
CREATE TABLE user_achievements (
  user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  achievement_id text NOT NULL,
  unlocked_at    timestamptz NOT NULL DEFAULT now(),
  source         text NOT NULL DEFAULT 'game',
  PRIMARY KEY (user_id, achievement_id)
);
