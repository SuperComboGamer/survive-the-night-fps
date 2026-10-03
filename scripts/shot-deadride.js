// Headless look at DEAD RIDE (client/deadride) in the real build: loads a URL, waits, screenshots now and then, prints
// errors and the frame rate. Isolated like the other browser scripts: own profile, off-screen, no pointer lock.
// usage: node scripts/shot-deadride.js [--url "http://localhost:3000/deadride/?play=shaft-nine&autostart=1&nolock=1"] [--secs 40] [--out shots/dr]
import puppeteer from 'puppeteer-core';
import { mkdirSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const url = arg('url', 'http://localhost:3000/deadride/?play=shaft-nine&autostart=1&nolock=1');
const secs = +arg('secs', 40);
const every = +arg('every', 8);
const out = arg('out', 'shots/dr');
const chrome = process.env.CHROME || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => existsSync(p));
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: 'new',
  protocolTimeout: 600000,
  args: ['--user-data-dir=' + mkdtempSync(join(tmpdir(), 'stn-chrome-')), '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--window-position=-32000,-32000', '--no-first-run', '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,720'],
});
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => {
  Element.prototype.requestPointerLock = function () {};
  Document.prototype.exitPointerLock = function () {};
});
await page.setViewport({ width: 1280, height: 720 });
const errors = [];
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${t.slice(0, 300)}`);
  else if (/\[(boot|game|map|stop|route|vehicle)\]/i.test(t)) console.log('[console]', t.slice(0, 200));
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
const t0 = Date.now();
let n = 0;
while ((Date.now() - t0) / 1000 < secs) {
  await new Promise((r) => setTimeout(r, every * 1000));
  const fatal = await page.evaluate(() => window.__fatal || '');
  await page.screenshot({ path: `${out}/${String(n++).padStart(2, '0')}.png` });
  console.log(`t+${Math.round((Date.now() - t0) / 1000)}s shot ${n - 1}${fatal ? ' FATAL ' + fatal.slice(0, 300) : ''}`);
  if (fatal) break;
}
console.log(errors.length ? `ERRORS (${errors.length}):\n` + [...new Set(errors)].slice(0, 20).join('\n') : 'no console errors');
await browser.close();
