// Join lock e2e: the click on Join takes the mouse - no click on the game once it is joined. The browser only gives the
// page the mouse (and fullscreen) on a request made while the user's click still counts: Chrome within 5 s of it, and
// only until a fullscreen request it grants uses it up; Firefox and Safari only while the click is being handled. The
// join is done a second or more after the click, so Game.holdForJoin asks on the click itself, and Input.requestLock
// asks for the mouse before fullscreen.
//
// Headless Chrome may not take the mouse or the screen (lib.js stubs them), so the canvas and the page get stand-ins
// that answer by one of those rules - 'chrome' or 'strict' - and grant the mouse 150 ms after a request; nothing real
// is ever taken. For each rule: a real click on Join and the mouse is held in play; for 'chrome', the mouse let go of
// and taken back with one click; then a join that fails gives the mouse and the screen back. --root runs another
// checkout (a "before").
// usage: node scripts/e2e-joinlock.js [--root <tree>] [--build]
import { resolve } from 'node:path';
import { REPO, parseArgs, sleep, startGame, launchChrome, CHEAP_SETTINGS } from './clip/lib.js';

const args = parseArgs(process.argv.slice(2));
const root = args.root ? resolve(args.root) : REPO;

let failed = 0;
const check = (name, ok, info) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || info === undefined ? '' : ' ' + JSON.stringify(info)}`);
};

let game = null, chrome = null;
try {
  game = await startGame(root, { seed: 1, build: !!args.build });
  chrome = await launchChrome({ width: 1280, height: 720, storage: { 'stn.settings': CHEAP_SETTINGS } });
  const p = chrome.page;
  const state = () =>
    p.evaluate(() => {
      const g = window.__game, lk = window.__lk;
      return { state: g.state, held: lk.held, granted: lk.granted, refused: lk.refused, fs: lk.fs, wanted: g.keyGuard.wanted, hold: g.joinHold, input: g.input.enabled, pause: !g.ui.pause.root.hidden, hint: document.querySelector('.toasts')?.textContent.includes('Click the game to resume looking around.') || false, joining: !!g.ui.splash.joining };
    });
  const until = async (fn, ms) => {
    for (const t = Date.now(); Date.now() - t < ms && !(await p.evaluate(fn)); ) await sleep(200);
  };

  for (const rule of ['chrome', 'strict']) {
    await p.goto(game.url, { waitUntil: 'load', timeout: 60000 });
    await until(() => !!(window.__game && window.__game.world && !window.__game.warm), 30000);
    await sleep(1000);
    // the stand-ins for the browser's pointer lock and fullscreen
    await p.evaluate((rule) => {
      const g = window.__game, inp = g.input;
      const lk = (window.__lk = { held: false, asked: false, fs: false, granted: 0, refused: 0, gesture: 0, used: -1, handling: false });
      // the user's click: a press is a new activation (Chrome), and an input event is handled until its task ends (Firefox)
      addEventListener('mousedown', () => lk.gesture++, true);
      addEventListener('keydown', (e) => e.key !== 'Escape' && lk.gesture++, true);
      for (const t of ['mousedown', 'mouseup', 'click', 'keydown', 'keyup'])
        addEventListener(t, () => ((lk.handling = true), setTimeout(() => (lk.handling = false), 0)), true);
      const counts = () => navigator.userActivation.isActive && (rule === 'strict' ? lk.handling : lk.used !== lk.gesture);
      const change = (locked) => {
        lk.held = locked;
        // (what Input's pointerlockchange listener does)
        inp.locked = locked;
        inp.skipMove = locked;
        if (!locked) for (const [code, acts] of [...inp.down]) if (code.startsWith('Mouse') || acts.includes('fire') || acts.includes('aim')) inp.release(code, true);
        inp.handlers.onLockChange?.(locked);
      };
      lk.change = change;
      Object.defineProperty(inp.canvas, 'requestPointerLock', {
        configurable: true,
        value() {
          if (!counts()) {
            lk.refused++;
            return Promise.reject(new DOMException('a user gesture is required', 'NotAllowedError'));
          }
          if (!lk.held && !lk.asked) {
            lk.granted++;
            lk.asked = true;
            setTimeout(() => {
              lk.asked = false;
              if (!lk.held) change(true);
            }, 150);
          }
          return Promise.resolve();
        },
      });
      Object.defineProperty(document.documentElement, 'requestFullscreen', {
        configurable: true,
        value() {
          if (!counts()) return Promise.reject(new TypeError('Permissions check failed'));
          if (rule === 'chrome') lk.used = lk.gesture; // (granted: the click is used up)
          lk.fs = true;
          return Promise.resolve();
        },
      });
      inp.exitLock = function () {
        if (lk.held) setTimeout(() => lk.held && change(false), 30);
      };
    }, rule);

    const join = await p.evaluateHandle(() => [...document.querySelectorAll('button')].find((x) => /^\s*(quick )?join/i.test(x.textContent) && x.offsetParent));
    const t0 = Date.now();
    await join.click(); // (a real click: the user's activation)
    await until(() => window.__game.state === 'playing', 40000);
    const ms = Date.now() - t0;
    await sleep(1000);
    let s = await state();
    check(`${rule}: the click on Join takes the mouse (in the game ${ms} ms after it)`, s.state === 'playing' && s.held && s.input && !s.pause && !s.hold, s);
    if (rule === 'chrome') {
      check(`${rule}: ...and fullscreen`, s.fs && s.wanted, s);
      // the browser lets go of the mouse (Esc, outside fullscreen's keyboard lock): the menu, and one click to play on.
      // (The stand-in never puts the page in fullscreen, so this is the click of a page out of it: the first one there
      // used to take only the screen.)
      await p.evaluate(() => window.__lk.change(false));
      await sleep(300);
      s = await state();
      check(`${rule}: the mouse let go of opens the menu`, !s.held && s.pause, s);
      const refused = s.refused;
      await p.keyboard.press('Escape');
      await until(() => window.__game.ui.pause.root.hidden && document.querySelector('.toasts')?.textContent.includes('Click the game to resume looking around.'), 2000);
      s = await state();
      check(`${rule}: Esc closes the menu even when Chrome refuses an immediate re-lock`, !s.held && !s.pause && s.input && s.refused > refused && s.hint, s);
      await p.mouse.click(900, 400); // (the menu is gone; one click takes the mouse back)
      await sleep(600);
      s = await state();
      check(`${rule}: one click takes it back, out of fullscreen too`, s.held && s.input && !s.pause, s);
    }

    // back on the splash, a join that fails gives back what its click took
    await p.evaluate(() => window.__game.ui.cb.onLeave());
    await until(() => window.__game.state === 'menu' && !window.__lk.held, 10000);
    await sleep(1500);
    await p.evaluate(() => {
      const b = document.createElement('button');
      b.id = 'stn-bad-join';
      b.textContent = 'join a game that is not there';
      b.style.cssText = 'position:fixed;left:8px;top:8px;z-index:99999;padding:8px';
      b.onclick = () => window.__game.ui.splash.join('QQQQQ');
      document.body.appendChild(b);
    });
    const granted = (await state()).granted;
    await p.click('#stn-bad-join');
    await until(() => !window.__game.ui.splash.joining, 40000);
    // (it fails in a moment, often before the mouse is given: a lock landing after it goes straight back)
    await sleep(500);
    s = await state();
    check(`${rule}: a join's click asks for the mouse at once`, s.granted > granted, s);
    await sleep(500);
    s = await state();
    check(`${rule}: ...and a join that fails gives the mouse and the screen back`, s.state === 'menu' && !s.held && !s.hold && !s.wanted && !s.joining, s);
  }
} finally {
  if (chrome) await chrome.close();
  if (game) game.stop();
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
