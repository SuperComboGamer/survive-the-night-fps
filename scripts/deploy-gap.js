// How long a deploy interrupts play, measured (docs/deploys.md): real server processes behind a stand-in for the
// edge (new connections go to the newest server once it is up, open ones stay where they are), bots that play an
// invite-only game with commands every tick, and deploys one after another. Each bot comes back the way the page
// does - client/net/moveback.js decides, with the client's own Connection - and every phase is timed from the moment
// its socket was closed as moved:
//   welcome  the next server took it back in (S2C.WELCOME): from here it can move (prediction)
//   snap     its first snapshot there: it sees the game again
// and the bots' verdicts: in place, or a reload (which would cost a page load on top: see e2e-handoff.js).
// usage: node scripts/deploy-gap.js [--deploys 3] [--bots 3] [--client-changes 0] [--json]
// (Linux: a server is stopped with SIGTERM, as the host does. Windows: with the 'shutdown' message, as pm2 does.)
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer, connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { C2S, S2C, PROTOCOL_VERSION, MOVED_CODE, Writer, Reader, writeInput } from '../shared/protocol.js';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? dflt : process.argv[i + 1] === undefined || process.argv[i + 1].startsWith('--') ? true : process.argv[i + 1];
};
const DEPLOYS = +arg('deploys', 3);
const BOTS = +arg('bots', 3);
const CLIENT_CHANGES = +arg('client-changes', 0); // how many of the deploys (the last ones) bring another client build
const JSON_OUT = !!arg('json', false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = mkdtempSync(join(tmpdir(), 'stn-deploy-gap-'));
const base = 45000 + Math.floor(Math.random() * 800);
const say = (...a) => JSON_OUT || console.log(...a);

// ---------------------------------------------------------------- the edge
let live = base + 1;
const edge = createServer((sock) => {
  const up = connect(live, '127.0.0.1');
  sock.pipe(up).pipe(sock);
  const end = () => (sock.destroy(), up.destroy());
  sock.on('error', end).on('close', end);
  up.on('error', end).on('close', end);
});
await new Promise((r) => edge.listen(base, r));
const EDGE = `localhost:${base}`;
globalThis.location = { protocol: 'http:', host: EDGE };

const servers = [];
function server(name, port, env = {}) {
  const proc = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, DATABASE_URL: '', PORT: String(port), STATS_FILE: join(dir, `stats-${name}.json`), HANDOFF_DIR: join(dir, 'handoff'), HANDOFF_PIN: 'unsigned', GODMODE: '1', DAY_SECONDS: '600', LOBBY_LIMITS: '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const s = { name, port, proc, log: '', exit: null };
  proc.stdout.on('data', (d) => (s.log += d));
  proc.stderr.on('data', (d) => (s.log += d));
  proc.on('exit', (code) => (s.exit = { code }));
  servers.push(s);
  return s;
}
const up = async (s) => {
  for (let i = 0; i < 600 && !s.log.includes('listening'); i++) await sleep(50);
  return s.log.includes('listening');
};
const stop = (s) => (process.platform === 'win32' ? s.proc.send({ t: 'shutdown' }) : s.proc.kill('SIGTERM'));

// ---------------------------------------------------------------- what the page does, as a bot
// moveback.js when this tree has it; otherwise what client/main.js did before it (fetch the version, reload if the
// client build changed, else join again, backing off from 250 ms to 2 s)
const mb = await import('../client/net/moveback.js').catch(() => null);
let loadedFrom = null; // (what the page was loaded from: the first server's, once it is up)

function bot(name) {
  const b = { name, pid: randomUUID(), id: 0, seq: 0, ws: null, code: '', times: [], verdicts: [], timer: null };
  // one socket: resolves on WELCOME (true) or a REJECT / close before it (the Error)
  b.connect = (t0) =>
    new Promise((resolve) => {
      const ws = new WebSocket(`ws://${EDGE}/ws?game=${b.code}`);
      ws.binaryType = 'arraybuffer';
      let joined = false;
      ws.onopen = () => {
        const w = new Writer(128);
        w.u8(C2S.JOIN);
        w.u8(PROTOCOL_VERSION);
        w.str(name);
        w.str(b.pid);
        w.u8(255);
        ws.send(w.bytes());
      };
      ws.onmessage = (m) => {
        const r = new Reader(m.data);
        const t = r.u8();
        if (t === S2C.WELCOME) {
          b.id = r.u16();
          joined = true;
          b.ws = ws;
          if (t0) b.cur.welcome = performance.now() - t0;
          clearInterval(b.timer);
          // a running page's commands: one packet a tick
          b.timer = setInterval(() => {
            if (ws.readyState !== 1) return;
            const w = new Writer(64);
            w.u8(C2S.INPUT);
            w.u16(0);
            w.u8(0);
            writeInput(w, [{ seq: (b.seq = (b.seq + 1) & 0xffff), buttons: 0, qyaw: 0, qpitch: 0, slot: 255 }]);
            ws.send(w.bytes());
          }, 50);
          resolve(true);
        } else if (t === S2C.REJECT) {
          const err = new Error('rejected');
          err.reason = r.u8();
          resolve(err);
        } else if (t === S2C.SNAPSHOT && joined && t0 && b.cur.snap === undefined) b.cur.snap = performance.now() - t0;
      };
      ws.onclose = (e) => {
        clearInterval(b.timer);
        if (!joined) return resolve(Object.assign(new Error('closed'), { unanswered: true }));
        if (e.code === MOVED_CODE) b.onMoved?.();
      };
    });
  b.onMoved = async () => {
    const t0 = performance.now();
    b.cur = {};
    let verdict = 'in place';
    if (mb) {
      verdict = await mb.moveBack({
        code: b.code,
        loadedFrom: { protocol: PROTOCOL_VERSION, build: b.from.build, compat: b.from.compat },
        version: (code) => fetch(`http://${EDGE}/api/version${code ? `?game=${code}` : ''}`, { cache: 'no-store' }).then((r) => r.json()),
        join: () => b.connect(t0),
        still: () => true,
      });
    } else {
      // client/main.js as it was
      verdict = 'gave up';
      const until = performance.now() + 45000;
      for (let wait = 250; performance.now() < until; wait = Math.min(wait * 2, 2000)) {
        const now = await fetch(`http://${EDGE}/api/version`, { cache: 'no-store' })
          .then((r) => r.json())
          .catch(() => null);
        if (now && (now.protocol !== PROTOCOL_VERSION || now.build !== b.from.build)) {
          verdict = 'reload';
          break;
        }
        if (now && (await b.connect(t0)) === true) {
          verdict = 'in place';
          break;
        }
        await sleep(wait);
      }
    }
    if (typeof verdict === 'object') verdict = verdict.verdict;
    b.cur.verdict = verdict;
    if (verdict === 'reload') {
      // what a reloaded page does: it loads (not timed here), then joins the game again
      b.from = await (await fetch(`http://${EDGE}/api/version`)).json();
      for (let i = 0; i < 40 && (await b.connect(t0)) !== true; i++) await sleep(250);
    }
    b.times.push(b.cur);
  };
  return b;
}

// ---------------------------------------------------------------- the deploys
const result = { deploys: [], bots: BOTS };
try {
  let cur = server('S0', base + 1);
  if (!(await up(cur))) throw new Error(`the first server did not start:\n${cur.log}`);
  loadedFrom = await (await fetch(`http://${EDGE}/api/version`)).json();
  const made = await (await fetch(`http://${EDGE}/api/games`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Gap', inviteOnly: true, maxPlayers: 8, difficulty: 'nightfall' }) })).json();
  const bots = Array.from({ length: BOTS }, (_, i) => bot(`Bot${i}`));
  for (const b of bots) {
    b.code = made.code;
    b.from = { ...loadedFrom };
    if ((await b.connect(0)) !== true) throw new Error('a bot could not join');
  }
  await sleep(3000);
  for (let d = 1; d <= DEPLOYS; d++) {
    const clientChange = d > DEPLOYS - CLIENT_CHANGES;
    const next = server(`S${d}`, base + 1 + d, clientChange ? { CLIENT_BUILD: `another-${d}` } : {});
    if (!(await up(next))) throw new Error(`server ${next.name} did not start:\n${next.log}`);
    live = next.port;
    for (const b of bots) b.times.length = 0;
    const log0 = next.log.length;
    stop(cur);
    for (let i = 0; i < 400 && bots.some((b) => !b.times.length); i++) await sleep(50);
    await sleep(2500); // (the game standing still until someone plays: its "runs again" line comes a moment after)
    const rows = bots.map((b) => b.times[0] || { verdict: 'not back' });
    const nlog = next.log.slice(log0);
    const saveMs = /handoff \w+: \d+ players, \d+ KB, (\d+) ms/.exec(cur.log)?.[1];
    const ready = /game \w+ up in (\d+) ms/.exec(nlog)?.[1];
    const still = /runs again: stood still (\d+) ms/.exec(nlog)?.[1];
    result.deploys.push({ deploy: d, clientChange, saveMs: saveMs ? +saveMs : null, workerReadyMs: ready ? +ready : null, stoodStillMs: still ? +still : null, bots: rows });
    say(`deploy ${d}${clientChange ? ' (another client build)' : ''}: the old server saved in ${saveMs ?? '?'} ms; the new one had it up in ${ready ?? '?'} ms; it stood still ${still ?? '?'} ms`);
    for (const [i, r] of rows.entries()) say(`  bot ${i}: ${r.verdict.padEnd(8)} back in (WELCOME) ${String(Math.round(r.welcome ?? -1)).padStart(5)} ms   first snapshot ${String(Math.round(r.snap ?? -1)).padStart(5)} ms`);
    for (let i = 0; i < 200 && !cur.exit; i++) await sleep(50);
    cur = next;
  }
  stop(cur);
  for (let i = 0; i < 200 && !cur.exit; i++) await sleep(50);
} catch (e) {
  console.error(e.stack || e);
  result.error = String(e.message);
}
edge.close();
for (const s of servers) if (!s.exit) s.proc.kill('SIGKILL');
if (arg('logs', false)) for (const s of servers) say(`--- ${s.name}\n${s.log.split('\n').filter((l) => /restor|generated|handoff|handed|up in|runs again|prepar|SIGTERM|shutdown/.test(l)).join('\n')}`);
const all = result.deploys.flatMap((d) => d.bots.filter((b) => b.welcome !== undefined));
const med = (k) => {
  const v = all.map((b) => b[k]).filter((x) => x !== undefined).sort((a, b) => a - b);
  return v.length ? { median: Math.round(v[Math.floor(v.length / 2)]), max: Math.round(v[v.length - 1]), n: v.length } : null;
};
result.summary = { welcome: med('welcome'), snap: med('snap'), reloads: result.deploys.reduce((n, d) => n + d.bots.filter((b) => b.verdict === 'reload').length, 0) };
if (JSON_OUT) console.log(JSON.stringify(result));
else console.log(`\nfrom the socket closing (ms): back in (WELCOME) ${JSON.stringify(result.summary.welcome)}  first snapshot ${JSON.stringify(result.summary.snap)}  reloads ${result.summary.reloads}`);
process.exit(result.error ? 1 : 0);
