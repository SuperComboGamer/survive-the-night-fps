// Migrations: the SQL files in server/db/migrations, applied in the order of their names (001_..., 002_...), each
// once. schema_migrations says which have been; all that are pending go in one transaction, under an advisory lock,
// so two processes migrating at once (a deploy's pre-deploy step and a server starting) do it once between them and
// a migration that fails leaves the database as it was.
//
// Run by `npm run migrate` (scripts/migrate.js) - on Railway that is the service's pre-deploy command
// (railway.json), so a deploy whose migrations fail never goes live - and by the server itself on start when the
// database is a PGlite one (local development) or MIGRATE_ON_START=1.
//
// A migration that has been applied is never edited: changing the schema is a new file. One whose text changed
// after it went in is said out loud (its checksum), not run again.
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));
const LOCK = 7_420_311; // pg_advisory_xact_lock key: ours, arbitrary
const NAME = /^\d{3,}_[a-z0-9_]+\.sql$/;

export function migrationFiles(dir = MIGRATIONS_DIR) {
  return readdirSync(dir)
    .filter((f) => NAME.test(f))
    .sort()
    .map((name) => {
      const sql = readFileSync(dir + name, 'utf8');
      return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    });
}

const TABLE = `CREATE TABLE IF NOT EXISTS schema_migrations (
  name       text PRIMARY KEY,
  checksum   text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
)`;

// Applies whatever is pending. -> { applied: [names], pending: 0, changed: [names whose file no longer matches] }
export async function migrate(db, { dir = MIGRATIONS_DIR, log = () => {} } = {}) {
  const files = migrationFiles(dir);
  return db.tx(async (t) => {
    await t.query('SELECT pg_advisory_xact_lock($1)', [LOCK]);
    await t.exec(TABLE);
    const done = new Map((await t.query('SELECT name, checksum FROM schema_migrations')).rows.map((r) => [r.name, r.checksum]));
    const applied = [];
    const changed = [];
    for (const f of files) {
      if (done.has(f.name)) {
        if (done.get(f.name) !== f.checksum) changed.push(f.name);
        continue;
      }
      log(`migrate: applying ${f.name}`);
      try {
        await t.exec(f.sql);
      } catch (err) {
        err.message = `${f.name}: ${err.message}`;
        throw err;
      }
      await t.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [f.name, f.checksum]);
      applied.push(f.name);
    }
    for (const name of changed) log(`migrate: ${name} was edited after it was applied - it is not run again; put changes in a new migration`);
    return { applied, pending: 0, changed };
  });
}

// What has not been applied yet (without applying it): the names. A database never migrated has them all pending.
export async function pendingMigrations(db, { dir = MIGRATIONS_DIR } = {}) {
  const files = migrationFiles(dir);
  let done = new Set();
  try {
    done = new Set((await db.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  } catch (err) {
    if (err.code !== '42P01') throw err; // (undefined_table: nothing has ever been applied)
  }
  return files.filter((f) => !done.has(f.name)).map((f) => f.name);
}
