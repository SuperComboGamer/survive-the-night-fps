// A deploy builds each game's valley on the next server before the last one saves it (rooms.js announce / prepare,
// room-worker.js `prepare`, handoff.js announceAndWait / listenComing / ready), so its players wait for a save to be
// loaded, not for a valley to be generated.
//   - in the process: a worker prepared for a game builds its valley and says it is ready; the save, once it comes,
//     is loaded into that worker (the room is up in a few ms); one prepared for a valley this build makes differently
//     is let go and says nothing; a server going down hears which games the next one is ready for, and waits no
//     longer than it is told to for the rest
//   - two real servers: the game is played on while the next server builds its valley, and the players are back in
//     well under half a second of their sockets closing (it was about a second before: docs/deploys.md)
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { FileStore, envelope, encode } from '../server/handoff.js';
import { Lobby } from '../server/rooms.js';
import { Game } from '../server/game.js';
import { C2S, S2C, PROTOCOL_VERSION, MOVED_CODE, Writer, Reader, writeInput } from '../shared/protocol.js';

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : detail}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000) => {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(20)) if (fn()) return true;
  return false;
};
const dir = mkdtempSync(join(tmpdir(), 'stn-handoff-prepare-'));

// ---------------------------------------------------------------- in the process
const SEED = 777001;
const g = new Game({ seed: SEED, dayLength: 3600, log: () => {} });
const body = encode(envelope(g));
const shape = g.worldShape;
const store = new FileStore(join(dir, 'handoff'));
const logs = [];
const lobby = new Lobby({ stats: { enter() {}, leave() {} }, store, log: (...a) => logs.push(a.join(' ')) });
const heard = (re) => logs.some((l) => re.test(l));
const meta = { name: 'Prepared', host: '', maker: '', first: '', inviteOnly: true, quick: false, maxPlayers: 4, difficulty: 'nightfall', created: Date.now(), match: null };

