// Look-dev screenshots of the real game (server: GODMODE=1 DEBUG_COMMANDS=1).
// usage: node scripts/lookdev.js [--url http://localhost:5173] [--out /tmp/lookdev] [--quality high] [--size 1280x720] [--dpr 1]
//        name:x,z,yawDeg,pitchDeg,cycle[,flashlight 0|1] [...]
// cycle: 0.25 noon · 0.1 morning (sun east: yaw -90) · 0.46 dusk (sun west: yaw 90) · 0.75 midnight.
// yaw 0 looks north (-z), 90 west (-x). Prints uncapped FPS measured over 2 s per view.
// --debug 1 shows only the sun shafts, --debug 2 only the SSAO.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = { url: 'http://localhost:5173', out: '/tmp/lookdev', quality: 'high', size: '1280x720', wait: '2500' };
const views = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) opt[args[i].slice(2)] = args[++i];
  else views.push(args[i]);
}
if (!views.length) views.push('road:10,20,70,2,0.25', 'dusk:10,20,70,2,0.46', 'night:10,20,70,2,0.75');
mkdirSync(opt.out, { recursive: true });
const [W, H] = opt.size.split('x').map(Number);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--disable-gpu-vsync', '--disable-frame-rate-limit'],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: +(opt.dpr || 1) });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
});
await page.evaluateOnNewDocument((q) => {
  const s = JSON.parse(localStorage.getItem('stn.settings') || '{}');
  s.quality = q;
  localStorage.setItem('stn.settings', JSON.stringify(s));
}, opt.quality);
await page.goto(opt.url, { waitUntil: 'load' });
await sleep(2500);
await page.evaluate(() => {
  for (const inp of document.querySelectorAll('input[type=text], input:not([type])')) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, 'Lookdev');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  }
  [...document.querySelectorAll('button')].find((x) => /join/i.test(x.textContent)).click();
});
await sleep(4000);
await page.evaluate(() => {
  const g = window.__game;
  g.input.locked = true;
  g.input.enabled = true;
  g.input.requestLock = () => {};
  g.input.exitLock = () => {};
  g.input.handlers.onLockChange = () => {};
  g.ui.showPause(false);
  document.getElementById('ui').style.visibility = 'hidden';
});
if (opt.debug) await page.evaluate((d) => (window.__game.renderer.passes.applyMat.uniforms.uDebug.value = d), +opt.debug);
for (const v of views) {
  const [name, spec] = v.split(':');
  const [x, z, yaw, pitch, cycle, flash = 0] = spec.split(',').map(Number);
  await page.evaluate((t) => window.__game.conn.chat(t), `/tp ${x} ${z}`);
  await sleep(400);
  await page.evaluate(
    (yaw, pitch, cycle, flash) => {
      const g = window.__game;
      g.debugCycle = cycle;
      g.env.cycle = cycle;
      g.input.yaw = (yaw * Math.PI) / 180;
      g.input.pitch = (pitch * Math.PI) / 180;
    },
    yaw,
    pitch,
    cycle,
    flash,
  );
  if ((await page.evaluate(() => !!window.__game.localFlash)) !== !!flash) await page.keyboard.press('KeyF');
  await sleep(+opt.wait);
  const fps = await page.evaluate(
    () =>
      new Promise((res) => {
        let n = 0;
        const t0 = performance.now();
        const f = () => {
          n++;
          if (performance.now() - t0 < 2000) requestAnimationFrame(f);
          else res((n * 1000) / (performance.now() - t0));
        };
        requestAnimationFrame(f);
      }),
  );
  const file = `${opt.out}/${name}.png`;
  await page.screenshot({ path: file });
  const st = await page.evaluate(() => ({ calls: window.__game.renderer.stats.calls, tris: window.__game.renderer.stats.tris, adapt: window.__game.renderer.readAdapt?.() ?? 1, avg: window.__game.renderer.debugAvgLum ?? 0, ref: window.__game.env.adaptRef ?? 0 }));
  console.log(`${file}  fps ${fps.toFixed(0)}  calls ${st.calls}  tris ${(st.tris / 1000).toFixed(0)}k  adapt ${st.adapt.toFixed(2)} (avg ${st.avg.toFixed(3)} ref ${st.ref.toFixed(3)})`);
}
if (errors.length) console.log('console errors/warnings:\n  ' + [...new Set(errors)].slice(0, 20).join('\n  '));
await browser.close();
