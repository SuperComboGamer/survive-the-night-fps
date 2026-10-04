// A deploy as the real client sees it (server/handoff.js, client/main.js moveBack, Game.onMoving), in headless Chrome.
// A small proxy plays Railway's edge: the page talks to one address, and from the moment the new server is up new
// connections go to it while open ones stay on the old one until it closes them. The page joins a game on A; B
// starts, A is stopped: the game stays on screen (no splash, the "Server updating" banner) and is back in the same
// game as the same player, where it was, within a few seconds. Then C starts with another client build and B is
// stopped: the page loads again (the new build) and goes back into the game by itself.
// Needs the client built (npm run build). usage: node scripts/e2e-handoff.js [outdir]
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { createServer, connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, CHEAP_SETTINGS } from './clip/lib.js';

const out = process.argv[2] || '/tmp/e2e-handoff';
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, info = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : info}`);
};
const dir = mkdtempSync(join(tmpdir(), 'stn-e2e-handoff-'));
const base = 42000 + Math.floor(Math.random() * 800);

// the edge: every new connection to `edge` goes to whichever server is live now
let live = base + 1;
const edge = createServer((sock) => {
  const up = connect(live, '127.0.0.1');
  sock.pipe(up).pipe(sock);
  const end = () => (sock.destroy(), up.destroy());
  sock.on('error', end).on('close', end);
  up.on('error', end).on('close', end);
});
await new Promise((r) => edge.listen(base, r));
const url = `http://localhost:${base}`;

const servers = [];
function server(name, port, env = {}) {
  const proc = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, DATABASE_URL: '', PORT: String(port), STATS_FILE: join(dir, `stats-${name}.json`), HANDOFF_DIR: join(dir, 'handoff'), GODMODE: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const s = { name, port, proc, log: '', exit: null };
  proc.stdout.on('data', (d) => (s.log += d));
  proc.stderr.on('data', (d) => (s.log += d));
  proc.on('exit', (code) => (s.exit = { code }));
  servers.push(s);
  return s;
}
const up = async (s) => {
  for (let i = 0; i < 300 && !s.log.includes('listening'); i++) await sleep(50);
  return s.log.includes('listening');
};
const stop = async (s) => {
  s.proc.kill('SIGTERM');
  for (let i = 0; i < 200 && !s.exit; i++) await sleep(50);
};

