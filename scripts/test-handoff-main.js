// The first deploy of a change: the server it replaces is of the build before, and the saves it leaves are that build's.
// scripts/fixtures/handoff-ee173eb.json is a game saved by the server of main at ee173eb - the last build before saves
// named the build they were made by, and before they carried the lie of the land - as it puts a save in the store on a
// deploy. A real server of this tree finds it waiting and carries the game on with its own code: every player back in
// their own body, the same valley, the same night. (A deploy from main to this tree, live, with main's own server, is in
// docs/deploys.md; this keeps the save format honest from here on.) When this tree makes another map of the fixture's
// seed, its game could not be carried on by anything (it names no build): the test says so and skips.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore, decode, worldPrint } from '../server/handoff.js';
import { worldFor } from '../shared/worlds.js';
import { Connection } from '../client/net/connection.js';
import { comeBack } from '../client/net/comeback.js';

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : detail}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(25)) if (await fn()) return true;
  return false;
};
const fx = JSON.parse(readFileSync(new URL('./fixtures/handoff-ee173eb.json', import.meta.url), 'utf8'));
const body = Buffer.from(fx.body, 'base64');
const env = decode(body);
check('the save of main names no build and carries no ground: as the server it replaces writes them', !fx.meta.build && env.worldGround === undefined && typeof env.worldShape === 'string');
if (worldPrint(worldFor(env.game.seed, env.game.act)).shape !== fx.worldShape) {
  console.log(`SKIP  this tree makes another map of seed ${env.game.seed} than ee173eb did: that game could not be carried on (its save names no build). Expected after a map change; the fixture is about the first deploy from ee173eb.`);
  process.exit(failed ? 1 : 0);
}
const dir = mkdtempSync(join(tmpdir(), 'stn-handoff-main-'));
const HANDOFF_DIR = join(dir, 'handoff');
await new FileStore(HANDOFF_DIR).put(fx.code, fx.meta, body);
const port = 44400 + Math.floor(Math.random() * 400);
const proc = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, DATABASE_URL: '', PORT: String(port), STATS_FILE: join(dir, 'stats.json'), HANDOFF_DIR, LOBBY_LIMITS: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
let exited = false;
proc.stdout.on('data', (d) => (log += d));
proc.stderr.on('data', (d) => (log += d));
proc.on('exit', () => (exited = true));
globalThis.location = { protocol: 'http:', host: `localhost:${port}` };
const warn = console.warn;
console.warn = () => {};
const conns = [];
try {
  check('a server of this tree is up, with the save waiting', await until(() => log.includes('listening')), log);
  await until(() => /up in \d+ ms|not restored/.test(log));
  check('...and carries the game on with its own code', new RegExp(`game ${fx.code} restored from the last server`).test(log) && !/not restored|carried on by build/.test(log), log.split('\n').slice(-8).join('\n'));
  for (const [i, pid] of fx.pids.entries()) {
    const into = {};
    const why = await comeBack({
      code: fx.code,
      moved: true,
      every: 100,
      ms: 15000,
      join: () => {
        const conn = new Connection({});
        into.conn = conn;
        conns.push(conn);
        return conn.connect(['Ann', 'Ben', 'Cy'][i], pid, fx.code).then(
          (info) => ((into.info = info), true),
          (e) => e
        );
      },
    });
    check(`${['Ann', 'Ben', 'Cy'][i]} is back in their own body, in the same valley`, why === '' && into.info?.id === fx.ids[i] && into.info.seed === env.game.seed >>> 0, JSON.stringify({ why, id: into.info?.id, was: fx.ids[i] }));
  }
  const info = await (await fetch(`http://localhost:${port}/api/games/${fx.code}`)).json();
  check('...in the same run: the same night, the game by its name', info.phase === fx.phase && info.day === fx.day && info.name === 'Saved by main', JSON.stringify(info));
} catch (e) {
  check('no error', false, e.stack);
}
console.warn = warn;
// (every socket closed before the process goes: Node on Windows can trip over a WebSocket still closing at exit)
for (const c of conns) c.close(4001);
await sleep(300);
proc.kill('SIGKILL');
await until(() => exited, 5000);
check('the server is stopped', exited);
console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
