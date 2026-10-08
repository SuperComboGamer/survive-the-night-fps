// Keybinds (shared/binds.js, client/game/binds.js, client/net/accountbinds.js, server/usersettings.js) and holding the
// drop key (client/game/drophold.js). In-process: the defaults, rebinding, what collides and how a collision is settled
// (swap / use here), resets, an action left with no key, labels, what is kept in localStorage and anything unreadable
// there falling back to the defaults, the server's strict check of what it is asked to keep; Input with a key rebound
// while it is held (nothing stuck); a tap of the drop key not dropping and a hold dropping. Against a real server
// process on a PGlite database of its own: a guest is told to sign in, a signed-in player saves binds and gets them
// back (and so does their other browser), junk is refused, the newer copy wins; and a server without a database
// answering without accounts.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ACTIONS, ACTION, DEFAULT_BINDS, BIND_GROUPS, codeLabel, checkOverrides, fromOverrides, toOverrides, isBindCode, sharesOk } from '../shared/binds.js';
import * as B from '../client/game/binds.js';
import { DropHold, DROP_HOLD, TAP_HINT } from '../client/game/drophold.js';
import { openDb } from '../server/db/index.js';
import { migrate } from '../server/db/migrate.js';
import { BTN } from '../shared/constants.js';

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : detail}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sorted = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
const eq = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b)); // (jsonb keeps an object's keys in an order of its own)

// a localStorage of our own
const memStore = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
};

// ---------------------------------------------------------------- the actions and their defaults
{
  check('every action has a label, a known group and two binds', ACTIONS.every((a) => a.label && BIND_GROUPS.includes(a.group) && a.keys.length === 2), JSON.stringify(ACTIONS.filter((a) => !a.label || !BIND_GROUPS.includes(a.group))));
  check('every group has actions', BIND_GROUPS.every((g) => ACTIONS.some((a) => a.group === g)));
  check('every default is a key a bind can be', ACTIONS.every((a) => a.keys.every((k) => k === null || isBindCode(k))));
  check('the pairs the game always had are the defaults: Ctrl / C crouch, Y / Enter chat, RMB / Left Alt aim, Z / MMB ping', eq(DEFAULT_BINDS.crouch, ['ControlLeft', 'KeyC']) && eq(DEFAULT_BINDS.chat, ['KeyY', 'Enter']) && eq(DEFAULT_BINDS.aim, ['Mouse2', 'AltLeft']) && eq(DEFAULT_BINDS.ping, ['KeyZ', 'Mouse1']));
  check('the energy drink is on B and the player list on Tab', eq(DEFAULT_BINDS.drink, ['KeyB', null]) && ACTION.drink.group === 'Inventory & items' && eq(DEFAULT_BINDS.players, ['Tab', null]) && ACTION.players.menu);
  check('Escape, Backspace, Delete and Meta are never a bind; the mouse buttons are', !['Escape', 'Backspace', 'Delete', 'MetaLeft', 'F12', '', null, 7].some(isBindCode) && ['Mouse0', 'Mouse3', 'Mouse4', 'KeyW', 'ArrowUp', 'Numpad5'].every(isBindCode));
  // no two defaults collide, except a hands key with a build key (the hammer takes those over)
  const clash = [];
  for (const a of ACTIONS) for (const b of ACTIONS) if (a.id < b.id && !sharesOk(a.id, b.id)) for (const k of a.keys) if (k && b.keys.includes(k)) clash.push(`${a.id}/${b.id}:${k}`);
  check('no two default binds collide', !clash.length, clash.join(' '));
  check('...but Q, R and E do double duty with the hammer out (last weapon / back, reload / on, interact / on)', DEFAULT_BINDS.buildPrev[0] === 'KeyQ' && DEFAULT_BINDS.buildNext.includes('KeyR') && DEFAULT_BINDS.buildNext.includes('KeyE') && sharesOk('lastWeapon', 'buildPrev') && sharesOk('interact', 'buildNext') && !sharesOk('fire', 'demolish') && !sharesOk('reload', 'interact'));
  check('labels: Z for KeyZ, 5 for Digit5, Left Ctrl, LMB / RMB / MMB / Mouse 4 / Mouse 5, Option on a Mac', codeLabel('KeyZ') === 'Z' && codeLabel('Digit5') === '5' && codeLabel('ControlLeft') === 'Left Ctrl' && ['Mouse0', 'Mouse2', 'Mouse1', 'Mouse3', 'Mouse4'].map((c) => codeLabel(c)).join() === 'LMB,RMB,MMB,Mouse 4,Mouse 5' && codeLabel('AltLeft', { mac: true }) === 'Left Option');
  check("...and the keyboard's own label where the browser has one (AZERTY: KeyQ is A)", codeLabel('KeyQ', { layout: new Map([['KeyQ', 'a']]) }) === 'A' && codeLabel('ArrowUp', { layout: new Map([['ArrowUp', 'x']]) }) === '↑');
}

