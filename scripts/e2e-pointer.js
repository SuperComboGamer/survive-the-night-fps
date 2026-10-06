// Pointer lock e2e: the trigger is never dead under a held mouse. In Chrome the click that takes the mouse is answered a
// moment later, and a screen opened in that moment (I straight after the click, the pause menu's way back with the
// map up, a chat line sent from the inventory) used to have the lock land over it: the mouse held, the input off, and
// with Esc the page's under fullscreen's keyboard lock (keyguard.js), nothing but leaving fullscreen got out.
//
// Headless Chrome may not take the mouse (lib.js stubs pointer lock), so the page gets a stand-in that answers the way
// Chrome does: a request needs a user activation and is granted 150 ms later, a release lands 30 ms later, and Esc
// reaches the page. Each case is checked, and stills go to the out dir; --root runs another checkout (a "before").
// usage: node scripts/e2e-pointer.js [--root <tree>] [--out shots/clip/pointer] [--build]
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REPO, OUT, parseArgs, sleep, startGame, launchChrome, LIFE_MAX, CHEAP_SETTINGS } from './clip/lib.js';

const args = parseArgs(process.argv.slice(2), { out: join(OUT, 'pointer') });
const root = args.root ? resolve(args.root) : REPO;
const out = resolve(args.out);
mkdirSync(out, { recursive: true });

