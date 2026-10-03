// How long DEAD RIDE takes to load on this machine's GPU (headless Chrome on the real GPU, ANGLE D3D11 on Windows like a
// normal Chrome): the menu with its 3D preview, the map finishing in the background, and PLAY to the first frame of play,
// with a screenshot in play. Isolated: own profile, off-screen, no pointer lock.
// usage: node scripts/time-deadride.js [--url http://localhost:3000/deadride/] [--map shaft-nine] [--menu 20] [--gl d3d11]
import puppeteer from 'puppeteer-core';
import { existsSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const url = arg('url', 'http://localhost:3000/deadride/');
const map = arg('map', 'shaft-nine');
const menuSecs = +arg('menu', 20);
const out = arg('out', 'shots');
mkdirSync(out, { recursive: true });
const chrome = process.env.CHROME || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => existsSync(p));
const b = await puppeteer.launch({
  executablePath: chrome,
  headless: 'new',
  protocolTimeout: 900000,
  args: ['--user-data-dir=' + mkdtempSync(join(tmpdir(), 'stn-chrome-')), '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--window-position=-32000,-32000', '--no-first-run', '--ignore-gpu-blocklist', `--use-angle=${arg('gl', 'd3d11')}`, '--window-size=1280,720'],
});
const p = await b.newPage();
await p.evaluateOnNewDocument(() => {
  Element.prototype.requestPointerLock = function () {};
});
await p.setViewport({ width: 1280, height: 720 });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => p.evaluate(() => performance.now() / 1000);
await p.goto(url, { waitUntil: 'load', timeout: 120000 });
// the menu's preview of the selected map
let heroAt = 0;
for (let k = 0; k < 300 && !heroAt; k++) {
  await sleep(500);
  heroAt = await p.evaluate((id) => (window.__g?.menu?.heroes?.[id]?.state === 'ready' ? performance.now() / 1000 : 0), map);
}
console.log(`menu preview ready at ${heroAt.toFixed(1)} s`);
await p.screenshot({ path: `${out}/dr-menu.png` });
// time on the menu (the rest loads in the background)
await sleep(menuSecs * 1000);
const restDone = await p.evaluate((id) => !!window.__g.menu.heroes[id]?.world?.loadedAll, map);
console.log(`after ${menuSecs} s on the menu the whole map ${restDone ? 'is' : 'is not yet'} loaded`);
const t0 = await now();
p.evaluate((id) => window.__g.play(id), map).catch(() => {});
// (the page records when play begins: polling from here can stall while the page's main thread is busy loading)
await p.evaluate(() => {
  const g = window.__g;
  const check = () => (g.mode === 'play' ? (window.__playAt = performance.now() / 1000) : setTimeout(check, 50));
  check();
});
let playAt = 0;
for (let k = 0; k < 600 && !playAt; k++) {
  await sleep(500);
  playAt = await p.evaluate(() => window.__playAt || 0);
}
console.log(`PLAY -> in game: ${(playAt - t0).toFixed(1)} s (page time ${playAt.toFixed(1)} s)`);
await sleep(4000);
await p.screenshot({ path: `${out}/dr-play.png` });
const fps = await p.evaluate(() => window.__g?.perf?.fps);
console.log(`fps in play ${fps?.toFixed?.(0)}`, errors.length ? `errors: ${errors.join(' | ')}` : 'no page errors');
await b.close();
