// Where the time goes while nothing is drawn: Chrome's sampling profiler over (1) the page's load to the splash's
// scene, (2) the opening of the survivor picker, (3) the world swap of the crossing (the mainland built and drawn for
// the first time). Each is saved as shots/perf/profile-<what>.cpuprofile and its heaviest functions (inclusive time)
// printed; perf/inclusive.js prints more of one. An unminified build is made for it, the normal one put back after.
// The real GPU, vsync on (lib.js launchChrome's gpu: true and nothing more).
// usage: node scripts/perf/profile-load.js [--top 40] [--only load,picker,swap]
import { execFileSync } from 'node:child_process';
import { join as pjoin } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { REPO, parseArgs, sleep, startGame, launchChrome, list } from '../clip/lib.js';
import { SEED, INSTRUMENT, chat, loadMenu, join } from './lib.js';

const args = parseArgs(process.argv.slice(2), { top: '40' });
const only = list(args.only);
const vite = (extra) => execFileSync(process.execPath, [pjoin(REPO, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', ...extra], { cwd: REPO, stdio: 'ignore' });
let game = null, chrome = null;
try {
  vite(['--minify', 'false']);
  game = await startGame(REPO, { seed: SEED, env: { NODE_ENV: 'test', DEV_ADMIN: '1' } });
  chrome = await launchChrome({ width: 1280, height: 720, gpu: true, life: 4 * 60_000, storage: { 'stn.settings': JSON.stringify({ quality: 'high', renderScale: 1 }), 'stn.character': '3', 'stn.name': 'profile' } });
  const page = chrome.page;
  page.on('pageerror', (e) => console.error('  page:', String(e).slice(0, 200)));
  await page.evaluateOnNewDocument(INSTRUMENT);
  const cdp = await page.createCDPSession();
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  mkdirSync(pjoin(REPO, 'shots', 'perf'), { recursive: true });
  const prof = async (what, fn) => {
    const on = !only || only.includes(what);
    if (on) await cdp.send('Profiler.start');
    const t0 = Date.now();
    await fn();
    const wall = Date.now() - t0;
    if (!on) return;
    const { profile: P } = await cdp.send('Profiler.stop');
    writeFileSync(pjoin(REPO, 'shots', 'perf', `profile-${what}.cpuprofile`), JSON.stringify(P));
    const byId = new Map(P.nodes.map((n) => [n.id, n]));
    const parent = new Map();
    for (const n of P.nodes) for (const c of n.children || []) parent.set(c, n.id);
    const key = (n) => `${n.callFrame.functionName || '(anonymous)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`;
    const incl = new Map();
    let total = 0;
    P.samples.forEach((id, i) => {
      const n = byId.get(id);
      if (n.callFrame.functionName === '(idle)') return;
      const t = P.timeDeltas[i];
      total += t;
      const seen = new Set();
      for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
        const k = key(byId.get(cur));
        if (seen.has(k)) continue;
        seen.add(k);
        incl.set(k, (incl.get(k) || 0) + t);
      }
    });
    console.log(`\n== ${what}: ${wall} ms of wall clock, ${(total / 1000).toFixed(0)} ms busy`);
    for (const [k, v] of [...incl].sort((a, b) => b[1] - a[1]).slice(0, +args.top)) console.log(`${(v / 1000).toFixed(0).padStart(6)} ms  ${k}`);
  };
  await prof('load', () => loadMenu(page, game.url));
  await prof('picker', async () => {
    await page.evaluate(() => document.querySelector('.cp-face')?.click());
    await sleep(2500);
    await page.evaluate(() => document.querySelector('.cp-done')?.click());
  });
  await join(page);
  await sleep(1500);
  await prof('swap', async () => {
    await chat(page, '/cross skip');
    for (let i = 0; i < 600 && !(await page.evaluate(() => window.__game.act === 2 && !window.__game.warm && window.__game.global.phase !== 5)); i++) await sleep(50);
    await sleep(500);
  });
} finally {
  await chrome?.close().catch((e) => console.error(String(e)));
  game?.stop();
  vite([]);
}
