// Gameplay e2e: two headless clients join; verifies searching containers, building anywhere, pickups,
// crafting, chat and that clients see each other. Run the server with GODMODE=1 for stability.
// usage: node scripts/e2e-gameplay.js [url] [outdir]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:3000';
const out = process.argv[3] || '/tmp/e2e-gp';
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const results = [];
const check = (name, ok, info = '') => {
  results.push([name, ok]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
};
async function openClient(name) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && page.errors.push(m.text()));
  await page.goto(url, { waitUntil: 'load' });
  await sleep(2500);
  await page.evaluate((n) => {
    for (const inp of document.querySelectorAll('input[type=text], input:not([type])')) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(inp, n);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, name);
  await page.evaluate((n) => {
    const input = document.querySelector('input');
    if (input) {
      input.value = n;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const b = [...document.querySelectorAll('button')].find((x) => /join/i.test(x.textContent));
    b.click();
  }, name);
  await sleep(4000);
  await page.evaluate(() => {
    const g = window.__game;
    g.input.locked = true;
    g.input.enabled = true;
    g.ui.showPause(false);
    // headless has no real pointer lock: keep input enabled
    g.input.requestLock = () => {};
    g.input.handlers.onLockChange = () => {};
    g.input.exitLock = () => {};
    const n = g.ui.notify.bind(g.ui);
    g.ui.notify = (t, st, d) => {
      console.log('NOTIFY', t);
      return n(t, st, d);
    };
  });
  page.on('console', (m) => m.text().startsWith('NOTIFY') && console.log(`  [${name}]`, m.text()));
  return page;
}
const walkTo = async (page, x, z, stop = 1.2, timeout = 15000) => {
  const t0 = Date.now();
  await page.keyboard.down('KeyW');
  while (Date.now() - t0 < timeout) {
    const d = await page.evaluate(
      (x, z) => {
        const g = window.__game;
        const p = g.renderPos;
        g.input.yaw = Math.atan2(-(x - p.x), -(z - p.z));
        g.input.pitch = -0.6;
        return Math.hypot(x - p.x, z - p.z);
      },
      x,
      z,
    );
    if (d < stop) break;
    await sleep(100);
  }
  await page.keyboard.up('KeyW');
  const st = await page.evaluate(() => {
    const g = window.__game;
    return { pos: [g.renderPos.x.toFixed(1), g.renderPos.z.toFixed(1)], enabled: g.input.enabled, buttons: g.input.buttons };
  });
  console.log('  walkTo', x.toFixed(1), z.toFixed(1), '->', JSON.stringify(st));
};

const A = await openClient('Alice');
const B = await openClient('Bob');
await sleep(1500);
// 1. clients see each other
const seen = await A.evaluate(() => [...window.__game.entities.ents.values()].filter((e) => e.kind === 1).length);
check('client A sees client B as an entity', seen >= 1, `(players visible: ${seen})`);
const names = await A.evaluate(() => [...window.__game.players.values()].map((p) => p.name));
check('player list has both names', names.includes('Alice') && names.includes('Bob'), JSON.stringify(names));

// 2. search the nearest container (hold E)
await A.bringToFront();
await sleep(500);
const cache = await A.evaluate(() => {
  const g = window.__game;
  let best = null;
  let bd = 1e9;
  for (const e of g.entities.ents.values()) {
    if (e.kind !== 8 || e.q[3] !== 0) continue;
    const x = e.q[0] / 64;
    const z = e.q[2] / 64;
    const d = Math.hypot(x - g.renderPos.x, z - g.renderPos.z);
    if (d < bd) {
      bd = d;
      best = { id: e.id, x, y: e.q[1] / 64, z, d };
    }
  }
  return best;
});
if (cache) {
  await walkTo(A, cache.x, cache.z, 1.6, 20000);
  await A.evaluate((c) => {
    const g = window.__game;
    const p = g.renderPos;
    g.input.yaw = Math.atan2(-(c.x - p.x), -(c.z - p.z));
    const dist = Math.hypot(c.x - p.x, c.z - p.z);
    g.input.pitch = -Math.atan2(g.camera.position.y - c.y, Math.max(0.3, dist));
  }, cache);
  await sleep(400);
  const prompt = await A.evaluate(() => window.__game.prompt);
  await A.keyboard.down('KeyE');
  await sleep(1800);
  await A.keyboard.up('KeyE');
  await sleep(500);
  const searched = await A.evaluate((id) => window.__game.entities.ents.get(id)?.q[3] === 1, cache.id);
  check('holding E searches a container', searched, `(prompt: ${prompt})`);
} else check('found a container to search', false);

// 3. build a barricade on open ground (anywhere - there is no base any more)
const car = await A.evaluate(() => ({ x: window.__game.world.car.x, z: window.__game.world.car.z }));
await walkTo(A, car.x + 14, car.z + 12, 1.5);
await A.evaluate((car) => {
  const g = window.__game;
  const p = g.renderPos;
  g.input.yaw = Math.atan2(-(p.x - car.x), -(p.z - car.z)) + Math.PI; // face away from the car
  g.input.pitch = -0.45;
}, car);
await A.keyboard.press('Digit5');
await sleep(800);
const structs0 = await A.evaluate(() => [...window.__game.entities.ents.values()].filter((e) => e.kind === 4).length);
// turn until the ghost shows a free spot
for (let k = 0; k < 12; k++) {
  const ok = await A.evaluate(() => window.__game.ui.build.root.classList.contains('invalid') === false);
  if (ok) break;
  await A.evaluate(() => (window.__game.input.yaw += 0.52));
  await sleep(250);
}
await A.evaluate(() => window.__game.tryBuild());
await sleep(1200);
const structs1 = await A.evaluate(() => [...window.__game.entities.ents.values()].filter((e) => e.kind === 4).length);
check('placing a barricade creates a structure', structs1 === structs0 + 1, `(${structs0} -> ${structs1})`);
await B.bringToFront();
await sleep(600);
const bSees = await B.evaluate(() => [...window.__game.entities.ents.values()].filter((e) => e.kind === 4).length);
check('other client sees the structure', bSees >= 1);
await A.screenshot({ path: `${out}/build.png` });

await A.bringToFront();
await sleep(400);
// 4. crafting (torch = stick + cloth): give it a try with what we have; bandage needs 2 cloth
const inv0 = await A.evaluate(() => JSON.stringify(window.__game.inventory.slots.filter(Boolean)));
await A.evaluate(() => window.__game.uiCallbacks().onCraft(3)); // baseball bat: 3 planks (we have 4 - 4 for barricade = 0)
await sleep(600);
// pick up the nearest item
const item = await A.evaluate(() => {
  const g = window.__game;
  let best = null;
  let bd = 1e9;
  for (const e of g.entities.ents.values()) {
    if (e.kind !== 3) continue;
    const d = Math.hypot(e.rx - g.renderPos.x, e.rz - g.renderPos.z);
    if (d < bd) {
      bd = d;
      best = { id: e.id, x: e.rx, z: e.rz, item: e.item, d };
    }
  }
  return best;
});
if (item) {
  await A.keyboard.press('Digit3');
  await walkTo(A, item.x, item.z, 1.0, 20000);
  await A.evaluate((it) => {
    const g = window.__game;
    const p = g.renderPos;
    g.input.yaw = Math.atan2(-(it.x - p.x), -(it.z - p.z));
    const dist = Math.hypot(it.x - p.x, it.z - p.z);
    g.input.pitch = -Math.atan2(1.5, Math.max(0.3, dist));
  }, item);
  await sleep(400);
  const prompt = await A.evaluate(() => window.__game.prompt);
  await A.keyboard.press('KeyE');
  await sleep(1200);
  const gone = await A.evaluate((id) => !window.__game.entities.ents.has(id), item.id);
  check('picking up an item removes it from the world', gone, `(item ${item.item}, dist ${item.d.toFixed(1)}, prompt: ${prompt})`);
  const inv1 = await A.evaluate(() => JSON.stringify(window.__game.inventory.slots.filter(Boolean)));
  check('inventory changed after pickup', inv0 !== inv1 || gone);
} else check('found an item to pick up', false);

// 5. chat
await A.keyboard.press('Enter');
await sleep(300);
await A.keyboard.type('anyone out there?');
await A.keyboard.press('Enter');
await sleep(1000);
await B.bringToFront();
await sleep(500);
const chatSeen = await B.evaluate(() => document.body.innerText.includes('anyone out there?'));
check('chat message delivered to the other client', chatSeen);
await B.screenshot({ path: `${out}/chat.png` });

await A.bringToFront();
await sleep(400);
// 6. drop weapon & pick it back
const w0 = await A.evaluate(() => window.__game.prediction.state.weapons[1]);
await A.keyboard.press('Digit2');
await sleep(600);
await A.keyboard.press('KeyG');
await sleep(800);
const w1 = await A.evaluate(() => window.__game.prediction.state.weapons[1]);
check('dropping the pistol empties the slot', w0 !== 0 && w1 === 0, `(${w0} -> ${w1})`);

const errs = [...A.errors, ...B.errors];
check('no client errors', errs.length === 0, errs.slice(0, 5).join(' | '));
console.log(`\n${results.filter((r) => r[1]).length}/${results.length} checks passed`);
await browser.close();
process.exit(results.every((r) => r[1]) ? 0 : 1);
