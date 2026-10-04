// The end screen's "how hard was it?" vote (server/feedback.js, migrations/004). In-process, on a PGlite database:
// a vote filed against the run the voter just finished, found by their account or their browser's guest key; the
// answer is everyone's votes; voting again changes the vote rather than adding one; what is kept of the match and the
// voter with it; no vote for a run that was abandoned, ended long ago or was left before its end, nor for nobody, nor
// an answer that is not one; records still queued are written before a vote looks for its run; the analytics
// function. Then a real server: a guest and a signed-in player die in a game (/kill), and vote over HTTP;
// a stranger, another site and a server without a database are turned away.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { C2S, S2C, PROTOCOL_VERSION, Writer, Reader } from '../shared/protocol.js';
import { openDb } from '../server/db/index.js';
import { migrate } from '../server/db/migrate.js';
import { MatchStore } from '../server/matchstore.js';
import { Feedback } from '../server/feedback.js';
import { idKey } from '../server/stats.js';

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : detail}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 5000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(50);
  }
  return false;
};
// what a call that should throw threw: its HTTP status, or 'none'
const statusOf = (p) => p.then(() => 'none', (err) => err.status ?? err.message);
const dir = mkdtempSync(join(tmpdir(), 'stn-feedback-'));
const procs = [];

