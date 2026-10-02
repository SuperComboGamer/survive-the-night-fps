// Legs e2e (server: GODMODE=1 DEBUG_COMMANDS=1): a survivor shoots a walker in the shins with the pistol until it
// has no legs left, and checks what the real client makes of it - the stumble, the leg coming off (the replicated
// field, the model, the piece that flies off), the hobble, the crawl - with a screenshot of each.
// usage: node scripts/e2e-legs.js [url] [outdir]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
const url = process.argv[2] || 'http://localhost:3000';
const out = process.argv[3] || '/tmp/e2e-legs';
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
await page.evaluate(() => {
  const g = window.__game;
  g.input.locked = true;
  g.input.enabled = true;
  g.input.requestLock = () => {};
  g.input.handlers.onLockChange = () => {};
  g.ui.showPause(false);
  g.debugCycle = 0.25; // noon
  g.env.cycle = 0.25;
});
const chat = (t) => page.evaluate((t) => window.__game.conn.chat(t), t);
let fails = 0;
const expect = (name, ok, info) => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info ? JSON.stringify(info) : ''}`);
};

// clear the place of the dead, then one walker 12 m ahead (it comes at her)
await chat('/give 70 60');
await page.keyboard.press('Digit2');
await sleep(600);
await page.evaluate(() => (window.__game.input.pitch = -0.1));
await chat('/spawn 0 1');
await sleep(600);
const programs0 = await page.evaluate(() => window.__game.renderer.renderer.info.programs.length);

// the nearest live zombie: its id, legs (ZF.LEGS), anim, distance, and how many gib pieces are in the air or lying
const look = (id) =>
  page.evaluate((id) => {
    const g = window.__game;
    const cam = g.camera.position;
    let best = null;
    for (const e of g.entities.ents.values()) {
      if (e.kind !== 2 || e.dead || (id && e.id !== id)) continue;
      const d = Math.hypot(e.rx - cam.x, e.rz - cam.z);
      if (!best || d < best.d) best = { id: e.id, d, legs: e.q[7], anim: e.q[4], hp: e.q[5], speed: e.speed, model: e.view?._inst?.legs ?? -1, ztype: e.ztype };
    }
    const limbs = g.effects.gibLimbs.state.reduce((n, s) => n + (s ? 1 : 0), 0);
    return best && { ...best, limbs };
  }, id);
// point the gun at a spot on it: h metres above its feet, `side` metres to its right
const aim = (id, h, side = 0) =>
  page.evaluate(
    (id, h, side) => {
      const g = window.__game;
      const e = g.entities.ents.get(id);
      if (!e) return false;
      const cam = g.camera.position;
      const tx = e.rx + Math.cos(e.ryaw) * side, tz = e.rz - Math.sin(e.ryaw) * side;
      const dx = tx - cam.x, dy = e.ry + h - cam.y, dz = tz - cam.z;
      g.input.yaw = Math.atan2(-dx, -dz);
      g.input.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      return true;
    },
    id,
    h,
    side,
  );
const shot = async () => {
  await page.evaluate(() => (window.__game.input.mouseButtons = 1));
  await sleep(60);
  await page.evaluate(() => (window.__game.input.mouseButtons = 0));
};
const snap = (name) => page.screenshot({ path: `${out}/${name}.png` });

let z = await look();
expect('a zombie is there to shoot at', !!z && z.legs === 0, z);
if (z) {
  const id = z.id;
  // let it come to 9 m
  for (let i = 0; i < 60 && (z = await look(id)) && z.d > 9; i++) await sleep(200);
  await aim(id, 0.3, 0.1);
  await snap('1-walking');
  // shoot it in the shins until a leg goes
  let shots = 0, tripped = false;
  while (z && z.legs === 0 && shots < 8) {
    await aim(id, 0.3, 0.1);
    await sleep(60);
    await shot();
    shots++;
    await sleep(200);
    z = await look(id);
    if (z && z.anim === 10) {
      tripped = true;
      if (z.legs === 0) await snap('2-stumble');
    }
  }
  expect('shots in the shin trip it', tripped, { shots });
  expect('a leg is shot off: replicated, on the model, and a piece flies off', !!z && (z.legs === 1 || z.legs === 2) && z.model === z.legs && z.limbs > 0, z);
  await sleep(250);
  await snap('3-leg-off');
  await sleep(1400);
  z = await look(id);
  await aim(id, 0.9);
  await sleep(150);
  await snap('4-hobble');
  expect('it hobbles on at half speed', !!z && z.speed > 0.5 && z.speed < 2.2, z && { speed: +z.speed.toFixed(2) });
  // ...and the other
  const one = z?.legs;
  shots = 0;
  while (z && z.legs === one && shots < 8) {
    await aim(id, 0.3, 0);
    await sleep(60);
    await shot();
    shots++;
    await sleep(200);
    z = await look(id);
  }
  expect('the other leg goes too: it is on the ground', !!z && z.legs === 3 && z.model === 3, z);
  await aim(id, 0.3);
  await sleep(200);
  await snap('5-falling');
  await sleep(1800);
  z = await look(id);
  await aim(id, 0.3);
  await sleep(150);
  await snap('6-crawl');
  expect('it crawls after her', !!z && z.legs === 3 && z.speed > 0.3 && z.speed < 1.8, z && { speed: +z.speed.toFixed(2), d: +z.d.toFixed(1) });
  // let it get to her, then look down at it
  for (let i = 0; i < 80 && (z = await look(id)) && z.d > 1.6; i++) await sleep(200);
  await aim(id, 0.3);
  await sleep(400);
  await snap('7-at-her-feet');
  // a head shot where the head now is: 0.5 m ahead of it, low
  const hp = z?.hp;
  await page.evaluate((id) => {
    const g = window.__game;
    const e = g.entities.ents.get(id);
    const cam = g.camera.position;
    const tx = e.rx - Math.sin(e.ryaw) * 0.5, tz = e.rz - Math.cos(e.ryaw) * 0.5;
    const dx = tx - cam.x, dy = e.ry + 0.38 - cam.y, dz = tz - cam.z;
    g.input.yaw = Math.atan2(-dx, -dz);
    g.input.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  }, id);
  await sleep(80);
  await shot();
  await sleep(500);
  const after = await page.evaluate((id) => {
    const e = window.__game.entities.ents.get(id);
    return e ? { hp: e.q[5], dead: !!e.dead } : { hp: 0, dead: true };
  }, id);
  expect('a shot at its head, on the ground ahead of it, lands', after.dead || after.hp < hp, { before: hp, ...after });
  await snap('8-headshot');
}
const programs1 = await page.evaluate(() => window.__game.renderer.renderer.info.programs.length);
expect('no shader was built for any of it', programs1 === programs0, { before: programs0, after: programs1 });
expect('no client errors', errors.length === 0, [...new Set(errors)].slice(0, 5));
await browser.close();
process.exit(fails ? 1 : 0);
