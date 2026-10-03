// Headless look at Zombies mode in the real client: picks the mode on the splash, joins, optionally teleports (needs the
// server on DEBUG_COMMANDS=1 GODMODE=1) and screenshots. Prints console output and frame cost.
// usage: node scripts/shot-mine.js [--url http://localhost:5173] [--out dir] [--steps "name:chat command,wait ms;..."]
// e.g.   node scripts/shot-mine.js --steps "yard:;tunnels:/stop 1"
import puppeteer from 'puppeteer-core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { existsSync } from 'node:fs';

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const url = arg('url', 'http://localhost:5173');
const out = arg('out', 'shots');
const steps = (arg('steps', 'yard:') || '').split(';').filter(Boolean);
const chrome = process.env.CHROME || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p));
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--user-data-dir=' + mkdtempSync(join(tmpdir(), 'stn-chrome-')), '--mute-audio', '--window-position=-32000,-32000', '--no-first-run', '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--window-size=1280,720'] });
const page = await browser.newPage();
// nothing here may touch the person at the keyboard: no pointer lock, no focus stealing
await page.evaluateOnNewDocument(() => {
  Element.prototype.requestPointerLock = function () {};
  Document.prototype.exitPointerLock = function () {};
});
await page.setViewport({ width: 1280, height: 720 });
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' || m.type() === 'warning' || /\[mine\]|\[client\]/.test(t)) console.log(`[console.${m.type()}]`, t.slice(0, 400));
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: `${out}/0-splash.png` });
// the second mode button is Zombies
await page.evaluate(() => document.querySelectorAll('.sp-mode')[1]?.click());
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: `${out}/1-splash-mine.png` });
await page.evaluate(() => document.querySelector('.sp-joinbtn')?.click());
await new Promise((r) => setTimeout(r, 4000));
await page.keyboard.press('KeyF'); // the flashlight
const say = async (text) => {
  await page.evaluate((t) => window.__game.conn.action && window.__game.uiCallbacks().onChatSend(t), text);
};
for (const st of steps) {
  const [name, cmd = ''] = st.split(':');
  if (cmd) await say(cmd);
  await new Promise((r) => setTimeout(r, 2500));
  await page.screenshot({ path: `${out}/${name}.png` });
  const info = await page.evaluate(() => {
    const g = window.__game;
    const r = g.renderer.renderer.info;
    return { fps: g.fps, calls: r.render.calls, tris: r.render.triangles, programs: r.programs.length, cpu: +(g.cpuUpdateMs + g.cpuRenderMs).toFixed(2), pos: [g.renderPos.x, g.renderPos.y, g.renderPos.z].map((v) => +v.toFixed(1)), stop: g.mineScene?.cur, round: g.global.round, state: g.global.mstate };
  });
  console.log(name, JSON.stringify(info));
}
await browser.close();
