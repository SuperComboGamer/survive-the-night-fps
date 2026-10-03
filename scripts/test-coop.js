// DEAD RIDE co-op in two real browsers against a real server: one creates a game in the lobby, the other joins it by code
// and readies, the host starts, both load the map and begin together. Then: the guest mirrors the host's zombies (same net
// ids), each sees the other as a survivor, a hit claimed by the guest is applied by the host and kills for both, the points
// go to the guest, power-ups are shared, a downed guest is revived by the host, and when the host leaves the guest takes over.
// Isolated: own profiles, off-screen, no pointer lock. Slow under software rendering (each browser builds the map).
// usage: node scripts/test-coop.js [--base http://localhost:3000] [--map shaft-nine]
import puppeteer from 'puppeteer-core';
import { existsSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const base = arg('base', 'http://localhost:3000');
const map = arg('map', 'shaft-nine');
const out = arg('out', 'shots/coop');
mkdirSync(out, { recursive: true });
const chrome = process.env.CHROME || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};

async function open(name) {
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: 'new',
    protocolTimeout: 900000,
    args: ['--user-data-dir=' + mkdtempSync(join(tmpdir(), 'stn-chrome-')), '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--window-position=-32000,-32000', '--no-first-run', '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=960,540'],
  });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((n) => {
    Element.prototype.requestPointerLock = function () {};
    Document.prototype.exitPointerLock = function () {};
    localStorage.setItem('dr.name', n);
  }, name);
  await page.setViewport({ width: 960, height: 540 });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message.slice(0, 200)));
  await page.goto(`${base}/deadride/?nolock=1`, { waitUntil: 'load', timeout: 120000 });
  return { browser, page, errors, name };
}
const until = async (page, fn, arg, ms = 600000, step = 2000) => {
  for (let t = 0; t < ms; t += step) {
    if (await page.evaluate(fn, arg).catch(() => false)) return true;
    await sleep(step);
  }
  return false;
};

