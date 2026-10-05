// Shared plumbing for the clip-checking tools (scripts/clip/*.js): arguments, a dev server or a game server of their
// own, headless Chrome that keeps out of the way of whoever is using the machine, and labelled image sheets.
// See docs/object-clipping.md.
//
// THE RULES OF THE HEADLESS BROWSER. People use these machines while agents run, and on 2026-10-04 an agent's headless
// browsers locked a user out of their Windows account: 291 failed sign-ins by chrome.exe, 25 lockouts. The cause: about
// 40 s after it starts on a profile it has not seen, Chromium asks Windows whether the user's password is blank by
// signing in with an EMPTY one (password_manager_util_win's CheckBlankPasswordWithPrefs, from DelayReportOsPassword:
// LogonUser(user, ".", "")), and keeps the answer in the profile's "Local State" file. Every new temporary profile that
// lives past 40 s is therefore one failed Windows sign-in, and ten of those in ten minutes lock the account.
// So every headless browser in this repo is launched by launchChrome below and by nothing else, and launchChrome:
//   - writes the answer into the new profile's "Local State" before Chrome starts (LOCAL_STATE_SEED), so that sign-in
//     is never made;
//   - reads the account's failed sign-in counter before it launches and after the browser closes (badPasswordAttempts):
//     it refuses to launch at 4 or more, and if the counter rose while its browser was up it stops everything - it
//     throws and leaves a marker file (BLOCK_FILE) that refuses every later launch until a person deletes it;
//   - never takes input or the display: pointer lock, fullscreen, keyboard lock and wake lock are stubbed in every page
//     before any page script runs (SAFE_STUBS); the stubs are checked when the browser starts, after every page.goto
//     and before every screenshot, and a page without them is refused;
//   - is always headless ('new'), off screen and muted, and refuses flags that would show a window or uncap the frame
//     rate (FORBIDDEN_ARGS). The one way to an uncapped frame rate is the launcher's own perf: true (perfPlan below,
//     scripts/perf/bench.js): the real GPU at up to 1920 x 1080 with vsync and the frame limit off, for a browser that
//     lives 6 minutes at the most, still one on the whole machine, still below normal priority, and said so on stderr;
//   - renders in software (ANGLE swiftshader) unless the caller passes gpu: true (a tool's own --gpu flag), which is for
//     one short, bounded measurement;
//   - runs one browser at a time on the whole machine (a lock file in the temp folder), and one dev / game server at a
//     time in a process;
//   - runs the browser and the servers below normal priority;
//   - has a watchdog: a browser older than its limit (5 minutes by default, 15 at most) is killed with its whole
//     process tree by a separate process, even if the script that started it hangs; it is also killed on exit, on
//     SIGINT / SIGTERM and on an uncaught error, and its temporary profile (stn-chrome-*) is deleted;
//   - touches no credentials: a new empty profile every time (never the user's), the password manager, sync, background
//     services and integrated Windows sign-in all off (NO_CREDENTIALS, SAFE_PREFS);
//   - starts nothing at all while STN_NO_BROWSER=1 is set in the environment (the switch for a machine in use);
//   - sweeps up on the way in: a leftover stn-chrome browser older than the limit is killed, a stale profile removed.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync, copyFileSync, lstatSync, unlinkSync, rmdirSync, readdirSync, statSync, openSync, closeSync } from 'node:fs';
import { tmpdir, setPriority, constants as osConstants } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import puppeteer from 'puppeteer-core';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const OUT = join(REPO, 'shots', 'clip'); // (gitignored)
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- arguments
/**
 * --key value / --key=value / --flag. Returns { _: [positional...], key: value | true }. defaults fill what is not given.
 */
export function parseArgs(argv = process.argv.slice(2), defaults = {}) {
  const out = { _: [], ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[a.slice(2)] = argv[++i];
    else out[a.slice(2)] = true;
  }
  return out;
}
export const list = (v) => (v === undefined || v === true ? null : String(v).split(',').map((s) => s.trim()).filter(Boolean));

// ---------------------------------------------------------------- processes
/** A free TCP port, in [lo, hi] when given. */
export async function freePort(lo = 0, hi = 0) {
  const tryPort = (p) =>
    new Promise((res) => {
      const s = createServer();
      s.once('error', () => res(0));
      s.listen(p, () => {
        const got = s.address().port;
        s.close(() => res(got));
      });
    });
  if (!lo) return tryPort(0);
  for (let p = lo; p <= hi; p++) if (await tryPort(p)) return p;
  throw new Error(`no free port in ${lo}-${hi}`);
}

