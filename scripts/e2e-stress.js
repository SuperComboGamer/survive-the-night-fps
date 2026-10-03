// Client stress test (server: GODMODE=1 ADMIN_SECRET=dev): spawns ~120 zombies and reports frame CPU cost.
// usage: node scripts/e2e-stress.js [url] [outdir]
import puppeteer from 'puppeteer-core';
const url = process.argv[2] || 'http://localhost:5173';
const out = process.argv[3];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
// the admin commands (/give, /spawn, /tp...): the client says the server's ADMIN_SECRET on joining
await page.evaluateOnNewDocument((k) => localStorage.setItem('stn.admin', k), process.env.ADMIN_SECRET || 'dev');
await page.setViewport({ width: 1600, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url, { waitUntil: 'load' });
await sleep(3000);
await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => /join/i.test(x.textContent)).click());
await sleep(4500);
await page.evaluate(() => { const g = window.__game; g.input.locked = true; g.input.enabled = true; g.input.requestLock = () => {}; g.input.handlers.onLockChange = () => {}; g.ui.showPause(false); });
const chat = (t) => page.evaluate((t) => window.__game.conn.chat(t), t);
for (let r = 0; r < 6; r++) {
  await page.evaluate((y) => { window.__game.input.yaw = y; }, r * 1.05);
  await sleep(150);
  await chat(`/spawn ${[0, 1, 0, 3, 4, 0][r]} 20`);
  await sleep(300);
}
await page.evaluate(() => { window.__game.input.yaw = 0; window.__game.input.pitch = 0; });
for (let i = 0; i < 6; i++) {
  await sleep(1000);
  console.log(JSON.stringify(await page.evaluate(() => { const g = window.__game; const z = [...g.entities.ents.values()].filter((e) => e.kind === 2); return { store: z.length, dead: z.filter((e) => e.dead).length, count: g.entities.zombieCount, corpses: g.entities.corpses.length, near: z.filter((e) => Math.hypot(e.rx - g.renderPos.x, e.rz - g.renderPos.z) < 30).length }; })));
}
const stat = await page.evaluate(() => { const g = window.__game; return { fps: g.fps, upd: g.cpuUpdateMs.toFixed(2), rnd: g.cpuRenderMs.toFixed(2), calls: g.renderer.stats.calls, tris: g.renderer.stats.tris, zombies: g.entities.zombieCount, kbps: 0 }; });
const kb0 = await page.evaluate(() => window.__game.conn.bytesIn);
await sleep(5000);
const kb1 = await page.evaluate(() => window.__game.conn.bytesIn);
stat.kbps = ((kb1 - kb0) / 5 / 1024).toFixed(2);
console.log('stress', JSON.stringify(stat));
await page.screenshot({ path: `${out}/stress.png` });
console.log('errors', errors.length, errors.slice(0, 3));
await browser.close();
