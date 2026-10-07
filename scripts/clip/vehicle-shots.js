// Vehicles in the real game: stills and frame strips for the pull request (docs/object-clipping.md's rules: one
// headless browser, through lib.js's launchChrome, software rendering unless --gpu).
//   node scripts/clip/vehicle-shots.js <scene>[,<scene>...] [--seed 1337] [--out shots/pr/vehicles] [--gpu] [--build]
// The scenes are in scripts/clip/vehicle-scenes.js: each is an async function of a context
//   A, B        the pages of the two clients (B joins when a scene asks for it: ctx.second())
//   chat(p, t)  an admin command said by that client
//   ev(p, fn, arg)   run in the page (window.__game is the game)
//   keys(p, codes, ms)  hold those keys down for so long (KeyW, KeyA, Space ...)
//   cam(p, at)  a camera outside the eye: { x, y, z, yaw, pitch, fov, body } or null for the eye's own
//   orbit(p, target, yaw, pitch, dist, opts)  ...looking at a point from round it
//   shot(p, name, opts)  a screenshot (hud: false hides the HUD)
//   strip(name, files, cols)  a contact sheet of shots already taken
//   wait(ms), step(p, n)  let the game run; with the clock held (/step on) run n ticks
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REPO, parseArgs, sleep, startGame, launchChrome, composeSheets, LIFE_MAX, CHEAP_SETTINGS } from './lib.js';
import * as SCENES from './vehicle-scenes.js';

const args = parseArgs(process.argv.slice(2), { seed: '1337', out: join(REPO, 'shots', 'pr', 'vehicles') });
const names = (args._[0] || '').split(',').filter(Boolean);
if (!names.length || names.some((n) => !SCENES[n])) {
  console.log(`usage: node scripts/clip/vehicle-shots.js <scene>[,<scene>] [--seed n] [--out dir] [--gpu]\nscenes: ${Object.keys(SCENES).join(', ')}`);
  process.exit(1);
}
const out = resolve(args.out);
mkdirSync(out, { recursive: true });
let game = null;
let chrome = null;
const sheets = [];
try {
  game = await startGame(REPO, { seed: +args.seed, build: !!args.build, env: args.env ? Object.fromEntries(String(args.env).split(',').map((kv) => kv.split('='))) : {} });
  chrome = await launchChrome({ width: 1280, height: 720, gpu: !!args.gpu, life: LIFE_MAX, wait: 45 * 60_000, storage: args.gpu ? { 'stn.settings': JSON.stringify({ quality: args.quality || 'medium' }) } : { 'stn.settings': CHEAP_SETTINGS } });
  const join_ = async (p) => {
    await p.goto(game.url, { waitUntil: 'load', timeout: 60000 });
    await sleep(3500);
    await p.evaluate(() => [...document.querySelectorAll('button')].find((x) => /^\s*(quick )?join/i.test(x.textContent))?.click());
    for (let i = 0; i < 120 && !(await p.evaluate(() => !!(window.__game && window.__game.myId && window.__game.vm))); i++) await sleep(250);
    await sleep(2500);
    await p.evaluate(() => {
      const g = window.__game;
      g.input.locked = true;
      g.input.enabled = true;
      g.input.requestLock = () => {};
      g.input.handlers.onLockChange = () => {};
      g.ui.showPause(false);
    });
    await p.addStyleTag({ content: '.clip-nohud #ui { visibility: hidden !important; }' });
    return p;
  };
  const ctx = {
    A: await join_(chrome.page),
    B: null,
    out,
    seed: +args.seed,
    wait: sleep,
    async second() {
      if (!ctx.B) ctx.B = await join_(await chrome.newPage({ window: true }));
      await ctx.A.bringToFront();
      return ctx.B;
    },
    chat: (p, t) => p.evaluate((t) => window.__game.conn.chat(t), t),
    ev: (p, fn, arg) => p.evaluate(fn, arg),
    async keys(p, codes, ms) {
      for (const c of codes) await p.keyboard.down(c);
      await sleep(ms);
      for (const c of codes) await p.keyboard.up(c);
    },
    cam: (p, at) =>
      p.evaluate((at) => {
        window.__game.debugCam = at;
      }, at),
    orbit: (p, t, yaw, pitch, dist, o = {}) =>
      p.evaluate(
        ([t, yaw, pitch, dist, o]) => {
          const cp = Math.cos(pitch);
          // (yaw 0: from in front of something that faces -Z, looking back at it)
          const x = t[0] - Math.sin(yaw) * cp * dist, y = t[1] + Math.sin(pitch) * dist, z = t[2] - Math.cos(yaw) * cp * dist;
          window.__game.debugCam = { x, y, z, yaw: yaw + Math.PI, pitch: -pitch, fov: o.fov || 40, body: o.body !== false };
        },
        [t, yaw, pitch, dist, o],
      ),
    async shot(p, name, o = {}) {
      await p.bringToFront();
      await p.evaluate((hud) => document.body.classList.toggle('clip-nohud', !hud), o.hud !== false);
      await sleep(o.settle ?? 350);
      const file = join(out, `${name}.png`);
      await p.screenshot({ path: file });
      process.stdout.write('.');
      return file;
    },
    strip(name, files, cols = files.length, title = name, cell = [426, 240]) {
      sheets.push({ out: join(out, `${name}.png`), title, cols, cellW: cell[0], cellH: cell[1], cells: files.map((f, i) => ({ img: f, tag: String(i + 1), label: '' })) });
    },
    async step(p, n = 1) {
      await p.evaluate((n) => window.__game.conn.chat(`/step ${n}`), n);
    },
  };
  for (const n of names) {
    console.log(`\n== ${n}`);
    await SCENES[n](ctx);
  }
  if (sheets.length) await composeSheets(await chrome.newPage({ window: true }), sheets); // (a page of its own: the game's is busy)
  process.stdout.write('\n');
} finally {
  if (chrome) await chrome.close();
  if (game) game.stop();
}
console.log(`shots in ${out}`);
