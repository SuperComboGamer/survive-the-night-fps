// Shots in the real game (docs/object-clipping.md, "In the game"): starts the built game server of a tree on a free port
// (node server/index.js, NODE_ENV=production, a fixed seed, an admin secret for the chat commands, godmode, a long
// day), joins one or two headless clients, and runs a list of shots: give an item and take it in hand, /tp somewhere,
// look at a point, throw, and screenshot. A second client gives the third-person view of the first.
// With --before it does the same in another checkout too and composes each pair (before | after).
//
// usage: node scripts/clip/game-shots.js <shots.json> [--seed 1] [--before <worktree>] [--build] [--out shots/clip/game] [--gpu]
//   --gpu     the real GPU and the player's own quality (default: software rendering, the low preset)
// npm run clip:game -- scripts/clip/game-shots.example.json
//   --build   build the client (npm run build) first even if the tree has a dist/ (it is built when it has none)
//
// shots.json: [{ "name": "machete-vs-car", "who": "A", "give": [53], "key": "Digit3", "tp": [x, z, (y)],
//               "lookAt": [x, z, y] | "yaw": r, "pitch": r, "wait": 1500, "throwAt": ms, "hideHud": true,
//               "hideVm": true, "hideZombies": true, "others": { "A": { "tp": [...], "give": [...], "key": "...",
//               "yaw": r, "pitch": r } }, "title": "..." }]
//   who        the client that takes the shot (A, or B: B joins when any shot needs it); others: put the other
//              client somewhere first (the third-person view of a player holding something)
//   give/key   /give each item and equip it from the backpack, then press a key (Digit1 guns, Digit2 sidearm,
//              Digit3 melee, Digit4 throwables, Digit5 the hammer, Digit6 the walkie-talkie)
//   tp/lookAt  /tp to x z (onto the ground), then turn to face a world point (x, z, height)
//   throwAt    click once and shoot this many ms later (a throw's wind-up or release)
//   hideHud / hideVm / hideZombies: the HUD, the hands, the day's walkers (client side, for a clean still)
import { readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REPO, OUT, parseArgs, sleep, startGame, launchChrome, composeSheets, LIFE_MAX, CHEAP_SETTINGS } from './lib.js';

const args = parseArgs(process.argv.slice(2), { seed: '1', out: join(OUT, 'game') });
if (!args._.length) {
  console.log('usage: node scripts/clip/game-shots.js <shots.json> [--seed 1] [--before <worktree>]  (see the top of the file)');
  process.exit(1);
}
const shots = JSON.parse(readFileSync(resolve(args._[0]), 'utf8'));

