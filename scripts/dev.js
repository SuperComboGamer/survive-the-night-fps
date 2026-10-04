// Runs the authoritative game server (auto-restart on change) and the Vite dev server together.
// Open http://localhost:5173 (Vite proxies /ws, /social, /api and /status to the game server on :3000).
// The database is a PGlite one in data/pglite (Postgres in the server's own process: nothing to install) unless
// DATABASE_URL says otherwise - a real Postgres, or DATABASE_URL= (empty) for none at all. A restart on a change hands
// the games being played over to the restarted server, as a deploy does (server/handoff.js), through data/handoff.
import { spawn } from 'node:child_process';

const env = { ...process.env, NODE_ENV: process.env.NODE_ENV ?? 'development', DATABASE_URL: process.env.DATABASE_URL ?? 'pglite:./data/pglite', HANDOFF_DIR: process.env.HANDOFF_DIR ?? './data/handoff' };
const procs = [
  spawn(process.execPath, ['--watch-path=server', '--watch-path=shared', 'server/index.js'], { stdio: 'inherit', env }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit', env: process.env }),
];
const stop = () => {
  for (const p of procs) p.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => code && console.log(`[dev] process exited with ${code}`));
