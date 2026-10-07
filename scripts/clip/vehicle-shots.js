// Vehicles in the real game: stills, frame strips and footage for the pull request (docs/object-clipping.md's rules:
// one headless browser, through lib.js's launchChrome, software rendering unless --gpu). Both clocks are held, as
// scripts/clip/nunchaku-film.js holds them: the page's (performance.now and requestAnimationFrame are stood in for,
// so a frame of the game happens when this script says and is exactly 1 / FPS s long however long it took to draw)
// and the server's (the admin /step: a tick when asked). So a scene is the same every time it is run.
//   node scripts/clip/vehicle-shots.js <scene>[,<scene>...] [--seed 1337] [--out shots/pr/vehicles] [--gpu] [--build]
//        [--quality low|medium|high] [--fps 15]
// The scenes are in scripts/clip/vehicle-scenes.js: each is an async function of a context
//   A, B             the pages of the two clients (B joins when a scene asks for it: await c.second())
//   chat(p, t)       an admin command said by that client (it is heard on the next frames)
//   ev(p, fn, arg)   run in the page (window.__game is the game)
//   run(n, o)        n frames of the game. o (or a function of the frame's number giving it): { A: { buttons, yaw,
//                    pitch, cam }, B: {...} } - what each client holds down, where it looks, a camera outside the eye
//   rec(name, n, o)  ...kept, as shots/<name>/00000.png on (footage: c.video cuts it)
//   info             what client A's page said after the last frame: { s (its predicted state), veh: [...], dead: [...] }
//   shot(p, name, opts)   a screenshot (hud: false hides the HUD)
//   strip(name, files, cols, title)   a contact sheet of shots already taken
//   video(name, fps)      the frames of rec(name) as name.mp4 (ffmpeg), and a strip of every so many of them
//   orbit(t, yaw, pitch, dist, opts)   a camera looking at a point from round it (for o.cam)
import { mkdirSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO, parseArgs, sleep, startGame, launchChrome, composeSheets, LIFE_MAX } from './lib.js';
import * as SCENES from './vehicle-scenes.js';

const args = parseArgs(process.argv.slice(2), { seed: '1337', out: join(REPO, 'shots', 'pr', 'vehicles'), quality: 'low', fps: '15' });
const names = (args._[0] || '').split(',').filter(Boolean).map((n) => n.replace(/-/g, '_'));
if (!names.length || names.some((n) => !SCENES[n])) {
  console.log(`usage: node scripts/clip/vehicle-shots.js <scene>[,<scene>] [--seed n] [--out dir] [--gpu] [--quality q]\nscenes: ${Object.keys(SCENES).filter((k) => typeof SCENES[k] === 'function').join(', ')}`);
  process.exit(1);
}
const FPS = +args.fps;
const out = resolve(args.out);
mkdirSync(out, { recursive: true });
const FFMPEG = process.env.FFMPEG || 'C:\\Users\\zany\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1-full_build\\bin\\ffmpeg.exe';

function VIRTUAL_CLOCK() {
  const realNow = performance.now.bind(performance);
  window.__realNow = realNow;
  const realRAF = window.requestAnimationFrame.bind(window);
  let held = false, now = 0, queue = [];
  performance.now = () => (held ? now : realNow());
  window.requestAnimationFrame = (cb) => {
    if (!held) return realRAF(cb);
    queue.push(cb);
    return queue.length;
  };
  window.__vt = {
    hold() {
      now = realNow() + 50;
      held = true;
    },
    free() {
      held = false;
      const cbs = queue;
      queue = [];
      for (const cb of cbs) realRAF(cb);
    },
    step(ms) {
      now += ms;
      const cbs = queue;
      queue = [];
      for (const cb of cbs) cb(now);
      return cbs.length;
    },
  };
}

