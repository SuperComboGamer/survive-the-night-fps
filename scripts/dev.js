// Runs the authoritative game server (auto-restart on change) and the Vite dev server together.
// Open http://localhost:5173 (Vite proxies /ws and /status to the game server on :3000).
import { spawn } from 'node:child_process';

const procs = [
  spawn(process.execPath, ['--watch-path=server', '--watch-path=shared', 'server/index.js'], { stdio: 'inherit', env: process.env }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit', env: process.env }),
];
const stop = () => {
  for (const p of procs) p.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => code && console.log(`[dev] process exited with ${code}`));
