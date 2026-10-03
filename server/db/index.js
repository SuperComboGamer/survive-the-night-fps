// The database: Postgres, named by DATABASE_URL. Accounts, sessions, friends and messages (auth.js, social.js), the
// leaderboard (dbstats.js) and every match played (matchstore.js) live in it. Only the network thread talks to it
// (index.js, rooms.js): the games in their workers post what they have to say to that thread, as the leaderboard
// always has.
//
//   postgres://user:pass@host:5432/db   a real server (Railway's Postgres: the service's DATABASE_URL)
//   pglite:./data/pglite                Postgres compiled to WebAssembly, in this process, kept in that folder
//   pglite:memory                       the same, kept nowhere: tests (@electric-sql/pglite, a dev dependency)
//
// Without DATABASE_URL there is no database: the server runs as it did before one, with the leaderboard in a file
// (stats.js) and no accounts.
//
// What the rest of the server sees, either way:
//   db.query(text, params)  -> { rows, rowCount }      one statement, $1.. parameters
//   db.exec(text)                                      any number of statements, no parameters (migrations)
//   db.tx(async (t) => ...)                            t.query / t.exec inside one transaction
//   db.close()
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import pg from 'pg';

// int8 (bigint, count(*), sum) comes back as a string from pg: every one of ours fits in a double
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v))); // numeric (avg, round)

const norm = (r) => ({ rows: r.rows || [], rowCount: r.rowCount ?? r.affectedRows ?? (r.rows ? r.rows.length : 0) });

// where a URL points, for the log: never its password
export function describeUrl(url) {
  if (!url) return 'none';
  if (url.startsWith('pglite:')) return url;
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}${u.pathname}`;
  } catch {
    return 'postgres';
  }
}

export async function openDb(url = process.env.DATABASE_URL, { log = () => {} } = {}) {
  if (!url) return null;
  if (url.startsWith('pglite:')) return openPglite(url.slice('pglite:'.length));
  const pool = new pg.Pool({
    connectionString: url,
    max: +(process.env.DATABASE_POOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'survive-the-night',
  });
  // an idle connection the server dropped (a Postgres restart): the pool makes a new one next time
  pool.on('error', (err) => log(`db: idle connection lost (${err.message})`));
  return {
    kind: 'postgres',
    query: (text, params) => pool.query(text, params).then(norm),
    exec: (text) => pool.query(text).then(() => {}),
    async tx(fn) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const t = { query: (text, params) => c.query(text, params).then(norm), exec: (text) => c.query(text).then(() => {}) };
        const out = await fn(t);
        await c.query('COMMIT');
        return out;
      } catch (err) {
        await c.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        c.release();
      }
    },
    close: () => pool.end(),
  };
}

// PGlite is one connection, single-threaded: it queues its own queries and transactions behind each other
async function openPglite(where) {
  let PGlite;
  try {
    ({ PGlite } = await import('@electric-sql/pglite'));
  } catch {
    throw new Error('DATABASE_URL is pglite:, but @electric-sql/pglite is not installed (npm install --include=dev)');
  }
  let dir;
  if (where && where !== 'memory') {
    dir = resolve(where);
    mkdirSync(dir, { recursive: true });
  }
  const db = dir ? new PGlite(dir) : new PGlite();
  await db.waitReady;
  const wrap = (q) => ({ query: (text, params) => q.query(text, params).then(norm), exec: (text) => q.exec(text).then(() => {}) });
  return {
    kind: 'pglite',
    ...wrap(db),
    tx: (fn) => db.transaction((t) => fn(wrap(t))),
    close: () => db.close(),
  };
}