let game = null;
let chrome = null;
const sheets = [];
const t0 = Date.now();
try {
  game = await startGame(REPO, { seed: +args.seed, build: !!args.build });
  chrome = await launchChrome({ width: 1280, height: 720, gpu: !!args.gpu, life: LIFE_MAX, wait: 45 * 60_000, storage: { 'stn.settings': JSON.stringify(args.quality === 'low' ? { quality: 'low', renderScale: 1 } : { quality: args.quality, renderScale: 1 }) } });
  const trace = (t) => process.env.CLIP_TRACE && console.log(`  [join] ${t} ${Math.round((Date.now() - t0) / 1000)} s`);
  const join_ = async (p) => {
    await p.evaluateOnNewDocument(VIRTUAL_CLOCK);
    trace('goto');
    await p.goto(game.url, { waitUntil: 'load', timeout: 60000 });
    trace('loaded');
    await sleep(3500);
    await p.evaluate(() => [...document.querySelectorAll('button')].find((x) => /^\s*(quick )?join/i.test(x.textContent))?.click());
    trace('clicked');
    for (let i = 0; i < 400 && !(await p.evaluate(() => !!(window.__game && window.__game.myId && window.__game.vm))); i++) await sleep(250);
    trace('in');
    await sleep(2500);
    await p.evaluate(() => {
      const g = window.__game;
      g.input.locked = true;
      g.input.enabled = true;
      g.input.requestLock = () => {};
      g.input.handlers.onLockChange = () => {};
      g.ui.showPause(false);
    });
    await p.addStyleTag({ content: '.clip-nohud #ui { visibility: hidden !important; } .stn-ui .chat-log { visibility: hidden !important; }' });
    trace('ready');
    return p;
  };
  const c = {
    A: await join_(chrome.page),
    B: null,
    out,
    seed: +args.seed,
    fps: FPS,
    held: false,
    info: null,
    tickAcc: 0,
    left: () => LIFE_MAX - (Date.now() - t0),
    wait: sleep,
    chat: (p, t) => p.evaluate((t) => window.__game.conn.chat(t), t),
    ev: (p, fn, arg) => p.evaluate(fn, arg),
    async second() {
      if (c.B) return c.B;
      if (c.held) throw new Error('second(): before the clocks are held');
      // (two pages drawing at once on the software renderer: the newcomer's shaders take minutes to build. The first
      // page draws a frame every 2.5 s meanwhile: both wait on the one GPU process)
      await c.A.evaluate(() => window.__vt.hold());
      let busy = false;
      const slow = setInterval(async () => {
        if (busy) return;
        busy = true;
        await c.A.evaluate(() => window.__vt.step(50)).catch(() => {});
        busy = false;
      }, 2500);
      try {
        c.B = await join_(await chrome.newPage({ window: true }));
      } finally {
        clearInterval(slow);
        while (busy) await sleep(20);
      }
      await c.A.evaluate(() => window.__vt.free());
      await c.A.bringToFront();
      return c.B;
    },
    // both clocks held from here on
    async hold() {
      if (c.held) return;
      await c.chat(c.A, '/step on');
      await sleep(400);
      for (const p of [c.A, c.B]) if (p) await p.evaluate(() => window.__vt.hold());
      c.held = true;
      await c.run(4);
    },
    async frame(o = {}, save = null) {
      // (left alone for 20 s the server lets its clock go again: Game.takeSteps)
      if (c.held && Date.now() - (c.lastWall || 0) > 8000) await c.chat(c.A, '/step on');
      c.lastWall = Date.now();
      const pages = [['A', c.A], ['B', c.B]].filter((x) => x[1]);
      c.tickAcc += 20 / FPS;
      const ticks = Math.floor(c.tickAcc + 1e-9);
      c.tickAcc -= ticks;
      for (const [key, p] of pages) {
        const st = o[key] || {};
        if (process.env.CLIP_TRACE) console.log(`  [frame] ${key}`);
        await p.evaluate(
          (st, ms) => {
            const g = window.__game;
            g.input.buttons = st.buttons || 0;
            if (st.yaw !== undefined) g.input.yaw = st.yaw;
            if (st.pitch !== undefined) g.input.pitch = st.pitch;
            if (st.cam !== undefined) g.debugCam = st.cam;
            if (st.slot !== undefined) g.prediction.requestSlot(st.slot);
            window.__vt.step(ms);
          },
          st,
          1000 / FPS,
        );
      }
      if (process.env.CLIP_TRACE) console.log(`  [frame] info ${ticks}`);
      c.info = await c.A.evaluate(async (ticks) => {
        const g = window.__game;
        if (ticks) {
          const t = g.net.tick, t0 = Date.now();
          g.conn.chat(`/step ${ticks}`);
          while (g.net.tick === t && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 1));
        }
        const s = g.prediction.state;
        const veh = [];
        for (const e of g.vehicles.list.values()) veh.push({ id: e.id, vk: e.vk, x: e.veh.x, y: e.veh.y, z: e.veh.z, yaw: e.veh.yaw, sp: e.veh.vf, vf: e.q[5], state: e.veh.state, seats: e.veh.seats, fuel: e.veh.fuel, hp: e.veh.hp });
        const dead = [];
        for (const e of g.entities.ents.values()) if (e.kind === 2 && !e.dead && e.view) dead.push({ x: e.rx, y: e.ry, z: e.rz });
        return { s: { x: s.x, y: s.y, z: s.z, vx: s.vx, vz: s.vz, yaw: g.input.yaw, drive: s.drive, pass: s.pass, dyaw: s.dyaw, dsteer: s.dsteer, dfuel: s.dfuel }, veh, dead, hp: g.self.hp, prompt: g.prompt || '', tick: g.net.tick };
      }, ticks);
      if (save) await (save.p || c.A).screenshot({ path: save.file, optimizeForSpeed: true });
    },
    async run(n, o) {
      for (let i = 0; i < n; i++) await c.frame(typeof o === 'function' ? o(i) || {} : o || {});
    },
    async until(test, max, o) {
      let i = 0;
      for (; i < max && !test(); i++) await c.frame(typeof o === 'function' ? o(i) || {} : o || {});
      return i;
    },
    async rec(name, n, o, opts = {}) {
      const dir = join(out, 'frames', name);
      if (!opts.append) rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      let k = opts.append ? readdirSync(dir).length : 0;
      await (opts.p || c.A).evaluate((hud) => document.body.classList.toggle('clip-nohud', !hud), !!opts.hud);
      for (let i = 0; i < n; i++) {
        const st = typeof o === 'function' ? o(i) : o;
        if (st === null) break; // (the scene says it is over)
        await c.frame(st || {}, { file: join(dir, String(k++).padStart(5, '0') + '.png'), p: opts.p });
        if (i % 10 === 0) process.stdout.write('+');
      }
      return dir;
    },
    async shot(p, name, o = {}) {
      await p.evaluate((hud) => document.body.classList.toggle('clip-nohud', !hud), o.hud !== false);
      if (c.held) await c.run(o.settle ?? 2, o.hold);
      else await sleep(o.wait ?? 400);
      const file = join(out, `${name}.png`);
      await p.screenshot({ path: file });
      process.stdout.write('.');
      return file;
    },
    strip(name, files, cols = files.length, title = name, cell = [426, 240]) {
      sheets.push({ out: join(out, `${name}.png`), title, cols, cellW: cell[0], cellH: cell[1], cells: files.map((f, i) => ({ img: f, tag: String(i + 1), label: '' })) });
    },
    // the frames of rec(name): an mp4 at the frame rate they were taken at, and a strip of `n` of them
    video(name, n = 8, title = name) {
      const dir = join(out, 'frames', name);
      const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
      if (!files.length) return;
      if (existsSync(FFMPEG)) {
        try {
          execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(dir, '%05d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-vf', 'scale=1280:720', join(out, `${name}.mp4`)], { stdio: 'ignore' });
        } catch (e) {
          console.log(`  (ffmpeg: ${e.message.split('\n')[0]})`);
        }
      } else console.log('  (no ffmpeg here: the frames are kept, no mp4 cut)');
      const pick = [];
      for (let i = 0; i < n; i++) pick.push(join(dir, files[Math.min(files.length - 1, Math.round((i * (files.length - 1)) / Math.max(1, n - 1)))]));
      c.strip(`${name}-strip`, pick, Math.min(4, n), title, [640, 360]);
    },
    orbit(t, yaw, pitch, dist, o = {}) {
      const cp = Math.cos(pitch);
      // (yaw 0: from in front of something that faces -Z, looking back at it)
      const x = t[0] - Math.sin(yaw) * cp * dist, y = t[1] + Math.sin(pitch) * dist, z = t[2] - Math.cos(yaw) * cp * dist;
      return { x, y, z, yaw: yaw + Math.PI, pitch: -pitch, fov: o.fov || 40, body: o.body !== false };
    },
  };
  for (const n of names) {
    console.log(`\n== ${n} (${Math.round(c.left() / 1000)} s of this browser left)`);
    try {
      await SCENES[n](c);
    } catch (e) {
      console.log(`
  ${n} FAILED: ${e.stack || e}`); // (the sheets of the scenes before it are still made)
      break;
    }
  }
  if (sheets.length) await composeSheets(await chrome.newPage({ window: true }), sheets);
  process.stdout.write('\n');
} finally {
  if (chrome) await chrome.close();
  if (game) game.stop();
}
console.log(`shots in ${out} (${Math.round((Date.now() - t0) / 1000)} s)`);