// ---------------------------------------------------------------- in-process
{
  const db = await openDb('pglite:memory');
  await migrate(db);
  const matches = new MatchStore({ db });
  const fb = new Feedback({ db, matches });
  const uid = (await db.query(`INSERT INTO users (email, username, password_hash) VALUES ('v@x.io', 'Voter', 'x') RETURNING id`)).rows[0].id;
  const guest = idKey(randomUUID());
  const leaver = idKey(randomUUID());
  // a match, as a game's MatchTracker posts it: who was in it, and how it ended
  const match = ({ outcome = 'wipe', endedAgoMin = 0, players = [], nights = 2, peak = 2 } = {}) => {
    const id = randomUUID();
    const end = Date.now() - endedAgoMin * 60_000;
    matches.push({ k: 'match', id, startedAt: end - 900_000, seed: 7, startDay: 1, seats: 8, protocol: 1, settings: {} });
    for (const p of players)
      matches.push({ k: 'player', matchId: id, userId: p.userId || null, guestKey: p.guestKey || null, name: p.name || 'P', firstStint: true, joinedAt: end - 900_000, leftAt: end, seconds: 900, leftReason: p.leftReason || 'match_end', outcome: p.outcome || 'dead', kills: p.kills ?? 5, deaths: 1, downs: 2 });
    matches.push({ k: 'match_end', matchId: id, endedAt: end, outcome, lastDay: nights + 1, lastPhase: 'night', nightsSurvived: nights, durationS: 900, peakPlayers: peak });
    return id;
  };

  check('nobody has a run to vote on before one ends', (await statusOf(fb.voteDifficulty({ guestKey: guest }, 3))) === 404);
  match({ endedAgoMin: 20, players: [{ guestKey: guest }] });
  match({ outcome: 'abandoned', players: [{ guestKey: guest }] });
  await matches.flush();
  check('...nor on a run that ended 20 minutes ago, or that everyone walked away from', (await statusOf(fb.voteDifficulty({ guestKey: guest }, 3))) === 404);

  // (not flushed: the vote must write what is queued before it looks)
  const wipe = match({ players: [{ guestKey: guest, kills: 9 }, { userId: uid, name: 'Voter', outcome: 'turned' }, { guestKey: leaver, leftReason: 'left', outcome: 'left' }] });
  const a = await fb.voteDifficulty({ guestKey: guest }, 4);
  check('a guest votes on the run that just ended, its records written first, and gets everyone\'s votes back', a.mine === 4 && a.total === 1 && a.counts.join() === '0,0,0,1,0', JSON.stringify(a));
  const b = await fb.voteDifficulty({ userId: uid }, 2);
  check('a signed-in player votes by their account', b.total === 2 && b.counts.join() === '0,1,0,1,0', JSON.stringify(b));
  const c = await fb.voteDifficulty({ guestKey: guest }, 5);
  check('voting again changes the vote, it does not add one', c.total === 2 && c.counts.join() === '0,1,0,0,1', JSON.stringify(c));
  check('someone who left before the run ended has nothing to vote on', (await statusOf(fb.voteDifficulty({ guestKey: leaver }, 1))) === 404);
  const rows = (await db.query('SELECT * FROM difficulty_votes ORDER BY voter')).rows;
  const g = rows.find((r) => r.voter === `g:${guest}`);
  const u = rows.find((r) => r.voter === `u:${uid}`);
  check('the vote is filed against that run, with how it went and how the voter did', rows.length === 2 && g?.match_id === wipe && g.rating === 5 && g.outcome === 'wipe' && g.nights_survived === 2 && g.last_day === 3 && g.players === 2 && g.my_outcome === 'dead' && g.my_kills === 9 && g.my_deaths === 1 && g.my_downs === 2 && g.my_seconds === 900, JSON.stringify(g));
  check("...the guest's matches counted (the old and the abandoned one too), and the account's", g?.my_matches === 3 && u?.my_matches === 1 && u.my_outcome === 'turned' && u.rating === 2, JSON.stringify([g?.my_matches, u]));

  const bad = await Promise.all([0, 6, 2.5, 'x', null].map((r) => statusOf(fb.voteDifficulty({ guestKey: guest }, r))));
  check('an answer that is not 1..5 is a 400', bad.every((s) => s === 400), JSON.stringify(bad));
  check('so is a vote from nobody', (await statusOf(fb.voteDifficulty({}, 3))) === 400);

  // two runs in a row: the vote goes on the one that ended last
  await sleep(20);
  const next = match({ outcome: 'victory', players: [{ guestKey: guest, outcome: 'escaped' }], nights: 5, peak: 1 });
  await fb.voteDifficulty({ guestKey: guest }, 1);
  const latest = (await db.query('SELECT match_id, rating, outcome, my_outcome FROM difficulty_votes WHERE voter = $1 ORDER BY created_at', [`g:${guest}`])).rows;
  check('a second run takes a vote of its own, the first run keeping its vote', latest.length === 2 && latest[1].match_id === next && latest[1].rating === 1 && latest[1].outcome === 'victory' && latest[1].my_outcome === 'escaped' && latest[0].rating === 5, JSON.stringify(latest));

  // (PGlite gives numeric as text)
  const report = (await db.query('SELECT * FROM analytics_difficulty()')).rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k === 'bucket' ? v : Number(v)])));
  const all = report.find((r) => r.bucket === 'all');
  const wins = report.find((r) => r.bucket === 'run: victory');
  check('the analytics function: everyone, and split by the run and the voter', all?.votes === 3 && all.avg === 2.67 && all.too_easy === 33.3 && all.too_hard === 33.3 && wins?.votes === 1 && report.some((r) => r.bucket === 'team: solo') && report.some((r) => r.bucket === 'played: first match') && report.some((r) => r.bucket === 'me: dead or turned'), JSON.stringify(report));
  await matches.close();
  await db.close();
}

// ---------------------------------------------------------------- a real server
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
  proc.log = () => log;
  for (let i = 0; i < 200 && !log.includes('listening'); i++) await sleep(50);
  if (!log.includes('listening')) throw new Error(`server did not start:\n${log}`);
  return { port, proc, base: `http://localhost:${port}` };
}

