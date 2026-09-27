// Headless screenshot helper: node scripts/shot.js <url> <out.png> [waitMs] [width] [height]
// Prints browser console output. Uses the system Google Chrome.
import puppeteer from 'puppeteer-core';

const [url, out = 'shot.png', wait = '3000', w = '1280', h = '720'] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: +w, height: +h });
page.on('console', (m) => console.log(`[console.${m.type()}]`, m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, +wait));
await page.screenshot({ path: out });
await browser.close();
console.log('saved', out);
