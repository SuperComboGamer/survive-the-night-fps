// Plays Zombies mode in the real client for a while and reports what happens: errors, round state, zombies seen,
// frame cost, with screenshots every few seconds. usage: node scripts/play-mine.js [--url http://localhost:3000] [--secs 60] [--out shots/play]
// Optional --keys "w:2000,space:100" presses keys at the start (after joining).
import puppeteer from 'puppeteer-core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const url = arg('url', 'http://localhost:3000');
const secs = +arg('secs', 60);
const out = arg('out', 'shots/play');
const chrome = process.env.CHROME || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => existsSync(p));
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--user-data-dir=' + mkdtempSync(join(tmpdir(), 'stn-chrome-')), '--mute-audio', '--window-position=-32000,-32000', '--no-first-run', '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,720'] });
const page = await browser.newPage();
// nothing here may touch the person at the keyboard: no pointer lock, no focus stealing
await page.evaluateOnNewDocument(() => {
  Element.prototype.requestPointerLock = function () {};
  Document.prototype.exitPointerLock = function () {};
});
await page.setViewport({ width: 1280, height: 720 });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text().slice(0, 300)}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 2500));
await page.evaluate(() => document.querySelectorAll('.sp-mode')[1]?.click());
await new Promise((r) => setTimeout(r, 2000));
await page.evaluate(() => document.querySelector('.sp-joinbtn')?.click());
await new Promise((r) => setTimeout(r, 4000));
const keys = (arg('keys', '') || '').split(',').filter(Boolean);
for (const k of keys) {
  const [name, ms = '100'] = k.split(':');
  await page.keyboard.down(name);
  await new Promise((r) => setTimeout(r, +ms));
  await page.keyboard.up(name);
}
const t0 = Date.now();
let n = 0;
while ((Date.now() - t0) / 1000 < secs) {
  await new Promise((r) => setTimeout(r, 5000));
  const info = await page.evaluate(() => {
    const g = window.__game;
    let z = 0;
    let lamps = 0;
    for (const e of g.entities.ents.values()) if (e.kind === 2 && !e.dead) z++;
    lamps = g.mineLamps?.n ?? -1;
    const r = g.renderer.renderer.info;
    return { state: g.state, mode: g.mode, round: g.global.round, mstate: g.global.mstate, elev: g.global.elev, left: g.global.left, timeLeft: +g.global.timeLeft?.toFixed(1), zombiesSeen: z, lamps, points: g.self.points, hp: g.self.hp, stop: g.mineScene?.cur, fps: g.fps, pos: [g.renderPos.x, g.renderPos.y, g.renderPos.z].map((v) => +v.toFixed(1)), meshes: g.scene.children.length, programs: r.programs.length };
  });
  console.log(`t+${Math.round((Date.now() - t0) / 1000)}s`, JSON.stringify(info));
  await page.screenshot({ path: `${out}/${String(n++).padStart(2, '0')}.png` });
}
console.log(errors.length ? `ERRORS (${errors.length}):\n` + [...new Set(errors)].slice(0, 15).join('\n') : 'no console errors');
await browser.close();
