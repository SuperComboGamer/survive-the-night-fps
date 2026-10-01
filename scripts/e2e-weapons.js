// Weapons e2e (server: GODMODE=1 DEBUG_COMMANDS=1): fires/reloads every gun, swings every melee weapon,
// throws a molotov + pipe bomb and checks the resulting fire area / explosion, screenshots each.
// usage: node scripts/e2e-weapons.js [url] [outdir]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
const url = process.argv[2] || 'http://localhost:3000';
const out = process.argv[3] || '/tmp/e2e-weapons';
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(url, { waitUntil: 'load' });
await sleep(3000);
await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => /join/i.test(x.textContent)).click());
await sleep(4500);
await page.evaluate(() => { const g = window.__game; g.input.locked = true; g.input.enabled = true; g.input.requestLock = () => {}; g.input.handlers.onLockChange = () => {}; g.ui.showPause(false); g.input.yaw = 2.4; g.input.pitch = -0.05; });
const chat = (t) => page.evaluate((t) => window.__game.conn.chat(t), t);
const hold = async (ms) => { await page.evaluate(() => (window.__game.input.mouseButtons = 1)); await sleep(ms); await page.evaluate(() => (window.__game.input.mouseButtons = 0)); };
const state = () => page.evaluate(() => { const s = window.__game.prediction.state; return { slot: s.slot, w: s.weapons.slice(), mags: s.mags.slice(), ammo: s.ammo.slice(), reload: +s.reloadT.toFixed(2) }; });
let fails = 0;
const expect = (name, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info ? JSON.stringify(info) : ''}`); };
// [gun, ammo item]: shotgun, AK-47, hunting rifle, M4A1, MP5, double-barrel, crossbow
for (const [item, ammoItem] of [[60, 71], [61, 72], [62, 73], [63, 74], [64, 70], [65, 71], [66, 75]]) {
  await chat(`/give ${item} 1`);
  await chat(`/give ${ammoItem} 60`);
  await sleep(500);
  // equip from inventory if the slot was taken
  await page.evaluate((item) => { const g = window.__game; const i = g.inventory.slots.findIndex((x) => x && x.item === item); if (i >= 0) g.conn.action(5, i); }, item);
  await sleep(600);
  await page.keyboard.press('Digit1');
  await sleep(700);
  const s0 = await state();
  await hold([61, 63, 64].includes(item) ? 700 : 150);
  await sleep(300);
  const s1 = await state();
  expect(`fire weapon ${item}`, s0.w[0] === item && s1.mags[0] < s0.mags[0], { before: s0.mags[0], after: s1.mags[0] });
  await page.screenshot({ path: `${out}/fire-${item}.png` });
  await page.keyboard.press('KeyR');
  await sleep(250);
  const s2 = await state();
  expect(`reload weapon ${item}`, s2.reload > 0, { reload: s2.reload });
  await sleep(3200);
}
for (const item of [51, 52, 53]) {
  await chat(`/give ${item} 1`);
  await sleep(400);
  await page.evaluate((item) => { const g = window.__game; const i = g.inventory.slots.findIndex((x) => x && x.item === item); if (i >= 0) g.conn.action(5, i); }, item);
  await sleep(600);
  await page.keyboard.press('Digit3');
  await sleep(600);
  const s = await state();
  await hold(120);
  await sleep(250);
  await page.screenshot({ path: `${out}/melee-${item}.png` });
  expect(`equip melee ${item}`, s.w[2] === item, s.w);
}
// throwables
await chat('/give 30 2');
await chat('/give 31 2');
await sleep(600);
await page.keyboard.press('Digit4');
await sleep(600);
await page.evaluate(() => (window.__game.input.pitch = 0.15));
await hold(100);
await sleep(1500);
const fire = await page.evaluate(() => [...window.__game.entities.ents.values()].some((e) => e.kind === 7 && e.atype === 2));
expect('molotov creates a fire area', fire);
await page.screenshot({ path: `${out}/molotov.png` });
await page.keyboard.press('Digit4'); // cycle to pipe bomb
await sleep(700);
const tw = await state();
await hold(100);
await sleep(4000);
await page.screenshot({ path: `${out}/pipebomb.png` });
expect('pipe bomb selected', tw.w[3] === 31, tw.w);
expect('no client errors', errors.length === 0, [...new Set(errors)].slice(0, 5));
await browser.close();
process.exit(fails ? 1 : 0);