async function run(root, dir) {
  mkdirSync(dir, { recursive: true });
  let game = null;
  const clients = [];
  try {
    game = await startGame(root, { seed: +args.seed, build: !!args.build });
    // One browser (lib.js: one at a time), the second client in a window of its own: a page behind another tab stops
    // drawing and sending. Software rendering and the cheap quality preset unless --gpu.
    let chrome = null;
    const join_ = async () => {
      let p;
      if (!chrome) {
        chrome = await launchChrome({ width: 1280, height: 720, gpu: !!args.gpu, life: LIFE_MAX, storage: args.gpu ? null : { 'stn.settings': CHEAP_SETTINGS } });
        clients.push(chrome);
        p = chrome.page;
      } else p = await chrome.newPage({ window: true });
      await p.evaluateOnNewDocument((k) => {
        try {
          localStorage.setItem('stn.admin', k); // (the client says the admin secret on joining)
        } catch {}
      }, game.secret);
      await p.goto(game.url, { waitUntil: 'load', timeout: 60000 });
      await sleep(3500);
      await p.evaluate(() => [...document.querySelectorAll('button')].find((x) => /join/i.test(x.textContent))?.click());
      for (let i = 0; i < 80 && !(await p.evaluate(() => !!(window.__game && window.__game.myId && window.__game.vm))); i++) await sleep(250);
      await sleep(2500);
      await p.evaluate((k) => {
        const g = window.__game;
        g.input.locked = true;
        g.input.enabled = true;
        g.input.requestLock = () => {};
        g.input.handlers.onLockChange = () => {};
        g.ui.showPause(false);
        g.conn.chat(`/admin ${k}`);
      }, game.secret);
      await p.addStyleTag({ content: '.clip-nohud #ui { visibility: hidden !important; }' });
      return p;
    };
    const pages = { A: await join_() };
    if (shots.some((s) => s.who === 'B' || (s.others && s.others.B))) pages.B = await join_();
    const chat = (p, t) => p.evaluate((t) => window.__game.conn.chat(t), t);
    const equip = async (p, items) => {
      for (const it of items || []) {
        await chat(p, `/give ${it} 1`);
        await sleep(250);
        await p.evaluate((item) => {
          const g = window.__game;
          const i = g.inventory.slots.findIndex((x) => x && x.item === item);
          if (i >= 0) g.conn.action(5, i); // (equip from the backpack)
        }, it);
        await sleep(250);
      }
    };
    const tp = async (p, at) => {
      await chat(p, `/tp ${at.join(' ')}`);
      // (until the view is there: aiming before it arrives aims from where it was)
      for (let i = 0; i < 40; i++) {
        await sleep(150);
        if ((await p.evaluate((t) => Math.hypot(window.__game.renderer.camera.position.x - t[0], window.__game.renderer.camera.position.z - t[1]), at)) < 0.3) break;
      }
      await sleep(500);
    };
    const aim = (p, s) =>
      p.evaluate((s) => {
        const g = window.__game;
        if (s.yaw !== undefined) g.input.yaw = s.yaw;
        if (s.pitch !== undefined) g.input.pitch = s.pitch;
        if (s.lookAt) {
          const c = g.renderer.camera.position;
          const dx = s.lookAt[0] - c.x, dz = s.lookAt[1] - c.z, dy = (s.lookAt[2] ?? c.y) - c.y;
          g.input.yaw = Math.atan2(-dx, -dz);
          g.input.pitch = Math.atan2(dy, Math.hypot(dx, dz));
        }
      }, s);
    for (const s of shots) {
      const p = pages[s.who || 'A'];
      for (const [who, o] of Object.entries(s.others || {})) {
        const q = pages[who];
        await q.bringToFront();
        await equip(q, o.give);
        if (o.key) await q.keyboard.press(o.key);
        if (o.tp) await tp(q, o.tp);
        await aim(q, o);
        await sleep(400);
      }
      await p.bringToFront();
      await equip(p, s.give);
      if (s.key) {
        await p.keyboard.press(s.key);
        await sleep(400);
      }
      if (s.tp) await tp(p, s.tp);
      await aim(p, s);
      await p.evaluate((s) => {
        document.body.classList.toggle('clip-nohud', !!s.hideHud);
        window.__game.renderer.vmScene.visible = !s.hideVm;
      }, s);
      if (s.throwAt !== undefined) {
        await p.evaluate(() => (window.__game.input.mouseButtons = 1));
        await sleep(80);
        await p.evaluate(() => (window.__game.input.mouseButtons = 0));
        await sleep(s.throwAt);
      } else {
        await sleep(s.wait ?? 1500);
        if (s.lookAt) await aim(p, s); // (settled: aim again)
        await sleep(300);
      }
      if (s.hideZombies) {
        await p.evaluate(() => {
          for (const e of window.__game.entities.ents.values()) if (e.kind === 2 && e.view) e.view.object.visible = false; // (ENT.ZOMBIE)
        });
      }
      await p.screenshot({ path: join(dir, `${s.name}.png`) });
      if (s.hideZombies) await p.evaluate(() => { for (const e of window.__game.entities.ents.values()) if (e.kind === 2 && e.view) e.view.object.visible = true; });
      process.stdout.write('.');
    }
    process.stdout.write('\n');
  } finally {
    for (const c of clients) await c.close();
    if (game) game.stop();
  }
}

const out = resolve(args.out);
await run(REPO, join(out, 'after'));
if (args.before) {
  await run(resolve(args.before), join(out, 'before'));
  const c = await launchChrome();
  try {
    await composeSheets(
      c.page,
      shots.map((s) => ({ out: join(out, `${s.name}.png`), title: s.title || s.name, cols: 2, cellW: 640, cellH: 400, cells: [{ img: join(out, 'before', `${s.name}.png`), tag: 'before', label: s.name }, { img: join(out, 'after', `${s.name}.png`), tag: 'after', label: s.name }] }))
    );
  } finally {
    await c.close();
  }
}
console.log(`${shots.length} shots in ${out}`);