/** Stop a child process and everything it started. */
export function stopProcess(child) {
  if (!child || child.exitCode !== null || !child.pid) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGTERM');
  } catch {}
}

async function waitFor(child, re, what, ms = 60000) {
  let log = '';
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`${what}: not ready after ${ms / 1000} s\n${log.slice(-2000)}`)), ms);
    const on = (d) => {
      log += d;
      if (re.test(log)) {
        clearTimeout(t);
        res(log);
      }
    };
    child.stdout.on('data', on);
    child.stderr.on('data', on);
    child.once('exit', (c) => {
      clearTimeout(t);
      rej(new Error(`${what} exited (${c})\n${log.slice(-2000)}`));
    });
  });
}

// one dev server or game server at a time in a process, below normal priority
let server = null;
function oneServer(what) {
  if (server && server.exitCode === null) throw new Error(`${what}: another server of this process is still running (one at a time: stop it first)`);
}
function freeServer(child) {
  stopProcess(child);
  if (server === child) server = null;
}
function lowPriority(pid) {
  try {
    setPriority(pid, osConstants.priority.PRIORITY_BELOW_NORMAL);
  } catch {}
}

/**
 * The Vite dev server for a tree (its vite.config.js serves client/, so the sandboxes are at /sandbox/...).
 * Returns { url, stop }.
 */