let failed = 0;
const check = (name, ok, info) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || info === undefined ? '' : ' ' + JSON.stringify(info)}`);
};

let game = null, chrome = null;
try {
  game = await startGame(root, { seed: 1, build: !!args.build });
  chrome = await launchChrome({ width: 1280, height: 720, life: LIFE_MAX, storage: { 'stn.settings': CHEAP_SETTINGS } });
  const p = chrome.page;
  await p.goto(game.url, { waitUntil: 'load', timeout: 60000 });
  await sleep(3500);
  await p.evaluate(() => [...document.querySelectorAll('button')].find((x) => /^\s*(quick )?join/i.test(x.textContent))?.click());
  for (let i = 0; i < 120 && !(await p.evaluate(() => !!(window.__game && window.__game.myId && window.__game.vm))); i++) await sleep(250);
  await sleep(2500);

  // the stand-in for Chrome's pointer lock, and a count of the shots our own simulation fires
  await p.evaluate(() => {
    const g = window.__game, inp = g.input;
    const lk = (window.__lk = { held: false, asked: false, leaving: false });
    const change = (locked) => {
      lk.held = locked;
      // (what Input's pointerlockchange listener does)
      inp.locked = locked;
      inp.skipMove = locked;
      if (!locked) for (const [code, acts] of [...inp.down]) if (code.startsWith('Mouse') || acts.includes('fire') || acts.includes('aim')) inp.release(code, true);
      inp.handlers.onLockChange?.(locked);
    };
    inp.requestLock = function () {
      if (this.locked) return;
      this.onRequestLock?.();
      if (!navigator.userActivation.isActive || lk.asked || lk.held) return;
      lk.asked = true;
      setTimeout(() => {
        lk.asked = false;
        if (!lk.held) change(true);
      }, 150);
    };
    inp.exitLock = function () {
      if (!lk.held || lk.leaving) return;
      lk.leaving = true;
      setTimeout(() => {
        lk.leaving = false;
        if (lk.held) change(false);
      }, 30);
    };
    g.shots = 0;
    const on = g.onLocalEvents.bind(g);
    g.onLocalEvents = (evs, s) => {
      for (const ev of evs) if (ev.type === 'fire') g.shots++;
      return on(evs, s);
    };
  });
  const state = () =>
    p.evaluate(() => {
      const g = window.__game, ui = g.ui;
      const ps = g.prediction.state;
      return { held: window.__lk.held, input: g.input.enabled, inventory: ui.inventoryOpen, map: ui.mapOpen, pause: !ui.pause.root.hidden, slot: ps.slot, weapon: ps.weapons[0], mag: ps.mags[0], fps: Math.round(g.fps || 0) };
    });
  // under the lock the browser sends the mouse's buttons to the locked element, wherever the (hidden) cursor is
  const canvasMouse = (type) =>
    p.evaluate((type) => {
      window.__game.input.canvas.dispatchEvent(new MouseEvent(type, { button: 0, buttons: type === 'mousedown' ? 1 : 0, bubbles: true, cancelable: true }));
    }, type);
  // hold the trigger: how many shots that fired (a still is taken mid-burst)
  const holdFire = async (ms, still) => {
    const before = await p.evaluate(() => window.__game.shots);
    await canvasMouse('mousedown');
    await sleep(ms / 2);
    if (still) await p.screenshot({ path: join(out, still) });
    await sleep(ms / 2);
    await canvasMouse('mouseup');
    await sleep(100);
    return (await p.evaluate(() => window.__game.shots)) - before;
  };
  const backToPlay = async () => {
    await p.evaluate(() => {
      const g = window.__game;
      g.moving = false;
      if (g.ui.inventoryOpen) g.toggleInventory(false);
      if (g.ui.mapOpen) g.toggleMap(false);
    });
    await sleep(100);
    if (!(await state()).held) await p.mouse.click(900, 400); // (the game, or the pause menu's shade: either takes the mouse)
    await sleep(500);
  };

  // an AK-47 with 120 rounds, in hand
  await p.evaluate(() => {
    const g = window.__game;
    g.conn.chat('/give 61 1');
    g.conn.chat('/give 72 120');
  });
  await sleep(800);
  await p.evaluate(() => {
    const g = window.__game;
    const i = g.inventory.slots.findIndex((x) => x && x.item === 61);
    if (i >= 0) g.conn.action(5, i);
  });
  await sleep(600);
  await p.mouse.click(900, 400); // the click that takes the mouse
  await sleep(500);
  await p.keyboard.press('Digit1');
  for (let i = 0; i < 20 && (await state()).slot !== 0; i++) await sleep(250);
  await sleep(3000); // (the draw, and the first frames: software rendering runs at a few frames a second)
  let s = await state();
  check('in play: mouse held, input on, the AK in hand', s.held && s.input && s.slot === 0 && s.weapon === 61, s);
  let n = await holdFire(3000);
  check('in play: holding the trigger fires the AK', n >= 2, { shots: n, ...(await state()) });

  // 1. the click that takes the mouse back, and I before the lock lands
  await p.keyboard.press('Escape');
  await sleep(400);
  check('Esc lets go of the mouse for the menu', !(await state()).held && (await state()).pause, await state());
  await p.mouse.click(900, 400); // (off the rail: back to the game)
  await sleep(20);
  await p.keyboard.press('KeyI');
  await sleep(600);
  s = await state();
  await p.screenshot({ path: join(out, 'late-lock-inventory.png') });
  check('a lock that lands after I opened the inventory gives the mouse back to it', s.inventory && !s.held, s);
  await p.keyboard.press('KeyI');
  await sleep(500);
  s = await state();
  check('I again: back in play with the mouse held', !s.inventory && s.held && s.input, s);
  n = await holdFire(3000);
  check('...and the AK fires held', n >= 2, { shots: n, ...(await state()) });

  // 2. a chat line sent from the inventory
  await p.keyboard.press('KeyI');
  await sleep(400);
  await p.keyboard.press('Enter');
  await sleep(150);
  await p.keyboard.type('ok');
  await p.keyboard.press('Enter');
  await sleep(600);
  s = await state();
  check('a chat line sent from the inventory leaves the mouse with the inventory', s.inventory && !s.held, s);
  await backToPlay();

  // 3. the pause menu's way back (Enter) with the map opened over it
  await p.keyboard.press('Escape');
  await sleep(400);
  await p.keyboard.press('KeyM');
  await sleep(400);
  await p.keyboard.press('Enter'); // (the menu's first row, "Back to the game": the map covers the rail, not its keys)
  await sleep(600);
  s = await state();
  await p.screenshot({ path: join(out, 'pause-back-over-map.png') });
  check('"Back to the game" with the map up leaves the mouse with the map', s.map && !s.held, s);
  await backToPlay();

  // 4. whatever path leaves the input off under a held mouse with nothing up (the reported state): the trigger and Esc
  s = await state();
  check('back in play', s.held && s.input && !s.pause, s);
  await p.evaluate(() => (window.__game.input.enabled = false));
  await sleep(500);
  n = await holdFire(3000, 'stuck-hold-fire.png');
  check('input left off under a held mouse: the AK still fires held', n >= 2, { shots: n, ...(await state()) });
  await p.keyboard.press('Escape');
  await sleep(500);
  s = await state();
  await p.screenshot({ path: join(out, 'stuck-esc.png') });
  check('...and Esc opens the menu', !s.held && s.pause, s);
  await backToPlay();

  // 5. Esc while the input is off on purpose (between two servers on a deploy) still lets go of the mouse
  await p.evaluate(() => {
    const g = window.__game;
    g.moving = true;
    g.input.enabled = false;
  });
  await sleep(100);
  await p.keyboard.press('Escape');
  await sleep(500);
  s = await state();
  check('Esc with the input off lets go of the mouse', !s.held && s.pause, s);
  await p.evaluate(() => (window.__game.moving = false));
} finally {
  if (chrome) await chrome.close();
  if (game) game.stop();
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
