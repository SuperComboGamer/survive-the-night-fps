-- Dead Hand, the card game (shared/cards.js is the set, server/usercards.js keeps the collections): the cards each
-- player has found, the decks they built, and every move of cards from one owner to another.
--   owner  whose they are: 'a:<account id>' an account's, 'g:<sha-256 of the browser id>' a guest's (the key their
--          leaderboard record is under, stats.js idKey), 'm:<match uuid>' a bet held while that match is played (the
--          escrow: both bets, until they go to the winner or back)
--   user_id  the account behind an 'a:' owner (so an account deleted takes its cards with it); NULL for the others
--   card   the card's id in shared/cards.js (those ids are never reused)
--   n      how many copies of it they have found, on top of the starter set everyone has (which is never stored)
CREATE TABLE user_cards (
  owner       text NOT NULL CHECK (owner ~ '^(a:[0-9a-f-]{36}|g:[0-9a-f]{64}|m:[0-9a-f-]{36})$'),
  user_id     uuid REFERENCES users (id) ON DELETE CASCADE,
  card        smallint NOT NULL CHECK (card > 0),
  n           integer NOT NULL CHECK (n >= 0 AND n <= 9999),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner, card),
  CHECK ((owner LIKE 'a:%') = (user_id IS NOT NULL))
);
-- the bets still held, oldest first: what the sweep gives back when the game that held them never did
CREATE INDEX user_cards_escrow ON user_cards (updated_at) WHERE owner LIKE 'm:%';

-- A player's decks: four slots each. leader: the leader card (it sets the deck's faction); cards: { "<id>": n }.
CREATE TABLE user_decks (
  owner       text NOT NULL CHECK (owner ~ '^(a:[0-9a-f-]{36}|g:[0-9a-f]{64})$'),
  user_id     uuid REFERENCES users (id) ON DELETE CASCADE,
  slot        smallint NOT NULL CHECK (slot BETWEEN 0 AND 3),
  name        text NOT NULL DEFAULT '',
  leader      smallint NOT NULL,
  cards       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner, slot),
  CHECK ((owner LIKE 'a:%') = (user_id IS NOT NULL))
);

-- Every move of cards between owners, once: a trade, a bet put up ('<match uuid>:lock'), paid to the winner (':pay')
-- or given back (':back'). The id is the move's own, so one sent twice (a retry, a game handed to the next server
-- with it under way) is applied once. moves: [[from, to, card, n], ...]
CREATE TABLE card_ledger (
  id     text PRIMARY KEY,
  kind   text NOT NULL,
  moves  jsonb NOT NULL,
  at     timestamptz NOT NULL DEFAULT now()
);
