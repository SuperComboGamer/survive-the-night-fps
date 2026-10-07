// What a deploy does to a page that is playing (client/net/moveback.js, server/index.js /api/version and the build
// written into the page), with the client's own Connection against real servers behind a stand-in for the edge.
//   - the rules alone: the page goes back in as it is unless the protocol or the code both ends run (compat) changed;
//     a client-only change is loaded later; when to give up on a game (an update ended it: at once; no such game: three
//     answers over 20 s, as the game may still be on the server before)
//   - deploys one after another, the players playing all the while:
//       a deploy of the server alone: every page goes back in place, no reload, within half a second
//       a deploy of a new client alone: back in place too, told a newer client is ready (loaded when they leave)
//       a deploy that changes shared code: the pages reload once, and go back into the same bodies
//   - the page each server serves says what it was built as; the bundle goes out compressed
// (Linux: a server is stopped with SIGTERM, as the host does. Windows: with the 'shutdown' message, as pm2 does.)
import { spawn } from 'node:child_process';
import { get as httpGet } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createServer, connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { C2S, PROTOCOL_VERSION, REJECT_REASON, MOVED_CODE, Writer, writeInput } from '../shared/protocol.js';
import { moveBack, verdictFor, joinVerdict, pageBuild, NO_GAME_MS, mayReload, reloadedInto, RELOAD_MAX, RELOAD_MS, RELOAD_LOOP_TEXT } from '../client/net/moveback.js';
import { compatOf, CODEC_FILES } from '../server/compat.js';
import { Connection } from '../client/net/connection.js';
import { comeBack } from '../client/net/comeback.js';

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

// ---------------------------------------------------------------- the rules alone
const P = PROTOCOL_VERSION;
const page = { protocol: P, build: 'b1', compat: 'c1' };
check('the same server code, the same client: in place', verdictFor(page, { protocol: P, build: 'b1', compat: 'c1' }) === '');
check('a new client alone: in place, and the new one is loaded later', verdictFor(page, { protocol: P, build: 'b2', compat: 'c1' }) === 'update');
check('the code both ends run changed: the page is loaded again', verdictFor(page, { protocol: P, build: 'b2', compat: 'c2' }) === 'reload');
check('another protocol: the page is loaded again', verdictFor(page, { protocol: P + 1, build: 'b1', compat: 'c1' }) === 'reload');
check('a server from before compat is held to the build, as before', verdictFor(page, { protocol: P, build: 'b2' }) === 'reload' && verdictFor(page, { protocol: P, build: 'b1' }) === '');
check('not reached: nothing decided', verdictFor(page, null) === '');
const doc = { querySelector: (s) => (s === 'meta[name="stn-build"]' ? { getAttribute: () => `abc123 def456 ${P}` } : null) };
check('the page reads what it was built as from itself', JSON.stringify(pageBuild(doc)) === JSON.stringify({ build: 'abc123', compat: 'def456', protocol: P }) && pageBuild({ querySelector: () => null }) === null);

