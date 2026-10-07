// What a server does as it starts costs no more than it did before deploys kept games (docs/deploys.md):
//   - the client's files go out compressed as the build wrote them (vite.config.js precompress: name.br, name.gz beside
//     each), brotli or gzip as the browser takes it, the file as it is otherwise - nothing compressed as it starts
//   - no build is packed when nothing could use it (pinning off: no HANDOFF_BUILD_KEY), and when pinning is on, not on
//     the way up: once it listens, or - told to stop before it got to it (HANDOFF_PACK_AFTER_MS puts it off here) - before
//     the saves of its games, which name it, so that it is in the store for the next server
// Needs a built client (npm run build). (Linux: a server is stopped with SIGTERM. Windows: with the 'shutdown' message.)
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { Connection } from '../client/net/connection.js';

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : detail}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000) => {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(20)) if (await fn()) return true;
  return false;
};
const DIST = new URL('../dist/', import.meta.url);
if (!existsSync(new URL('index.html', DIST))) {
  console.log('SKIP  no built client in dist/ - run `npm run build` first');
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), 'stn-static-start-'));
const base = 46200 + Math.floor(Math.random() * 600);
const procs = [];
function server(name, port, env = {}) {
  const proc = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, DATABASE_URL: '', PORT: String(port), STATS_FILE: join(dir, `stats-${name}.json`), HANDOFF_DIR: join(dir, `handoff-${name}`), HANDOFF_BUILD_KEY: '', HANDOFF_PIN: '1', HANDOFF_PREPARE_MS: '0', LOBBY_LIMITS: '0', TMPDIR: dir, TEMP: dir, TMP: dir, ...env },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const s = { name, port, proc, log: '', exit: null, dir: join(dir, `handoff-${name}`) };
  proc.stdout.on('data', (d) => (s.log += d));
  proc.stderr.on('data', (d) => (s.log += d));
  proc.on('exit', (code) => (s.exit = { code }));
  procs.push(s);
  return s;
}
const stop = (s) => (process.platform === 'win32' ? s.proc.send({ t: 'shutdown' }) : s.proc.kill('SIGTERM'));
const up = (s) => until(() => s.log.includes('listening'), 30000);
// a request as a browser makes it, the body as it came over the wire (fetch would take the encoding off)
const get = (port, path, enc) =>
  new Promise((done, fail) =>
    request({ host: 'localhost', port, path, agent: false, headers: { 'accept-encoding': enc } }, (res) => {
      const parts = [];
      res.on('data', (d) => parts.push(d));
      res.on('end', () => done({ status: res.statusCode, enc: res.headers['content-encoding'] || '', vary: res.headers.vary || '', body: Buffer.concat(parts) }));
    })
      .on('error', fail)
      .end()
  );
const builds = (s) => (existsSync(`${s.dir}-builds`) ? readdirSync(`${s.dir}-builds`).filter((f) => f.endsWith('.json')) : []);

