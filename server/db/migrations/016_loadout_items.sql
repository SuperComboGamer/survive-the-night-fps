-- Permanent loadout items: profile-owned collectible instances, equipped into three run-start slots.
-- Like Dead Hand cards, an owner is an account ('a:<uuid>') or guest browser key ('g:<sha-256>'). Unlike cards,
-- duplicates are individual rows because later trades, wagers and auctions move one copy at a time.
CREATE TABLE loadout_items (
  id          uuid PRIMARY KEY,
  owner       text NOT NULL CHECK (owner ~ '^(a:[0-9a-f-]{36}|g:[0-9a-f]{64})$'),
  user_id     uuid REFERENCES users (id) ON DELETE CASCADE,
  catalog_id  smallint NOT NULL CHECK (catalog_id > 0),
  source      jsonb NOT NULL DEFAULT '{}'::jsonb,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((owner LIKE 'a:%') = (user_id IS NOT NULL))
);
CREATE INDEX loadout_items_owner ON loadout_items (owner, acquired_at, id);

CREATE TABLE loadout_slots (
  owner       text NOT NULL CHECK (owner ~ '^(a:[0-9a-f-]{36}|g:[0-9a-f]{64})$'),
  user_id     uuid REFERENCES users (id) ON DELETE CASCADE,
  slot        smallint NOT NULL CHECK (slot BETWEEN 0 AND 2),
  item_id     uuid REFERENCES loadout_items (id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner, slot),
  CHECK ((owner LIKE 'a:%') = (user_id IS NOT NULL))
);
CREATE UNIQUE INDEX loadout_slots_item ON loadout_slots (item_id) WHERE item_id IS NOT NULL;

-- Every durable change to loadout ownership/equipment, once. grants use the id supplied by the game event;
-- later move kinds can reuse the table for trades, wagers and auctions.
CREATE TABLE loadout_ledger (
  id      text PRIMARY KEY,
  kind    text NOT NULL,
  entries jsonb NOT NULL,
  at      timestamptz NOT NULL DEFAULT now()
);

