// The headless browser's rules (scripts/clip/lib.js, docs/object-clipping.md): a browser an agent starts must never take
// the screen, the keyboard, the machine or the ACCOUNT from the person using it. On 2026-10-04 an agent's browsers locked
// a user out of their Windows account: Chromium signs in to Windows with an empty password 40 s after it starts on a new
// profile, to learn whether the password is blank, and every temporary profile was a failed sign-in.
//
// Most of this runs with no browser at all: the flags, the counter guard and its marker file, the lock file (held by a
// dummy process) and the watchdog (killing a dummy process). Then ONE short software-rendered launch checks the seeded
// "Local State", the stubs, the game's own click that takes the mouse, and that the account's failed sign-in counter
// did not rise. Never add a run without the seed "to compare": that run is a failed sign-in.
// The launch is skipped where there is no Chrome, with STN_NO_BROWSER=1, and while the guard refuses to launch.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  REPO, sleep, startVite, launchChrome, pageIsSafe, chromePath, LOCK_FILE, BLOCK_FILE, BAD_ATTEMPTS_MAX, LOCAL_STATE_SEED, FORBIDDEN_ARGS, NO_CREDENTIALS, SAFE_PREFS,
  LIFE_DEFAULT, LIFE_MAX, PERF_ARGS, PERF_LIFE_MAX, perfPlan, badPasswordAttempts, guardBefore, guardAfter, takeLock, dropLock, startWatchdog,
} from './clip/lib.js';

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : detail}`);
}
const throws = (fn) => {
  try {
    fn();
    return '';
  } catch (e) {
    return e.message || 'threw';
  }
};
const rejects = async (p) => {
  try {
    await p;
    return '';
  } catch (e) {
    return e.message || 'threw';
  }
};
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};
// a process that does nothing until it is killed: stands in for a browser, or for another script holding the lock
const dummy = () => spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
const work = mkdtempSync(join(tmpdir(), 'stn-cliptest-'));

let vite = null, chrome = null;
const dummies = [];
try {
  // ------------------------------------------------------------ no browser: the flags and the profile's seed
  check('the profile is seeded with "the OS password is not blank", exactly', LOCAL_STATE_SEED === '{"password_manager":{"os_password_blank":false,"os_password_last_changed":"9000000000000000000"}}');
  check('no way to the credentials of the machine: basic password store, no sync, background services or component updates, no integrated sign-in', ['--password-store=basic', '--disable-sync', '--disable-background-networking', '--disable-component-update', '--auth-server-allowlist=', '--auth-negotiate-delegate-allowlist='].every((a) => NO_CREDENTIALS.includes(a)) && SAFE_PREFS.credentials_enable_service === false && SAFE_PREFS.profile.password_manager_enabled === false);
  check('a tool cannot point the browser at another profile, or allow integrated sign-in', ['--user-data-dir=C:/x', '--profile-directory=Default', '--auth-server-allowlist=*'].every((a) => FORBIDDEN_ARGS.test(a)));
  check('flags that show a window or uncap the frame rate are refused', ['--kiosk', '--start-fullscreen', '--app=http://x', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--headless=false'].every((a) => FORBIDDEN_ARGS.test(a)) && !FORBIDDEN_ARGS.test('--mute-audio'));
  check('...by the launcher itself, before anything is started', /not allowed/.test(await rejects(launchChrome({ extraArgs: ['--disable-gpu-vsync'] }))));
  check('a browser lives 5 minutes unless told, 15 at most', LIFE_DEFAULT === 5 * 60_000 && LIFE_MAX === 15 * 60_000);
  // the one bounded exception: the launcher's own perf: true (scripts/perf/bench.js)
  const plain = perfPlan({ width: 4000, height: 4000, life: 99 * 60_000 });
  check('a launch without perf adds no flag, is 1280 x 800 at the most and lives 15 minutes at the most', plain.args.length === 0 && plain.width === 1280 && plain.height === 800 && plain.life === LIFE_MAX);
  const pp = perfPlan({ perf: true, gpu: true, width: 4000, height: 4000, life: 99 * 60_000 });
  check('perf: true is the only way to an uncapped frame rate: the launcher adds the two flags itself', PERF_ARGS.join() === '--disable-gpu-vsync,--disable-frame-rate-limit' && pp.args.join() === PERF_ARGS.join());
  check('...for 6 minutes at the most, at 1920 x 1080 at the most', PERF_LIFE_MAX === 6 * 60_000 && pp.life === PERF_LIFE_MAX && pp.width === 1920 && pp.height === 1080 && perfPlan({ perf: true, gpu: true, life: 60_000 }).life === 60_000);
  check('...only on the real GPU', /real GPU/.test(throws(() => perfPlan({ perf: true }))) && /real GPU/.test(await rejects(launchChrome({ perf: true }))));
  check('...and a tool still cannot pass the flags itself, with perf or without', /not allowed/.test(throws(() => perfPlan({ perf: true, gpu: true, extraArgs: ['--disable-frame-rate-limit'] }))) && /not allowed/.test(throws(() => perfPlan({ gpu: true, extraArgs: ['--disable-gpu-vsync'] }))));

  // ------------------------------------------------------------ no browser: the failed sign-in counter's guard
  const marker = join(work, 'blocked');
  check('the guard lets a launch through below the limit, and where the counter cannot be read', BAD_ATTEMPTS_MAX === 4 && [0, 1, 3, null].every((n) => throws(() => guardBefore(n, marker)) === ''));
  check('...and refuses at 4 failed sign-ins or more, saying when the counter clears', [4, 7, 10].every((n) => /10 minutes after the last failure/.test(throws(() => guardBefore(n, marker)))));
  check('a counter that did not rise while the browser was up is fine', guardAfter(0, 0, marker) === null && guardAfter(3, 2, marker) === null && guardAfter(null, 5, marker) === null && guardAfter(2, null, marker) === null && !existsSync(marker));
  const rose = guardAfter(1, 2, marker);
  check('a counter that rose says STOP and leaves the marker file', /rose from 1 to 2/.test(rose || '') && /STOP/.test(rose || '') && existsSync(marker), String(rose));
  check('...and the marker refuses every later launch, whatever the counter reads', /blocked by/.test(throws(() => guardBefore(0, marker))) && /blocked by/.test(throws(() => guardBefore(null, marker))));
  rmSync(marker, { force: true });
  check('...until someone deletes it', throws(() => guardBefore(0, marker)) === '');
  check('the marker file is stn-chrome.blocked in the temp folder', BLOCK_FILE === join(tmpdir(), 'stn-chrome.blocked'));
  const before = badPasswordAttempts();
  check('the counter is read without elevation (a number on Windows, null elsewhere)', process.platform === 'win32' ? before === null || (Number.isInteger(before) && before >= 0) : before === null, String(before));
  console.log(`      the account's failed sign-in counter reads ${before}`);

  // ------------------------------------------------------------ no browser: one at a time (the lock file)
  check('the lock file is stn-chrome.lock in the temp folder', LOCK_FILE === join(tmpdir(), 'stn-chrome.lock'));
  let held = null;
  try {
    held = JSON.parse(readFileSync(LOCK_FILE, 'utf8'));
  } catch {}
  if (held && alive(held.pid)) {
    console.log(`SKIP  another process (${held.pid}) has a headless browser open: the lock, the watchdog and the launch were not exercised`);
  } else {
    const other = dummy();
    dummies.push(other);
    writeFileSync(LOCK_FILE, JSON.stringify({ pid: other.pid, t: Date.now() }));
    check('while a live process holds the lock, another launch waits and is then refused', /another headless browser is running/.test(await rejects(takeLock(700))));
    other.kill();
    for (let i = 0; i < 50 && alive(other.pid); i++) await sleep(100);
    await takeLock(700);
    check('a lock whose holder is gone is taken over', JSON.parse(readFileSync(LOCK_FILE, 'utf8')).pid === process.pid);
    dropLock();
    check('...and let go of', !existsSync(LOCK_FILE));

    // ---------------------------------------------------------- no browser: the watchdog
    const fake = dummy();
    dummies.push(fake);
    const dir = mkdtempSync(join(tmpdir(), 'stn-cliptest-profile-'));
    writeFileSync(join(dir, 'Local State'), LOCAL_STATE_SEED);
    const t0 = Date.now();
    startWatchdog(fake.pid, dir, 2000);
    await sleep(1000);
    check('the watchdog leaves a browser alone inside its time', alive(fake.pid));
    let dead = false;
    for (let i = 0; i < 40 && !dead; i++) {
      await sleep(250);
      dead = !alive(fake.pid);
    }
    check('...and kills it when its time is up, from a process of its own', dead && Date.now() - t0 >= 1900, `${Date.now() - t0} ms`);
    for (let i = 0; i < 20 && existsSync(dir); i++) await sleep(250);
    check('...and deletes its profile', !existsSync(dir), dir);
    rmSync(dir, { recursive: true, force: true });

    // ---------------------------------------------------------- the one launch
    let skip = '';
    if (process.env.STN_NO_BROWSER === '1') skip = 'STN_NO_BROWSER=1';
    else if (throws(() => chromePath())) skip = 'no Chrome on this machine (set CHROME)';
    else skip = throws(() => guardBefore(before));
    if (skip) {
      console.log(`SKIP  no browser was launched: ${skip}`);
    } else {
      vite = await startVite(REPO);
      chrome = await launchChrome({ width: 640, height: 400, life: 90_000 });
      const cmd = chrome.browser.process().spawnargs.join(' ');
      check('the browser runs on a temporary profile of its own (stn-chrome-*), with the credential flags', /stn-chrome-/.test(cmd) && chrome.profile.startsWith(tmpdir()) && NO_CREDENTIALS.every((a) => (a.startsWith('--disable-features=') ? a.slice(19).split(',').every((x) => cmd.includes(x)) : cmd.includes(a))), cmd); // (puppeteer folds --disable-features into its own)
      check('...headless, off screen and muted, with nothing that uncaps the frame rate', /--headless/.test(cmd) && cmd.includes('--window-position=-32000,-32000') && cmd.includes('--mute-audio') && !/disable-gpu-vsync|disable-frame-rate-limit|kiosk|start-fullscreen/.test(cmd));
      check('software rendering unless asked otherwise', chrome.angle === 'swiftshader' && cmd.includes('--use-angle=swiftshader'), chrome.angle);
      // (Chrome rewrites the file as it runs, with what it reads from the account: the keys stay)
      let state = null;
      for (let i = 0; i < 10 && !state; i++) {
        try {
          state = JSON.parse(readFileSync(join(chrome.profile, 'Local State'), 'utf8'));
        } catch {
          await sleep(200);
        }
      }
      const pm = state?.password_manager || {};
      check("the profile's Local State already answers whether the OS password is blank (no Windows sign-in to find out)", pm.os_password_blank === false && 'os_password_last_changed' in pm, JSON.stringify(pm));
      let prefs = null;
      try {
        prefs = JSON.parse(readFileSync(join(chrome.profile, 'Default', 'Preferences'), 'utf8'));
      } catch {}
      check('...and its Preferences turn the password manager off', prefs?.credentials_enable_service === false && prefs?.profile?.password_manager_enabled === false, JSON.stringify(prefs).slice(0, 200));
      check('the lock file names this process', JSON.parse(readFileSync(LOCK_FILE, 'utf8')).pid === process.pid);
      check('a second browser in the same process is refused', /already has a browser open/.test(await rejects(launchChrome())));

      const page = chrome.page;
      await page.goto(`${vite.url}/sandbox/icons-test.html`, { waitUntil: 'load', timeout: 60000 });
      check('the stubs are in place in a page', (await pageIsSafe(page)) === true);
      const ua = await page.evaluate(() => navigator.userAgent);
      check('the browser is headless', /Headless/.test(ua), ua);

      // a real click (a user gesture) that asks for fullscreen and the keyboard lock directly, then the way the game does
      // (KeyGuard.engage: fullscreen, then the keyboard; Input.requestLock: canvas.requestPointerLock), and the wake lock
      await page.evaluate(async () => {
        const { KeyGuard } = await import('/game/keyguard.js');
        const guard = new KeyGuard(() => window.__playing);
        window.__playing = true;
        window.__real = { keyboard: !!navigator.keyboard };
        const b = document.createElement('button');
        b.id = 'take';
        b.textContent = 'take the mouse';
        b.style.cssText = 'position:fixed;left:10px;top:10px;width:200px;height:80px;z-index:99999';
        b.addEventListener('click', () => {
          document.documentElement.requestFullscreen();
          navigator.keyboard?.lock(['KeyW']);
          guard.engage();
          document.body.requestPointerLock({ unadjustedMovement: true });
          navigator.wakeLock?.request('screen');
        });
        document.body.appendChild(b);
      });
      await page.mouse.click(60, 40);
      await sleep(800);
      const after = await page.evaluate(() => ({ fs: document.fullscreenElement === null, pl: document.pointerLockElement === null, calls: window.__stnSafe.calls, inner: [innerWidth, innerHeight], kb: window.__real.keyboard }));
      check('a click that calls requestFullscreen() leaves document.fullscreenElement null', after.calls.fullscreen >= 2 && after.fs, JSON.stringify(after));
      check('...navigator.keyboard.lock() reached only the stub', after.kb && after.calls.keyboardLock >= 2, JSON.stringify(after));
      check('...and so did the pointer lock', after.calls.pointerLock >= 1 && after.pl, JSON.stringify(after));
      check('the page is still the size it was (nothing went fullscreen)', after.inner[0] === 640 && after.inner[1] === 400, String(after.inner));
      await page.evaluate(() => (window.__playing = false));
      check('a screenshot of a safe page is taken', (await page.screenshot()).length > 100);

      // a page that did not go through the helper has no stubs: it is refused
      const raw = await chrome.browser.newPage();
      await raw.goto(`${vite.url}/sandbox/icons-test.html`, { waitUntil: 'load', timeout: 60000 });
      check('a page without the stubs is refused', /unsafe page/.test(await rejects(pageIsSafe(raw))));
      await raw.close();

      const { pid, profile } = chrome;
      const closed = await rejects(chrome.close());
      chrome = null;
      check('closing does not report a risen counter', closed === '', closed);
      check('...kills the browser, deletes its profile and lets go of the lock', !alive(pid) && !existsSync(profile) && !existsSync(LOCK_FILE));
      const end = badPasswordAttempts();
      check("the account's failed sign-in counter did not rise", before === null || end === null || end <= before, `${before} -> ${end}`);
      check('...and no marker file was left', !existsSync(BLOCK_FILE));
    }
  }
} catch (e) {
  check('no error', false, String(e && e.stack));
} finally {
  if (chrome) await chrome.close().catch((e) => check('closing', false, e.message));
  if (vite) vite.stop();
  for (const d of dummies) d.kill();
  try {
    const l = JSON.parse(readFileSync(LOCK_FILE, 'utf8'));
    if (l.pid === process.pid || dummies.some((d) => d.pid === l.pid)) unlinkSync(LOCK_FILE);
  } catch {}
  rmSync(work, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
