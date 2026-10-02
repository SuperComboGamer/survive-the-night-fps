// End-to-end smoke test in headless Chrome: loads the client, joins, plays a little, takes screenshots,
// reports FPS / draw calls and any console errors.
// usage: node scripts/e2e.js [url=http://localhost:5173] [outdir=/tmp/e2e] [scenario=basic]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:5173';
const out = process.argv[3] || '/tmp/e2e';
const scenario = process.argv[4] || 'basic';
mkdirSync(out, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errors = [];
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${t}`);
  if (m.type() === 'log' && /\[client\]|E2E/.test(t)) console.log(t);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message} ${e.stack?.split('\n').slice(0, 3).join(' | ')}`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('shot', `${out}/${name}.png`);
};
const stats = async (label) => {
  const s = await page.evaluate(() => {
    const g = window.__game;
    if (!g) return null;
    const r = g.renderer.renderer.info;
    return { fps: g.fps, cpuUpdate: g.cpuUpdateMs?.toFixed(2), cpuRender: g.cpuRenderMs?.toFixed(2), calls: g.renderer.stats.calls, tris: g.renderer.stats.tris, geos: r.memory.geometries, tex: r.memory.textures, zombies: g.entities?.zombieCount, ents: g.entities?.ents.size, state: g.state, phase: g.global.phase, day: g.global.day, hp: g.self.hp, pos: g.renderPos && [g.renderPos.x.toFixed(1), g.renderPos.y.toFixed(1), g.renderPos.z.toFixed(1)], corrections: g.prediction?.corrections, kbIn: (g.conn.bytesIn / 1024).toFixed(1) };
  });
  console.log(label, JSON.stringify(s));
};

await page.goto(url, { waitUntil: 'load' });
await sleep(4000);
await shot('01-splash');
await stats('menu');
// click the join button
const clicked = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')];
  const b = btns.find((x) => /join|enter|survive/i.test(x.textContent || '')) || btns[0];
  if (!b) return false;
  b.click();
  return b.textContent.trim();
});
console.log('clicked', clicked);
await sleep(5000);
await page.evaluate(() => {
  const g = window.__game;
  g.input.locked = true;
  g.input.enabled = true;
  g.ui.showPause?.(false);
});
await shot('02-joined');
await stats('joined');
if (process.env.CYCLE) await page.evaluate((c) => (window.__game.debugCycle = +c), process.env.CYCLE);
// walk forward toward the car / fire
await page.keyboard.down('KeyW');
await sleep(1500);
await page.keyboard.up('KeyW');
await shot('03-walked');
// look around
for (const [i, yaw] of [0.8, 2.2, 3.8, 5.2].entries()) {
  await page.evaluate((y) => {
    window.__game.input.yaw = y;
    window.__game.input.pitch = -0.05;
  }, yaw);
  await sleep(700);
  await shot(`04-look-${i}`);
}
// weapons
for (const k of ['Digit2', 'Digit3', 'Digit5']) {
  await page.keyboard.press(k);
  await sleep(900);
  await shot(`05-weapon-${k}`);
}
await page.keyboard.press('Digit2');
await sleep(600);
// fire the pistol a few times
await page.evaluate(() => (window.__game.input.mouseButtons = 1));
await sleep(150);
await page.evaluate(() => (window.__game.input.mouseButtons = 0));
await sleep(300);
await shot('06-fired');
// flashlight + inventory
await page.keyboard.press('KeyF');
await sleep(500);
await page.keyboard.press('KeyI');
await sleep(800);
await shot('07-inventory');
await page.keyboard.press('KeyI');
await sleep(500);
if (scenario === 'zombies') {
  // face the nearest zombie every second and take screenshots (use GODMODE=1 on the server)
  await page.keyboard.press('Digit2');
  for (let i = 0; i < 40; i++) {
    const info = await page.evaluate(() => {
      const g = window.__game;
      let best = null;
      let bd = 1e9;
      for (const e of g.entities.ents.values()) {
        if (e.kind !== 2) continue;
        const d = Math.hypot(e.rx - g.renderPos.x, e.rz - g.renderPos.z);
        if (d < bd) {
          bd = d;
          best = e;
        }
      }
      if (!best) return null;
      g.input.yaw = Math.atan2(-(best.rx - g.renderPos.x), -(best.rz - g.renderPos.z));
      g.input.pitch = Math.atan2(best.ry + 1.2 - (g.renderPos.y + 1.6), bd);
      return { d: bd.toFixed(1), type: best.ztype, anim: best.q[4] };
    });
    console.log('nearest zombie', JSON.stringify(info));
    if (info && +info.d > 9) await page.keyboard.down('KeyW');
    else await page.keyboard.up('KeyW');
    if (info && +info.d < 9 && i % 3 === 2) {
      await page.evaluate(() => (window.__game.input.mouseButtons = 1));
      await sleep(120);
      await page.evaluate(() => (window.__game.input.mouseButtons = 0));
    }
    await sleep(1200);
    if (info && +info.d < 30) await shot(`10-zombie-${i}`);
  }
}
if (scenario === 'night') {
  // wait for night (server should run with short DAY_SECONDS)
  await sleep(15000);
  await shot('08-night');
  await page.evaluate(() => (window.__game.input.pitch = 0));
  await sleep(8000);
  await shot('09-night-horde');
}
await stats('final');
console.log('--- errors ---');
const uniq = [...new Set(errors)];
for (const e of uniq.slice(0, 40)) console.log(e);
console.log(`total errors: ${errors.length}`);
await browser.close();