// ---------------------------------------------------------------- the binds module
{
  const store = memStore();
  B.loadBinds(store);
  check('nothing stored: the defaults, never changed', eq(B.allBinds(), Object.fromEntries(ACTIONS.map((a) => [a.id, [...a.keys]]))) && B.bindsUpdatedAt() === 0);
  check('lookups: KeyW is forward, Mouse0 is fire, KeyR is reload and next structure', eq(B.actionsOf('KeyW'), ['forward']) && eq(B.actionsOf('Mouse0'), ['fire']) && eq(B.actionsOf('KeyR'), ['reload', 'buildNext']) && eq(B.actionsOf('KeyP'), []));
  check('Dead Hand is on K, a key of the menus (it shuts its own screen), under Interface', eq(B.actionsOf('KeyK'), ['cards']) && ACTION.cards.menu && ACTION.cards.group === 'Interface' && eq(DEFAULT_BINDS.cards, ['KeyK', null]) && B.bindTag('cards') === '[K]');
  check('text: [E], Left Ctrl / C, [B]', B.bindTag('interact') === '[E]' && B.bindPair('crouch') === 'Left Ctrl / C' && B.bindTag('drink') === '[B]' && eq(B.actionsOf('KeyB'), ['drink']) && eq(B.actionsOf('Tab'), ['players']));

  let heard = 0;
  const off = B.onBindsChange(() => heard++);
  const t0 = Date.now();
  B.setBind('forward', 0, 'ArrowUp', { storage: store });
  check('forward onto Up (its own secondary): the two change places', eq(B.bindsOf('forward'), ['ArrowUp', 'KeyW']) && heard === 1 && B.bindsUpdatedAt() >= t0);
  B.setBind('forward', 1, null, { storage: store });
  check('...and its secondary cleared: W does nothing now', eq(B.bindsOf('forward'), ['ArrowUp', null]) && eq(B.actionsOf('KeyW'), []));
  check('stored: only what differs from the defaults, with the time', eq(JSON.parse(store.getItem('stn.binds')).binds, { forward: ['ArrowUp', null] }) && JSON.parse(store.getItem('stn.binds')).at === B.bindsUpdatedAt());

  // collisions
  check('Z is taken by ping: putting it on drop says so', eq(B.conflictsFor('drop', 'KeyZ'), [{ action: 'ping', slot: 0 }]));
  check('...a hands key on a build action is no collision (R on demolish shares with reload)', eq(B.conflictsFor('demolish', 'KeyR'), [{ action: 'buildNext', slot: 0 }]) && !B.conflictsFor('demolish', 'KeyR').some((c) => c.action === 'reload'));
  const moved = B.setBind('drop', 0, 'KeyZ', { mode: 'swap', storage: store });
  check('swap: drop gets Z, ping gets G (what drop had)', eq(B.bindsOf('drop'), ['KeyZ', null]) && eq(B.bindsOf('ping'), ['KeyG', 'Mouse1']) && eq(moved, [{ action: 'ping', slot: 0, code: 'KeyG' }]), JSON.stringify([B.bindsOf('drop'), B.bindsOf('ping'), moved]));
  const plan = B.planBind(B.allBinds(), 'interact', 0, 'KeyF', 'swap');
  check("a swap that would collide again gives nothing: E onto flashlight would clash with next structure's E", plan.moved.length === 1 && plan.moved[0].action === 'flashlight' && plan.moved[0].code === null && B.bindsOf('interact')[0] === 'KeyE', JSON.stringify(plan.moved));
  const moved2 = B.setBind('heal', 0, 'Mouse1', { mode: 'replace', storage: store });
  check('use here: heal gets MMB and ping is left without it', eq(B.bindsOf('heal'), ['Mouse1', null]) && eq(B.bindsOf('ping'), ['KeyG', null]) && moved2.length === 1 && moved2[0].code === null);
  B.setBind('crouch', 0, 'Mouse3', { storage: store });
  check('crouch onto Mouse 4: a mouse button is a bind like a key', eq(B.bindsOf('crouch'), ['Mouse3', 'KeyC']) && eq(B.actionsOf('Mouse3'), ['crouch']) && !B.boundKeyCodes().includes('Mouse3') && !B.boundKeyCodes().includes('ControlLeft'));
  B.setBind('drop', 0, null, { storage: store });
  check('drop with no key at all: unbound, and text says so', eq(B.bindsOf('drop'), [null, null]) && !B.hasBind('drop') && B.bindTag('drop') === '[unbound]' && B.bindPair('drop') === 'unbound');
  B.setBind('talk', 1, 'Mouse4', { storage: store });
  B.setBind('talk', 0, null, { storage: store });
  check('a lone secondary becomes the primary (the one text names)', eq(B.bindsOf('talk'), ['Mouse4', null]) && B.bindLabel('talk') === 'Mouse 5');

  // round trip through storage
  const snapshot = B.allBinds();
  const at = B.bindsUpdatedAt();
  B.loadBinds(store);
  check('reloaded from storage: the same binds and time', eq(B.allBinds(), snapshot) && B.bindsUpdatedAt() === at);

  // resets
  B.resetBind('crouch', { storage: store });
  check('reset one action: crouch is Ctrl / C again, the rest stay', eq(B.bindsOf('crouch'), ['ControlLeft', 'KeyC']) && B.isDefault('crouch') && !B.isDefault('forward'));
  B.resetAllBinds({ storage: store });
  check('reset all: every default back, and the time moves on (a reset is a change the account must hear of)', ACTIONS.every((a) => B.isDefault(a.id)) && B.bindsUpdatedAt() > at && eq(JSON.parse(store.getItem('stn.binds')).binds, {}));

  // corrupt storage
  for (const [what, raw] of [
    ['not JSON', '{nope'],
    ['an old version', JSON.stringify({ v: 0, at: 5, binds: { forward: ['KeyK', null] } })],
    ['a string', '"KeyW"'],
    ['an array', '[1,2]'],
  ]) {
    store.setItem('stn.binds', raw);
    B.loadBinds(store);
    check(`stored ${what}: the defaults`, ACTIONS.every((a) => B.isDefault(a.id)) && B.bindsUpdatedAt() === 0);
  }
  store.setItem('stn.binds', JSON.stringify({ v: 1, at: 1234, binds: { forward: ['KeyK', null], back: ['Escape', null], nope: ['KeyJ', null], left: 'KeyA', right: ['KeyL', 'KeyL'], jump: ['Mouse9', null] } }));
  B.loadBinds(store);
  check('stored junk mixed with good binds: the good ones kept, each bad one on its defaults', eq(B.bindsOf('forward'), ['KeyK', null]) && B.isDefault('back') && B.isDefault('left') && B.isDefault('jump') && eq(B.bindsOf('right'), ['KeyL', null]) && B.bindsUpdatedAt() === 1234, JSON.stringify(B.allBinds()));
  B.loadBinds({ getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } });
  check('storage that throws (a private window): the defaults, and a change still works for the page', ACTIONS.every((a) => B.isDefault(a.id)) && (B.setBind('map', 0, 'KeyN', { storage: { setItem: () => { throw new Error('full'); } } }), B.bindsOf('map')[0] === 'KeyN'));

  // the account's copy
  B.loadBinds(memStore());
  B.adoptBinds({ jump: ['Mouse3', 'Space'] }, 99999, { storage: store });
  check("the account's copy taken over, with its time", eq(B.bindsOf('jump'), ['Mouse3', 'Space']) && B.bindsUpdatedAt() === 99999 && JSON.parse(store.getItem('stn.binds')).at === 99999);
  check('exported for the account: overrides and time', eq(B.exportBinds(), { binds: { jump: ['Mouse3', 'Space'] }, updatedAt: 99999 }));
  off();
}

