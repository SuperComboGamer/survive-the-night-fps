// One bounded frame-time measurement of the two maps on the real GPU (docs/object-clipping.md, "Measuring frame
// time"): one browser, 1280 x 720, vsync on, SECONDS on the island and SECONDS in the middle of the mainland's
// city, stopping if three frames in a row take over 250 ms. Prints the frame times, draw calls and triangles.
//
// usage: node scripts/clip/act2-perf.js [--seed 1337] [--seconds 8]
import { REPO, parseArgs, sleep, startGame, launchChrome } from './lib.js';

const args = parseArgs(process.argv.slice(2), { seed: '1337', seconds: '8' });
const SECONDS = Math.min(9, +args.seconds); // (two of them: 20 s of measuring at the most)
let game = null;
let chrome = null;
try {
  game = await startGame(REPO, { seed: +args.seed, env: { NODE_ENV: 'test', DEV_ADMIN: '1' } });
  chrome = await launchChrome({ width: 1280, height: 720, gpu: true, life: 3 * 60_000 });
  const p = chrome.page;
  await p.goto(game.url, { waitUntil: 'load', timeout: 60000 });
  await sleep(3000);
  await p.evaluate(() => [...document.querySelectorAll('button')].find((x) => /join/i.test(x.textContent))?.click());
  for (let i = 0; i < 120 && !(await p.evaluate(() => !!(window.__game && window.__game.myId && window.__game.vm))); i++) await sleep(250);
  await sleep(4000);
  await p.evaluate(() => {
    const g = window.__game;
    g.input.locked = true;
    g.input.requestLock = () => {};
    g.input.handlers.onLockChange = () => {};
    g.ui.showPause(false);
  });
  const measure = (secs) =>
    p.evaluate(
      (secs) =>
        new Promise((done) => {
          const g = window.__game;
          const dts = [];
          let last = performance.now();
          let slow = 0;
          const t0 = last;
          const step = (now) => {
            const dt = now - last;
            last = now;
            dts.push(dt);
            slow = dt > 250 ? slow + 1 : 0;
            if (slow >= 3 || now - t0 > secs * 1000) {
              dts.sort((a, b) => a - b);
              // (a frame is several passes, and the renderer's counters start again at each: count one whole frame)
              const info = g.renderer.renderer.info;
              info.autoReset = false;
              info.reset();
              requestAnimationFrame(() => {
                const [calls, tris] = [info.render.calls, info.render.triangles];
                info.autoReset = true;
                done({ aborted: slow >= 3, frames: dts.length, avg: dts.reduce((a, b) => a + b, 0) / dts.length, p50: dts[dts.length >> 1], p95: dts[Math.floor(dts.length * 0.95)], worst: dts[dts.length - 1], calls, tris, quality: g.renderer.quality });
              });
            } else requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        }),
      secs,
    );
  const isl = await measure(SECONDS);
  console.log('island  ', JSON.stringify(isl));
  if (!isl.aborted) {
    await p.evaluate(() => window.__game.conn.chat('/cross skip'));
    for (let i = 0; i < 80 && (await p.evaluate(() => window.__game.act)) !== 2; i++) await sleep(250);
    await sleep(3000);
    await p.evaluate(() => window.__game.conn.chat('/place 28'));
    await sleep(4000);
    console.log('mainland', JSON.stringify(await measure(SECONDS)));
  }
} finally {
  await chrome?.close().catch((e) => console.error(String(e)));
  game?.stop();
}
