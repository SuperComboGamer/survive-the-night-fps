// Walks DEAD RIDE (client/deadride) in the real build: every map, every stop, a look around each, then round 1 until the
// dead show up, with a screenshot of each and every console error / fatal reported. Isolated: own profile, off-screen,
// no pointer lock. Slow under software rendering (a map takes minutes to build): run it in the background.
// usage: node scripts/verify-deadride.js [--base http://localhost:3000] [--maps shaft-nine,whiteout,last-ferry,after-hours] [--out shots/verify]
import puppeteer from 'puppeteer-core';
import { mkdirSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const base = arg('base', 'http://localhost:3000');
const maps = arg('maps', 'shaft-nine,whiteout,last-ferry,after-hours').split(',');
const out = arg('out', 'shots/verify');
const chrome = process.env.CHROME || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => existsSync(p));
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = [];

for (const map of maps) {
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: 'new',
    protocolTimeout: 900000,
    args: ['--user-data-dir=' + mkdtempSync(join(tmpdir(), 'stn-chrome-')), '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--window-position=-32000,-32000', '--no-first-run', '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,720'],
  });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    Element.prototype.requestPointerLock = function () {};
    Document.prototype.exitPointerLock = function () {};
  });
  await page.setViewport({ width: 1280, height: 720 });
  const errors = [];
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(`[${m.type()}] ${m.text().slice(0, 240)}`));
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message.slice(0, 240)}`));
  const t0 = Date.now();
  await page.goto(`${base}/deadride/?play=${map}&autostart=1&nolock=1`, { waitUntil: 'load', timeout: 120000 });
  // wait until play() finished (window.__ready) and the game is in play
  let ok = false;
  for (let k = 0; k < 180 && !ok; k++) {
    await sleep(5000);
    ok = await page.evaluate(() => !!window.__ready && window.__g?.mode === 'play').catch(() => false);
    const fatal = await page.evaluate(() => window.__fatal || '').catch(() => '');
    if (fatal) {
      errors.push('[fatal] ' + fatal.slice(0, 400));
      break;
    }
  }
  const loadS = ((Date.now() - t0) / 1000) | 0;
  const r = { map, loaded: ok, loadS, stops: [], zombies: 0, errors };
  if (ok) {
    const nStops = await page.evaluate(() => window.__g.world.stops.length);
    for (let i = 0; i < nStops; i++) {
      await page.evaluate((i) => window.__g.game.debugGotoStop(i), i);
      await sleep(9000);
      for (const [k, yaw] of [[0, 0], [1, Math.PI]]) {
        await page.evaluate((yaw) => {
          const p = window.__g.player;
          p.yaw += yaw;
        }, yaw);
        await sleep(2500);
        await page.screenshot({ path: `${out}/${map}-stop${i}-${k}.png` });
      }
      const info = await page.evaluate(() => ({ name: window.__g.world.stops[window.__g.game.stopIndex]?.name, calls: window.__g.gfx.renderer?.info?.render?.calls }));
      r.stops.push(info);
    }
    // round 1 at the first stop: wait for zombies, look at the nearest
    await page.evaluate(() => window.__g.game.debugGotoStop(0));
    await page.evaluate(() => {
      const g = window.__g.game;
      g.godMode = true;
      g.debugSetRound(1);
    });
    for (let k = 0; k < 24; k++) {
      await sleep(5000);
      const n = await page.evaluate(() => window.__g.zombies.count);
      if (n > 0) {
        r.zombies = n;
        break;
      }
    }
    await sleep(15000);
    await page.evaluate(() => {
      const g = window.__g;
      const z = g.zombies.alive?.[0];
      if (z) {
        const p = g.player;
        const dx = z.pos.x - p.pos.x;
        const dz = z.pos.z - p.pos.z;
        p.yaw = Math.atan2(-dx, -dz);
        p.pitch = 0;
      }
    });
    await sleep(2000);
    await page.screenshot({ path: `${out}/${map}-zombies.png` });
    r.zombies = await page.evaluate(() => window.__g.zombies.count);
  }
  r.errors = [...new Set(errors)].slice(0, 12);
  report.push(r);
  console.log(JSON.stringify(r));
  await browser.close();
}
console.log('\nSUMMARY');
for (const r of report) console.log(`${r.map}: ${r.loaded ? `loaded in ${r.loadS}s, stops ${r.stops.map((s) => s.name).join(' / ')}, zombies seen ${r.zombies}` : 'DID NOT LOAD'}, errors ${r.errors.length}`);
