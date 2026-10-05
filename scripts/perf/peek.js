// A look inside the running game, for working on its performance: joins on the island (or --mainland), stands at one
// of the benchmark's spots, and prints what an expression evaluated in the page returns (window.__game is the game).
// The real GPU, vsync on (lib.js launchChrome's gpu: true and nothing more).
// usage: node scripts/perf/peek.js [--mainland] [--spot street] --eval "<expression or async function body>"
import { REPO, parseArgs, sleep, startGame, launchChrome } from '../clip/lib.js';
import { SEED, SPOT, DAY, INSTRUMENT, chat, loadMenu, join, stand } from './lib.js';

const args = parseArgs(process.argv.slice(2), { spot: '', eval: '1' });
let game = null, chrome = null;
try {
  game = await startGame(REPO, { seed: SEED, build: true, env: { NODE_ENV: 'test', DEV_ADMIN: '1' } });
  chrome = await launchChrome({ width: 1280, height: 720, gpu: true, life: 4 * 60_000, storage: { 'stn.settings': JSON.stringify({ quality: 'high', renderScale: 1 }), 'stn.character': '3', 'stn.name': 'peek' } });
  const page = chrome.page;
  page.on('pageerror', (e) => console.error('  page:', String(e.stack || e).slice(0, 600)));
  await page.evaluateOnNewDocument(INSTRUMENT);
  await loadMenu(page, game.url);
  await join(page);
  if (args.mainland) {
    await chat(page, '/cross skip');
    for (let i = 0; i < 400 && !(await page.evaluate(() => window.__game.act === 2 && !window.__game.warm && window.__game.global.phase !== 5)); i++) await sleep(100);
    await sleep(3000);
  }
  await stand(page, SPOT[args.spot || (args.mainland ? 'street' : 'island')], DAY);
  await sleep(3000);
  const out = await page.evaluate(`(async () => { ${/return /.test(args.eval) ? args.eval : 'return ' + args.eval} })()`);
  console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 1));
} finally {
  await chrome?.close().catch((e) => console.error(String(e)));
  game?.stop();
}