try {
  // ---------------------------------------------------------------- pinning off (no key): nothing packed
  const A = server('A', base);
  check('a server with a handoff store and no HANDOFF_BUILD_KEY is up', await up(A), A.log);
  const page = (await get(A.port, '/', 'identity')).body.toString();
  const bundle = /src="(\/assets\/index-[^"]+\.js)"/.exec(page)?.[1];
  const plain = bundle && readFileSync(new URL(`.${bundle}`, DIST));
  check('the built client has its bundle written compressed beside it, brotli and gzip', bundle && existsSync(new URL(`.${bundle}.br`, DIST)) && existsSync(new URL(`.${bundle}.gz`, DIST)), `${bundle}: run npm run build`);
  const br = await get(A.port, bundle, 'gzip, deflate, br, zstd');
  check('a browser that takes brotli gets the brotli the build wrote, the same file underneath', br.status === 200 && br.enc === 'br' && /Accept-Encoding/i.test(br.vary) && br.body.equals(readFileSync(new URL(`.${bundle}.br`, DIST))) && brotliDecompressSync(br.body).equals(plain), JSON.stringify({ status: br.status, enc: br.enc, bytes: br.body.length }));
  const gz = await get(A.port, bundle, 'gzip, deflate');
  check('...one that takes gzip alone, the gzip', gz.enc === 'gzip' && gz.body.equals(readFileSync(new URL(`.${bundle}.gz`, DIST))) && gunzipSync(gz.body).equals(plain), JSON.stringify({ enc: gz.enc, bytes: gz.body.length }));
  const id = await get(A.port, bundle, 'identity');
  check('...and one that takes neither, the file as it is', id.enc === '' && id.body.equals(plain));
  const again = await get(A.port, bundle, 'br');
  check('...the same again (read from disk once, then kept)', again.enc === 'br' && again.body.equals(br.body));
  const pageBr = await get(A.port, '/', 'br');
  const pageGz = await get(A.port, '/', 'gzip');
  check('the page is stamped with what it was built as, and goes out compressed too', pageBr.enc === 'br' && brotliDecompressSync(pageBr.body).toString() === page && pageGz.enc === 'gzip' && gunzipSync(pageGz.body).toString() === page && page.includes('<meta name="stn-build"'), JSON.stringify({ br: pageBr.enc, gz: pageGz.enc }));
  const png = readdirSync(new URL('./', DIST)).find((f) => f.endsWith('.png'));
  if (png) {
    const img = await get(A.port, `/${png}`, 'br, gzip');
    check('an image (compressed already, nothing written beside it) goes as it is', img.status === 200 && img.enc === '' && img.body.equals(readFileSync(new URL(png, DIST))));
  }
  check('the compressed copies are not files of their own', (await get(A.port, `${bundle}.br`, 'identity')).status === 404);
  await sleep(1000);
  check('...and it packs no build: nothing could use it', !/this build is|is in the store/.test(A.log) && builds(A).length === 0, A.log.split('\n').filter((l) => /build/.test(l)).join('\n'));
  stop(A);
  await until(() => A.exit);

  // ---------------------------------------------------------------- pinning on: after it listens, or before its saves
  const B = server('B', base + 1, { HANDOFF_PIN: 'unsigned', HANDOFF_PACK_AFTER_MS: '60000' });
  check('a server that keeps its build (HANDOFF_PIN=unsigned) is up, its build not packed on the way up', (await up(B)) && !/this build is/.test(B.log), B.log);
  globalThis.location = { protocol: 'http:', host: `localhost:${B.port}` };
  const made = await (await fetch(`http://localhost:${B.port}/api/games`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Start', inviteOnly: true }) })).json();
  const conn = new Connection({});
  const warn = console.warn;
  console.warn = () => {};
  const joined = await conn.connect('Ann', randomUUID(), made.code).then(
    () => true,
    (e) => e
  );
  check('...a player is in a game on it', joined === true, String(joined));
  stop(B); // (told to stop before its build was packed: HANDOFF_PACK_AFTER_MS)
  await until(() => B.exit, 20000);
  console.warn = warn;
  conn.close(4001);
  const at = (re) => B.log.search(re);
  const own = /this build is ([0-9a-f]{24})/.exec(B.log)?.[1];
  const save = existsSync(join(B.dir, `${made.code}.json`)) ? JSON.parse(readFileSync(join(B.dir, `${made.code}.json`), 'utf8')) : null;
  check('told to stop before it packed its build, it packs it then, before the save', B.exit?.code === 0 && own && at(/listening/) < at(/this build is/) && at(/is in the store/) < at(/handed over in/) && /1 game\(s\) handed over/.test(B.log), B.log.split('\n').slice(-12).join('\n'));
  check("...and the game's save names it, and it is in the store for the next server", save?.meta?.build === own && builds(B).includes(`${own}.json`), JSON.stringify({ own, meta: save?.meta?.build, builds: builds(B) }));

  const C = server('C', base + 2, { HANDOFF_PIN: 'unsigned', HANDOFF_PACK_AFTER_MS: '' });
  check('a server that keeps its build, left alone, is up first', await up(C), C.log);
  check('...and packs it and puts it in the store once it listens', (await until(() => /is in the store/.test(C.log), 15000)) && C.log.indexOf('listening') < C.log.indexOf('this build is') && builds(C).length === 1, C.log.split('\n').slice(-6).join('\n'));
  stop(C);
  await until(() => C.exit);
} catch (e) {
  check('no error', false, String(e && e.stack));
}
for (const p of procs) if (!p.exit) p.proc.kill('SIGKILL');
await until(() => procs.every((s) => s.exit), 5000);
check('every server is stopped', procs.every((s) => s.exit));
if (failed) for (const s of procs) console.log(`\n--- ${s.name} ---\n${s.log.split('\n').slice(-25).join('\n')}`);
console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