// ---------------------------------------------------------------- the server's check
{
  check('fromOverrides / toOverrides round-trip', eq(toOverrides(fromOverrides({ fire: ['KeyF', null], flashlight: ['Mouse0', null] })), { fire: ['KeyF', null], flashlight: ['Mouse0', null] }));
  // a player's own bind beats a new default: K was theirs for something else before Dead Hand came along
  const mine = fromOverrides({ flashlight: ['KeyK', null] });
  check("a player's own bind on K wins: flashlight stays on K, Dead Hand is left with no key (not two actions on one)", eq(mine.flashlight, ['KeyK', null]) && eq(mine.cards, [null, null]), JSON.stringify([mine.flashlight, mine.cards]));
  const second = fromOverrides({ ping: ['KeyZ', 'KeyK'] });
  check('...on their secondary too; and nothing else of the defaults moves', eq(second.cards, [null, null]) && eq(second.map, ['KeyM', null]) && eq(second.bestiary, ['KeyJ', null]));
  check('...a default that collides with nothing they chose is kept (K free: Dead Hand on K)', eq(fromOverrides({ flashlight: ['KeyP', null] }).cards, ['KeyK', null]) && eq(fromOverrides(null).cards, ['KeyK', null]));
  check('...a hands key with a build key is no collision (Q for interact keeps last weapon / back on Q)', eq(fromOverrides({ interact: ['KeyQ', null] }).buildPrev, ['KeyQ', null]));
  const lone = fromOverrides({ heal: ['Mouse1', null] });
  check('...an action that gives up its primary keeps its secondary as the primary (ping: Z, MMB -> Z)', eq(lone.ping, ['KeyZ', null]) && eq(fromOverrides({ heal: ['KeyZ', null] }).ping, ['Mouse1', null]));
  check('...and what is kept for the player then says so (Dead Hand unbound is an override of its own)', eq(toOverrides(mine), { flashlight: ['KeyK', null], cards: [null, null] }), JSON.stringify(toOverrides(mine)));
  // ...and through the client's store: a browser that kept flashlight on K before the update
  const st = memStore();
  st.setItem('stn.binds', JSON.stringify({ v: 1, at: 777, binds: { flashlight: ['KeyK', null] } }));
  B.loadBinds(st);
  check('...loaded from this browser: K is the flashlight alone, Dead Hand unbound', eq(B.actionsOf('KeyK'), ['flashlight']) && !B.hasBind('cards') && B.bindTag('cards') === '[unbound]');
  B.loadBinds(memStore());
  check('the server keeps good overrides', checkOverrides({ forward: ['ArrowUp', null], crouch: ['Mouse3', 'KeyC'] }).ok && checkOverrides({}).ok);
  const bad = [null, [], 'x', { nope: ['KeyW', null] }, { forward: ['KeyW'] }, { forward: ['Escape', null] }, { forward: [5, null] }, { forward: 'KeyW' }, { forward: ['<script>', null] }, { __proto__: { forward: ['KeyW', null] }, constructor: ['KeyW', null] }];
  const said = bad.map((o) => checkOverrides(o));
  check('...and refuses junk: not an object, an unknown action, one bind, Escape, a number, a string, markup, constructor', said.every((r) => !r.ok && r.error), JSON.stringify(said));
  const many = Object.fromEntries(ACTIONS.map((a) => [a.id, [null, null]]));
  check('...every action, all unbound, is still within the limit', checkOverrides(many).ok);
}