try {
  const { port, proc, base } = await startServer({ NODE_ENV: 'test', DATABASE_URL: `pglite:${join(dir, 'db')}`, LOBBY_LIMITS: '0', DEV_ADMIN: '1' });
  const browser = () => {
    const b = { cookie: '', guestId: randomUUID() };
    b.post = async (path, body, headers = {}) => {
      const res = await fetch(base + path, { signal: AbortSignal.timeout(15000), method: 'POST', headers: { 'Content-Type': 'application/json', ...(b.cookie ? { cookie: b.cookie } : {}), ...headers }, body: JSON.stringify(body) });
      for (const c of res.headers.getSetCookie?.() || []) {
        const m = /^stn_session=([^;]*)/.exec(c);
        if (m) b.cookie = m[1] ? `stn_session=${m[1]}` : '';
      }
      return { status: res.status, body: await res.json().catch(() => null) };
    };
    b.vote = (rating, headers) => b.post('/api/feedback/difficulty', { rating, guestId: b.guestId }, headers);
    return b;
  };
  // a game socket, as connection.js opens one: the phase it is told of, and a way to say something in the chat
  const play = (b, code, name) =>
    new Promise((resolve) => {
      const ws = new WebSocket(`ws://localhost:${port}/ws${code ? `?game=${code}` : ''}`, { headers: b.cookie ? { cookie: b.cookie } : {} });
      ws.binaryType = 'arraybuffer';
      const c = { ws, id: 0, room: null };
      ws.onopen = () => {
        const w = new Writer(128);
        w.u8(C2S.JOIN);
        w.u8(PROTOCOL_VERSION);
        w.str(name);
        w.str(b.guestId);
        ws.send(w.bytes());
      };
      ws.onmessage = (m) => {
        const r = new Reader(m.data);
        const t = r.u8();
        if (t === S2C.ROOM) c.room = { code: r.str(), name: r.str() };
        else if (t === S2C.WELCOME) {
          c.id = r.u16();
          resolve(c);
        } else if (t === S2C.REJECT) resolve(c);
      };
      ws.onclose = () => resolve(c);
      c.say = (text) => {
        const w = new Writer(256);
        w.u8(C2S.CHAT);
        w.str(text);
        ws.send(w.bytes());
      };
      c.close = () => new Promise((done) => ((ws.onclose = done), ws.close()));
    });

  const gus = browser();
  const ann = browser();
  const stranger = browser();
  const reg = await ann.post('/api/auth/register', { email: 'ann@example.com', username: 'Ann', password: 'ann-password' });
  check('(Ann has an account)', reg.status === 201 && !!ann.cookie, JSON.stringify(reg));
  const made = await gus.post('/api/games', { name: 'Votes', host: 'Gus' });
  const code = made.body?.code;
  const g1 = await play(gus, code, 'Gus');
  const a1 = await play(ann, code, 'Ann');
  check('(both are in the game)', g1.id > 0 && a1.id > 0, JSON.stringify([made.body, g1.id, a1.id]));
  await sleep(500);
  const early = await gus.vote(3);
  check('a vote while the run is still going finds nothing to vote on', early.status === 404, JSON.stringify(early));
  for (const c of [g1, a1]) {
    c.say('/kill');
  }
  const ended = await until(() => /game over on day/.test(proc.log()), 8000);
  check('(the run ends with both dead)', ended, proc.log().slice(-600));

  const v1 = await gus.vote(4);
  check('a guest votes over HTTP with their browser id, and gets everyone\'s votes back', v1.status === 200 && v1.body.mine === 4 && v1.body.total === 1 && v1.body.counts.join() === '0,0,0,1,0', JSON.stringify(v1));
  const v2 = await ann.vote(3);
  check('a signed-in player votes by their cookie', v2.status === 200 && v2.body.total === 2 && v2.body.counts.join() === '0,0,1,1,0', JSON.stringify(v2));
  const v3 = await gus.vote(5);
  check('...and a second click changes the vote', v3.status === 200 && v3.body.total === 2 && v3.body.counts.join() === '0,0,1,0,1', JSON.stringify(v3));
  const s1 = await stranger.vote(1);
  check('someone who was not in the run is a 404', s1.status === 404 && /no run/i.test(s1.body?.error), JSON.stringify(s1));
  const x = await gus.vote(2, { Origin: 'https://evil.example' });
  check('a vote from another site is turned away', x.status === 403, JSON.stringify(x));
  await g1.close();
  await a1.close();
  await stop(proc);

  const bare = await startServer({ DATABASE_URL: '' });
  const r = await fetch(`${bare.base}/api/feedback/difficulty`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rating: 3, guestId: randomUUID() }) });
  check('a server without a database keeps no votes: a 503', r.status === 503, String(r.status));
  await stop(bare.proc);
} catch (err) {
  failed++;
  console.log('FAIL ', err.stack || err.message);
} finally {
  for (const p of procs) await stop(p).catch(() => {});
  rmSync(dir, { recursive: true, force: true });
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall feedback checks passed');
process.exit(failed ? 1 : 0);
