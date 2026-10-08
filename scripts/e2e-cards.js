// Dead Hand e2e: the card game's screens, looked at and checked in a real browser.
//
// Phase A (always): the UI sandbox (client/sandbox/ui-test.html ?screen=cards...) through Vite - the table mid-game
// (a practice match dealt from a seed and played some moves in), a card picked with the keys and where it may go lit,
// how a match ends, the deck builder, a trade, a pack opened, the chooser, the challenges, practice, and the HUD's
// line - at 1280 x 720 and at 800 x 600. It fails on a console error or a page error, on a card outside its row or the
// window, and on a part of the screen past the window's edge.
//
// Phase B (--live, once the server's side is in: node scripts/test-cards.js passes): a real game server, a node player
// (scripts/lib/cardbot.js) who takes any challenge and plays it out with the computer's moves (shared/cardai.js), and a
// browser player who challenges it through window.__game and plays its own moves the same way. Stills of the table
// mid-match, of how it ended, and of the HUD's line with the screen shut.
//
// Every browser is scripts/clip/lib.js's launchChrome (docs/object-clipping.md, "The headless browser's rules"), one
// at a time; every browser, server and bot is stopped in a finally. PNGs go to shots/cards/ (gitignored).
//
// usage: node scripts/e2e-cards.js [--live] [--only table,deck] [--out shots/cards]
import { mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { REPO, parseArgs, list, sleep, startVite, startGame, launchChrome, stopProcess, CHEAP_SETTINGS } from './clip/lib.js';

const args = parseArgs(process.argv.slice(2), { out: 'shots/cards' });
const OUT = resolve(REPO, args.out);
mkdirSync(OUT, { recursive: true });
const only = list(args.only);

let failed = 0;
const check = (name, ok, info) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || info === undefined ? '' : ' ' + JSON.stringify(info).slice(0, 600)}`);
};

// ---------------------------------------------------------------- what is checked on a page
// every card on the board inside its row, every card of the hand inside the window (up and down: the hand scrolls
// sideways on a small screen), and nothing of the screen past the window's edges -> { bad: [...], cards, rows }
function layoutProbe() {
  const bad = [];
  const vw = innerWidth;
  const vh = innerHeight;
  const r = (e) => e.getBoundingClientRect();
  const out = (a, b, pad = 1.5) => a.left < b.left - pad || a.right > b.right + pad || a.top < b.top - pad || a.bottom > b.bottom + pad;
  const win = { left: 0, top: 0, right: vw, bottom: vh };
  const rows = [...document.querySelectorAll('.cdscr:not([hidden]) .cd-row')];
  let cards = 0;
  for (const row of rows) {
    const rr = r(row);
    for (const c of row.querySelectorAll('.cd-cards > .cdf')) {
      cards++;
      const cr = r(c);
      if (out(cr, rr)) bad.push(`card ${c.dataset.id} out of its row (${Math.round(cr.left)},${Math.round(cr.top)} ${Math.round(cr.width)}x${Math.round(cr.height)} in ${Math.round(rr.left)},${Math.round(rr.top)} ${Math.round(rr.width)}x${Math.round(rr.height)})`);
    }
    if (out(rr, win)) bad.push(`a row past the window (${Math.round(rr.left)},${Math.round(rr.top)},${Math.round(rr.right)},${Math.round(rr.bottom)})`);
  }
  for (const c of document.querySelectorAll('.cdscr:not([hidden]) .cd-hand > .cdf')) {
    const cr = r(c);
    // (a picked card lifts out of the hand's box: that is the window's to hold, not the hand's)
    if (cr.top < -1.5 || cr.bottom > vh + 1.5) bad.push(`hand card ${c.dataset.id} past the window (${Math.round(cr.top)}..${Math.round(cr.bottom)})`);
  }
  const frame = document.querySelector('.cdscr:not([hidden]) .cd-frame');
  if (frame && out(r(frame), win)) bad.push('the frame is past the window');
  for (const e of document.querySelectorAll('.cdscr:not([hidden]) .cd-view:not([hidden]) > *')) {
    if (e.closest('[hidden]') || !e.offsetParent || e.classList.contains('cd-right')) continue;
    const er = r(e);
    if (er.width && out(er, win, 2)) bad.push(`${e.className} past the window (${Math.round(er.left)},${Math.round(er.top)},${Math.round(er.right)},${Math.round(er.bottom)})`);
  }
  const hud = document.querySelector('.cdl:not([hidden])');
  if (hud && out(r(hud), win)) bad.push('the HUD line is past the window');
  return { bad, cards, rows: rows.length, art: document.querySelectorAll('.cdf-art.has-art').length, faces: document.querySelectorAll('.cdscr:not([hidden]) .cdf').length };
}

const SIZES = [
  [1280, 720],
  [800, 600],
];
// [name, query, what to do on the page before the still]
const SCREENS = [
  ['table', 'screen=cards&seed=7&moves=9&still=1'],
  ['picked', 'screen=cards&seed=7&moves=9&still=1', 'pick'],
  ['end', 'screen=cards&tab=end&seed=11&still=1'],
  ['deck', 'screen=cards&tab=deck'],
  ['trade', 'screen=cards&tab=trade'],
  ['reveal', 'screen=cards&tab=reveal', 'wait'],
  ['chooser', 'screen=cards&tab=chooser'],
  ['asks', 'screen=cards&tab=asks'],
  ['practice', 'screen=cards&tab=practice'],
  ['hud', 'screen=hud-cards&kind=mine'],
  ['hud-ask', 'screen=hud-cards&kind=ask'],
];

async function phaseA() {
  let vite = null;
  let chrome = null;
  const errors = [];
  try {
    vite = await startVite(REPO);
    chrome = await launchChrome({ width: 1280, height: 800, onError: (m) => errors.push(m) });
    const page = chrome.page;
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    for (const [name, query, act] of SCREENS) {
      if (only && !only.includes(name)) continue;
      for (const [w, h] of SIZES) {
        errors.length = 0;
        await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
        const url = `${vite.url}/sandbox/ui-test.html?${query}`;
        for (let i = 0; ; i++) {
          try {
            await page.goto(url, { waitUntil: 'load', timeout: 60000 });
            break;
          } catch (e) {
            if (i >= 3) throw e;
            await sleep(1500);
          }
        }
        // (Vite reloads the page the first time it meets a module to optimise: what is asked of the page then is asked again)
        const ask = async (fn, ...a) => {
          for (let i = 0; ; i++) {
            try {
              return await page.evaluate(fn, ...a);
            } catch (e) {
              if (i >= 6 || !/context was destroyed|navigation/i.test(e.message)) throw e;
              await sleep(1200);
            }
          }
        };
        await sleep(600);
        for (let i = 0; i < 80 && !(await ask((sel) => !!document.querySelector(sel), name.startsWith('hud') ? '.cdl:not([hidden])' : '.cdscr:not([hidden])')); i++) await sleep(250);
        // (the pictures: drawn as they come into view, in software here, a few a frame)
        for (let i = 0; i < 80; i++) {
          const left = await ask(() => [...document.querySelectorAll('.cdscr:not([hidden]) .cdf-art[data-art]')].filter((a) => !a.classList.contains('has-art') && a.offsetParent && a.getBoundingClientRect().bottom > 0 && a.getBoundingClientRect().top < innerHeight).length);
          if (!left) break;
          await sleep(250);
        }
        if (act === 'pick') {
          await page.keyboard.press('Digit2');
          await sleep(300);
        }
        if (act === 'wait') await sleep(2200);
        await sleep(400);
        const file = join(OUT, `${name}-${w}x${h}.png`);
        await page.screenshot({ path: file });
        const probe = await ask(layoutProbe);
        check(`${name} at ${w}x${h}: no console errors`, !errors.length, errors);
        check(`${name} at ${w}x${h}: cards inside their rows and the window (${probe.cards} on the board, ${probe.faces} faces, ${probe.art} pictures)`, !probe.bad.length, probe.bad);
        if (name === 'table') check(`${name} at ${w}x${h}: the board has its six rows and cards on it`, probe.rows === 6 && probe.cards > 0, probe);
        if (name === 'picked') {
          const lit = await ask(() => document.querySelectorAll('.cd-row.lit, .cd-horn.lit, .cdf.lit, .cd-detail.ready').length);
          check(`${name} at ${w}x${h}: a card picked with its key lights where it may go`, lit > 0, { lit });
        }
        console.log(`      ${file}`);
      }
    }
  } finally {
    await chrome?.close().catch((e) => {
      console.error(e.message);
      failed++;
    });
    vite?.stop();
  }
}

// ---------------------------------------------------------------- phase B: a real server, a bot, a browser player
async function phaseB() {
  let game = null;
  let chrome = null;
  let bot = null;
  const errors = [];
  try {
    game = await startGame(REPO, { seed: 3, build: true, env: { GAME_IDLE_SECONDS: '900' } });
    chrome = await launchChrome({ width: 1280, height: 720, life: 10 * 60_000, storage: { 'stn.settings': CHEAP_SETTINGS, 'stn.name': 'Tester' }, onError: (m) => errors.push(m) });
    const p = chrome.page;
    p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await p.goto(game.url, { waitUntil: 'load', timeout: 60000 });
    await sleep(3000);
    await p.evaluate(() => [...document.querySelectorAll('button')].find((x) => /^\s*(quick )?join/i.test(x.textContent))?.click());
    for (let i = 0; i < 160 && !(await p.evaluate(() => !!(window.__game && window.__game.myId && window.__game.state === 'playing'))); i++) await sleep(250);
    const code = await p.evaluate(() => window.__game.room?.code || window.__game.conn.room?.code || '');
    check('the browser player is in a game', !!code, code);
    // the bot joins the same game, walks up to the player and waits for a challenge
    const ws = game.url.replace(/^http/, 'ws');
    bot = spawn(process.execPath, ['scripts/lib/cardbot.js', `${ws}/ws?game=${code}`, '--name', 'Sam', '--secs', '400'], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
    let botLog = '';
    bot.stdout.on('data', (d) => (botLog += d));
    bot.stderr.on('data', (d) => (botLog += d));
    let botId = 0;
    for (let i = 0; i < 80 && !botId; i++) {
      await sleep(250);
      botId = await p.evaluate(() => [...window.__game.players].find(([, x]) => x.name === 'Sam')?.[0] || 0);
    }
    check('the card bot joined', !!botId, botLog.slice(-400));
    // the player goes over to the bot (the admin's /tp x z: the test server runs the admin commands for everyone)
    const at = await p.evaluate((id) => {
      const e = window.__game.entities.ents.get(id);
      return e ? { x: e.rx, z: e.rz } : null;
    }, botId);
    check('the bot is in sight', !!at, at);
    if (at) await p.evaluate((a) => window.__game.conn.chat(`/tp ${(a.x + 1.4).toFixed(2)} ${a.z.toFixed(2)}`), at);
    await sleep(1500);
    // the browser player challenges it: the chooser, then Challenge (deck slot: the Survivors' starter deck)
    await p.evaluate((id) => {
      const g = window.__game;
      g.cards.chooser(id);
    }, botId);
    await sleep(500);
    await p.screenshot({ path: join(OUT, 'live-chooser.png') });
    await p.evaluate((id) => window.__game.cards.ask(id, 'match', -1, 0), botId);
    let dealt = false;
    for (let i = 0; i < 60 && !dealt; i++) {
      await sleep(250);
      dealt = await p.evaluate(() => !!window.__game.cards.s.match);
    }
    check('the bot took the challenge: the cards are dealt', dealt, botLog.slice(-600));
    if (dealt) {
      await p.evaluate(() => window.__game.toggleCards(true, false, 'table'));
      // the browser plays its own moves with the computer's choice, a few, then a still mid-match
      const play = async (n) => {
        for (let i = 0; i < n; i++) {
          const done = await p.evaluate(() => window.__game.cards.autoplay('normal'));
          if (done === 'over') return true;
          await sleep(done === 'moved' ? 700 : 400);
        }
        return false;
      };
      await play(14);
      await sleep(800);
      await p.screenshot({ path: join(OUT, 'live-table.png') });
      const probe = await p.evaluate(layoutProbe);
      check('live table: cards inside their rows and the window', !probe.bad.length, probe.bad);
      // the HUD's line with the screen shut, then on to the end
      await p.evaluate(() => window.__game.toggleCards(false, false));
      await sleep(600);
      await p.screenshot({ path: join(OUT, 'live-hud.png') });
      const line = await p.evaluate(() => document.querySelector('.cdl:not([hidden]) .cdl-t')?.textContent || '');
      check('the HUD line says a match is under way', /Dead Hand vs Sam/.test(line), line);
      await p.evaluate(() => window.__game.toggleCards(true, false, 'table'));
      let over = false;
      for (let i = 0; i < 30 && !over; i++) over = await play(10);
      await sleep(1200);
      await p.screenshot({ path: join(OUT, 'live-end.png') });
      const end = await p.evaluate(() => window.__game.cards.s.lastEnd);
      check('the match ended, and the client heard how', over && !!end && ['win', 'loss', 'draw'].includes(end.outcome), end);
    }
    check('live: no console errors', !errors.length, errors);
  } finally {
    stopProcess(bot);
    await chrome?.close().catch((e) => {
      console.error(e.message);
      failed++;
    });
    game?.stop();
  }
}

try {
  await phaseA();
  if (args.live) await phaseB();
} catch (err) {
  failed++;
  console.log('FAIL  threw', err);
}
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