// ---------------------------------------------------------------- Input: a key rebound while it is held
{
  const listeners = { doc: {}, win: {} };
  const target = (where) => ({ addEventListener: (t, f) => ((listeners[where][t] ||= []).push(f)) });
  globalThis.document = Object.assign(target('doc'), { pointerLockElement: null });
  globalThis.window = target('win');
  const fire = (where, type, e) => (listeners[where][type] || []).forEach((f) => f({ preventDefault() {}, repeat: false, ...e }));
  const { Input } = await import('../client/game/input.js');
  B.loadBinds(memStore());
  const inp = new Input({});
  inp.enabled = true;
  const ups = [];
  inp.handlers.onKeyUp = (code, acts) => ups.push(...acts);
  const keys = [];
  inp.handlers.onKey = (code, acts) => keys.push(...acts);
  fire('win', 'keydown', { code: 'KeyW' });
  check('W held: forward', inp.sample() === BTN.FWD && inp.held('forward'));
  B.setBind('forward', 0, 'ArrowUp', { mode: 'replace', storage: memStore() });
  B.setBind('forward', 1, null, { storage: memStore() });
  fire('win', 'keyup', { code: 'KeyW' });
  inp.clearLatch();
  check('rebound to Up while W was held, then W let go: nothing stuck', inp.sample() === 0 && !inp.held('forward'));
  fire('win', 'keydown', { code: 'KeyW' });
  inp.clearLatch();
  check('...W does nothing now', inp.sample() === 0);
  fire('win', 'keyup', { code: 'KeyW' });
  fire('win', 'keydown', { code: 'ArrowUp' });
  check('...and Up moves', inp.sample() === BTN.FWD);
  fire('win', 'keyup', { code: 'ArrowUp' });
  fire('win', 'keydown', { code: 'KeyV' });
  B.setBind('talk', 0, 'KeyB', { storage: memStore() });
  fire('win', 'keyup', { code: 'KeyV' });
  check('push to talk rebound while V was down: letting V go still stops the talking', keys.includes('talk') && ups.includes('talk'));
  B.setBind('crouch', 0, 'Mouse3', { storage: memStore() });
  inp.locked = true;
  inp.clearLatch();
  fire('doc', 'mousedown', { button: 3 });
  check('crouch on Mouse 4: the side button held crouches', inp.sample() === BTN.CROUCH);
  fire('doc', 'mouseup', { button: 3 });
  inp.clearLatch();
  fire('win', 'keydown', { code: 'ControlLeft' });
  check('...and Left Ctrl no longer does', inp.sample() === 0);
  fire('win', 'keyup', { code: 'ControlLeft' });
  inp.enabled = false;
  fire('win', 'keydown', { code: 'KeyI' });
  fire('win', 'keydown', { code: 'KeyG' });
  check('controls off (the inventory up): its own key still answers, a key of play does not', keys.includes('inventory') && !keys.includes('drop'));
  fire('win', 'keyup', { code: 'KeyI' });
  inp.enabled = true;
  fire('win', 'keydown', { code: 'KeyD' });
  inp.handlers.isTyping = () => true;
  fire('win', 'keydown', { code: 'KeyA' });
  check('typing in the chat: keys do nothing', !inp.held('left') && inp.held('right'));
  inp.handlers.isTyping = () => false;
  inp.releaseAll();
  inp.clearLatch();
  check('releaseAll lets go of everything', inp.sample() === 0 && inp.down.size === 0);
  delete globalThis.document;
  delete globalThis.window;
}

