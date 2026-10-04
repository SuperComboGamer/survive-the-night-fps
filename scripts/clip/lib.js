// Shared plumbing for the clip-checking tools (scripts/clip/*.js): arguments, a dev server or a game server of their
// own, headless Chrome that keeps out of the way of whoever is using the machine, and labelled image sheets.
// See docs/object-clipping.md.
//
// Headless rules (these tools run on machines people are working at): Chrome is started headless ('new'), off screen,
// muted, with a fresh throwaway profile (a stn-chrome-* directory in the system temp folder, deleted afterwards), and
// pointer lock is stubbed out in every page. Every browser and every server a tool starts is stopped in a finally,
// whatever happens.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync, copyFileSync, lstatSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

/**
 * The Vite dev server for a tree (its vite.config.js serves client/, so the sandboxes are at /sandbox/...).
 * Returns { url, stop }.
 */
export async function startVite(root = REPO) {
  const port = await freePort(5190, 5299);
  const bin = join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!existsSync(bin)) throw new Error(`${root} has no node_modules (npm install there first)`);
  const child = spawn(process.execPath, [bin, '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await waitFor(child, /Local:|ready in/, `vite in ${root}`);
  } catch (e) {
    stopProcess(child);
    throw e;
  }
  return { url: `http://localhost:${port}`, stop: () => stopProcess(child) };
}

/**
 * The real game: node server/index.js serving the tree's dist/ (built first if there is none, or with build: true),
 * NODE_ENV=production, an admin secret for the chat commands (/give, /tp, ...), godmode, a fixed seed and a long day.
 * Returns { url, secret, stop }.
 */
export async function startGame(root = REPO, { seed = 1, build = false, env = {} } = {}) {
  if (build || !existsSync(join(root, 'dist', 'index.html'))) execFileSync(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { cwd: root, stdio: 'ignore' });
  const port = await freePort(3500, 3599);
  const secret = 'clip' + Math.random().toString(36).slice(2, 10);
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), NODE_ENV: 'production', ADMIN_SECRET: secret, GODMODE: '1', SEED: String(seed), START_DAY: '1', DAY_SECONDS: '3000', DATABASE_URL: '', DEBUG_COMMANDS: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitFor(child, /listening|serving \d+ static/i, `game server in ${root}`);
  } catch (e) {
    stopProcess(child);
    throw e;
  }
  await sleep(400);
  return { url: `http://localhost:${port}`, secret, stop: () => stopProcess(child) };
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

/**
 * Launch an isolated headless Chrome. ANGLE: d3d11 on Windows, metal on a Mac (ANGLE=swiftshader to force software).
 * Returns { browser, page (a first page, set up), newPage(), close() }. Call close() in a finally.
 */
export async function launchChrome({ width = 900, height = 600, extraArgs = [], onError = (m) => console.error('  page:', m) } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'stn-chrome-'));
  const angle = process.env.ANGLE || (process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : 'swiftshader');
  let browser = null;
  const close = async () => {
    if (browser) await browser.close().catch(() => {});
    browser = null;
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {}
  };
  try {
    browser = await puppeteer.launch({
      executablePath: chromePath(),
      headless: 'new',
      userDataDir: profile,
      args: ['--window-position=-32000,-32000', '--mute-audio', `--use-angle=${angle}`, '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files', ...extraArgs],
    });
    const newPage = async () => {
      const page = await browser.newPage();
      await page.evaluateOnNewDocument(() => {
        Element.prototype.requestPointerLock = function () {};
      });
      await page.setViewport({ width, height, deviceScaleFactor: 1 });
      page.on('pageerror', (e) => onError(e.message));
      return page;
    };
    const page = await newPage();
    return { browser, page, newPage, close };
  } catch (e) {
    await close();
    throw e;
  }
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
  const files = ['models-vm.js', 'models-hold.js', 'models-test.js'];
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
