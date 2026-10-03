// What the match records say, for tuning the game: `npm run report` prints every analytics_* question
// (server/db/migrations/003_analytics.sql) asked of DATABASE_URL.
//   npm run report                       the last 30 days
//   npm run report -- --days 7
//   npm run report -- --since 2026-10-01
//   npm run report -- --build 85b7f0d    since the first match on that deploy (a balance change, say)
//   npm run report -- --only night_funnel,weapons
//   npm run report -- --json             the rows as JSON, for a spreadsheet or a chart
// On Railway, where the database has no public address: `railway ssh` into the game service and run it there.
import { openDb, describeUrl } from '../server/db/index.js';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const QUESTIONS = [
  ['overview', 'Overview'],
  ['daily', 'Day by day'],
  ['by_team_size', 'By team size (most players at once)'],
  ['night_funnel', 'Night by night: how many teams reach each night and see it through'],
  ['bosses', 'Bosses'],
  ['death_causes', 'What downs and kills survivors'],
  ['damage_sources', 'Where the damage survivors take comes from'],
  ['kills_by_type', 'The dead put down, by kind'],
  ['weapons', 'Weapons'],
  ['supply_pacing', 'Pacing: minutes into a match each car supply is first found / installed'],
  ['retention', 'Do players come back (by matches played)'],
  ['server_health', 'Server health'],
];

const db = await openDb(url);
try {
  let since = new Date(Date.now() - (+(opt('days') || 30)) * 86400_000);
  if (opt('since')) since = new Date(opt('since'));
  if (opt('build')) {
    const r = await db.query('SELECT min(started_at) AS at FROM matches WHERE build LIKE $1', [`${opt('build')}%`]);
    if (!r.rows[0]?.at) throw new Error(`no match was played on a build starting ${opt('build')}`);
    since = r.rows[0].at;
  }
  if (Number.isNaN(+since)) throw new Error('--since is not a date');
  const only = opt('only')?.split(',');
  const out = {};
  for (const [q, title] of QUESTIONS) {
    if (only && !only.includes(q)) continue;
    const { rows } = await db.query(`SELECT * FROM analytics_${q}($1)`, [since]);
    out[q] = rows;
    if (args.includes('--json')) continue;
    console.log(`\n== ${title}`);
    printTable(rows);
  }
  if (args.includes('--json')) console.log(JSON.stringify({ since, db: describeUrl(url), ...out }, null, 2));
  else console.log(`\n(${describeUrl(url)}, matches since ${new Date(since).toISOString()})`);
} catch (err) {
  console.error('report failed:', err.message);
  process.exitCode = 1;
} finally {
  await db.close();
}

function printTable(rows) {
  if (!rows.length) return console.log('  (nothing yet)');
  const cols = Object.keys(rows[0]);
  const cell = (v) => (v === null || v === undefined ? '-' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
  const width = cols.map((c) => Math.max(c.length, ...rows.map((r) => cell(r[c]).length)));
  const line = (vals) => '  ' + vals.map((v, i) => (typeof rows[0][cols[i]] === 'number' ? v.padStart(width[i]) : v.padEnd(width[i]))).join('  ');
  console.log(line(cols));
  console.log('  ' + width.map((w) => '-'.repeat(w)).join('  '));
  for (const r of rows) console.log(line(cols.map((c) => cell(r[c]))));
}
