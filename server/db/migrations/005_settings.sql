-- A signed-in player's own settings, kept on their account so they follow them to any browser (server/index.js
-- /api/me/binds, client/net/accountbinds.js). One row per kind of setting: 'binds' is the keybinds (shared/binds.js:
-- only the actions rebound away from their defaults, { action: [primary, secondary] }); other kinds can come later
-- without a new table.
--   updated_at  when the player last changed them, by the clock of the browser they did it in. A browser's copy and
--               this one are reconciled by it - the newer wins - so it is the client's time, not the row's write time.

CREATE TABLE user_settings (
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind        text NOT NULL,
  data        jsonb NOT NULL,
  updated_at  timestamptz NOT NULL,
  saved_at    timestamptz NOT NULL DEFAULT now(),  -- when the server last wrote the row
  PRIMARY KEY (user_id, kind)
);
