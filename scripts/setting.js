// The settings of the whole game kept in the database (server/serversettings.js), on DATABASE_URL. The servers pick a
// change up within a few seconds, no restart.
//
//   npm run setting                              every setting and its value
//   npm run setting -- max_total_games 50        sets one
//   npm run setting -- max_total_games unset     back to its default
//
// A PGlite database (DATABASE_URL=pglite:...) only with the server stopped: add --server-stopped.
import { openDb } from '../server/db/index.js';
import { migrate } from '../server/db/migrate.js';
import { SETTINGS } from '../server/serversettings.js';

const args = process.argv.slice(2);
const stopped = args.includes('--server-stopped');
const [key, raw] = args.filter((a) => a !== '--server-stopped');
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set: the settings live in the database');
  process.exit(1);
}
// (a PGlite database is a folder only one process may have open: the server's, while it runs)
if (/^pglite:/.test(url) && !stopped) {
  console.error('DATABASE_URL is a PGlite folder, which only one process may have open: stop the server first and add --server-stopped (it reads the setting when it starts), or use Postgres');
  process.exit(1);
}
if (key && !SETTINGS[key]) {
  console.error(`no setting ${key}: there are ${Object.keys(SETTINGS).join(', ')}`);
  process.exit(1);
}

const db = await openDb(url);
try {
  await migrate(db);
  if (key && raw !== undefined) {
    if (raw === 'unset') await db.query('DELETE FROM server_settings WHERE key = $1', [key]);
    else {
      let value;
      try {
        value = JSON.parse(raw);
      } catch {
        value = raw;
      }
      if (SETTINGS[key].parse(value) === undefined) throw new Error(`${raw} is not a value for ${key}: ${SETTINGS[key].about}`);
      await db.query(
        `INSERT INTO server_settings (key, value) VALUES ($1, $2::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [key, JSON.stringify(value)]
      );
    }
  }
  const rows = new Map((await db.query('SELECT key, value FROM server_settings')).rows.map((r) => [r.key, r.value]));
  for (const [k, s] of Object.entries(SETTINGS)) {
    if (key && k !== key) continue;
    console.log(`${k} = ${rows.has(k) ? JSON.stringify(rows.get(k)) : `unset (${JSON.stringify(s.default)})`}    ${s.about}`);
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
