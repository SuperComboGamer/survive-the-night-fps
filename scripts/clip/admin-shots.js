// Screenshots of the control room (/admin, client/admin/) for a pull request: a game server of its own on a PGlite
// database seeded with made-up accounts, a few games with bots playing in them (scripts/bot.js), a few things done
// from the panel so the audit log has something in it, then every view, the two confirmations, the page as a
// signed-out visitor and as an account that is no admin, a phone-width overview, and a server with no database.
//
//   node scripts/clip/admin-shots.js [--out shots/pr/admin-panel]
//
// The browser is lib.js's launchChrome and nothing else (docs/object-clipping.md, "The headless browser's rules").
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { REPO, parseArgs, sleep, startGame, launchChrome, stopProcess } from './lib.js';
import { openDb } from '../../server/db/index.js';
import { migrate } from '../../server/db/migrate.js';
import { Auth, hashPassword } from '../../server/auth.js';
import { setAdmin } from '../../server/admin.js';
import { C2S, PROTOCOL_VERSION, Writer } from '../../shared/protocol.js';

const args = parseArgs(process.argv.slice(2), { out: 'shots/pr/admin-panel' });
const OUT = resolve(REPO, args.out);
mkdirSync(OUT, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'stn-admin-shots-'));
const W = 1280;
const H = 800;

// ---------------------------------------------------------------- made-up accounts
const ADMINS = ['Nightwarden', 'Lanternjaw'];
const PLAYERS = ['RustyNail', 'Mothlight', 'Bexley', 'OldCrow', 'Juniper', 'Halloran'];
const cookie = {};
{
  const db = await openDb(`pglite:${join(dir, 'db')}`);
  await migrate(db);
  const auth = new Auth({ db });
  const hash = await hashPassword('not-a-real-password');
  let day = 40;
  for (const name of [...ADMINS, ...PLAYERS]) {
    const id = (await db.query(`INSERT INTO users (email, username, password_hash, created_at, last_seen_at) VALUES ($1, $2, $3, now() - make_interval(days => $4), now() - make_interval(mins => $5)) RETURNING id`, [`${name.toLowerCase()}@example.invalid`, name, hash, day, ADMINS.includes(name) ? 0 : day * 7])).rows[0].id;
    day -= 4;
    cookie[name] = await auth.newSession({ id }, { ip: '', ua: 'shots' });
  }
  for (const name of ADMINS) await setAdmin(db, name, true);
  for (const name of ADMINS) cookie[name] = await auth.newSession({ id: (await db.query('SELECT id FROM users WHERE username = $1', [name])).rows[0].id }, { ip: '', ua: 'shots' });
  await db.close();
}

const children = [];
const sockets = [];
let chrome = null;
let game = null;
const cleanUp = async () => {
  for (const ws of sockets) {
    try {
      ws.close();
    } catch {}
  }
  for (const c of children) stopProcess(c);
  await chrome?.close().catch((e) => console.error(e.message));
  chrome = null;
  game?.stop();
  game = null;
};

