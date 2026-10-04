// A deploy's SIGTERM reaches the server as Railway starts it (`npm start`, railway.json): npm runs the script under
// `sh -c` and forwards the signal to that shell, so the script has to replace the shell with node (`exec`). A shell
// that runs node as its child instead dies of the signal and takes the container down with it, node never told: no
// game is handed over (every deploy before this test). Here the script shell is one that never replaces itself with
// its last command, as the deploy image's may not; the server must still say it is handing the games over and exit 0.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : detail}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = mkdtempSync(join(tmpdir(), 'stn-start-'));
const shell = join(dir, 'forking-sh');
writeFileSync(shell, '#!/bin/bash\n[ "$1" = -c ] && shift\neval "$1"\nexit $?\n');
chmodSync(shell, 0o755);

const port = 42000 + Math.floor(Math.random() * 800);
// (its own process group: a node left behind by a shell that died is killed with it below)
const proc = spawn('npm', ['start', '--silent', `--script-shell=${shell}`], {
  env: { ...process.env, DATABASE_URL: '', PORT: String(port), STATS_FILE: join(dir, 'stats.json'), HANDOFF_DIR: join(dir, 'handoff') },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
});
let log = '';
let exit = null;
proc.stdout.on('data', (d) => (log += d));
proc.stderr.on('data', (d) => (log += d));
proc.on('exit', (code, signal) => (exit = { code, signal }));

try {
  for (let i = 0; i < 300 && !log.includes('listening'); i++) await sleep(50);
  check('npm start brings the server up', log.includes('listening'), log.slice(-500));
  proc.kill('SIGTERM');
  for (let i = 0; i < 100 && !exit; i++) await sleep(50);
  check('the SIGTERM sent to npm reaches the server', log.includes('SIGTERM: handing the games over'), log.slice(-500));
  check('npm exits cleanly once the server has', exit?.code === 0, JSON.stringify(exit));
} finally {
  try {
    process.kill(-proc.pid, 'SIGKILL');
  } catch {}
}
process.exit(failed ? 1 : 0);
