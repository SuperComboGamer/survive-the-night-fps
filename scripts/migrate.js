// Applies the database migrations (server/db/migrations) to DATABASE_URL: `npm run migrate`. Railway runs it as the
// game service's pre-deploy command (railway.json): a deploy whose migrations fail stops there and the running one
// stays up. `npm run migrate -- --status` lists what is pending without applying anything.
import { openDb, describeUrl } from '../server/db/index.js';
import { migrate, pendingMigrations } from '../server/db/migrate.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.log('[migrate] DATABASE_URL is not set: no database to migrate');
  process.exit(0);
}
const db = await openDb(url, { log: (...a) => console.log('[migrate]', ...a) });
try {
  if (process.argv.includes('--status')) {
    const pending = await pendingMigrations(db);
    console.log(`[migrate] ${describeUrl(url)}: ${pending.length ? `pending ${pending.join(', ')}` : 'up to date'}`);
  } else {
    const t0 = Date.now();
    const { applied } = await migrate(db, { log: (...a) => console.log('[migrate]', ...a) });
    console.log(`[migrate] ${describeUrl(url)}: ${applied.length ? `applied ${applied.join(', ')}` : 'already up to date'} (${Date.now() - t0} ms)`);
  }
} catch (err) {
  console.error('[migrate] failed:', err.message);
  process.exitCode = 1;
} finally {
  await db.close().catch(() => {});
}