// joining from the splash: a newer client of the same compat is loaded first too (this page's own files may be gone)
check('from the splash, a newer client of the same compat is loaded before joining; the same one is not', joinVerdict(page, { protocol: P, build: 'b2', compat: 'c1' }) === 'reload' && joinVerdict(page, { protocol: P, build: 'b1', compat: 'c1' }) === '' && joinVerdict(page, { protocol: P, build: 'b2', compat: 'c2' }) === 'reload');
// a page is not loaded again for one game for ever (a server that keeps saying it has to be)
{
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const t = 1_000_000;
  const tries = Array.from({ length: RELOAD_MAX + 2 }, (_, i) => mayReload(storage, 'LOOPED', t + i * 1000));
  check(`a page is loaded again for a game ${RELOAD_MAX} times at most in a while, then not: it says why instead`, tries.slice(0, RELOAD_MAX).every(Boolean) && !tries[RELOAD_MAX] && !tries[RELOAD_MAX + 1] && /keeps asking/.test(RELOAD_LOOP_TEXT), JSON.stringify(tries));
  check('...the count is per game, and wears off', mayReload(storage, 'OTHER', t) && mayReload(storage, 'LOOPED', t + RELOAD_MS + 1));
  reloadedInto(storage, 'OTHER');
  check('...and starts again once the page is in the game', !mem.has('stn.reloads.OTHER'));
  check('...(a browser without sessionStorage reloads as before)', mayReload(null, 'LOOPED'));
}
// compat: shared/, the protocol, and the wire codec outside shared/ - not the rest of the server or the client
{
  const tree = mkdtempSync(join(tmpdir(), 'stn-compat-'));
  for (const f of ['shared/a.js', ...CODEC_FILES, 'server/game.js', 'client/game/game.js']) {
    mkdirSync(join(tree, dirname(f)), { recursive: true });
    writeFileSync(join(tree, f), `// ${f}\n`);
  }
  const was = compatOf(tree, P);
  const changed = (f) => {
    const before = readFileSync(join(tree, f));
    writeFileSync(join(tree, f), `${before}// changed\n`);
    const c = compatOf(tree, P);
    writeFileSync(join(tree, f), before);
    return c !== was;
  };
  check('compat changes with shared/, with the protocol, and with each codec file outside shared/ (snapshot.js, decode.js, connection.js)', changed('shared/a.js') && compatOf(tree, P + 1) !== was && CODEC_FILES.every(changed), CODEC_FILES.join(' '));
  check("...and not with the rest of the server's code or the client's (those deploys go back in place)", !changed('server/game.js') && !changed('client/game/game.js') && compatOf(tree, P) === was);
  check('...the real codec files are where compat looks for them', CODEC_FILES.every((f) => existsSync(new URL(`../${f}`, import.meta.url))));
}

// a clock that runs as fast as it is slept
const fake = () => {
  let t = 0;
  return { now: () => t, sleep: async (ms) => void (t += ms) };
};
const answer = (reason) => Object.assign(new Error(`rejected ${reason}`), { reason });
{
  const c = fake();
  const asked = [];
  const r = await moveBack({ code: 'ABCDEF', loadedFrom: page, ...c, version: async (code) => (asked.push(code), page), join: async () => (asked.length < 4 ? answer(REJECT_REASON.FULL) : true) });
  check('turned away by the old server (still answering, going down): tried again quickly, then in place', r.verdict === 'in place' && !r.update && c.now() < 1000 && asked.every((x) => x === 'ABCDEF'), JSON.stringify({ r, t: c.now(), asked }));
}
{
  const c = fake();
  let n = 0;
  const r = await moveBack({ code: 'ABCDEF', loadedFrom: page, ...c, version: async () => page, join: async () => (++n < 5 ? answer(REJECT_REASON.NO_GAME) : true) });
  check('no such game a few times (the game still on the server before): not given up, and in place once it is there', r.verdict === 'in place' && n === 5, JSON.stringify({ r, n }));
}
{
  const c = fake();
  let n = 0;
  const r = await moveBack({ code: 'ABCDEF', loadedFrom: page, ...c, version: async () => page, join: async () => (n++, answer(REJECT_REASON.NO_GAME)) });
  check('...but given up after three answers over 20 s, and not before', r.verdict === 'gave up' && c.now() >= NO_GAME_MS && n >= 3 && /could not be brought back/.test(r.message), JSON.stringify({ r, t: c.now(), n }));
}
{
  const c = fake();
  const r = await moveBack({ code: 'ABCDEF', loadedFrom: page, ...c, version: async () => page, join: async () => answer(REJECT_REASON.ENDED_MAP) });
  check('an update ended it: over at once, and why', r.verdict === 'ended' && c.now() === 0 && /rejected/.test(r.message), JSON.stringify(r));
}
{
  const c = fake();
  const r = await moveBack({ code: 'ABCDEF', loadedFrom: page, ...c, version: async () => page, join: async () => answer(REJECT_REASON.VERSION) });
  check('the server says this page is of another version: loaded again', r.verdict === 'reload', JSON.stringify(r));
}
{
  const c = fake();
  let left = false;
  const r = await moveBack({ code: 'ABCDEF', loadedFrom: page, ...c, still: () => !left, version: async () => null, join: async () => true });
  check('the server not reached: asked again, never joined blind', r.verdict === 'gave up', JSON.stringify(r));
  left = true;
  const r2 = await moveBack({ code: 'ABCDEF', loadedFrom: page, ...c, still: () => !left, version: async () => page, join: async () => true });
  check('the player left meanwhile: nothing more is done', r2.verdict === 'left');
}

