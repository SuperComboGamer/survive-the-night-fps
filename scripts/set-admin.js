// Grants or removes admin-command access for an account.
//   npm run admin -- <username-or-email> [on|off]
import { openDb } from '../server/db/index.js';
import { migrate } from '../server/db/migrate.js';
import { setAdmin } from '../server/admin.js';

const identity = process.argv[2];
const mode = String(process.argv[3] || 'on').toLowerCase();
if (!identity || !['on', 'off'].includes(mode)) {
  console.error('usage: npm run admin -- <username-or-email> [on|off]');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('[admin] DATABASE_URL is not set');
  process.exit(1);
}

const db = await openDb(process.env.DATABASE_URL, { log: (...a) => console.log('[admin]', ...a) });
try {
  await migrate(db, { log: (...a) => console.log('[admin]', ...a) });
  const user = await setAdmin(db, identity, mode === 'on');
  console.log(`[admin] ${user.username} is ${user.is_admin ? 'an admin' : 'not an admin'}; existing sign-ins were revoked`);
} catch (err) {
  console.error('[admin] failed:', err.message);
  process.exitCode = 1;
} finally {
  await db.close().catch(() => {});
}