// ---------------------------------------------------------------- hold to drop
{
  const h = new DropHold();
  const run = (secs, slot = 0, able = true) => {
    let out = null;
    for (let t = 0; t < secs - 1e-9; t += 1 / 60) out = h.update(1 / 60, slot, able) || out;
    return out;
  };
  h.start(0);
  const early = run(0.15);
  const tap = h.release();
  check('a tap of the drop key does not drop, and asks for a hold', early === null && tap === 'tap' && h.hint === TAP_HINT && !h.holding);
  run(TAP_HINT + 0.1);
  check('...the hint goes after a moment', h.hint === 0);
  h.start(0);
  const held = run(DROP_HOLD + 0.05);
  check(`held ${DROP_HOLD} s: it drops, once`, held === 'drop' && !h.holding && h.release() === null && run(1) === null);
  h.start(0);
  run(0.2);
  check('halfway, it says so (progress)', h.progress > 0.4 && h.progress < 0.6);
  const switched = run(0.5, 1);
  check('switching weapons mid-hold calls it off', switched === null && !h.holding);
  h.start(0);
  check('paused or downed mid-hold calls it off', run(1, 0, false) === null && !h.holding);
  h.start(0);
  run(0.1);
  check('let go by the game (a menu taking over): no hint', h.release(true) === null && h.hint === 0);
}

