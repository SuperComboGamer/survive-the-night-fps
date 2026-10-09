-- Active in-run permanent-item trade offers reserve item copies so they cannot be wagered elsewhere.
CREATE TABLE loadout_trade_locks (
  item_id    uuid PRIMARY KEY REFERENCES loadout_items (id) ON DELETE CASCADE,
  room       text NOT NULL,
  trade_id   text NOT NULL,
  owner      text NOT NULL CHECK (owner ~ '^(a:[0-9a-f-]{36}|g:[0-9a-f]{64})$'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX loadout_trade_locks_room ON loadout_trade_locks (room, trade_id);
CREATE INDEX loadout_trade_locks_owner ON loadout_trade_locks (owner);