const errors = [];
const chrome = await launchChrome({ width: 1280, height: 720, life: 10 * 60_000, storage: { 'stn.settings': CHEAP_SETTINGS }, onError: (m) => errors.push(m) });
try {
  const A = server('A', base + 1);
  check('server A is up behind the edge', await up(A), A.log);
  const page = chrome.page;
  // headless has no real pointer lock: the game is told it has it, as e2e-gameplay.js does
  const fakeLock = () =>
    page.evaluate(() => {
      const g = window.__game;
      g.input.requestLock = () => {};
      g.input.exitLock = () => {};
    });
  await page.goto(url, { waitUntil: 'load' });
  await sleep(2500);
  await page.evaluate(() => {
    const inp = document.querySelector('input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, 'Mover');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    [...document.querySelectorAll('button')].find((b) => /^\s*(quick )?join/i.test(b.textContent)).click(); // (not the survivor card, whose text also says "join")
  });
  for (let i = 0; i < 240 && !(await page.evaluate(() => window.__game?.state === 'playing' && !!window.__game.global)); i++) await sleep(250);
  await fakeLock();
  await sleep(1500);
  const look = () =>
    page.evaluate(() => {
      const g = window.__game;
      const splash = [...document.querySelectorAll('#ui *')].find((e) => /splash/i.test(e.className) && e.offsetParent !== null);
      return { state: g.state, moving: !!g.moving, id: g.myId, code: g.room?.code, x: g.renderPos.x, z: g.renderPos.z, seed: g.seed, day: g.global?.day, splash: !!splash, banner: document.getElementById('ui').classList.contains('conn-on'), text: document.body.innerText.match(/Server updating[^\n]*/i)?.[0] || '' };
    });
  const before = await look();
  check('the page is in a game on A', before.state === 'playing' && before.id > 0 && before.code, JSON.stringify(before));
  await page.screenshot({ path: join(out, '1-before.png') });

  // ---------------------------------------------------------------- the same build: back in place
  const B = server('B', base + 2);
  check('server B is up', await up(B));
  live = B.port;
  const t0 = Date.now();
  A.proc.kill('SIGTERM');
  let during = null;
  let back = null;
  for (let i = 0; i < 120; i++) {
    const s = await look();
    if (s.moving && !during) {
      during = s;
      await page.screenshot({ path: join(out, '2-moving.png') });
    }
    if (during && !s.moving && s.state === 'playing') {
      back = s;
      break;
    }
    await sleep(100);
  }
  const took = Date.now() - t0;
  check('while the game moves it stays on screen: no splash, the "Server updating" banner', during && during.state === 'playing' && !during.splash && during.banner && /Server updating/i.test(during.text), JSON.stringify(during));
  check(`...and is back in the game within a few seconds (${took} ms)`, !!back && took < 8000, JSON.stringify(back));
  await sleep(1500);
  const after = await look();
  check('...the same game, the same player, the same valley and day', after.code === before.code && after.id === before.id && after.seed === before.seed && after.day === before.day, JSON.stringify({ before, after }));
  check('...where they were', Math.hypot(after.x - before.x, after.z - before.z) < 2, JSON.stringify({ before, after }));
  check('...with the banner gone and the game streaming', !after.banner && (await page.evaluate(() => performance.now() - window.__game.snapAt)) < 500);
  await page.screenshot({ path: join(out, '3-back.png') });

  // ---------------------------------------------------------------- another build: the page loads again, and goes back in
  const C = server('C', base + 3, { CLIENT_BUILD: 'another-build' });
  check('server C (another client build) is up', await up(C));
  live = C.port;
  const loaded = page.waitForNavigation({ timeout: 20000 }).catch(() => null);
  B.proc.kill('SIGTERM');
  await loaded;
  let again = null;
  // (a page building its valley holds its main thread for a while: a look that does not come back is tried again)
  const peek = () => Promise.race([page.evaluate(() => window.__game && { state: window.__game.state, id: window.__game.myId, code: window.__game.room?.code }), sleep(3000).then(() => null)]).catch(() => null);
  for (let i = 0; i < 80; i++) {
    const s = await peek();
    if (s?.state === 'playing') {
      again = s;
      break;
    }
    await sleep(250);
  }
  check('another build: the page loads again and goes back into the same game, as the same player', again && again.code === before.code && again.id === before.id, JSON.stringify(again));
  await page.screenshot({ path: join(out, '4-reloaded.png') });

  // ---------------------------------------------------------------- a server that cannot read the save: the splash, and why
  await sleep(1500);
  await fakeLock();
  const D = server('D', base + 4, { CLIENT_BUILD: 'another-build', HANDOFF_STATE_VERSION: '99' });
  check('server D (cannot read the save) is up', await up(D));
  live = D.port;
  const t1 = Date.now();
  C.proc.kill('SIGTERM');
  let ended = null;
  for (let i = 0; i < 100 && !ended; i++) {
    await sleep(200);
    const s = await peek();
    const text = await page.evaluate(() => document.body.innerText).catch(() => '');
    if (s?.state === 'menu') ended = { ...s, text: text.match(/[^\n]*could not be brought back[^\n]*/i)?.[0], took: Date.now() - t1 };
  }
  check(`...the game ends on the splash, saying why, within seconds (${ended?.took} ms)`, ended && ended.text && ended.took < 15000, JSON.stringify(ended));
  await page.screenshot({ path: join(out, '5-not-brought-back.png') });
  check('no errors on the page', errors.length === 0, errors.join(' | '));
  await stop(B);
  await stop(C);
  await stop(D);
} catch (e) {
  check('no error', false, String(e && e.stack));
}
await chrome.close().catch((e) => check('the browser closed cleanly', false, e.message));
edge.close();
for (const s of servers) if (!s.exit) s.proc.kill('SIGKILL');
if (failed) for (const s of servers) console.log(`\n--- ${s.name} ---\n${s.log.split('\n').slice(-20).join('\n')}`);
console.log(failed ? `\n${failed} FAILED (screenshots in ${out})` : `\nall ok (screenshots in ${out})`);
process.exit(failed ? 1 : 0);