// ---------------------------------------------------------------- the migration
{
  const db = await openDb('pglite:memory');
  const { applied } = await migrate(db);
  check('005_settings applies', applied.includes('005_settings.sql'), applied.join());
  await db.close();
}

// ---------------------------------------------------------------- a real server
const dir = mkdtempSync(join(tmpdir(), 'stn-binds-'));
const procs = [];
const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
async function stop(proc) {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  const gone = new Promise((r) => proc.once('exit', r));
  proc.kill('SIGTERM');
  const t = setTimeout(() => proc.kill('SIGKILL'), 8000);
  await gone;
  clearTimeout(t);
}
async function startServer(env) {
  const port = await freePort();
  const proc = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(port), STATS_FILE: '', GAME_IDLE_SECONDS: '2', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  procs.push(proc);
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 300 && !log.includes('listening'); i++) await sleep(50);
  if (!log.includes('listening')) throw new Error(`server did not start:\n${log}`);
  return { port, proc, base: `http://localhost:${port}` };
}
const browser = (base) => {
  const b = { cookie: '' };
  b.req = async (method, path, body) => {
    const res = await fetch(base + path, { signal: AbortSignal.timeout(15000), method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(b.cookie ? { cookie: b.cookie } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    for (const c of res.headers.getSetCookie?.() || []) {
      const m = /^stn_session=([^;]*)/.exec(c);
      if (m) b.cookie = m[1] ? `stn_session=${m[1]}` : '';
    }
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return b;
};

try {
  const { base } = await startServer({ DATABASE_URL: `pglite:${join(dir, 'db')}` });
  const guest = browser(base);
  const g1 = await guest.req('GET', '/api/me/binds');
  const g2 = await guest.req('PUT', '/api/me/binds', { binds: {}, updatedAt: Date.now() });
  check('a guest is told to sign in (401), for reading and for saving', g1.status === 401 && g2.status === 401, JSON.stringify([g1, g2]));

  const home = browser(base);
  const reg = await home.req('POST', '/api/auth/register', { email: 'kb@example.com', username: 'Keys', password: 'keys-password' });
  check('signed up', reg.status === 201 && home.cookie, JSON.stringify(reg));
  const none = await home.req('GET', '/api/me/binds');
  check('a new account has no binds kept yet', none.status === 200 && none.body.binds === null && none.body.updatedAt === 0, JSON.stringify(none));

  const t1 = Date.now();
  const mine = { forward: ['ArrowUp', null], crouch: ['Mouse3', 'KeyC'], drop: [null, null] };
  const put = await home.req('PUT', '/api/me/binds', { binds: mine, updatedAt: t1 });
  check('PUT keeps them, and answers with what is kept', put.status === 200 && eq(put.body.binds, mine) && put.body.updatedAt === t1, JSON.stringify(put));
  const got = await home.req('GET', '/api/me/binds');
  check('GET gives them back, to the millisecond', eq(got.body.binds, mine) && got.body.updatedAt === t1, JSON.stringify(got));

  const work = browser(base);
  await work.req('POST', '/api/auth/login', { login: 'Keys', password: 'keys-password' });
  const there = await work.req('GET', '/api/me/binds');
  check('signed in on another browser: the binds are there', eq(there.body.binds, mine) && there.body.updatedAt === t1, JSON.stringify(there));

  const junk = await Promise.all([
    home.req('PUT', '/api/me/binds', { binds: { fly: ['KeyF', null] }, updatedAt: t1 + 1 }),
    home.req('PUT', '/api/me/binds', { binds: { forward: ['Escape', null] }, updatedAt: t1 + 1 }),
    home.req('PUT', '/api/me/binds', { binds: { forward: ['KeyW'] }, updatedAt: t1 + 1 }),
    home.req('PUT', '/api/me/binds', { binds: { forward: ['KeyW', null] }, updatedAt: 'soon' }),
    home.req('PUT', '/api/me/binds', { binds: 'all of them', updatedAt: t1 + 1 }),
    home.req('PUT', '/api/me/binds', { binds: { forward: ['K'.repeat(5000), null] }, updatedAt: t1 + 1 }),
  ]);
  check('junk is refused: an unknown action, Escape, one bind, no time, not an object (400) and too big (413)', junk.slice(0, 5).every((r) => r.status === 400 && r.body.error) && junk[5].status === 413, JSON.stringify(junk.map((r) => [r.status, r.body])));
  check('...and what was kept is untouched', eq((await home.req('GET', '/api/me/binds')).body.binds, mine));

  // newer wins: the work browser changes them later; the home browser, behind, saves an older change
  const t2 = t1 + 60_000;
  const newer = { forward: ['KeyI', null] };
  await work.req('PUT', '/api/me/binds', { binds: newer, updatedAt: t2 });
  const stale = await home.req('PUT', '/api/me/binds', { binds: { jump: ['Mouse4', null] }, updatedAt: t1 + 5 });
  check('an older save than what is kept is not written, and the answer is the newer copy', stale.status === 200 && eq(stale.body.binds, newer) && stale.body.updatedAt === t2, JSON.stringify(stale));
  const later = await home.req('POST', '/api/me/binds', { binds: { jump: ['Mouse4', null] }, updatedAt: t2 + 1 });
  check('a newer one is (POST works as well as PUT)', eq(later.body.binds, { jump: ['Mouse4', null] }) && later.body.updatedAt === t2 + 1, JSON.stringify(later));
  const ahead = await home.req('PUT', '/api/me/binds', { binds: {}, updatedAt: Date.now() + 365 * 86400_000 });
  check("a clock a year ahead is held to a day ahead of the server's", ahead.body.updatedAt <= Date.now() + 86400_000 + 5000, JSON.stringify(ahead.body));

  // saving too often
  let refused = 0;
  for (let i = 0; i < 40; i++) if ((await home.req('PUT', '/api/me/binds', { binds: {}, updatedAt: Date.now() + 86400_000 + i })).status === 429) refused++;
  check('saving many times in a row is held back (429) after a burst', refused > 0 && refused < 40, String(refused));

  await home.req('POST', '/api/auth/logout', {});
  check('signed out: a guest again', (await home.req('GET', '/api/me/binds')).status === 401);
} catch (err) {
  failed++;
  console.log('FAIL  threw', err);
}

try {
  const { base } = await startServer({ DATABASE_URL: '' });
  const get = await fetch(base + '/api/me/binds').then(async (r) => ({ status: r.status, body: await r.json() }));
  const put = await fetch(base + '/api/me/binds', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ binds: {}, updatedAt: 1 }) });
  check('without a database: GET says there are no accounts (the browser keeps its own), PUT is a 503', get.status === 200 && get.body.accounts === false && get.body.binds === null && put.status === 503, JSON.stringify([get, put.status]));
} catch (err) {
  failed++;
  console.log('FAIL  threw', err);
}

await Promise.all(procs.map(stop));
rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
