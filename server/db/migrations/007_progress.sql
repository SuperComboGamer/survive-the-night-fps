-- Experience and perks (shared/progress.js): what a player has earned over every game, beside the rest of their stats.
--   xp       counted as it is earned, written with the board's stats (DbStats.flush). The level is worked out from it
--   perks    the perk ids they picked, in the order they picked them (checked against their level when read)
--   respecs  how many times they have started their picks over: each deals them new offers (perkSalt)

ALTER TABLE player_stats
  ADD COLUMN xp      integer  NOT NULL DEFAULT 0,
  ADD COLUMN perks   smallint[] NOT NULL DEFAULT '{}',
  ADD COLUMN respecs integer  NOT NULL DEFAULT 0;
