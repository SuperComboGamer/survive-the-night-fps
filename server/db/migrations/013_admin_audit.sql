-- The admin panel's record of what was done with it (server/adminpanel.js, /admin): every action an admin took
-- that changes something - a game reset or closed, a player removed, a setting changed, an account's admin flag -
-- with who did it, when, to what, and how it went. Looking at things is not recorded. Rows are only ever added.
-- (Additive only: the old server is still running when the new one migrates.)

CREATE TABLE admin_audit (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  admin_id    uuid REFERENCES users (id) ON DELETE SET NULL, -- (the name stays if the account is ever deleted)
  admin_name  text NOT NULL,
  action      text NOT NULL,              -- game.reset, game.close, server.drain, setting.set, account.admin, ...
  target      text NOT NULL DEFAULT '',   -- a game's code, an account's name, a setting's key; '' for the server
  detail      jsonb NOT NULL DEFAULT '{}',-- what was asked for (a reason, a value): never a secret
  ok          boolean NOT NULL,
  result      text NOT NULL DEFAULT '',   -- what happened, or why it did not
  server_id   text NOT NULL DEFAULT ''    -- the server it was done on (cluster.js), '' for a server on its own
);
CREATE INDEX admin_audit_at ON admin_audit (at DESC);
