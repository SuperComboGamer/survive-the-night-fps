// Night camp scene + proximity voice check between two clients (server: GODMODE=1 DEV_ADMIN=1).
// usage: node scripts/e2e-night.js [url] [outdir]
import puppeteer from 'puppeteer-core';
const url = process.argv[2] || 'http://localhost:5173';
const out = process.argv[3];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const errors = [];
async function client(name) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(url, { waitUntil: 'load' });
  await sleep(3000);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => /join/i.test(x.textContent)).click());
  await sleep(4500);
  await page.evaluate(() => { const g = window.__game; g.input.locked = true; g.input.enabled = true; g.input.requestLock = () => {}; g.input.handlers.onLockChange = () => {}; g.ui.showPause(false); });
  return page;
}
const A = await client('A');
const chat = (t) => A.evaluate((t) => window.__game.conn.chat(t), t);
await chat('/give 24 5'); await chat('/give 1 20'); await chat('/give 5 30');
await sleep(500);
await A.keyboard.press('Digit5');
await sleep(500);
// place torches and walls around
const place = async (type, yaw, pitch, rot) => {
  await A.evaluate((type, yaw, pitch, rot) => { const g = window.__game; g.buildType = type; g.buildPicked = true; g.buildRot = rot; g.input.yaw = yaw; g.input.pitch = pitch; }, type, yaw, pitch, rot);
  await sleep(250);
  await A.evaluate(() => window.__game.tryBuild());
  await sleep(350);
};
await place(6, 0.6, -0.5, 0); await place(6, -0.8, -0.5, 0); await place(1, 0.0, -0.35, 0); await place(2, 1.3, -0.3, 64); await place(4, -0.3, -0.6, 0);
await chat('/night');
await sleep(4000);
await A.keyboard.press('Digit3');
await A.keyboard.press('KeyF');
for (const [i, yaw] of [0, 1.6, 3.2, 4.8].entries()) {
  await A.evaluate((y) => { window.__game.input.yaw = y; window.__game.input.pitch = -0.1; }, yaw);
  await sleep(900);
  await A.screenshot({ path: `${out}/night-${i}.png` });
}
const B = await client('B');
await A.bringToFront(); await A.evaluate(() => window.__game.voice.setTransmit(true));
await B.bringToFront(); await B.evaluate(() => window.__game.voice.setTransmit(true));
await sleep(6000);
console.log('voice from B:', JSON.stringify(await B.evaluate(() => [...window.__game.voice.peers.entries()].map(([id, p]) => ({ id, c: p.pc.connectionState, src: !!p.source, stream: !!p.stream, ready: window.__game.audio.ready, ent: window.__game.entities.ents.has(id) })))));
console.log('voice from A:', JSON.stringify(await A.evaluate(() => [...window.__game.voice.peers.entries()].map(([id, p]) => ({ id, c: p.pc.connectionState, src: !!p.source, stream: !!p.stream, ready: window.__game.audio.ready, ent: window.__game.entities.ents.has(id) })))));
await B.evaluate(() => { const g = window.__game; g.input.yaw = Math.atan2(g.renderPos.x, g.renderPos.z) + Math.PI; });
await sleep(800);
await B.screenshot({ path: `${out}/night-other-player.png` });
console.log('errors', errors.length, [...new Set(errors)].slice(0, 5));
await browser.close();
