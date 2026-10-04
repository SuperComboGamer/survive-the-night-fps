// Talking mouths e2e (server: GODMODE=1 ADMIN_SECRET=e2e, or the secret as the 3rd argument): two clients, each in a
// browser of its own with a fake microphone (Chrome's fake device beeps). B stands in front of A. While A is not
// talking, A's mouth stays shut and nothing runs for it; A holds V (push to talk) and B sees A's mouth open with the
// beeps and close between them, the jaw dropping with it; A lets go and the mouth is gone within about 0.4 s. Then A
// keys the walkie-talkie instead, and the mouth moves the same way.
// usage: node scripts/e2e-mouth.js [url] [outdir] [admin secret]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
const url = process.argv[2] || 'http://localhost:5173';
const out = process.argv[3] || '/tmp/e2e-mouth';
const admin = process.argv[4] || 'e2e';
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
  await page.waitForSelector('.sp-joinbtn', { visible: true, timeout: 15000 });
  await page.click('.sp-joinbtn');
  await page.waitForFunction(() => window.__game?.myId && window.__game?.prediction?.state, { timeout: 15000 });
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

// On B, every 20 ms for ms: A's mouth as B draws it (visible, how open, the jaw bone, the loudness read for it) and
// how many times its mouth was updated at all
const watch = (ms) =>
  B.evaluate(
    (id, ms) =>
      new Promise((done) => {
        const g = window.__game;
        const sv = g.entities.ents.get(id)?.view?._inst;
        if (!sv) return done(null);
        let calls = 0;
        const um = sv.updateMouth;
        sv.updateMouth = function (...a) {
          calls++;
          return um.apply(this, a);
        };
        const rows = [];
        const t0 = performance.now();
        const iv = setInterval(() => {
          rows.push({ t: Math.round(performance.now() - t0), at: Date.now(), vis: sv.mouth.visible, open: +sv.mouthOpen.toFixed(3), jaw: +sv.bones[7].rotation.x.toFixed(3), level: +g.voice.mouthLevel(id).toFixed(3) });
          if (performance.now() - t0 >= ms) {
            clearInterval(iv);
            sv.updateMouth = um;
            done({ rows, calls });
          }
        }, 20);
      }),
    idA,
    ms
  );
const sum = (w) => {
  const r = w?.rows || [];
  const opens = r.map((x) => x.open);
  // how many times it popped open: rose past 0.3 from under 0.1
  let pops = 0, low = true;
  for (const o of opens) {
    if (low && o > 0.3) pops++, (low = false);
    else if (o < 0.1) low = true;
  }
  return { n: r.length, calls: w?.calls, shown: r.filter((x) => x.vis).length, maxOpen: Math.max(0, ...opens), minJaw: Math.min(0, ...r.map((x) => x.jaw)), maxLevel: Math.max(0, ...r.map((x) => x.level)), pops };
};

const A = await client();
const B = await client();
const idA = await A.evaluate(() => window.__game.myId);
const idB = await B.evaluate(() => window.__game.myId);
expect('both in one game', idA && idB && (await B.evaluate((id) => window.__game.players.has(id), idA)), { idA, idB });
await A.evaluate((k) => window.__game.conn.chat(`/admin ${k}`), admin); // (/tp is an admin command)
await sleep(300);

// A stands 1.6 m in front of B, facing B
const spot = await B.evaluate(() => {
  const g = window.__game;
  const s = g.prediction.state;
  return [+(s.x - Math.sin(g.input.yaw) * 1.6).toFixed(2), +(s.z - Math.cos(g.input.yaw) * 1.6).toFixed(2), g.input.yaw];
});
await A.evaluate((spot) => {
  const g = window.__game;
  g.conn.chat(`/tp ${spot[0]} ${spot[1]}`);
  g.input.yaw = spot[2] + Math.PI;
}, spot);
await sleep(1500);
await B.bringToFront();
await B.evaluate(() => {
  const g = window.__game;
  g.input.pitch = 0.02;
  // nothing in front of A's face in the pictures: no weapon in B's hands, no crosshair
  g.renderer.vmScene.visible = false;
  document.head.insertAdjacentHTML('beforeend', '<style>.xh{visibility:hidden}</style>');
});
await sleep(1500);
// the whole view, and A's face (in the middle of it) close up, taken as A's mouth is open (on a beep)
const shoot = async (name) => {
  await B.waitForFunction((id) => window.__game.entities.ents.get(id)?.view?._inst.mouthOpen > 0.6, { polling: 'raf', timeout: 3000 }, idA).catch(() => {});
  await B.screenshot({ path: `${out}/${name}.png` });
  await B.screenshot({ path: `${out}/${name}-face.png`, clip: { x: 560, y: 270, width: 160, height: 120, scale: 3 } });
};

// not talking: shut, and the mouth is not even updated
const quiet = sum(await watch(1500));
expect("A not talking: B never sees A's mouth, nothing runs for it", quiet.n > 50 && quiet.shown === 0 && quiet.calls === 0 && quiet.maxLevel < 0.02, quiet);

// A holds V: the beeps come through and the mouth moves with them
await A.bringToFront();
await A.keyboard.down('KeyV');
await sleep(600);
const tx = await A.evaluate(() => window.__game.voice.transmitting);
await B.bringToFront();
await sleep(400);
const talkW = watch(3000);
await sleep(1200);
await shoot('b-sees-talking');
const talk = sum(await talkW);
await sleep(100);
expect('A holds V: on the air', tx, { tx });
expect("B sees A's mouth open with the voice, the jaw dropping", talk.shown > 0 && talk.maxOpen > 0.5 && talk.minJaw < -0.1, talk);
expect('...and close between the beeps, opening again on the next', talk.pops >= 2, talk);

// A lets go mid-beep: the mouth is gone within about 0.4 s of the last sound B got (and the jaw back up)
const afterW = watch(2500);
await sleep(700);
await A.keyboard.up('KeyV');
const after = await afterW;
const lastLoud = Math.max(0, ...after.rows.filter((x) => x.level > 0.03).map((x) => x.at));
const lastShown = Math.max(0, ...after.rows.filter((x) => x.vis).map((x) => x.at));
const end = after.rows.at(-1);
const lag = lastShown - lastLoud;
expect('A lets go: the mouth shuts within ~0.4 s of the last sound', lastLoud > 0 && lag > 0 && lag < 480 && !end.vis && end.open === 0 && end.jaw === 0, { lag, end, ...sum(after) });

// the walkie-talkie: fire held keys it, and the mouth follows that voice too
await A.bringToFront();
await A.keyboard.press('Digit6');
await sleep(900);
await A.mouse.down({ button: 'left' });
await sleep(600);
const keyed = await A.evaluate(() => window.__game.radio.keyed && window.__game.voice.transmitting);
await B.bringToFront();
await sleep(300);
const radioW = watch(2500);
await sleep(1000);
await shoot('b-sees-radio');
const radio = sum(await radioW);
expect('A keys the walkie-talkie', keyed, { keyed });
expect("B sees A's mouth move behind the radio", radio.maxOpen > 0.5 && radio.pops >= 1, radio);
await A.bringToFront();
await A.mouse.up({ button: 'left' });
await sleep(1200);
await B.bringToFront();
const off = sum(await watch(800));
expect('off the air: shut again', off.shown === 0 && off.calls === 0, off);

expect('no client errors', errors.length === 0, [...new Set(errors)].slice(0, 5));
await Promise.race([Promise.all(browsers.map((b) => b.close())), sleep(5000)]);
process.exit(fails ? 1 : 0);