lobby.prepare('PREPWRONG', { seed: SEED, act: 1, shape: 'not-this-one' });
await until(() => heard(/PREPWRONG: the valley built ahead is let go \(this build makes another valley/));
const said = existsSync(join(dir, 'handoff', 'PREPWRONG.ready')) ? readFileSync(join(dir, 'handoff', 'PREPWRONG.ready'), 'utf8') : null;
check('a worker prepared for a valley this build makes differently is let go, and the store is told it will not be ready (the server going down need not wait for it)', heard(/PREPWRONG: the valley built ahead is let go/) && said === '0' && !lobby.prepared.has('PREPWRONG'), `${said} ${logs.join('\n')}`);

lobby.prepare('PREPRIGHT', { seed: SEED, act: 1, shape });
await until(() => existsSync(join(dir, 'handoff', 'PREPRIGHT.ready')));
check('a worker prepared for the valley the game is on builds it, and tells the store it is ready for the save', existsSync(join(dir, 'handoff', 'PREPRIGHT.ready')) && lobby.prepared.get('PREPRIGHT')?.ready, logs.join('\n'));
lobby.prepare('PREPRIGHT', { seed: SEED, act: 1, shape });
check('...once (a second word about the same game changes nothing)', lobby.prepared.size === 1);
await store.put('PREPRIGHT', meta, body);
const room = await lobby.restore('PREPRIGHT');
check('the save, when it comes, goes to that worker', room?.builtAhead === true && !lobby.prepared.has('PREPRIGHT'), JSON.stringify({ builtAhead: room?.builtAhead }));
await until(() => room.ready);
const upMs = +/PREPRIGHT up in (\d+) ms/.exec(logs.join('\n'))?.[1];
const aheadMs = +/PREPRIGHT: its valley built ahead in (\d+) ms/.exec(logs.join('\n'))?.[1];
// (held to the valley it saved building, on this machine: a slow one is slow at both)
check(`...which has the game up in a moment: ${upMs} ms, against ${aheadMs} ms for the valley alone`, room.ready && upMs < Math.max(250, aheadMs), logs.join('\n'));
check('...under its code, with its seats and name', lobby.rooms.get('PREPRIGHT') === room && room.maxPlayers === 4 && room.name === 'Prepared' && room.st.seed === SEED >>> 0);
room.shut();

// the server going down: it hears which games the next one is ready for, and waits no longer than it is told to
lobby.prepare('PREPONE', { seed: SEED, act: 1, shape });
const t0 = Date.now();
const ready = await store.announceAndWait(
  [
    { code: 'PREPONE', info: { seed: SEED, act: 1, shape } },
    { code: 'PREPNONE', info: { seed: SEED, act: 1, shape } },
  ],
  1500
);
check('a server going down hears which games the next one is ready for, and gives up on the rest when its time is up', ready.has('PREPONE') && !ready.has('PREPNONE') && Date.now() - t0 >= 1400 && Date.now() - t0 < 1500 + 2000, JSON.stringify({ ready: [...ready], ms: Date.now() - t0 }));
check('...and leaves nothing of it behind in the store', !existsSync(join(dir, 'handoff', 'PREPONE.coming')) && !existsSync(join(dir, 'handoff', 'PREPONE.ready')));
lobby.stopping = true;
lobby.dropPrepared('PREPONE', 'the test is over');
await store.close();

// ---------------------------------------------------------------- two real servers
const base = 46000 + Math.floor(Math.random() * 800);
const procs = [];
function server(name, port) {
  const proc = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, DATABASE_URL: '', PORT: String(port), STATS_FILE: join(dir, `stats-${name}.json`), HANDOFF_DIR: join(dir, 'live'), GODMODE: '1', DAY_SECONDS: '600', LOBBY_LIMITS: '0' },
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
// a bot that plays (commands every tick) and, moved, comes straight back to `next()`'s server
function bot(code, port) {
  const b = { pid: randomUUID(), id: 0, snaps: 0, back: null, port };
  b.join = () =>
    new Promise((resolve) => {
      const ws = new WebSocket(`ws://localhost:${b.port}/ws?game=${code}`);
      ws.binaryType = 'arraybuffer';
      let timer = 0;
      let seq = 0;
      ws.onopen = () => {
        const w = new Writer(64);
        w.u8(C2S.JOIN);
        w.u8(PROTOCOL_VERSION);
        w.str('Bot');
        w.str(b.pid);
        ws.send(w.bytes());
      };
      ws.onmessage = (m) => {
        const r = new Reader(m.data);
        const t = r.u8();
        if (t === S2C.WELCOME) {
          b.id = r.u16();
          b.welcomeAt = performance.now();
          timer = setInterval(() => {
            const w = new Writer(32);
            w.u8(C2S.INPUT);
            w.u16(0);
            w.u8(0);
            writeInput(w, [{ seq: (seq = (seq + 1) & 0xffff), buttons: 0, qyaw: 0, qpitch: 0, slot: 255 }]);
            if (ws.readyState === 1) ws.send(w.bytes());
          }, 50);
          resolve(true);
        } else if (t === S2C.REJECT) resolve(false);
        else if (t === S2C.SNAPSHOT) b.snaps++;
      };
      ws.onclose = (e) => {
        clearInterval(timer);
        resolve(false);
        if (e.code === MOVED_CODE) b.movedAt = performance.now();
      };
    });
  return b;
}
try {
  const A = server('A', base);
  check('server A is up', await until(() => A.log.includes('listening')));
  const made = await (await fetch(`http://localhost:${A.port}/api/games`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Ahead', inviteOnly: true, maxPlayers: 4 }) })).json();
  const bots = [bot(made.code, A.port), bot(made.code, A.port)];
  check('two players in a game on A', (await Promise.all(bots.map((b) => b.join()))).every(Boolean));
  await sleep(1500);
  const B = server('B', base + 1);
  check('server B is up', await until(() => B.log.includes('listening')));
  const snapsBefore = bots[0].snaps;
  stop(A);
  await until(() => /valley built ahead in \d+ ms/.test(B.log), 10000);
  check('B builds the valley of the game A is about to hand over, while A still plays it', /game \w+: its valley built ahead in \d+ ms, ready for its save/.test(B.log) && !bots[0].movedAt, B.log.split('\n').slice(-5).join('\n'));
  await until(() => bots.every((b) => b.movedAt), 10000);
  check('...and A sends its players over once B has said so', /the next server had 1 of 1 game\(s\) ready/.test(A.log) && bots.every((b) => b.movedAt) && bots[0].snaps > snapsBefore, A.log.split('\n').slice(-6).join('\n'));
  for (const b of bots) b.port = B.port;
  const ok = await Promise.all(bots.map(async (b) => (await b.join()) || (await sleep(100), await b.join())));
  const gaps = bots.map((b) => Math.round(b.welcomeAt - b.movedAt));
  // (tens of ms on the development PC; the bound leaves a slow machine room, and is still under a valley's building)
  check(`...where they are back in their bodies within moments of their sockets closing (${gaps.join(', ')} ms)`, ok.every(Boolean) && gaps.every((ms) => ms < 1500) && /restored from the last server \(.*its valley built ahead\)/.test(B.log), B.log.split('\n').slice(-8).join('\n'));
  await until(() => /runs again: stood still/.test(B.log), 5000);
  const still = +/runs again: stood still (\d+) ms/.exec(B.log)?.[1];
  check(`...and the game runs again a moment after they play (stood still ${still} ms)`, still < 1500, B.log.split('\n').slice(-6).join('\n'));
  stop(B);
  await until(() => procs.every((s) => s.exit), 10000);
} catch (e) {
  check('no error', false, String(e && e.stack));
}
for (const s of procs) if (!s.exit) s.proc.kill('SIGKILL');
await until(() => procs.every((s) => s.exit), 5000);
check('every server is stopped', procs.every((s) => s.exit));
if (failed) for (const s of procs) console.log(`\n--- ${s.name} ---\n${s.log.split('\n').slice(-25).join('\n')}`);
console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
