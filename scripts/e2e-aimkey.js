// Hold-to-aim key e2e (server: GODMODE=1 ADMIN_SECRET=dev): Left Alt held is right mouse held. With a gun it raises the
// sights (zoom, no crosshair) and a left click fires aimed; let go and the sights come down. With a melee weapon it swings
// heavy, in build mode it does nothing, and the browser never gets the key (no Alt menu).
// usage: node scripts/e2e-aimkey.js [url] [outdir]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
const url = process.argv[2] || 'http://localhost:3000';
const out = process.argv[3] || '/tmp/e2e-aimkey';
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
// the admin commands (/give, /spawn, /tp...): the client says the server's ADMIN_SECRET on joining
await page.evaluateOnNewDocument((k) => localStorage.setItem('stn.admin', k), process.env.ADMIN_SECRET || 'dev');
await page.setViewport({ width: 1280, height: 720 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(url, { waitUntil: 'load' });
await sleep(3000);
await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => /join/i.test(x.textContent)).click());
await sleep(4500);
await page.evaluate(() => {
  const g = window.__game;
  g.input.locked = true;
  g.input.enabled = true;
  g.input.requestLock = () => {};
  g.input.handlers.onLockChange = () => {};
  g.ui.showPause(false);
  g.input.pitch = -0.05;
  // every local fire / melee event, with whether it was aimed or heavy
  g.seen = [];
  const on = g.onLocalEvents.bind(g);
  g.onLocalEvents = (evs, s) => {
    for (const ev of evs) if (ev.type === 'fire' || ev.type === 'melee') g.seen.push({ type: ev.type, aiming: !!ev.aiming, heavy: !!ev.heavy });
    return on(evs, s);
  };
});
const chat = (t) => page.evaluate((t) => window.__game.conn.chat(t), t);
const view = () =>
  page.evaluate(() => {
    const g = window.__game;
    const s = g.prediction.state;
    return { slot: s.slot, w: s.weapons.slice(), mag: s.mags[0], aimT: +g.aimT.toFixed(2), fov: +g.camera.fov.toFixed(1), crosshair: g.hud.crosshair.visible, alt: !!(g.input.sample() & 256), seen: g.seen.splice(0) };
  });
let fails = 0;
const expect = (name, ok, info) => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info ? JSON.stringify(info) : ''}`);
};

// a gun in the primary slot
await chat('/give 63 1');
await chat('/give 74 90');
await sleep(500);
await page.evaluate(() => {
  const g = window.__game;
  const i = g.inventory.slots.findIndex((x) => x && x.item === 63);
  if (i >= 0) g.conn.action(5, i);
});
await sleep(600);
await page.keyboard.press('Digit1');
await sleep(900);
const hip = await view();
expect('M4 in hand, hip: crosshair up, no aim', hip.w[0] === 63 && hip.slot === 0 && hip.aimT === 0 && hip.crosshair && !hip.alt, hip);

const prevented = await page.evaluate(() => {
  const down = new KeyboardEvent('keydown', { code: 'AltLeft', key: 'Alt', altKey: true, cancelable: true, bubbles: true });
  const up = new KeyboardEvent('keyup', { code: 'AltLeft', key: 'Alt', cancelable: true, bubbles: true });
  window.dispatchEvent(down);
  window.dispatchEvent(up);
  return [down.defaultPrevented, up.defaultPrevented];
});
expect('Alt down and up are kept from the browser', prevented[0] && prevented[1], prevented);

await page.keyboard.down('AltLeft');
await sleep(600);
const ads = await view();
expect('Alt held: sights up, zoomed, no crosshair', ads.alt && ads.aimT > 0.95 && ads.fov < hip.fov && !ads.crosshair, { ads, hipFov: hip.fov });
await page.screenshot({ path: `${out}/aim-alt.png` });

await page.mouse.down({ button: 'left' });
await sleep(120);
await page.mouse.up({ button: 'left' });
await sleep(400);
const shot = await view();
const fired = shot.seen.filter((e) => e.type === 'fire');
expect('left click with Alt held fires aimed', shot.mag < hip.mag && fired.length > 0 && fired.every((e) => e.aiming), { mag: [hip.mag, shot.mag], fired });

await page.keyboard.up('AltLeft');
await sleep(600);
const down = await view();
expect('Alt let go: sights down, crosshair back', !down.alt && down.aimT < 0.05 && down.fov >= hip.fov - 0.1 && down.crosshair, down);

await page.mouse.down({ button: 'left' });
await sleep(120);
await page.mouse.up({ button: 'left' });
await sleep(400);
const hipShot = (await view()).seen.filter((e) => e.type === 'fire');
expect('left click without Alt fires from the hip', hipShot.length > 0 && hipShot.every((e) => !e.aiming), hipShot);

// right mouse still aims
await page.mouse.down({ button: 'right' });
await sleep(600);
const rmb = await view();
await page.mouse.up({ button: 'right' });
expect('right mouse held still aims', rmb.alt && rmb.aimT > 0.95, rmb);
await sleep(500);

// melee: Alt held is the heavy swing, as RMB held is
await chat('/give 51 1');
await sleep(400);
await page.evaluate(() => {
  const g = window.__game;
  const i = g.inventory.slots.findIndex((x) => x && x.item === 51);
  if (i >= 0) g.conn.action(5, i);
});
await sleep(600);
await page.keyboard.press('Digit3');
await sleep(800);
await view();
await page.keyboard.down('AltLeft');
await sleep(500);
await page.keyboard.up('AltLeft');
await sleep(300);
const melee = (await view()).seen.filter((e) => e.type === 'melee');
expect('Alt held with a melee weapon swings heavy', melee.length > 0 && melee.every((e) => e.heavy), melee);

// build mode: the key does nothing
await page.keyboard.press('Digit5');
await sleep(800);
await page.keyboard.down('AltLeft');
await sleep(300);
const build = await view();
await page.keyboard.up('AltLeft');
expect('Alt in build mode sends no aim button', build.slot === 4 && !build.alt, build);

const controls = await page.evaluate(() => document.body.textContent.match(/RMB \/ (Alt|Option)/g) || []);
expect('controls list names the key', controls.length > 0, controls);
expect('no client errors', errors.length === 0, [...new Set(errors)].slice(0, 5));
await browser.close();
process.exit(fails ? 1 : 0);