export async function startVite(root = REPO) {
  oneServer('vite');
  const port = await freePort(5190, 5299);
  const bin = join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!existsSync(bin)) throw new Error(`${root} has no node_modules (npm install there first)`);
  const child = spawn(process.execPath, [bin, '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  server = child;
  lowPriority(child.pid);
  try {
    await waitFor(child, /Local:|ready in/, `vite in ${root}`);
  } catch (e) {
    freeServer(child);
    throw e;
  }
  return { url: `http://localhost:${port}`, stop: () => freeServer(child) };
}

/**
 * The real game: node server/index.js serving the tree's dist/ (built first if there is none, or with build: true),
 * the admin chat commands (/give, /tp, ...) for every client (NODE_ENV=test with DEV_ADMIN=1; and an ADMIN_SECRET, for a
 * tree from before admin accounts), godmode, a fixed seed and a long day.
 * Returns { url, secret, stop }.
 */
export async function startGame(root = REPO, { seed = 1, build = false, env = {} } = {}) {
  oneServer('game server');
  if (build || !existsSync(join(root, 'dist', 'index.html'))) execFileSync(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { cwd: root, stdio: 'ignore' });
  const port = await freePort(3500, 3599);
  const secret = 'clip' + Math.random().toString(36).slice(2, 10);
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test', DEV_ADMIN: '1', ADMIN_SECRET: secret, GODMODE: '1', SEED: String(seed), START_DAY: '1', DAY_SECONDS: '3000', DATABASE_URL: '', DEBUG_COMMANDS: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server = child;
  lowPriority(child.pid);
  try {
    await waitFor(child, /listening|serving \d+ static/i, `game server in ${root}`);
  } catch (e) {
    freeServer(child);
    throw e;
  }
  await sleep(400);
  return { url: `http://localhost:${port}`, secret, stop: () => freeServer(child) };
}

// ---------------------------------------------------------------- headless Chrome
export function chromePath() {
  if (process.env.CHROME) return process.env.CHROME;
  const c =
    process.platform === 'win32'
      ? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']
      : process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
        : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const found = c.find((p) => existsSync(p));
  if (!found) throw new Error('no Chrome found: set CHROME to its path');
  return found;
}

export const LIFE_DEFAULT = 5 * 60_000, LIFE_MAX = 15 * 60_000; // a browser's lifetime (ms): the watchdog's limit
export const LOCK_FILE = join(tmpdir(), 'stn-chrome.lock'); // { pid, t }: who has the one browser this machine runs
// While this file exists no browser is launched: it is written when the account's failed sign-in counter rose while a
// browser of ours was up. A person deletes it once they know why.
export const BLOCK_FILE = join(tmpdir(), 'stn-chrome.blocked');
export const BAD_ATTEMPTS_MAX = 4; // no launch at this many failed sign-ins on the account or more (Windows locks it at 10 here)
// What Chromium would otherwise find out by a Windows sign-in with an empty password, 40 s after it starts on a new
// profile (see the top of this file): "the OS password is not blank", dated far in the future so it is never stale.
// Chrome rewrites the entry with what it reads from the account; it does not sign in.
export const LOCAL_STATE_SEED = '{"password_manager":{"os_password_blank":false,"os_password_last_changed":"9000000000000000000"}}';
// flags no tool may pass: anything that shows a window, takes the screen or uncaps the frame rate
export const FORBIDDEN_ARGS = /^--(kiosk|start-fullscreen|start-maximized|app=|disable-gpu-vsync|disable-frame-rate-limit|headless=(false|old)|new-window|user-data-dir|profile-directory|auth-server-allowlist=.|auth-negotiate-delegate-allowlist=.)/;
// The one uncapped measurement (launchChrome's perf: true, for scripts/perf/bench.js): the flags the launcher adds
// itself (a tool still cannot pass them), the most such a browser may live and the largest frame it may draw.
export const PERF_ARGS = ['--disable-gpu-vsync', '--disable-frame-rate-limit'];
export const PERF_LIFE_MAX = 6 * 60_000;
export const PERF_SIZE = [1920, 1080], SIZE_MAX = [1280, 800];
/**
 * What a launch may be: its lifetime, its size and the flags the launcher adds for it. perf: true is the bounded
 * exception to "no uncapped frame rate" - only with gpu: true, 6 minutes at the most, up to 1920 x 1080. Throws on a
 * flag no tool may pass and on perf without the GPU (an uncapped frame rate in software measures nothing).
 */
export function perfPlan({ perf = false, gpu = false, life = LIFE_DEFAULT, width = 900, height = 600, extraArgs = [] } = {}) {
  const bad = extraArgs.find((a) => FORBIDDEN_ARGS.test(a));
  if (bad) throw new Error(`launchChrome: ${bad} is not allowed (it shows a window, takes the screen or uncaps the frame rate)`);
  if (perf && !gpu) throw new Error('launchChrome: perf: true is for a measurement on the real GPU (pass gpu: true with it)');
  if (perf && process.env.ANGLE === 'swiftshader') throw new Error('launchChrome: perf: true with ANGLE=swiftshader would measure the software renderer');
  const [w, h] = perf ? PERF_SIZE : SIZE_MAX;
  return { life: Math.min(perf ? PERF_LIFE_MAX : LIFE_MAX, Math.max(1000, life)), width: Math.min(width, w), height: Math.min(height, h), args: perf ? PERF_ARGS.slice() : [] };
}
// Nothing of Chrome's may touch the machine's credentials: no OS password store or keychain, no sync, no background
// services, no password manager, and no integrated Windows (NTLM / Negotiate) sign-in to any host - a failed one counts
// against the Windows account, and ten of those lock it.
export const NO_CREDENTIALS = [
  '--password-store=basic', '--use-mock-keychain', '--disable-sync', '--disable-background-networking', '--disable-component-update', '--no-service-autorun',
  '--disable-features=PasswordManagerOnboarding,AutofillServerCommunication,BiometricAuthenticationForFilling,PasswordImport,WebAuthenticationUI',
  '--auth-server-allowlist=', '--auth-negotiate-delegate-allowlist=',
];
// ...and the profile's preferences, written before the first start
export const SAFE_PREFS = { credentials_enable_service: false, profile: { password_manager_enabled: false }, password_manager: { biometric_authentication_filling: false } };
// settings for a game client in a test: the cheap presets (pass to newPage({ storage }) under 'stn.settings')
export const CHEAP_SETTINGS = JSON.stringify({ quality: 'low', renderScale: 0.75 });

/**
 * Runs in every page before any of its scripts: whatever takes the mouse, the keyboard, the screen or the machine's
 * sleep from the person at it does nothing here and says it worked. The game's own guard (client/game/keyguard.js)
 * asks for fullscreen and then for the keyboard on the click that takes the mouse. window.__stnSafe counts the
 * calls and is what pageIsSafe checks.
 */
export function SAFE_STUBS() {
  const calls = { pointerLock: 0, fullscreen: 0, keyboardLock: 0, wakeLock: 0 };
  const mark = (fn) => {
    fn.__stnStub = true;
    return fn;
  };
  const done = () => Promise.resolve();
  const def = (obj, name, fn) => {
    try {
      Object.defineProperty(obj, name, { value: mark(fn), writable: false, configurable: false });
    } catch {
      try {
        obj[name] = mark(fn);
      } catch {}
    }
  };
  def(Element.prototype, 'requestPointerLock', function () {
    calls.pointerLock++;
    return done();
  });
  def(Document.prototype, 'exitPointerLock', () => {});
  for (const n of ['requestFullscreen', 'webkitRequestFullscreen', 'webkitRequestFullScreen', 'mozRequestFullScreen', 'msRequestFullscreen'])
    def(Element.prototype, n, function () {
      calls.fullscreen++;
      return done();
    });
  for (const n of ['exitFullscreen', 'webkitExitFullscreen', 'webkitCancelFullScreen']) def(Document.prototype, n, done);
  const kb = typeof Keyboard !== 'undefined' ? Keyboard.prototype : navigator.keyboard || null;
  if (kb) {
    def(kb, 'lock', () => {
      calls.keyboardLock++;
      return done();
    });
    def(kb, 'unlock', () => {});
  }
  const wl = typeof WakeLock !== 'undefined' ? WakeLock.prototype : navigator.wakeLock || null;
  if (wl)
    def(wl, 'request', () => {
      calls.wakeLock++;
      return Promise.resolve({ released: false, type: 'screen', release: done, addEventListener() {}, removeEventListener() {} });
    });
  Object.defineProperty(window, '__stnSafe', { value: { calls }, writable: false, configurable: false });
}

/** What pageIsSafe reads in the page: every stub in place (true), or the names of the ones that are not. */
function SAFE_CHECK() {
  const bad = [];
  const ok = (fn) => typeof fn === 'function' && fn.__stnStub === true;
  if (!window.__stnSafe) bad.push('__stnSafe');
  if (!ok(Element.prototype.requestPointerLock)) bad.push('requestPointerLock');
  if (!ok(document.exitPointerLock)) bad.push('exitPointerLock');
  if (!ok(Element.prototype.requestFullscreen)) bad.push('requestFullscreen');
  if ('webkitRequestFullscreen' in Element.prototype && !ok(Element.prototype.webkitRequestFullscreen)) bad.push('webkitRequestFullscreen');
  if (!ok(document.exitFullscreen)) bad.push('exitFullscreen');
  if (navigator.keyboard && !(ok(navigator.keyboard.lock) && ok(navigator.keyboard.unlock))) bad.push('keyboard.lock');
  if (navigator.wakeLock && !ok(navigator.wakeLock.request)) bad.push('wakeLock.request');
  if (document.fullscreenElement) bad.push('fullscreenElement is set');
  if (document.pointerLockElement) bad.push('pointerLockElement is set');
  return bad.length ? bad : true;
}
/** Throws unless the page's stubs are all in place and it holds neither the screen nor the pointer. */
export async function pageIsSafe(page) {
  const r = await page.evaluate(SAFE_CHECK).catch((e) => ['could not be checked: ' + e.message]);
  if (r !== true) throw new Error(`unsafe page (${page.url()}): ${r.join(', ')}. No shot is taken of a page that could take the screen or the keyboard.`);
  return true;
}

/**
 * The account's failed sign-in counter (Windows: BadPasswordAttempts, readable without elevation; it clears 10 minutes
 * after the last failure). null where it cannot be read (another platform, a domain account, no PowerShell).
 */
export function badPasswordAttempts() {
  if (process.platform !== 'win32') return null;
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', "([ADSI]('WinNT://./' + $env:USERNAME + ',user')).BadPasswordAttempts.Value"], { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    const n = parseInt(out.trim(), 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}
/** Before a launch: throws while the marker file is there, or with the counter (n; null = unreadable) at the limit. */
export function guardBefore(n, blockFile = BLOCK_FILE) {
  if (existsSync(blockFile)) {
    let why = '';
    try {
      why = readFileSync(blockFile, 'utf8').trim();
    } catch {}
    throw new Error(`launchChrome: blocked by ${blockFile} - the account's failed sign-in counter rose while a browser of ours was up. Find out why, then delete the file. (${why})`);
  }
  if (n !== null && n >= BAD_ATTEMPTS_MAX) throw new Error(`launchChrome: the Windows account has ${n} failed sign-ins (no launch at ${BAD_ATTEMPTS_MAX} or more; Windows locks the account at 10). The counter clears 10 minutes after the last failure.`);
}
/** After a browser: if the counter rose (before -> after) writes the marker file and returns the message to throw. */
export function guardAfter(before, after, blockFile = BLOCK_FILE) {
  if (before === null || after === null || after <= before) return null;
  const msg = `the Windows account's failed sign-in counter rose from ${before} to ${after} while a headless browser was up (${new Date().toISOString()}, process ${process.pid})`;
  try {
    writeFileSync(blockFile, msg + '\n');
  } catch {}
  return `launchChrome: ${msg}. STOP: launch nothing more. ${blockFile} now refuses every launch until someone deletes it.`;
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};
/** Kills a process and everything under it, now. */
export function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
  }
}