// ---------------------------------------------------------------- deploys, one after another
const dir = mkdtempSync(join(tmpdir(), 'stn-deploys-'));
const base = 47000 + Math.floor(Math.random() * 800);
let live = base + 1;
const edge = createServer((sock) => {
  const up = connect(live, '127.0.0.1');
  sock.pipe(up).pipe(sock);
  // (an end is passed on by the pipes once what was in flight has gone: a close frame is not cut off. Only an
  // error tears both down)
  const end = () => (sock.destroy(), up.destroy());
  sock.on('error', end);
  up.on('error', end);
});
await new Promise((r) => edge.listen(base, r));
const EDGE = `localhost:${base}`;
globalThis.location = { protocol: 'http:', host: EDGE };
// (no keep-alive: Node's fetch would pool the connection, and the stand-in edge binds a connection to the server that
// was live when it opened - a WebSocket sent down it would reach the old server. A browser opens a new connection for
// a WebSocket, and a real edge routes each request.)
const getText = (url) =>
  new Promise((done) => {
    const req = httpGet(url, { agent: false, timeout: 2000 }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => done(res.statusCode === 200 ? body : null));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => done(null));
  });
const getJson = async (url) => {
  try {
    return JSON.parse(await getText(url));
  } catch {
    return null;
  }
};
const procs = [];
function server(name, port, env = {}) {
  const proc = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, DATABASE_URL: '', PORT: String(port), STATS_FILE: join(dir, `stats-${name}.json`), HANDOFF_DIR: join(dir, 'handoff'), GODMODE: '1', DAY_SECONDS: '600', LOBBY_LIMITS: '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const s = { name, port, proc, log: '', exit: null };
  proc.stdout.on('data', (d) => (s.log += d));
  proc.stderr.on('data', (d) => (s.log += d));
  proc.on('exit', (code) => (s.exit = { code }));
  procs.push(s);
  return s;
}
const stop = (s) => (process.platform === 'win32' ? s.proc.send({ t: 'shutdown' }) : s.proc.kill('SIGTERM'));
const up = (s) => until(() => s.log.includes('listening'), 30000);
const version = (code) => getJson(`http://${EDGE}/api/version${code ? `?game=${code}` : ""}`);

// a page that plays: the client's Connection, commands every tick, and moved, moveBack as main.js runs it
function player(name) {
  const p = { name, pid: randomUUID(), id: 0, conn: null, from: null, moves: [], seq: 0, errs: [] };
  p.join = (code) => {
    const conn = new Connection({ close: (c) => c === MOVED_CODE && p.moved(code) });
    p.conn = conn;
    return conn.connect(name, p.pid, code).then(
      (info) => {
        p.id = info.id;
        p.welcomed = conn; // (in the game: WELCOME on this socket - open and ROOM come before the game answers)
        p.seed = info.seed;
        clearInterval(p.timer);
        p.timer = setInterval(() => conn.sendInput(0, 0, [{ seq: (p.seq = (p.seq + 1) & 0xffff), buttons: 0, qyaw: 0, qpitch: 0, slot: 255 }], -1), 50);
        return true;
      },
      (err) => (p.errs.push(`${Math.round(performance.now())} ${err.reason ?? ''} ${err.message}`), err)
    );
  };
  p.moved = async (code) => {
    clearInterval(p.timer);
    const t0 = performance.now();
    const r = await moveBack({ code, loadedFrom: p.from, version, join: () => p.join(code) });
    const m = { ...r, ms: Math.round(performance.now() - t0), id: p.id };
    if (r.verdict === 'reload') {
      m.reload = await p.reload(code);
      m.idAfter = p.id;
    }
    p.moves.push(m);
  };
  // a page loaded again for a deploy, as main.js has it: it loads (reloadMs), it was built as whichever server served it,
  // and goes back in as a reopened page does (comeBack, moved), asking before each try whether it can play the game
  // (canJoinHere) - a page a server going down served is loaded again
  p.reloadMs = 0;
  p.reload = async (code) => {
    let loads = 0;
    const load = async () => {
      loads++;
      await sleep(p.reloadMs);
      for (let i = 0; i < 40 && !(p.from = pageOf(await getText(`http://${EDGE}/?game=${code}`))); i++) await sleep(100);
    };
    await load();
    const why = await comeBack({
      code,
      moved: true,
      ms: 60_000,
      join: async () => {
        let v = null;
        for (let i = 0; i < 20 && !v; i++) if (!(v = await version(code))) await sleep(250);
        if (verdictFor(p.from, v) === 'reload') return void (await load());
        return p.join(code);
      },
    });
    return { loads, why };
  };
  return p;
}
const pageOf = (html) => {
  const m = /<meta name="stn-build" content="([^"]*)">/.exec(html)?.[1];
  return m ? pageBuild({ querySelector: () => ({ getAttribute: () => m }) }) : null;
};

