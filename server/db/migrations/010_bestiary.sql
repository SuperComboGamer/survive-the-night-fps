-- The bestiary (shared/bestiary.js is the book, server/userbestiary.js keeps it): the kinds of the dead an account has
-- seen, and when it first saw each. A guest's are kept in their browser.
--   ztype  the kind (ZTYPE in shared/defs.js: those numbers are never reused)
CREATE TABLE user_bestiary (
  user_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  ztype    smallint NOT NULL,
  seen_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, ztype)
);