const A = await open('Hosty');
const B = await open('Guesty');
try {
  // the menus are up when the lobby client exists
  await until(A.page, () => !!window.__g?.lobby);
  await until(B.page, () => !!window.__g?.lobby);
  await A.page.evaluate(async (map) => {
    const L = window.__g.lobby;
    await L.connect('Hosty');
    L.send({ t: 'create', map, max: 5, name: 'Test team' });
  }, map);
  check('the host creates a game', await until(A.page, () => !!window.__g.lobby.lobby, null, 10000, 200));
  const code = await A.page.evaluate(() => window.__g.lobby.lobby.code);
  await B.page.evaluate(async (code) => {
    const L = window.__g.lobby;
    await L.connect('Guesty');
    L.send({ t: 'join', code });
  }, code);
  check('the guest joins by code', await until(B.page, () => window.__g.lobby.lobby?.players.length === 2, null, 10000, 200), code);
  await B.page.evaluate(() => window.__g.lobby.send({ t: 'ready', v: true }));
  await sleep(500);
  await A.page.evaluate(() => window.__g.lobby.send({ t: 'start' }));
  const t0 = Date.now();
  const both = await Promise.all([until(A.page, () => window.__g.mode === 'play'), until(B.page, () => window.__g.mode === 'play')]);
  check('both load the map and start together', both[0] && both[1], `${((Date.now() - t0) / 1000) | 0}s`);
  check('roles: one host, one guest', (await A.page.evaluate(() => window.__g.coop?.isHost)) === true && (await B.page.evaluate(() => window.__g.coop?.isHost)) === false);
  // round 1: the host spawns, the guest mirrors
  check('round 1 starts for both', await until(B.page, () => window.__g.game.round >= 1, null, 60000));
  check('the guest mirrors the host\'s zombies', await until(B.page, () => window.__g.zombies.alive.some((z) => z.netId), null, 120000));
  const ids = await A.page.evaluate(() => window.__g.zombies.alive.map((z) => z.netId));
  const idsB = await B.page.evaluate(() => window.__g.zombies.alive.map((z) => z.netId));
  check('...with the same net ids', idsB.length > 0 && idsB.every((id) => ids.includes(id)), `host ${ids} guest ${idsB}`);
  check('each sees the other as a survivor', (await A.page.evaluate(() => window.__g.coop.remotes.size)) === 1 && (await B.page.evaluate(() => window.__g.coop.remotes.size)) === 1);
  const d0 = await A.page.evaluate(() => {
    const r = window.__g.coop.remotes.values().next().value;
    return r.pos.distanceTo(window.__g.player.pos);
  });
  check('teammates start apart, not on top of each other', d0 > 1, `${d0.toFixed(1)} m`);
  // a look at each other (screenshots): turn to face the teammate, from a few metres off
  for (const [P, nm] of [[A, 'host-sees-guest'], [B, 'guest-sees-host']]) {
    await P.page.evaluate(() => {
      const g = window.__g;
      const r = g.coop.remotes.values().next().value;
      const p = g.player;
      const dx = r.pos.x - p.pos.x;
      const dz = r.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      if (d < 3) {
        p.pos.x = r.pos.x - (dx / d) * 3.5;
        p.pos.z = r.pos.z - (dz / d) * 3.5;
      }
      p.yaw = Math.atan2(-(r.pos.x - p.pos.x), -(r.pos.z - p.pos.z));
      p.pitch = -0.08;
    });
    await sleep(3000);
    await P.page.screenshot({ path: `${out}/${nm}.png` });
  }
  // the guest claims a lethal hit
  const target = idsB[0];
  const ptsB0 = await B.page.evaluate(() => window.__g.game.points);
  await B.page.evaluate((id) => {
    const c = window.__g.coop;
    const z = c.zById.get(id);
    c.claimHit(z, { amount: 99999, part: 'torso', dir: new z.pos.constructor(0, 0, 1), point: z.pos.clone().setY(z.pos.y + 1.2) }, { _sid: 1 });
  }, target);
  check('the guest\'s hit is applied by the host: dead there', await until(A.page, (id) => !window.__g.zombies.alive.some((z) => z.netId === id), target, 10000, 200));
  check('...and dead here', await until(B.page, (id) => !window.__g.zombies.alive.some((z) => z.netId === id), target, 10000, 200));
  check('...and the points are the guest\'s', await until(B.page, (p0) => window.__g.game.points > p0, ptsB0, 10000, 200), `${ptsB0} -> ${await B.page.evaluate(() => window.__g.game.points)}`);
  await A.page.screenshot({ path: `${out}/host.png` });
  await B.page.screenshot({ path: `${out}/guest.png` });
  // power-up: the host drops one, the guest takes it, both get the effect
  await A.page.evaluate(() => {
    const g = window.__g.game;
    const p = window.__g.coop.remotes.values().next().value.pos;
    g.dropPowerup('maxammo', p.clone().setX(p.x + 5)); // (5 m from the guest: it walks over below)
  });
  check('a power-up the host drops appears for the guest', await until(B.page, () => window.__g.game.powerups.length > 0, null, 10000, 200));
  await B.page.evaluate(() => {
    const g = window.__g.game;
    const pu = g.powerups[0];
    window.__g.player.pos.set(pu.pos.x, pu.pos.y, pu.pos.z);
  });
  check('...the guest walks into it and it is gone for both', (await until(B.page, () => window.__g.game.powerups.length === 0, null, 15000, 300)) && (await until(A.page, () => window.__g.game.powerups.length === 0, null, 5000, 300)));
  // the guest goes down, the host revives
  await B.page.evaluate(() => {
    const g = window.__g.game;
    g.perks.clear();
    window.__g.player.damage(9999);
  });
  check('the guest goes down (not game over)', await until(B.page, () => window.__g.game.state === 'downed', null, 5000, 200));
  check('the host sees the guest down', await until(A.page, () => [...window.__g.coop.remotes.values()].some((r) => r.flags & 2), null, 5000, 200));
  await A.page.evaluate(() => {
    const c = window.__g.coop;
    c.revive([...c.remotes.keys()][0]);
  });
  check('the host revives the guest', await until(B.page, () => window.__g.game.state !== 'downed' && window.__g.player.alive, null, 5000, 200));
  // the host leaves: the guest runs the game
  await A.browser.close();
  check('the host leaves: the guest becomes the host', await until(B.page, () => window.__g.coop?.isHost === true, null, 15000, 300));
  check('...and its zombies come alive (not puppets)', await B.page.evaluate(() => window.__g.zombies.puppet === false));
} catch (e) {
  check('no error', false, String(e && e.stack));
}
console.log('host errors:', A.errors.slice(0, 5));
console.log('guest errors:', B.errors.slice(0, 5));
await B.browser.close().catch(() => {});
await A.browser.close().catch(() => {});
console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok');
process.exit(fails.length ? 1 : 0);
