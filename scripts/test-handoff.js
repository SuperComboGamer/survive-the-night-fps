// A deploy, end to end (server/handoff.js, gamestate.js, rooms.js handoffAll / restore, index.js shutdown): two real
// server processes sharing a HANDOFF_DIR, as the old and the new deployment of a Railway deploy. Bots play an
// invite-only game on A into its first night; B starts; A is sent SIGTERM. Every bot's socket is closed with
// MOVED_CODE, A exits cleanly, and each bot that joins the same code on B with its browser id is given back its own
// player in the same run - the same valley, night and day - and is told the server was updated. A bot that never
// comes back is let go after HANDOFF_RESERVE; one with no browser id joins as a newcomer. Then the next deploy goes
// to a server that cannot read the save (another STATE_VERSION): the game ends there, as every deploy did before, and
// a junk save in the folder is shrugged off.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { C2S, S2C, PROTOCOL_VERSION, LEFT_CODE, MOVED_CODE, REJECT_REASON, Writer, Reader } from '../shared/protocol.js';
import { PHASE } from '../shared/constants.js';

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : detail}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = mkdtempSync(join(tmpdir(), 'stn-handoff-'));
const HANDOFF_DIR = join(dir, 'handoff');
const RESERVE = 8; // s (HANDOFF_RESERVE_SECONDS)
const base = 41000 + Math.floor(Math.random() * 800);
const procs = [];
function server(name, port, env = {}) {
  const proc = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, DATABASE_URL: '', PORT: String(port), STATS_FILE: join(dir, `stats-${name}.json`), HANDOFF_DIR, HANDOFF_RESERVE_SECONDS: String(RESERVE), DAY_SECONDS: '6', GODMODE: '1', GAME_IDLE_SECONDS: '60', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const s = { name, port, proc, log: '', exit: null };
  proc.stdout.on('data', (d) => (s.log += d));
  proc.stderr.on('data', (d) => (s.log += d));
  proc.on('exit', (code, signal) => (s.exit = { code, signal, at: Date.now() }));
  procs.push(s);
  return s;
}
const up = async (s) => {
  for (let i = 0; i < 300 && !s.log.includes('listening'); i++) await sleep(50);
  return s.log.includes('listening');
};
const api = async (s, path, opts) => {
  const r = await fetch(`http://localhost:${s.port}${path}`, opts);
  return { status: r.status, body: await r.json().catch(() => null) };
};

