// Walkie-talkie e2e (server: GODMODE=1 NODE_ENV=test DEV_ADMIN=1, for /tp): two clients, each in a browser of its own with a fake
// microphone. [6] puts the walkie-talkie in A's hand (it hisses); chat typed reaches B on the far side of the valley
// with it in hand or not; holding fire keys it: A's mic opens, B is told A is on the air, hears the static and A's
// voice through the radio at any distance. Letting go takes A off the air again, and B sees A raise it to the mouth.
// usage: node scripts/e2e-radio.js [url] [outdir]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
const url = process.argv[2] || 'http://localhost:5173';
const out = process.argv[3] || '/tmp/e2e-radio';
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const browsers = [];
async function client() {
  // (a browser each: a page that is not the front tab of its browser stops drawing and sending)
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--disable-features=AudioServiceSandbox'],
  });
  browsers.push(browser);
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
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
  });
  return page;
}
let fails = 0;
const expect = (name, ok, info) => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info ? JSON.stringify(info) : ''}`);
};
const A = await client();
const B = await client();
const idA = await A.evaluate(() => window.__game.myId);
const idB = await B.evaluate(() => window.__game.myId);
expect('both in one game', idA && idB && (await B.evaluate((id) => window.__game.players.has(id), idA)), { idA, idB });
const chat = (p, t) => p.evaluate((t) => window.__game.conn.chat(t), t);
const radio = (p, other) =>
  p.evaluate((other) => {
    const g = window.__game;
    const s = g.prediction.state;
    const peer = g.voice.peers.get(other);
    return {
      slot: s.slot,
      vm: g.vm.itemId,
      say: document.querySelector('.chat-say')?.textContent,
      hudRadio: !g.ui.hud.radio.hidden,
      hudTx: g.ui.hud.radio.classList.contains('tx'),
      label: g.ui.hud.aType.textContent,
      inHand: g.radio.inHand,
      keyed: g.radio.keyed,
      tx: g.voice.transmitting,
      onAir: [...g.radio.onAir],
      listed: !!g.players.get(other)?.onAir,
      hiss: g.audio._staticLvl,
      peerRadio: !!peer?.radio,
      heard: peer?.source?.mode?.() ?? -1,
      level: +(peer?.level || 0).toFixed(3),
    };
  }, other);

// [6]: the walkie-talkie in hand
await A.bringToFront();
await A.keyboard.press('Digit6');
await sleep(900);
const held = await radio(A, idB);
expect('[6] takes out the walkie-talkie', held.slot === 5 && held.vm === 45 && held.inHand, held);
expect('...the HUD says how to talk', held.say === 'Say' && held.hudRadio && /hold fire/i.test(held.label), held);
expect('...and it hisses quietly', held.hiss > 0 && held.hiss < 1, held);
await A.screenshot({ path: `${out}/a-held.png` });

// across the valley: A walks off far out of earshot
const far = await A.evaluate(() => {
  const s = window.__game.prediction.state;
  return [Math.round(s.x + 260), Math.round(s.z)];
});
await chat(A, `/tp ${far[0]} ${far[1]}`);
await sleep(1500);
const dist = await B.evaluate((id) => {
  const g = window.__game;
  const s = g.prediction.state;
  const e = g.entities.ents.get(id);
  return e ? Math.hypot(e.rx - s.x, e.rz - s.z) : 'out of sight';
}, idA);
expect('A is out of earshot', dist === 'out of sight' || dist > 60, { dist });
await chat(A, 'radio check');
await sleep(800);
const line = await B.evaluate(() => [...document.querySelectorAll('.chat-line')].filter((l) => /radio check/.test(l.textContent)).length);
expect('chat reaches B across the valley', line === 1, { line });

// holding fire keys it
await A.mouse.down({ button: 'left' });
await sleep(1200);
const txA = await radio(A, idB);
await B.bringToFront();
await sleep(1500);
const rxB = await radio(B, idA);
expect('fire held keys it: A on the air, mic open, HUD lit', txA.keyed && txA.tx && txA.hudTx && /on the air/i.test(txA.label), txA);
expect('B is told A is on the air and hears the static', rxB.listed && rxB.onAir.includes(idA) && rxB.hiss === 1, rxB);
expect("B gets A's voice through the radio at any distance", rxB.peerRadio && rxB.heard === 2, rxB);
await A.bringToFront();
await A.screenshot({ path: `${out}/a-keyed.png` });
await A.mouse.up({ button: 'left' });
await sleep(1500);
const offA = await radio(A, idB);
await B.bringToFront();
await sleep(500);
const offB = await radio(B, idA);
expect('letting go takes A off the air, mic closed', !offA.keyed && !offA.tx && offA.inHand, offA);
expect('...and B hears the radio go quiet', !offB.listed && offB.onAir.length === 0 && offB.hiss === 0 && !offB.peerRadio, offB);

// out of the hand: chat still reaches B across the valley
await A.bringToFront();
await A.keyboard.press('Digit3');
await sleep(800);
await chat(A, 'just me');
await sleep(800);
const quiet = await B.evaluate(() => [...document.querySelectorAll('.chat-line')].filter((l) => /just me/.test(l.textContent)).length);
const away = await radio(A, idB);
expect('put away: chat still reaches B, no hiss', quiet === 1 && !away.inHand && away.hiss === 0 && away.say === 'Say', { quiet, away });

// B sees A with it: back beside B, A keys it and it comes up to the mouth
const spot = await B.evaluate(() => {
  const g = window.__game;
  const s = g.prediction.state;
  return [+(s.x - Math.sin(g.input.yaw) * 1.9).toFixed(2), +(s.z - Math.cos(g.input.yaw) * 1.9).toFixed(2), g.input.yaw];
});
await chat(A, `/tp ${spot[0]} ${spot[1]}`);
await A.evaluate((yaw) => (window.__game.input.yaw = yaw + Math.PI), spot[2]);
await A.keyboard.press('Digit6');
await sleep(1500);
await B.bringToFront();
await B.evaluate(() => (window.__game.input.pitch = -0.05));
await sleep(1200);
await B.screenshot({ path: `${out}/b-sees-held.png` });
await A.bringToFront();
await A.mouse.down({ button: 'left' });
await sleep(800);
await B.bringToFront();
await sleep(1200);
const near = await radio(B, idA);
await B.screenshot({ path: `${out}/b-sees-keyed.png` });
expect('B sees A holding it, raised while A is on the air', near.listed, near);
await A.bringToFront();
await A.mouse.up({ button: 'left' });

expect('no client errors', errors.length === 0, [...new Set(errors)].slice(0, 5));
await Promise.race([Promise.all(browsers.map((b) => b.close())), sleep(5000)]);
process.exit(fails ? 1 : 0);
