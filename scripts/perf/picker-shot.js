// The survivor picker as it opens: the longest frame and the longest run of JavaScript of its opening, and a picture
// of it with its ten portraits in (shots/perf/picker-<label>.png). For a change to how the portraits are made.
//   --perf            measured as the benchmark measures it: uncapped at 1920 x 1080 (lib.js launchChrome's perf: true,
//                     a browser of 20 s), `--rounds` times, alternating with `--before <dir>` if given; the medians go
//                     to shots/perf/picker.json, which perf:report puts in its table in place of the benchmark's own
//                     two rows (the benchmark opens the picker once per session too)
// usage: node scripts/perf/picker-shot.js [--before <dir>] [--rounds 3] [--perf] [--label after]
import { join as pjoin, resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { REPO, parseArgs, sleep, startGame, launchChrome } from '../clip/lib.js';
import { SEED, INSTRUMENT, loadMenu, summarize, median } from './lib.js';

const args = parseArgs(process.argv.slice(2), { label: 'after', rounds: '1' });
const PERF = !!args.perf;
async function open(tree, label, shot) {
  let game = null, chrome = null;
  try {
    game = await startGame(tree, { seed: SEED, env: { NODE_ENV: 'test', DEV_ADMIN: '1' } });
    chrome = await launchChrome({ width: PERF ? 1920 : 1280, height: PERF ? 1080 : 720, gpu: true, perf: PERF, life: 90_000, storage: { 'stn.settings': JSON.stringify({ quality: 'high', renderScale: 1 }), 'stn.character': '3', 'stn.name': 'picker' } });
    const page = chrome.page;
    page.on('pageerror', (e) => console.error('  page:', String(e.stack || e).slice(0, 400)));
    await page.evaluateOnNewDocument(INSTRUMENT);
    await loadMenu(page, game.url);
    await page.evaluate(() => {
      window.__bench.throttle = 0;
      window.__bench.start();
    });
    await sleep(300);
    await page.evaluate(() => document.querySelector('.cp-face')?.click());
    await sleep(3000);
    const s = summarize(await page.evaluate(() => window.__bench.stop()));
    await page.evaluate(() => (window.__bench.throttle = 16));
    const imgs = await page.evaluate(() => [...document.querySelectorAll('.cp-cell img')].filter((i) => i.naturalWidth > 0).length);
    console.log(`${label}: longest frame ${s.ms.worst.toFixed(0)} ms, longest JavaScript ${s.jsWorstMs.toFixed(0)} ms; ${imgs} portraits in`);
    if (shot) {
      mkdirSync(pjoin(REPO, 'shots', 'perf'), { recursive: true });
      await page.screenshot({ path: pjoin(REPO, 'shots', 'perf', `picker-${label}.png`) });
    }
    return { worstFrameMs: s.ms.worst, worstJsMs: s.jsWorstMs, portraits: imgs };
  } finally {
    await chrome?.close().catch((e) => console.error(String(e)));
    game?.stop();
  }
}
const before = args.before ? resolve(String(args.before)) : null;
const runs = { before: [], after: [] };
for (let r = 0; r < +args.rounds; r++) {
  if (before) runs.before.push(await open(before, 'before', !PERF && r === 0));
  runs.after.push(await open(REPO, before ? 'after' : String(args.label), !PERF && r === 0));
  if (PERF) await sleep(3000);
}
if (PERF) {
  const med = (k, key) => median(runs[k].map((x) => x[key]));
  const out = { rounds: +args.rounds, before: before ? { worstFrameMs: med('before', 'worstFrameMs'), worstJsMs: med('before', 'worstJsMs') } : null, after: { worstFrameMs: med('after', 'worstFrameMs'), worstJsMs: med('after', 'worstJsMs') }, runs };
  writeFileSync(pjoin(REPO, 'shots', 'perf', 'picker.json'), JSON.stringify(out));
  console.log(JSON.stringify({ before: out.before, after: out.after }));
}