// a bot: joins, counts snapshots, keeps chat lines, and says how its socket closed
const client = (s, code, name, pid) =>
  new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${s.port}/ws?game=${code}`);
    ws.binaryType = 'arraybuffer';
    const c = { ws, id: 0, reject: 0, chat: [], snaps: 0, closed: null };
    c.close = (code = LEFT_CODE) => new Promise((done) => (c.closed ? done() : ((ws.onclose = () => done()), ws.close(code))));
    c.gone = new Promise((done) => (c.onGone = done));
    ws.onopen = () => {
      const w = new Writer(128);
      w.u8(C2S.JOIN);
      w.u8(PROTOCOL_VERSION);
      w.str(name);
      w.str(pid);
      ws.send(w.bytes());
    };
    ws.onmessage = (m) => {
      const r = new Reader(m.data);
      const t = r.u8();
      if (t === S2C.WELCOME) {
        c.id = r.u16();
        c.seed = r.u32();
        resolve(c);
      } else if (t === S2C.REJECT) {
        c.reject = r.u8();
        resolve(c);
      } else if (t === S2C.SNAPSHOT) c.snaps++;
      else if (t === S2C.CHAT) {
        r.u16();
        r.u8();
        c.chat.push(r.str());
      }
    };
    ws.onclose = (e) => {
      c.closed = { code: e.code, reason: e.reason };
      c.onGone(c.closed);
      resolve(c);
    };
  });
// joins a game that may still be on its way over: as the client does (moveBack), a few tries
async function rejoin(s, code, name, pid) {
  for (let i = 0; i < 20; i++) {
    const c = await client(s, code, name, pid);
    if (c.id) return c;
    await sleep(250);
  }
  return null;
}

try {
  // ---------------------------------------------------------------- A: a game into its first night
  const A = server('A', base);
  check('server A is up', await up(A), A.log);
  const made = await api(A, '/api/games', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Deploy night', inviteOnly: true, maxPlayers: 6, difficulty: 'ember' }) });
  const code = made.body?.code;
  check('an invite-only game to hand over', made.status === 201 && code?.length === 10, JSON.stringify(made));
  const pids = { ann: randomUUID(), ben: randomUUID(), cy: randomUUID() };
  const ann = await client(A, code, 'Ann', pids.ann);
  const ben = await client(A, code, 'Ben', pids.ben);
  const cy = await client(A, code, 'Cy', pids.cy);
  const bot = await client(A, code, 'Bot', ''); // (no browser id)
  check('four players in it', ann.id && ben.id && cy.id && bot.id, JSON.stringify([ann.id, ben.id, cy.id, bot.id]));
  let info = null;
  for (let i = 0; i < 60; i++) {
    info = (await api(A, `/api/games/${code}`)).body;
    if (info?.phase === PHASE.NIGHT) break;
    await sleep(250);
  }
  check('night has fallen on A', info?.phase === PHASE.NIGHT && info.day === 1, JSON.stringify(info));
  await sleep(2000); // (some of the night's horde out)

  // ---------------------------------------------------------------- B starts; A is told to stop
  const B = server('B', base + 1);
  check('server B is up, with nothing to restore yet', (await up(B)) && !/restored/.test(B.log), B.log);
  const t0 = Date.now();
  A.proc.kill('SIGTERM');
  const closes = await Promise.all([ann, ben, cy, bot].map((c) => Promise.race([c.gone, sleep(10000).then(() => null)])));
  check('every socket of the game is closed as moved (MOVED_CODE), not dropped', closes.every((c) => c?.code === MOVED_CODE), JSON.stringify(closes));
  for (let i = 0; i < 100 && !A.exit; i++) await sleep(50);
  check(`A exits cleanly once it has handed the game over (${A.exit ? A.exit.at - t0 : '-'} ms)`, A.exit?.code === 0 && A.exit.at - t0 < 15000, JSON.stringify(A.exit));
  check('...and says so', /handoff \w+: 4 players/.test(A.log) && /1 game\(s\) handed over/.test(A.log), A.log.split('\n').slice(-8).join('\n'));

  // ---------------------------------------------------------------- back in, on B
  const ann2 = await rejoin(B, code, 'Ann', pids.ann);
  check('the same code is a game on B: the invite link still works', !!ann2, B.log.split('\n').slice(-10).join('\n'));
  check('...the same browser is given its own player back', ann2?.id === ann.id, `${ann2?.id} vs ${ann.id}`);
  check('...in the same valley', ann2?.seed === ann.seed, `${ann2?.seed} vs ${ann.seed}`);
  await sleep(600);
  check('...and is told the server was updated', ann2?.chat.some((t) => /server was updated/.test(t)), JSON.stringify(ann2?.chat));
  const ben2 = await rejoin(B, code, 'Benjamin', pids.ben);
  check('another name, the same browser: their own player all the same', ben2?.id === ben.id, `${ben2?.id} vs ${ben.id}`);
  const bot2 = await rejoin(B, code, 'Bot', '');
  check('a bot with no browser id joins as a newcomer', bot2?.id && bot2.id !== bot.id, `${bot2?.id} vs ${bot.id}`);
  info = (await api(B, `/api/games/${code}`)).body;
  check('the run carries on: still night 1, the invite-only game under its name, still Ember', info?.phase === PHASE.NIGHT && info.day === 1 && info.inviteOnly && info.name === 'Deploy night' && info.difficulty === 'ember', JSON.stringify(info));
  check('...with the seats of those not back yet kept (Cy, and the old Bot)', info?.players === 5, JSON.stringify(info));
  await sleep(1000);
  check('...and it streams to them', ann2?.snaps > 10 && ben2?.snaps > 10, `${ann2?.snaps} ${ben2?.snaps}`);
  await sleep((RESERVE + 2) * 1000);
  info = (await api(B, `/api/games/${code}`)).body;
  check('those who never came back are let go after the reserve', info?.players === 3, JSON.stringify(info));
  check('...and, invite-only, still not in the public list', !(await api(B, '/api/games')).body.list.some((g) => g.code === code));

  // ---------------------------------------------------------------- the next deploy cannot read it
  writeFileSync(join(HANDOFF_DIR, 'JUNKJUNK.json'), '{ not json');
  const C = server('C', base + 2, { HANDOFF_STATE_VERSION: '99' });
  check('server C (another state version) is up, junk in the folder and all', await up(C));
  await sleep(800);
  B.proc.kill('SIGTERM');
  await Promise.all([ann2, ben2, bot2].map((c) => Promise.race([c.gone, sleep(10000)])));
  for (let i = 0; i < 100 && !B.exit; i++) await sleep(50);
  check('B hands it over and exits', B.exit?.code === 0, JSON.stringify(B.exit));
  await sleep(1500);
  check('C will not restore a save of another state version', /not restored: state version 1 \(this build reads 99\)/.test(C.log), C.log.split('\n').slice(-12).join('\n'));
  const ann3 = await client(C, code, 'Ann', pids.ann);
  check('...so the game is over, as a deploy used to end it', ann3.reject === REJECT_REASON.NO_GAME, JSON.stringify({ reject: ann3.reject, id: ann3.id }));
  check('...and C carries on regardless', (await api(C, '/status')).status === 200 && C.exit === null);
  check('the junk save is not restored and does not stop anything', !/JUNKJUNK restored/.test(C.log) && readdirSync(HANDOFF_DIR).filter((f) => f.startsWith('JUNKJUNK')).length <= 1);
  C.proc.kill('SIGTERM');
  for (let i = 0; i < 100 && !C.exit; i++) await sleep(50);
} catch (e) {
  check('no error', false, String(e && e.stack));
}
for (const s of procs) if (!s.exit) s.proc.kill('SIGKILL');
if (failed) for (const s of procs) console.log(`\n--- ${s.name} ---\n${s.log.split('\n').slice(-25).join('\n')}`);
console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
