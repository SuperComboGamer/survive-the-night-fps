-- Zombie Skulls and the loadout item auction house.
-- Balances are per owner (account or guest), every change is ledgered once, and active listings reserve one item copy.
CREATE TABLE loadout_skull_balances (
  owner      text PRIMARY KEY CHECK (owner ~ '^(a:[0-9a-f-]{36}|g:[0-9a-f]{64})$'),
  user_id    uuid REFERENCES users (id) ON DELETE CASCADE,
  balance    integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((owner LIKE 'a:%') = (user_id IS NOT NULL))
);

CREATE TABLE loadout_skull_ledger (
  id    text PRIMARY KEY,
  kind  text NOT NULL,
  meta  jsonb NOT NULL DEFAULT '{}'::jsonb,
  at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE loadout_skull_entries (
  ledger_id text NOT NULL REFERENCES loadout_skull_ledger (id) ON DELETE CASCADE,
  owner     text NOT NULL CHECK (owner ~ '^(a:[0-9a-f-]{36}|g:[0-9a-f]{64})$'),
  user_id   uuid REFERENCES users (id) ON DELETE CASCADE,
  delta     integer NOT NULL CHECK (delta <> 0),
  PRIMARY KEY (ledger_id, owner),
  CHECK ((owner LIKE 'a:%') = (user_id IS NOT NULL))
);
CREATE INDEX loadout_skull_entries_owner ON loadout_skull_entries (owner, ledger_id);

CREATE TABLE loadout_auction_listings (
  id             uuid PRIMARY KEY,
  item_id        uuid NOT NULL REFERENCES loadout_items (id) ON DELETE CASCADE,
  seller         text NOT NULL CHECK (seller ~ '^a:[0-9a-f-]{36}$'),
  seller_user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  catalog_id     smallint NOT NULL CHECK (catalog_id > 0),
  price          integer NOT NULL CHECK (price BETWEEN 1 AND 100000),
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'sold', 'cancelled', 'expired')),
  buyer          text CHECK (buyer IS NULL OR buyer ~ '^a:[0-9a-f-]{36}$'),
  buyer_user_id  uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  closed_at      timestamptz,
  ledger_id      text,
  CHECK ((buyer IS NULL AND buyer_user_id IS NULL) OR (buyer IS NOT NULL AND buyer_user_id IS NOT NULL))
);
CREATE UNIQUE INDEX loadout_auction_active_item ON loadout_auction_listings (item_id) WHERE status = 'active';
CREATE INDEX loadout_auction_active ON loadout_auction_listings (status, expires_at, price);
CREATE INDEX loadout_auction_seller ON loadout_auction_listings (seller, status, created_at DESC);