// the stn-chrome browsers running on this machine: [{ pid, ageMs, cmd }]
function stnChromes() {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -match 'stn-chrome-' } | ForEach-Object { '{0}|{1}|{2}' -f $_.ProcessId, [int]((Get-Date) - $_.CreationDate).TotalMilliseconds, $_.CommandLine }"], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      return out.split(/\r?\n/).filter(Boolean).map((l) => {
        const [pid, age, ...cmd] = l.split('|');
        return { pid: +pid, ageMs: +age, cmd: cmd.join('|') };
      });
    }
    const out = execFileSync('ps', ['-eo', 'pid=,etimes=,args='], { encoding: 'utf8' });
    return out.split('\n').filter((l) => l.includes('stn-chrome-')).map((l) => {
      const m = l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
      return m ? { pid: +m[1], ageMs: +m[2] * 1000, cmd: m[3] } : null;
    }).filter(Boolean);
  } catch {
    return [];
  }
}

/** On the way in: a leftover stn-chrome browser older than the watchdog's limit is killed, a stale profile removed. */
export function sweepChromes(maxAge = LIFE_MAX) {
  let killed = 0, removed = 0;
  const running = stnChromes();
  for (const p of running) {
    if (p.ageMs > maxAge) {
      killTree(p.pid);
      killed++;
    }
  }
  const live = stnChromes().map((p) => p.cmd).join('\n');
  try {
    for (const d of readdirSync(tmpdir())) {
      if (!d.startsWith('stn-chrome-') || d === 'stn-chrome.lock') continue;
      const p = join(tmpdir(), d);
      if (live.includes(d)) continue; // (a browser is using it)
      try {
        if (Date.now() - statSync(p).mtimeMs < 60_000) continue; // (one being made this moment)
        rmSync(p, { recursive: true, force: true });
        removed++;
      } catch {}
    }
  } catch {}
  return { killed, removed };
}

