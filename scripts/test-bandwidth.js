// Server network bandwidth metrics: bucket aggregation, rollover, and the admin-only shape.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NetworkMetrics } from '../server/netmetrics.js';
import { openDb } from '../server/db/index.js';
import { migrate } from '../server/db/migrate.js';
import { Auth, hashPassword } from '../server/auth.js';
import { setAdmin } from '../server/admin.js';

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : detail}`);
}
const J = (v) => JSON.stringify(v);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
async function stop(proc) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
  const gone = new Promise((r) => proc.once('exit', r));
  proc.kill('SIGTERM');
  const t = setTimeout(() => proc.kill('SIGKILL'), 8000);
  await gone;
  clearTimeout(t);
}

// ---------------------------------------------------------------- aggregation
{
  let now = 0;
  const m = new NetworkMetrics({ now: () => now });
  m.wsIn('game_input', 100);
  m.wsOut('game_snapshots', 240);
  m.wsOut('game_snapshots', 60);
  let s = m.snapshot({ players: 2, sockets: 2 });
  check('totals and the current minute count bytes and messages in both directions', s.windows.lastMinute.bytesIn === 100 && s.windows.lastMinute.bytesOut === 300 && s.windows.lastMinute.messagesIn === 1 && s.windows.lastMinute.messagesOut === 2, J(s.windows.lastMinute));
  check('per-connected-player averages are included', s.perPlayer.lastMinute.bytesIn === 50 && s.perPlayer.lastMinute.bytesOut === 150, J(s.perPlayer.lastMinute));
  check('per-channel breakdown separates input from snapshots', s.channels.some((c) => c.name === 'game_input' && c.lastHour.bytesIn === 100) && s.channels.some((c) => c.name === 'game_snapshots' && c.lastHour.bytesOut === 300), J(s.channels));

  now = 60_000;
  m.wsOut('lobby_cards', 50);
  s = m.snapshot({ players: 1, sockets: 1 });
  const lastTwo = s.perMinute.slice(-2);
  check('minute rollover keeps the previous minute in the last-hour series and starts a new current bucket', lastTwo[0].bytesOut === 300 && lastTwo[1].bytesOut === 50 && s.windows.lastMinute.bytesOut === 50 && s.windows.lastHour.bytesOut === 350, J(lastTwo));

  now = 25 * 3_600_000;
  m.wsIn('social', 7);
  s = m.snapshot();
  check('day rollover drops traffic older than the 24-hour window', s.windows.lastDay.bytesIn === 7 && s.windows.lastDay.bytesOut === 0, J(s.windows.lastDay));
}

// ---------------------------------------------------------------- real admin endpoint
const dir = mkdtempSync(join(tmpdir(), 'stn-bandwidth-'));
let proc = null;
try {
  const dbUrl = `pglite:${join(dir, 'db')}`;
  const db = await openDb(dbUrl);
  await migrate(db);
  const auth = new Auth({ db });
  await db.query('INSERT INTO users (email, username, password_hash) VALUES ($1, $2, $3)', ['root@example.com', 'Root', await hashPassword('root-password')]);
  await setAdmin(db, 'Root', true);
  const id = (await db.query("SELECT id FROM users WHERE username = 'Root'")).rows[0].id;
  const cookie = `stn_session=${await auth.newSession({ id }, { ip: '', ua: 'test' })}`;
  await db.close();

  const port = await freePort();
  proc = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(port), DATABASE_URL: dbUrl, STATS_FILE: '', NODE_ENV: 'test', CLUSTER: '', HANDOFF_DIR: '', MIGRATE_ON_START: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 400 && !log.includes('listening'); i++) await sleep(50);
  if (!log.includes('listening')) throw new Error(`server did not start:\n${log}`);
  const base = `http://localhost:${port}`;
  const req = (headers = {}) => {
    const h = { 'X-STN-Admin': '1', ...headers };
    for (const k of Object.keys(h)) if (h[k] === null) delete h[k];
    return fetch(`${base}/api/admin/state`, { signal: AbortSignal.timeout(20000), headers: h });
  };

  const noHeader = await req({ 'X-STN-Admin': null });
  const guest = await req();
  const admin = await req({ cookie });
  const body = await admin.json();
  const bw = body.server?.bandwidth;
  check('admin bandwidth endpoint keeps the admin panel header and sign-in checks', noHeader.status === 403 && guest.status === 401 && admin.status === 200, J([noHeader.status, guest.status, admin.status, log]));
  check(
    'admin state includes bandwidth windows, charts, channels and the counting note',
    bw &&
      bw.windows?.lastMinute &&
      bw.windows?.lastHour &&
      bw.windows?.lastDay &&
      bw.perMinute?.length === 60 &&
      bw.perHour?.length === 24 &&
      Array.isArray(bw.channels) &&
      bw.channels.some((c) => c.name === 'http_api') &&
      typeof bw.note === 'string',
    J(bw)
  );
} catch (err) {
  check('admin bandwidth endpoint test did not throw', false, err.stack || err.message);
} finally {
  await stop(proc);
  rmSync(dir, { recursive: true, force: true });
}

if (failed) process.exit(1);