try {
  let cur = server('S0', base + 1);
  check('the first server is up', await up(cur), cur.log);
  const html = await fetch(`http://${EDGE}/`, { headers: { 'accept-encoding': 'identity' } });
  const built = pageOf(await html.text());
  const v0 = await version();
  check('the page it serves says what it was built as: the build, the compat and the protocol that /api/version gives', built && built.build === v0.build && built.compat === v0.compat && built.protocol === P && /^[0-9a-f]{12}$/.test(v0.compat), JSON.stringify({ built, v0 }));
  const gz = await fetch(`http://${EDGE}/`, { headers: { 'accept-encoding': 'gzip' } });
  // (fetch takes the encoding off itself)
  check('...and goes out compressed to a browser that takes it', gz.headers.get('content-encoding') === 'gzip' && (await gz.text()).includes('stn-build'), gz.headers.get('content-encoding'));
  const made = await (await fetch(`http://${EDGE}/api/games`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Deploys', inviteOnly: true, maxPlayers: 6 }) })).json();
  const code = made.code;
  const players = [player('Ann'), player('Ben'), player('Cy')];
  for (const p of players) {
    p.from = built;
    check(`${p.name} is in the game`, (await p.join(code)) === true);
  }
  const ids = players.map((p) => p.id);
  const errs = () => JSON.stringify(players.map((p) => p.errs.splice(0).slice(-8)));
  await sleep(1500);

  const deploy = async (name, env, what) => {
    const next = server(name, cur.port + 1, env);
    check(`${what}: server ${name} is up`, await up(next), next.log);
    live = next.port;
    for (const p of players) p.moves.length = 0;
    stop(cur);
    const back = await until(() => players.every((p) => p.moves.length), 30000);
    await until(() => cur.exit, 15000);
    cur = next;
    return back;
  };

  // a deploy of the server alone
  await deploy('S1', {}, 'a deploy of the server alone');
  const m1 = players.map((p) => p.moves[0]);
  check('...every page goes back in place, into its own body: no reload', m1.every((m, i) => m?.verdict === 'in place' && !m.update && m.id === ids[i]), JSON.stringify(m1) + errs());
  // (tens of ms on the development PC: the bound leaves a slow machine room, and is still well under a reload's seconds)
  check(`...within moments of its socket closing (${m1.map((m) => m?.ms).join(', ')} ms)`, m1.every((m) => m?.ms < 1500), JSON.stringify(m1));
  await sleep(1000);

  // a deploy of a new client alone (the same shared code)
  await deploy('S2', { CLIENT_BUILD: 'newclient' }, 'a deploy of a new client alone');
  const m2 = players.map((p) => p.moves[0]);
  check('...the pages still go back in place, and hear that a newer client is ready', m2.every((m, i) => m?.verdict === 'in place' && m.update && m.id === ids[i]), JSON.stringify(m2));
  check(`...as quickly (${m2.map((m) => m?.ms).join(', ')} ms)`, m2.every((m) => m?.ms < 1500), errs());
  await sleep(1000);

  // a deploy that changes the code both ends run
  await deploy('S3', { CLIENT_BUILD: 'newclient2', CLIENT_COMPAT: 'othercompat1' }, 'a deploy that changes shared code');
  const m3 = players.map((p) => p.moves[0]);
  check('...every page reloads, once, and goes back into its own body', m3.every((m, i) => m?.verdict === 'reload' && m.idAfter === ids[i]) && players.every((p) => p.from?.compat === 'othercompat1'), JSON.stringify(m3) + errs());
  await sleep(1000);
  await deploy('S4', { CLIENT_BUILD: 'newclient2', CLIENT_COMPAT: 'othercompat1' }, 'and the server alone again');
  const m4 = players.map((p) => p.moves[0]);
  check('...the reloaded pages go back in place', m4.every((m, i) => m?.verdict === 'in place' && m.id === ids[i]), JSON.stringify(m4));

  // ---------------------------------------------------------------- deploys back to back
  const inGame = () => players.every((p, i) => p.welcomed === p.conn && p.conn.open && p.id === ids[i] && p.conn.room?.code === code);
  const near = (s) => server(s, base + 1 + +s.slice(1), { CLIENT_BUILD: 'newclient3', CLIENT_COMPAT: 'othercompat3' });
  // shared code changes again: every page reloads, slowly (3 s each)...
  for (const p of players) p.reloadMs = 3000;
  const S5 = near('S5');
  check('back to back: S5 (shared code changed again) is up', await up(S5), S5.log);
  live = S5.port;
  for (const p of players) p.moves.length = 0;
  stop(cur);
  await until(() => /restored from the last server/.test(S5.log), 15000);
  // ...and while they are still loading, the next deploy: S6, with S5 told to stop
  const S6 = server('S6', base + 7, { CLIENT_BUILD: 'newclient3', CLIENT_COMPAT: 'othercompat3', HANDOFF_PREPARE_MS: '0' });
  check('...S6 is up while the pages are still loading for S5', (await up(S6)) && players.every((p) => !p.moves.length), JSON.stringify(players.map((p) => p.moves)));
  live = S6.port;
  stop(S5);
  check('...every page is back in its own body on S6, having reloaded', (await until(inGame, 30000)) && players.every((p) => p.moves[0]?.verdict === 'reload' && p.moves[0].reload.why === ''), JSON.stringify(players.map((p) => p.moves)) + errs());
  check('...and the game went through S5 to S6 with nobody lost', /restored from the last server/.test(S6.log) && players.every((p, i) => p.id === ids[i]), S6.log.split('\n').slice(-8).join('\n'));
  await until(() => S5.exit, 15000);
  for (const p of players) p.moves.length = 0;
  // S6 goes with nothing up after it (a host that stops the old one first): the save waits in the store. S7 comes up,
  // finds it and starts bringing it back, and is told to stop before the game is up there
  stop(S6);
  await until(() => S6.exit, 15000);
  const S7 = near('S7');
  live = S7.port;
  await until(() => /restored from the last server/.test(S7.log), 20000);
  stop(S7);
  await until(() => S7.exit, 15000);
  check('a server told to stop while it is still bringing a game back puts the save back in the store, as it came', /its save is back in the store for the next server/.test(S7.log) && S7.exit?.code === 0, S7.log.split('\n').slice(-10).join('\n'));
  const S8 = near('S8');
  check('...S8 is up', await up(S8), S8.log);
  live = S8.port;
  check('...and the game goes on there: every page back in its own body, in place', (await until(inGame, 40000)) && players.every((p) => p.moves.at(-1)?.verdict === 'in place'), JSON.stringify(players.map((p) => p.moves)) + errs());
  cur = S8;
  check('the run is the same run throughout: the same valley', players.every((p) => p.seed === players[0].seed));
  stop(cur);
  await until(() => cur.exit, 15000);
} catch (e) {
  check('no error', false, String(e && e.stack));
}
edge.close();
for (const p of [...new Set(procs)]) if (!p.exit) p.proc.kill('SIGKILL');
await until(() => procs.every((s) => s.exit), 5000);
check('every server is stopped', procs.every((s) => s.exit));
if (failed) for (const s of procs) console.log(`\n--- ${s.name} ---\n${s.log.split('\n').slice(-25).join('\n')}`);
console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
