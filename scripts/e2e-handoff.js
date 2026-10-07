// A deploy as the real client sees it (server/handoff.js, client/net/moveback.js, Game.onMoving), in headless Chrome
// (through scripts/clip/lib.js launchChrome, as every browser here). A small proxy plays the edge: the page talks to
// one address, and from the moment the new server is up new connections go to it while open ones stay on the old one
// until it closes them. The page joins a game on A, then four deploys:
//   B, the server alone: the page goes back in place, never leaving the game, timed on the page
//   C, a new client alone: no reload either; the player is told the new version loads when they leave
//   D, shared code changed: the page loads again (timed: the reload path) and goes back into the game by itself
//   E, cannot read the save and may not carry it on: the game ends on the splash, saying why
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
  // (an end is passed on by the pipes once what was in flight has gone: a close frame is not cut off)
  const end = () => (sock.destroy(), up.destroy());
  sock.on('error', end);
  up.on('error', end);
});
await new Promise((r) => edge.listen(base, r));
const url = `http://localhost:${base}`;

const servers = [];
function server(name, port, env = {}) {
  const proc = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, DATABASE_URL: '', PORT: String(port), STATS_FILE: join(dir, `stats-${name}.json`), HANDOFF_DIR: join(dir, 'handoff'), GODMODE: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
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
// (Windows cannot send SIGTERM: a server there is asked to stop with the 'shutdown' message)
const term = (s) => (process.platform === 'win32' ? s.proc.send({ t: 'shutdown' }) : s.proc.kill('SIGTERM'));
const stop = async (s) => {
  term(s);
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

  // the page writes down when it starts moving and when it is back (Game.moving), every 2 ms, and what it logs
  const logs = [];
  page.on('console', (m) => logs.push(m.text()));
  const watchMoves = () =>
    page.evaluate(() => {
      window.__moves = [];
      let was = false;
      clearInterval(window.__moveTimer);
      window.__moveTimer = setInterval(() => {
        const g = window.__game;
        const m = !!g?.moving;
        const banner = document.getElementById('ui').classList.contains('conn-on');
        if (m !== was) window.__moves.push({ moving: m, t: performance.now(), banner });
        if (banner) window.__moves.banner = true;
        was = m;
      }, 2);
    });
  const moves = () => page.evaluate(() => ({ list: window.__moves || [], banner: !!window.__moves?.banner })).catch(() => null);
  const gapOf = (m) => (m?.list.length >= 2 && m.list[0].moving && !m.list[1].moving ? Math.round(m.list[1].t - m.list[0].t) : null);
  const timing = {};

  // ---------------------------------------------------------------- the server alone: back in place
  await watchMoves();
  const B = server('B', base + 2);
  check('server B is up', await up(B));
  live = B.port;
  term(A);
  let m1 = null;
  for (let i = 0; i < 100 && !(gapOf((m1 = await moves())) !== null); i++) await sleep(100);
  const after = await look();
  timing.serverOnly = gapOf(m1);
  check(`a deploy of the server alone: the page goes back in place, never leaving the game (${timing.serverOnly} ms on the page)`, timing.serverOnly !== null && timing.serverOnly < 1500 && after.state === 'playing' && !after.splash, JSON.stringify({ m1, after }));
  check(`...with no "Server updating" banner for a move that short (it comes up after 400 ms)`, !m1?.banner || timing.serverOnly > 400, JSON.stringify(m1));
  await sleep(1500);
  const after1 = await look();
  check('...the same game, the same player, the same valley and day', after1.code === before.code && after1.id === before.id && after1.seed === before.seed && after1.day === before.day, JSON.stringify({ before, after1 }));
  check('...where they were', Math.hypot(after1.x - before.x, after1.z - before.z) < 2, JSON.stringify({ before, after1 }));
  check('...and the game streaming', (await page.evaluate(() => performance.now() - window.__game.snapAt)) < 500);
  await page.screenshot({ path: join(out, '2-server-only.png') });

  // ---------------------------------------------------------------- a new client alone: in place, the new one later
  await watchMoves();
  const C = server('C', base + 3, { CLIENT_BUILD: 'another-client' });
  check('server C (a new client, the same shared code) is up', await up(C));
  live = C.port;
  let navigated = false;
  const onNav = () => (navigated = true);
  page.on('framenavigated', onNav);
  term(B);
  let m2 = null;
  for (let i = 0; i < 100 && !(gapOf((m2 = await moves())) !== null); i++) await sleep(100);
  await sleep(1500);
  page.off('framenavigated', onNav);
  timing.clientOnly = gapOf(m2);
  const chat2 = await page.evaluate(() => document.body.innerText.includes('The new version loads the next time you leave the game')).catch(() => false);
  check(`a deploy of a new client alone: no reload, back in place (${timing.clientOnly} ms on the page)`, !navigated && timing.clientOnly !== null && timing.clientOnly < 1500 && (await look()).state === 'playing', JSON.stringify({ navigated, m2 }));
  check('...and the player is told the new version loads when they leave the game', chat2);
  await page.screenshot({ path: join(out, '3-client-only.png') });

  // ---------------------------------------------------------------- shared code changed: the page loads again, and goes back in
  const D = server('D', base + 4, { CLIENT_BUILD: 'another-client-2', CLIENT_COMPAT: 'othercompat2' });
  check('server D (shared code changed) is up', await up(D));
  live = D.port;
  // what the page still held as it went (Edge has crashed instead of reloading a page still in a game): written down
  // as the reload starts (beforeunload) and as the page goes (pagehide), and read back from the page that replaces it
  await page.evaluate(() => {
    const held = () => {
      const g = window.__game;
      return { gl: !g.renderer.renderer.getContext().isContextLost(), workers: g.audio._queue?.workers.filter((r) => !r.dead).length ?? 0, sound: g.audio.context?.state || 'none', mic: !!g.voice.localStream };
    };
    addEventListener('beforeunload', () => sessionStorage.setItem('e2e.held', JSON.stringify(held())));
    addEventListener('pagehide', () => sessionStorage.setItem('e2e.heldGone', JSON.stringify(held())));
  });
  logs.length = 0;
  const loaded = page.waitForNavigation({ timeout: 20000 }).catch(() => null);
  const t2 = Date.now();
  term(C);
  await loaded;
  const navAt = Date.now();
  let again = null;
  // (a page building its valley holds its main thread for a while: a look that does not come back is tried again)
  const peek = () =>
    Promise.race([
      page.evaluate(() => {
        const g = window.__game;
        const shown = (sel) => !!document.querySelector(sel) && !document.querySelector(sel).hidden && document.querySelector(sel).offsetParent !== null;
        return g && { state: g.state, id: g.myId, code: g.room?.code, splash: shown('.splash'), updating: shown('.stn-updating'), drawn: !g.warm, snap: performance.now() - (g.snapAt || 0) };
      }),
      sleep(3000).then(() => null),
    ]).catch(() => null);
  let sawSplash = false;
  let sawUpdating = false;
  for (let i = 0; i < 240; i++) {
    const s = await peek();
    if (s?.splash) sawSplash = true;
    if (s?.updating && !sawUpdating) {
      sawUpdating = true;
      await page.screenshot({ path: join(out, '4-updating.png') });
    }
    if (s?.state === 'playing' && !s.updating && s.drawn && s.snap < 500) {
      again = s;
      break;
    }
    await sleep(100);
  }
  timing.reload = { stopToNavigation: navAt - t2, stopToPlaying: Date.now() - t2, pageLog: logs.filter((l) => /\[client\] (world|shaders)|\[net\]/.test(l)) };
  check(`shared code changed: the page loads again and goes back into the same game, as the same player (${timing.reload.stopToPlaying} ms from the old server being stopped to drawing the game again, software rendering)`, again && again.code === before.code && again.id === before.id, JSON.stringify(again));
  check('...under the "Game updated" card, never the splash', sawUpdating && !sawSplash, JSON.stringify({ sawUpdating, sawSplash }));
  const held = await page.evaluate(() => ({ reload: JSON.parse(sessionStorage.getItem('e2e.held') || 'null'), gone: JSON.parse(sessionStorage.getItem('e2e.heldGone') || 'null') })).catch(() => null);
  check('...having let go of the GPU, the synth workers and the microphone before it reloaded', held?.reload && !held.reload.gl && held.reload.workers === 0 && !held.reload.mic, JSON.stringify(held));
  check('...and with its sound card closed by the time it went', held?.gone?.sound === 'closed', JSON.stringify(held));
  await page.screenshot({ path: join(out, '5-reloaded.png') });

  // ---------------------------------------------------------------- a server that cannot read the save, and may not carry it on: the splash, and why
  await sleep(1500);
  await fakeLock();
  const E = server('E', base + 5, { CLIENT_BUILD: 'another-client-2', CLIENT_COMPAT: 'othercompat2', HANDOFF_STATE_VERSION: '99', HANDOFF_PIN: '0' });
  check('server E (cannot read the save, no carrying on by the old build) is up', await up(E));
  live = E.port;
  const t1 = Date.now();
  term(D);
  let ended = null;
  for (let i = 0; i < 100 && !ended; i++) {
    await sleep(200);
    const s = await peek();
    const text = await page.evaluate(() => document.body.innerText).catch(() => '');
    if (s?.state === 'menu') ended = { ...s, text: text.match(/[^\n]*(could not be carried over|could not be brought back)[^\n]*/i)?.[0], took: Date.now() - t1 };
  }
  check(`...the game ends on the splash, saying why, within seconds (${ended?.took} ms)`, ended && ended.text && ended.took < 15000, JSON.stringify(ended));
  await page.screenshot({ path: join(out, '6-not-brought-back.png') });
  check('no errors on the page', errors.length === 0, errors.join(' | '));
  console.log(`timing ${JSON.stringify(timing)}`);
  for (const s of servers) if (!s.exit) await stop(s);
} catch (e) {
  check('no error', false, String(e && e.stack));
}
await chrome.close().catch((e) => check('the browser closed cleanly', false, e.message));
edge.close();
for (const s of servers) if (!s.exit) s.proc.kill('SIGKILL');
if (failed) for (const s of servers) console.log(`\n--- ${s.name} ---\n${s.log.split('\n').slice(-20).join('\n')}`);
console.log(failed ? `\n${failed} FAILED (screenshots in ${out})` : `\nall ok (screenshots in ${out})`);
process.exit(failed ? 1 : 0);
