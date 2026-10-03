// Showcase e2e (server: GODMODE=1 ADMIN_SECRET=dev): spawns every zombie type in front of the player
// and screenshots it, then dies to test zombie mode, and tests voice peer connections between 2 clients.
// usage: node scripts/e2e-showcase.js [url] [outdir] [cycle]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:3000';
const out = process.argv[3] || '/tmp/e2e-show';
const cycle = process.argv[4];
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const errors = [];
async function openClient(name) {
  const page = await browser.newPage();
  // the admin commands (/give, /spawn, /tp...): the client says the server's ADMIN_SECRET on joining
  await page.evaluateOnNewDocument((k) => localStorage.setItem('stn.admin', k), process.env.ADMIN_SECRET || 'dev');
  await page.setViewport({ width: 1280, height: 720 });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(url, { waitUntil: 'load' });
  await sleep(2500);
  await page.evaluate((n) => {
    for (const inp of document.querySelectorAll('input[type=text], input:not([type])')) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, n);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }
    [...document.querySelectorAll('button')].find((x) => /join/i.test(x.textContent)).click();
  }, name);
  await sleep(4000);
  await page.evaluate((c) => {
    const g = window.__game;
    g.input.locked = true;
    g.input.enabled = true;
    g.input.requestLock = () => {};
    g.input.exitLock = () => {};
    g.input.handlers.onLockChange = () => {};
    g.ui.showPause(false);
    if (c) g.debugCycle = +c;
  }, cycle);
  return page;
}
const chat = async (page, text) => {
  await page.evaluate((t) => window.__game.conn.chat(t), text);
  await sleep(300);
};
const faceNearest = (page, type) =>
  page.evaluate((type) => {
    const g = window.__game;
    let best = null;
    let bd = 1e9;
    for (const e of g.entities.ents.values()) {
      if (e.kind !== 2 || (type >= 0 && e.ztype !== type)) continue;
      const d = Math.hypot(e.rx - g.renderPos.x, e.rz - g.renderPos.z);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    if (!best) return null;
    const h = [1.75, 1.72, 2.8, 1.85, 1.3, 1.9, 1.8, 0.4, 4.2, 3.6, 0.85, 2.0][best.ztype];
    g.input.yaw = Math.atan2(-(best.rx - g.renderPos.x), -(best.rz - g.renderPos.z));
    g.input.pitch = Math.atan2(best.ry + h * 0.55 - (g.renderPos.y + 1.6), bd);
    return { d: +bd.toFixed(1), anim: best.q[4] };
  }, type);

const A = await openClient('Showcase');
await chat(A, '/give 61 1'); // AK
await chat(A, '/give 72 200');
await A.keyboard.press('Digit1');
const NAMES = ['walker', 'runner', 'tank', 'spitter', 'leaper', 'roper', 'boomer', 'bat', 'abomination', 'hivequeen', 'dog', 'shade'];
for (let t = 0; t < NAMES.length; t++) {
  await A.evaluate(() => {
    window.__game.input.yaw = 0;
    window.__game.input.pitch = 0;
  });
  await sleep(200);
  await chat(A, `/spawn ${t} 1`);
  let info = null;
  for (let k = 0; k < 12; k++) {
    await sleep(250);
    info = await faceNearest(A, t);
    if (info && info.d < 9 && k > 4) break;
  }
  await A.screenshot({ path: `${out}/z-${t}-${NAMES[t]}.png` });
  console.log(NAMES[t], JSON.stringify(info));
  // kill it with the AK
  for (let k = 0; k < 30; k++) {
    const f = await faceNearest(A, t);
    if (!f) break;
    await A.evaluate(() => (window.__game.input.mouseButtons = 1));
    await sleep(150);
  }
  await A.evaluate(() => (window.__game.input.mouseButtons = 0));
  await sleep(400);
  if (t === 6) await A.screenshot({ path: `${out}/z-boomer-explode.png` });
}
// voice: second client, both enable mic
const B = await openClient('Voice');
await sleep(1500);
await A.bringToFront();
await A.evaluate(() => window.__game.voice.setTransmit(true));
await B.bringToFront();
await B.evaluate(() => window.__game.voice.setTransmit(true));
await sleep(6000);
const vstate = await A.evaluate(() => [...window.__game.voice.peers.values()].map((p) => ({ conn: p.pc.connectionState, hasSource: !!p.source })));
console.log('voice peers from A:', JSON.stringify(vstate));
// death -> zombie
await A.bringToFront();
await chat(A, '/kill');
await sleep(2500);
await A.screenshot({ path: `${out}/death.png` });
await sleep(7000);
const z = await A.evaluate(() => ({ zombie: window.__game.self.zombie, alive: window.__game.self.alive, hp: window.__game.self.hp }));
console.log('after death:', JSON.stringify(z));
await A.screenshot({ path: `${out}/zombie-mode.png` });
await A.evaluate(() => (window.__game.input.mouseButtons = 1));
await sleep(400);
await A.evaluate(() => (window.__game.input.mouseButtons = 0));
await A.screenshot({ path: `${out}/zombie-claw.png` });
await B.bringToFront();
await sleep(800);
const bView = await B.evaluate(() => [...window.__game.entities.ents.values()].filter((e) => e.kind === 1).map((e) => e.q[5]));
console.log('B sees player flags:', JSON.stringify(bView));
console.log('errors:', errors.length, [...new Set(errors)].slice(0, 8).join(' | '));
await browser.close();