// the machine's one browser: a lock file holding the pid of the process that has it
function readLock() {
  try {
    return JSON.parse(readFileSync(LOCK_FILE, 'utf8'));
  } catch {
    return null;
  }
}
export async function takeLock(waitMs) {
  const until = Date.now() + waitMs;
  for (;;) {
    try {
      const fd = openSync(LOCK_FILE, 'wx'); // (fails if it exists: two launches cannot both get it)
      closeSync(fd);
      writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, t: Date.now() }));
      return;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    const held = readLock();
    // a lock whose holder is gone, or that is older than any browser may live, is nobody's
    if (!held || !alive(held.pid) || Date.now() - held.t > LIFE_MAX + 60_000) {
      try {
        unlinkSync(LOCK_FILE);
      } catch {}
      continue;
    }
    if (Date.now() > until) throw new Error(`another headless browser is running (process ${held.pid} holds ${LOCK_FILE}): one at a time on this machine`);
    await sleep(500);
  }
}
export function dropLock() {
  const held = readLock();
  if (held && held.pid === process.pid) {
    try {
      unlinkSync(LOCK_FILE);
    } catch {}
  }
}

// below normal priority for the browser and everything it started (they carry its profile's path on their command line)
function lowerChrome(profile) {
  try {
    if (process.platform === 'win32') {
      const name = profile.split(/[\\/]/).pop();
      execFileSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -match '${name}' } | ForEach-Object { try { (Get-Process -Id $_.ProcessId).PriorityClass = 'BelowNormal' } catch {} }`], { stdio: 'ignore' });
    } else {
      for (const p of stnChromes()) if (p.cmd.includes(profile)) lowPriority(p.pid);
    }
  } catch {}
}

// a process of its own that kills the browser's tree when its time is up, whatever became of the script
export function startWatchdog(pid, profile, life) {
  const code = `
    const { execFileSync } = require('child_process'); const fs = require('fs');
    const [pid, life, profile, lock, owner] = process.argv.slice(1);
    const gone = (p) => { try { process.kill(+p, 0); return false; } catch (e) { return e.code !== 'EPERM'; } };
    const t0 = Date.now();
    const iv = setInterval(() => {
      const late = Date.now() - t0 > +life;
      if (!late && !gone(pid) && !gone(owner)) return; // (the browser is up, its script is alive, its time is not out)
      clearInterval(iv);
      if (!gone(pid)) { try { if (process.platform === 'win32') execFileSync('taskkill', ['/pid', pid, '/T', '/F'], { stdio: 'ignore' }); else process.kill(-pid, 'SIGKILL'); } catch {} try { process.kill(+pid, 'SIGKILL'); } catch {} }
      setTimeout(() => {
        try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
        try { const l = JSON.parse(fs.readFileSync(lock, 'utf8')); if (String(l.pid) === owner) fs.unlinkSync(lock); } catch {}
      }, 1500);
    }, 500);`;
  const w = spawn(process.execPath, ['-e', code, String(pid), String(life), profile, LOCK_FILE, String(process.pid)], { detached: true, stdio: 'ignore', windowsHide: true });
  w.unref();
  return w;
}

let current = null; // this process's one browser: { close }
let hooked = false;
function hookExit() {
  if (hooked) return;
  hooked = true;
  const end = () => {
    if (current) current.killNow();
  };
  process.on('exit', end);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => {
      end();
      process.exit(130);
    });
  }
  process.on('uncaughtException', (e) => {
    console.error(e);
    end();
    process.exit(1);
  });
  process.on('unhandledRejection', (e) => {
    console.error(e);
    end();
    process.exit(1);
  });
}

/**
 * Launch the one isolated headless Chrome (see the rules at the top of this file). Software rendering unless gpu: true.
 * perf: true (with gpu: true): the one uncapped measurement - see perfPlan.
 * life: the most it may live (ms; LIFE_DEFAULT, at most LIFE_MAX). storage: localStorage keys every page starts with.
 * Returns { browser, page (a first page, set up), newPage({ window }) (window: in a window of its own, so it keeps
 * drawing while another page is in front), close(), angle, pid }. Call close() in a finally.
 */
export async function launchChrome({ width = 900, height = 600, extraArgs = [], onError = (m) => console.error('  page:', m), gpu = false, perf = false, life = LIFE_DEFAULT, wait = 10 * 60_000, storage = null } = {}) {
  const plan = perfPlan({ perf, gpu, life, width, height, extraArgs });
  if (process.env.STN_NO_BROWSER === '1') throw new Error('launchChrome: STN_NO_BROWSER=1 is set - no browser may be started on this machine now');
  if (current) throw new Error('launchChrome: this process already has a browser open (one at a time: close it first, or use newPage({ window: true }))');
  ({ life, width, height } = plan);
  if (perf) console.error(`launchChrome: an UNCAPPED frame-rate measurement is running on the real GPU (${width} x ${height}, vsync and the frame limit off, ${Math.round(life / 1000)} s at the most): the machine will be sluggish until it closes`);
  const badBefore = badPasswordAttempts();
  guardBefore(badBefore);
  hookExit();
  sweepChromes();
  await takeLock(wait);
  let profile = '';
  // software rendering unless asked for the real GPU (ANGLE=swiftshader in the environment still forces software)
  const angle = gpu && process.env.ANGLE !== 'swiftshader' ? (process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : 'swiftshader') : 'swiftshader';
  let browser = null, pid = 0, dog = null, timer = null, closed = false, rose = null;
  const killNow = () => {
    // (synchronous: what an exit handler can still do)
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    killTree(pid);
    try {
      if (profile) rmSync(profile, { recursive: true, force: true });
    } catch {}
    if (pid) rose = guardAfter(badBefore, badPasswordAttempts()); // (the marker file is written here, even on the way out)
    try {
      if (dog) dog.kill();
    } catch {}
    dropLock();
    current = null;
  };
  const close = async () => {
    if (closed) return;
    if (browser) await Promise.race([browser.close().catch(() => {}), sleep(5000)]);
    killNow();
    for (let i = 0; i < 5 && profile && existsSync(profile); i++) {
      await sleep(300);
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {}
    }
    if (rose) {
      const msg = rose;
      rose = null;
      throw new Error(msg);
    }
  };
  try {
    // a new, empty profile of its own every time, never the user's (nor a copy of it): the answer to "is the OS
    // password blank" already in it (no Windows sign-in to find out), the password manager and every credential
    // prompt switched off, all before Chrome first reads it. If these cannot be written there is no launch.
    profile = mkdtempSync(join(tmpdir(), 'stn-chrome-'));
    writeFileSync(join(profile, 'Local State'), LOCAL_STATE_SEED);
    mkdirSync(join(profile, 'Default'), { recursive: true });
    writeFileSync(join(profile, 'Default', 'Preferences'), JSON.stringify(SAFE_PREFS));
    if (readFileSync(join(profile, 'Local State'), 'utf8') !== LOCAL_STATE_SEED) throw new Error('launchChrome: the profile was not seeded');
    browser = await puppeteer.launch({
      executablePath: chromePath(),
      headless: 'new',
      userDataDir: profile,
      defaultViewport: { width, height, deviceScaleFactor: 1 },
      args: ['--window-position=-32000,-32000', `--window-size=${width},${height}`, '--mute-audio', `--use-angle=${angle}`, '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files', '--force-device-scale-factor=1', ...NO_CREDENTIALS, ...plan.args, ...extraArgs],
    });
    pid = browser.process()?.pid || 0;
    current = { killNow };
    dog = startWatchdog(pid, profile, life);
    timer = setTimeout(() => {
      console.error(`launchChrome: the browser outlived its ${Math.round(life / 1000)} s and was killed`);
      killNow();
    }, life);
    timer.unref?.();
    lowerChrome(profile);
    const setUp = async (page) => {
      await page.evaluateOnNewDocument(SAFE_STUBS);
      if (storage)
        await page.evaluateOnNewDocument((kv) => {
          try {
            for (const k in kv) if (localStorage.getItem(k) === null) localStorage.setItem(k, kv[k]);
          } catch {}
        }, storage);
      await page.setViewport({ width, height, deviceScaleFactor: 1 });
      page.on('pageerror', (e) => onError(e.message));
      // no going on with, and no picture of, a page that could take the screen or the keyboard
      const go = page.goto.bind(page);
      page.goto = async (...a) => {
        const r = await go(...a);
        if (page.url() && !/^(about:|chrome:)/.test(page.url())) await pageIsSafe(page);
        return r;
      };
      const shot = page.screenshot.bind(page);
      page.screenshot = async (o) => {
        if (page.url() && !/^(about:|chrome:)/.test(page.url())) await pageIsSafe(page);
        return shot(o);
      };
      return page;
    };
    const newPage = async ({ window = false } = {}) => {
      if (!window) return setUp(await browser.newPage());
      // a window of its own: a page behind another tab stops drawing, one in its own window does not
      const known = new Set(browser.targets());
      const cdp = await browser.target().createCDPSession();
      await cdp.send('Target.createTarget', { url: 'about:blank', newWindow: true, background: true, width, height, left: -32000, top: -32000 });
      await cdp.detach().catch(() => {});
      const target = await browser.waitForTarget((t) => t.type() === 'page' && !known.has(t));
      return setUp(await target.page());
    };
    const page = await setUp((await browser.pages())[0] || (await browser.newPage()));
    await page.goto('data:text/html,<title>stn</title>'); // (the self-check: the stubs are in a page of this browser, or there is no browser)
    return { browser, page, newPage, close, angle, pid, profile, born: Date.now(), life, badBefore, perf: !!perf };
  } catch (e) {
    await close().catch((e2) => console.error(e2.message));
    throw e;
  }
}

/**
 * For a long job (a survey of hundreds of frames): the browser to go on with - the one in hand while it has most of
 * its lifetime left, else a new one in its place (the watchdog would kill the old one mid-frame). chrome: null to start.
 */
export async function renewChrome(chrome, opts = {}) {
  if (chrome && Date.now() - chrome.born < chrome.life * 0.6) return chrome;
  if (chrome) await chrome.close();
  return launchChrome(opts);
}

/** Load a URL, wait, optionally evaluate something (its JSON result is returned), screenshot to file (if given). */
export async function shoot(page, url, { file = null, w = 900, h = 600, wait = 500, evaluate = null } = {}) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  // (Vite reloads the page when it first meets a dependency to optimise, which aborts that load: try again)
  for (let i = 0; ; i++) {
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 60000 });
      break;
    } catch (e) {
      if (i >= 3) throw e;
      await sleep(1500);
    }
  }
  await sleep(wait);
  let result;
  if (evaluate) {
    try {
      result = await page.evaluate(evaluate);
    } catch (e) {
      result = { error: e.message };
    }
  }
  if (file) await page.screenshot({ path: file });
  return result;
}

// ---------------------------------------------------------------- image sheets
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
/**
 * Compose labelled image grids, each to its own PNG. sheets: [{ out, title?, cols, cellW, cellH?, cells: [{ img (a path),
 * label, tag? ('before' | 'after': a coloured badge) }] }]. Uses a page of an already open browser.
 */
export async function composeSheets(page, sheets) {
  const work = mkdtempSync(join(tmpdir(), 'stn-sheet-'));
  try {
    for (const s of sheets) {
      const cellH = s.cellH || Math.round((s.cellW * 2) / 3);
      const rows = Math.ceil(s.cells.length / s.cols);
      const head = s.title ? 44 : 0;
      const W = s.cols * s.cellW + (s.cols + 1) * 8, H = head + rows * (cellH + 30) + (rows + 1) * 8;
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>
        body{margin:0;background:#15171b;font:600 15px system-ui,Segoe UI,sans-serif;color:#e8e6e1}
        h1{margin:0;padding:10px 12px 0;font-size:19px;height:${head - 10}px;box-sizing:border-box}
        .g{display:grid;grid-template-columns:repeat(${s.cols},${s.cellW}px);gap:8px;padding:8px}
        .c{background:#0c0d10;border-radius:4px;overflow:hidden}
        .c img{display:block;width:${s.cellW}px;height:${cellH}px;object-fit:cover}
        .l{height:30px;line-height:30px;padding:0 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .t{display:inline-block;padding:0 7px;margin-right:8px;border-radius:3px;font-size:13px;line-height:20px}
        .before{background:#7a2b26}.after{background:#2b6a34}
      </style></head><body>${s.title ? `<h1>${esc(s.title)}</h1>` : ''}<div class="g">${s.cells
        .map((c) => `<div class="c"><img src="${pathToFileURL(resolve(c.img)).href}"><div class="l">${c.tag ? `<span class="t ${esc(c.tag)}">${esc(c.tag)}</span>` : ''}${esc(c.label || '')}</div></div>`)
        .join('')}</div></body></html>`;
      const f = join(work, 'sheet.html');
      writeFileSync(f, html);
      mkdirSync(dirname(resolve(s.out)), { recursive: true });
      await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
      await page.goto(pathToFileURL(f).href, { waitUntil: 'load' });
      await page.screenshot({ path: s.out, fullPage: true });
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- another tree to compare against
/**
 * Make `tree` able to run this tree's sandbox measurements: the clip check (&clip=1), the third-person sandbox (?hold=)
 * and the camera helpers live in client/sandbox/, and a tree from before they existed has older copies. Copies ours over
 * theirs and returns a function that puts theirs back (call it in a finally). Only the sandbox files are touched.
 */
export function lendSandbox(tree) {
  const files = ['models-vm.js', 'models-hold.js', 'models-test.js', 'models-turn.js'];
  const saved = [];
  for (const f of files) {
    const theirs = join(tree, 'client', 'sandbox', f);
    saved.push([theirs, existsSync(theirs) ? readFileSync(theirs) : null]);
    copyFileSync(join(REPO, 'client', 'sandbox', f), theirs);
  }
  return () => {
    for (const [p, data] of saved) {
      try {
        if (data) writeFileSync(p, data);
        else rmSync(p, { force: true });
      } catch {}
    }
  };
}

/**
 * A worktree of a git ref (default origin/main) in the system temp folder, with node_modules: linked to ours when the
 * package-lock.json is the same, installed otherwise. Returns { dir, remove }. Call remove() in a finally.
 */
export function tempWorktree(ref = 'origin/main') {
  const dir = mkdtempSync(join(tmpdir(), 'stn-before-'));
  rmSync(dir, { recursive: true, force: true });
  execFileSync('git', ['worktree', 'add', '--detach', dir, ref], { cwd: REPO, stdio: 'ignore' });
  const remove = () => {
    // the link to our node_modules goes first, on its own: nothing that removes the worktree may follow it into ours
    const nm = join(dir, 'node_modules');
    try {
      if (lstatSync(nm).isSymbolicLink()) {
        try {
          unlinkSync(nm);
        } catch {
          rmdirSync(nm);
        }
      }
    } catch {}
    try {
      execFileSync('git', ['worktree', 'remove', '--force', dir], { cwd: REPO, stdio: 'ignore' });
    } catch {}
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
    try {
      execFileSync('git', ['worktree', 'prune'], { cwd: REPO, stdio: 'ignore' });
    } catch {}
  };
  try {
    const same = readFileSync(join(dir, 'package-lock.json'), 'utf8') === readFileSync(join(REPO, 'package-lock.json'), 'utf8');
    if (same) execFileSync(process.platform === 'win32' ? 'cmd' : 'ln', process.platform === 'win32' ? ['/c', 'mklink', '/J', join(dir, 'node_modules'), join(REPO, 'node_modules')] : ['-s', join(REPO, 'node_modules'), join(dir, 'node_modules')], { stdio: 'ignore' });
    else execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'ignore', shell: process.platform === 'win32' });
  } catch (e) {
    remove();
    throw e;
  }
  return { dir, remove };
}
