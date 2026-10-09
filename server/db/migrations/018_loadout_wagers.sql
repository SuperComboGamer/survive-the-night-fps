-- Dead Hand loadout item wagers.
-- Active rows reserve a profile item copy while a lobby or in-run match is being agreed, played, or settled.
CREATE TABLE loadout_wager_locks (
  item_id    uuid PRIMARY KEY REFERENCES loadout_items (id) ON DELETE CASCADE,
  lock_id    text NOT NULL,
  room       text NOT NULL,
  match_id   text NOT NULL,
  owner      text NOT NULL CHECK (owner ~ '^(a:[0-9a-f-]{36}|g:[0-9a-f]{64})$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX loadout_wager_locks_room ON loadout_wager_locks (room, match_id);
CREATE INDEX loadout_wager_locks_owner ON loadout_wager_locks (owner);