try {
  // (SEED '': a valley of its own per game. A long day, and nobody dies: the games are still there for every shot)
  game = await startGame(REPO, { build: true, env: { DATABASE_URL: `pglite:${join(dir, 'db')}`, DEV_ADMIN: '', SEED: '', GAME_IDLE_SECONDS: '900', DAY_SECONDS: '1200', NIGHT_SECONDS: '1200' } });
  const base = game.url;
  const ws = base.replace(/^http/, 'ws');
  const api = async (who, method, path, body) => {
    const r = await fetch(base + path, { method, headers: { 'X-STN-Admin': '1', cookie: `stn_session=${cookie[who]}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return r.json();
  };
  const bots = (code, names, seconds = 900) => {
    const c = spawn(process.execPath, ['scripts/bot.js', String(names.length), String(seconds), `${ws}/ws?game=${code}`], { cwd: REPO, env: { ...process.env, BOT_NAMES: names.join(','), BOT_PING: '1' }, stdio: 'ignore' });
    children.push(c);
  };
  // a signed-in player who stands where they landed
  const stand = (code, who, name = who) =>
    new Promise((done) => {
      const s = new WebSocket(`${ws}/ws?game=${code}`, { headers: cookie[who] ? { cookie: `stn_session=${cookie[who]}` } : {} });
      s.binaryType = 'arraybuffer';
      sockets.push(s);
      s.onopen = () => {
        const w = new Writer(96);
        w.u8(C2S.JOIN);
        w.u8(PROTOCOL_VERSION);
        w.str(name);
        w.str(crypto.randomUUID());
        s.send(w.bytes());
        setTimeout(() => done(s), 400);
      };
      s.onerror = () => done(s);
    });

  // ---- three games, with people in them
  const A = (await api('Nightwarden', 'POST', '/api/admin/games', { name: 'Friday Night Run', maxPlayers: 8, difficulty: 'nightfall' })).game.code;
  const B = (await api('Nightwarden', 'POST', '/api/admin/games', { name: 'Quarry Crew', maxPlayers: 4, difficulty: 'blackout', inviteOnly: true })).game.code;
  const C = (await api('Lanternjaw', 'POST', '/api/admin/games', { name: 'First Timers', maxPlayers: 6, difficulty: 'ember' })).game.code;
  const D = (await api('Lanternjaw', 'POST', '/api/admin/games', { name: 'Test Table', maxPlayers: 2 })).game.code;
  bots(A, ['Dutch', 'Marlowe', 'Pike', 'Wren']);
  await stand(A, 'RustyNail');
  await stand(A, 'Nightwarden');
  const dropper = await stand(A, null, 'Sparrow');
  bots(B, ['Ferris', 'Odile']);
  await stand(B, 'Mothlight');
  bots(C, ['Tam', 'Greer', 'Lowell']);
  await stand(C, 'Bexley');
  const E = (await api('Lanternjaw', 'POST', '/api/admin/games', { name: 'Lakeside Regulars', maxPlayers: 8 })).game.code;
  bots(E, ['Corbin', 'Idris', 'Sable', 'Vesper', 'Anouk']);
  await stand(E, 'Juniper');
  const F = (await api('Nightwarden', 'POST', '/api/admin/games', { name: 'Two Man Job', maxPlayers: 2, difficulty: 'blackout', inviteOnly: true })).game.code;
  bots(F, ['Rook']);
  await stand(F, 'OldCrow');
  bots('', ['Quince', 'Lark']); // (a quick join: the lobby picks, or makes, their game)
  await sleep(8000);

  // ---- a few things done, for the games to show and the audit log to hold
  const ids = Object.fromEntries((await api('Nightwarden', 'GET', '/api/admin/accounts')).accounts.map((a) => [a.username, a.id]));
  const playerOf = async (code, name) => (await api('Nightwarden', 'GET', `/api/admin/games/${code}`)).players.find((p) => p.name === name)?.id;
  await api('Nightwarden', 'POST', `/api/admin/games/${A}/command`, { cmd: 'night' });
  await api('Nightwarden', 'POST', `/api/admin/games/${A}/command`, { cmd: 'spawn', type: 'runner', count: 12, player: await playerOf(A, 'Dutch') });
  await api('Lanternjaw', 'POST', `/api/admin/games/${C}/message`, { text: 'Welcome in. Stick together and board up before dark.' });
  await api('Lanternjaw', 'POST', `/api/admin/games/${C}/command`, { cmd: 'give', item: 'medkit', count: 2, player: await playerOf(C, 'Tam') });
  await api('Nightwarden', 'PUT', '/api/admin/settings/max_total_games', { value: 40 });
  await api('Lanternjaw', 'POST', '/api/admin/server/drain', { on: true });
  await api('Lanternjaw', 'POST', '/api/admin/server/drain', { on: false });
  await api('Nightwarden', 'POST', `/api/admin/games/${B}/kick`, { player: await playerOf(B, 'Odile'), reason: 'Blocking the mine entrance' });
  await api('Nightwarden', 'POST', `/api/admin/games/${D}/close`, { confirm: D, reason: 'Finished testing' });
  await api('Lanternjaw', 'POST', `/api/admin/accounts/${ids.Lanternjaw}/admin`, { on: false }); // (refused: their own)
  await api('Nightwarden', 'POST', '/api/admin/server/broadcast', { text: 'A new build goes out at midnight. Your games carry on through it.' });
  await api('Nightwarden', 'POST', `/api/admin/games/${E}/command`, { cmd: 'night' });
  await sleep(70000); // (the bots have played a while: kills, tick times, an uptime that is not seconds)

  // ---- the pictures
  chrome = await launchChrome({ width: W, height: H, life: 4 * 60_000 });
  const page = chrome.page;
  dropper.close(); // (a player who dropped: their place is held for a minute - so only now, with the browser up)
  const host = new URL(base).hostname;
  const as = async (who) => {
    const cdp = await page.createCDPSession();
    await cdp.send('Network.clearBrowserCookies');
    await cdp.detach();
    await page.goto('about:blank'); // (the next open is a load of the page, not a move within the one already up)
    if (who) await page.setCookie({ name: 'stn_session', value: cookie[who], domain: host, path: '/', httpOnly: true });
  };
  const open = async (hash, { w = W, h = H, wait = 1800 } = {}) => {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await page.goto(`${base}/admin${hash ? `#${hash}` : ''}`, { waitUntil: 'load', timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    await sleep(wait);
  };
  const shot = async (name, opts = {}) => {
    await page.screenshot({ path: join(OUT, `${name}.png`), ...opts });
    console.log(`  ${name}.png`);
  };
  const click = (text, scope = 'button') =>
    page.evaluate(
      (t, sel) => {
        const b = [...document.querySelectorAll(sel)].find((x) => x.textContent.trim() === t);
        if (!b) throw new Error(`no ${sel} "${t}"`);
        b.click();
      },
      text,
      scope
    );

  await as('Nightwarden');
  await open('overview');
  await shot('overview');
  await open('games');
  await shot('games');
  await open(`games/${A}`, { wait: 2500 });
  await shot('game-detail', { fullPage: true });
  await page.evaluate(() => document.querySelector('.ad-danger').scrollIntoView({ block: 'center' }));
  await click('Reset game');
  await sleep(400);
  await shot('confirm-reset');
  await page.keyboard.press('Escape');
  await click('Close game');
  await sleep(300);
  await page.type('.ad-dialog input', 'Wrapping up for tonight');
  await sleep(200);
  await shot('confirm-close');
  await page.keyboard.press('Escape');
  await open('server', { wait: 2200 });
  await shot('server-settings', { fullPage: true });
  await open('accounts');
  await shot('accounts');
  await open('audit');
  await shot('audit-log');
  await open('overview', { w: 390, h: 800 });
  await shot('overview-phone', { fullPage: true });
  await open(`games/${A}`, { w: 390, h: 800, wait: 2500 });
  await shot('game-detail-phone', { fullPage: true });

  // (each of these must be the card and nothing else: no tabs, no numbers)
  const gated = async (what) => {
    const r = await page.evaluate(() => ({ gate: !!document.querySelector('.ad-gate'), tabs: !!document.querySelector('.ad-tabs'), tiles: document.querySelectorAll('.st-tile').length }));
    if (!r.gate || r.tabs || r.tiles) throw new Error(`${what}: the page is showing the panel (${JSON.stringify(r)})`);
  };
  await as(null);
  await open('overview');
  await gated('signed out');
  await shot('signed-out');
  await as('RustyNail');
  await open('overview');
  await gated('not an admin');
  await shot('not-an-admin');

  // ---- a server with no database (the browser stays; the game server is swapped)
  for (const s of sockets) s.close();
  for (const c of children) stopProcess(c);
  game.stop();
  game = await startGame(REPO, { env: { DATABASE_URL: '', DEV_ADMIN: '' } });
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.goto(`${game.url}/admin`, { waitUntil: 'load', timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await sleep(1500);
  await gated('no database');
  await shot('no-database');
} finally {
  await cleanUp();
  rmSync(dir, { recursive: true, force: true });
}
console.log(`shots in ${OUT}`);
process.exit(0);
