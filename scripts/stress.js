// Load test of the multi-game server: how many players one game takes, and how many games one box runs.
//
//   node scripts/stress.js game [--steps 4,8,12,16,24,32]       one game, more and more players
//   node scripts/stress.js box  [--steps 1,2,4,8,12,16,24,32]   more and more games of --per (8) players
//   options: --warm S (seconds into the night before measuring, 65: past the second wave)  --measure S (40)
//            --port P (3931)  --per N (8)  --bots-per-thread N (25)  --threads N (6, the most bot threads)
//            --start-day N (3)  --out FILE (JSON results; default stress-<mode>-<time>.json in the temp dir)
//
// It starts a server of its own (server/index.js on --port) with GODMODE (bots never die, so every game keeps its
// whole team in the fight), DAY_SECONDS=20 (night comes fast), an ADMIN_SECRET (bots /admin and /give themselves ammo at night)
// and no per-address limits, makes each step's games with POST /api/games, and puts protocol-level bots in them
// (scripts/stress-bot.js, in worker threads). Each step waits for night, lets it run --warm seconds, then for
// --measure seconds samples /status every second (each game thread's CPU and busy share, the network thread's,
// the RSS) and reads the [stats] lines every game prints every 10 s (tick mean / p99 / max, zombies, KB/s per
// client). The bots report what a player would notice: bytes down, snapshots a second, the longest gap.
//
// The machine running this is probably busy with other things: wall-clock tick times then come out longer than
// they would on a box of their own. CPU ms per second (process.threadCpuUsage, per thread) is the number to trust.
import { spawn } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { writeFileSync, createWriteStream } from 'node:fs';
import { loadavg, availableParallelism, totalmem, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHASE } from '../shared/constants.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const mode = args[0] === 'box' ? 'box' : 'game';
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const PORT = +opt('port', 3931);
const WARM = +opt('warm', 65);
const MEASURE = +opt('measure', 40);
const PER = +opt('per', 8);
const PER_THREAD = +opt('bots-per-thread', 25);
const MAX_THREADS = +opt('threads', 6);
const START_DAY = +opt('start-day', 3);
const STEPS = opt('steps', mode === 'game' ? '4,8,12,16,24,32' : '1,2,4,8,12,16,24,32').split(',').map(Number);
const OUT = opt('out', join(tmpdir(), `stress-${mode}-${Date.now()}.json`));
const LOG = OUT.replace(/\.json$/, '') + '.server.log';
const BASE = `http://localhost:${PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const max = (a) => (a.length ? Math.max(...a) : 0);
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------- the server
const busy = await fetch(`${BASE}/status`).then(() => true, () => false);
if (busy) {
  console.error(`port ${PORT} is taken: pick another with --port`);
  process.exit(1);
}
const logFile = createWriteStream(LOG);
const statsLines = []; // { at, code, players, zombies, ents, mean, p99, max, over, ticks, cpu, kbs }
const STATS_RE = /^\[game (\w+)\] \[stats\] players (\d+) zombies (\d+) ents (\d+) tick ([\d.]+)ms p99 ([\d.]+)ms max ([\d.]+)ms over (\d+)\/(\d+) .*?cpu ([\d.]+)ms\/s out ([\d.]+) KB\/s\/client/;
process.env.ADMIN_SECRET ||= 'stress-admin'; // the server's, and the bots' (their threads get this env)
const server = spawn(process.execPath, ['server/index.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), GODMODE: '1', DAY_SECONDS: '20', START_DAY: String(START_DAY), CONN_PER_IP: '0', LOBBY_LIMITS: '0', ROOM_MAX_PLAYERS: '64', MAX_GAMES: '400', STATS_FILE: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let tail = '';
const onOut = (chunk) => {
  logFile.write(chunk);
  tail += chunk.toString();
  const lines = tail.split('\n');
  tail = lines.pop();
  for (const line of lines) {
    const m = STATS_RE.exec(line);
    if (m) statsLines.push({ at: Date.now(), code: m[1], players: +m[2], zombies: +m[3], ents: +m[4], mean: +m[5], p99: +m[6], max: +m[7], over: +m[8], ticks: +m[9], cpu: +m[10], kbs: +m[11] });
    else if (/crash|error|stopped/i.test(line)) console.log('  server:', line);
  }
};
server.stdout.on('data', onOut);
server.stderr.on('data', onOut);

// ---------------------------------------------------------------- bot threads
const threads = [];
function thread(i) {
  while (threads.length <= i) {
    const w = new Worker(new URL('./stress-bot.js', import.meta.url));
    w.unref();
    threads.push(w);
  }
  return threads[i];
}
const ask = (w, msg, reply) =>
  new Promise((resolve) => {
    const on = (m) => {
      if (m.t !== reply) return;
      w.off('message', on);
      resolve(m);
    };
    w.on('message', on);
    w.postMessage(msg);
  });

let cleaning = false;
async function cleanup(code = 0) {
  if (cleaning) return;
  cleaning = true;
  for (const w of threads) await w.terminate().catch(() => {});
  server.kill('SIGTERM');
  await sleep(300);
  if (server.exitCode === null) server.kill('SIGKILL');
  process.exit(code);
}
process.on('SIGINT', () => cleanup(130));
process.on('SIGTERM', () => cleanup(143));
server.on('exit', (code) => {
  if (!cleaning) {
    console.error(`server exited (${code}): see ${LOG}`);
    cleanup(1);
  }
});

for (let i = 0; ; i++) {
  if (await fetch(`${BASE}/api/games`).then((r) => r.ok, () => false)) break;
  if (i > 100) {
    console.error('server did not come up');
    await cleanup(1);
  }
  await sleep(100);
}

// ---------------------------------------------------------------- one step
async function makeGame(name, maxPlayers) {
  const r = await fetch(`${BASE}/api/games`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, maxPlayers }) });
  const j = await r.json();
  if (!r.ok) throw new Error(`create failed: ${r.status} ${j.error}`);
  return j.code;
}
const gameInfo = (code) => fetch(`${BASE}/api/games/${code}`).then((r) => (r.ok ? r.json() : null), () => null);
const status = () => fetch(`${BASE}/status`).then((r) => r.json());

let botSeq = 0;
async function step(games, perGame) {
  const label = mode === 'game' ? `${perGame} players` : `${games} games x ${perGame}`;
  const load0 = loadavg()[0];
  const before = await status();
  const codes = [];
  for (let g = 0; g < games; g++) codes.push(await makeGame(`stress ${g}`, perGame));
  // bots, spread over the threads (a game's bots over several, so one slow thread does not hold one game back)
  const total = games * perGame;
  const nThreads = Math.min(MAX_THREADS, Math.max(1, Math.ceil(total / PER_THREAD)));
  const plan = Array.from({ length: nThreads }, () => []);
  let k = 0;
  for (const code of codes) for (let i = 0; i < perGame; i++) plan[k++ % nThreads].push({ id: ++botSeq, url: `ws://localhost:${PORT}/ws?game=${code}`, name: `bot${botSeq}` });
  plan.forEach((bots, i) => thread(i).postMessage({ t: 'spawn', bots }));
  const t0 = Date.now();
  process.stdout.write(`\n[${label}] ${total} bots on ${nThreads} threads, load avg ${load0.toFixed(1)}: waiting for night`);
  // night in every game
  for (;;) {
    const infos = await Promise.all(codes.map(gameInfo));
    if (infos.every((i) => i && i.phase === PHASE.NIGHT)) break;
    if (Date.now() - t0 > 120000) {
      console.log(` - no night after 120 s: ${JSON.stringify(infos.map((i) => i && { p: i.players, ph: i.phase }))}`);
      break;
    }
    await sleep(1000);
  }
  const joined = (await Promise.all(codes.map(gameInfo))).reduce((a, i) => a + (i?.players || 0), 0);
  process.stdout.write(`, night (${joined}/${total} in), warming ${WARM} s`);
  await sleep(WARM * 1000);
  // measure
  await Promise.all(threads.slice(0, nThreads).map((w) => ask(w, { t: 'sample' }, 'sample'))); // (starts the bots' window)
  const from = Date.now();
  const samples = [];
  process.stdout.write(`, measuring ${MEASURE} s`);
  while (Date.now() - from < MEASURE * 1000) {
    await sleep(1000);
    samples.push(await status());
  }
  const botSamples = await Promise.all(threads.slice(0, nThreads).map((w) => ask(w, { t: 'sample' }, 'sample')));
  await sleep(1500); // (the [stats] line of the last 10 s)
  const to = Date.now();
  const lines = statsLines.filter((l) => l.at >= from && l.at <= to && codes.includes(l.code));
  const after = samples[samples.length - 1];

  // per game thread, per sample: only the games with players in them (an emptied game from the last step idles)
  const live = samples.flatMap((s) => s.list.filter((g) => g.players > 0));
  const bots = botSamples.flatMap((s) => s.bots);
  const res = {
    label,
    games,
    perGame,
    joined,
    loadAvg: r1(load0),
    gamesAlive: after.games,
    rssMb: after.rssMb,
    rssBeforeMb: before.rssMb,
    gameCpuMs: r1(mean(live.map((g) => g.load.cpuMs))), // per game thread, ms of CPU a second
    gameCpuMsMax: r1(max(live.map((g) => g.load.cpuMs))),
    gameElu: r2(mean(live.map((g) => g.load.elu))),
    // busy wall time over CPU time of the game threads: ~1 on a machine of its own; above that the OS kept them
    // off a core while they had work (other load on the box), and every wall-clock timing is inflated by about that
    contention: r1(mean(live.map((g) => g.load.elu * 1000)) / Math.max(0.1, mean(live.map((g) => g.load.cpuMs)))),
    totalGameCpuMs: r1(mean(samples.map((s) => s.list.reduce((a, g) => a + g.load.cpuMs, 0)))),
    netCpuMs: r1(mean(samples.map((s) => s.net.cpuMs))),
    netElu: r2(mean(samples.map((s) => s.net.elu))),
    heapMb: r1(mean(live.map((g) => g.heapMb))),
    tickMean: r2(mean(lines.map((l) => l.mean))),
    tickP99: r2(mean(lines.map((l) => l.p99))),
    tickP99Worst: r2(max(lines.map((l) => l.p99))),
    tickMax: r2(max(lines.map((l) => l.max))),
    over: lines.reduce((a, l) => a + l.over, 0),
    ticks: lines.reduce((a, l) => a + l.ticks, 0),
    zombies: r1(mean(lines.map((l) => l.zombies))),
    kbsPerClient: r1(mean(lines.map((l) => l.kbs))),
    botKBs: r1(mean(bots.map((b) => b.bytesPerS / 1024))),
    botUpKBs: r2(mean(bots.map((b) => b.upPerS / 1024))),
    botSnapsPerS: r1(mean(bots.map((b) => b.snapsPerS))),
    botWorstGapMs: Math.round(max(bots.map((b) => b.maxGapMs))),
    botSlowGaps: bots.reduce((a, b) => a + b.slow, 0),
    botSyncsPerS: r1(mean(bots.map((b) => b.syncs)) / MEASURE),
    botZombiesSeen: r1(mean(bots.map((b) => b.zombiesSeen))),
    botErrors: bots.filter((b) => b.err || b.entErr).map((b) => b.err || `decode x${b.entErr}`).slice(0, 5),
    botThreadCpuMs: botSamples.map((s) => Math.round(s.cpuMs)),
    botThreadElu: botSamples.map((s) => r2(s.elu)),
    loadAvgAfter: r1(loadavg()[0]),
  };
  console.log(`: done`);
  // the bots go; their games idle until the server closes them (90 s empty)
  await Promise.all(threads.map((w) => ask(w, { t: 'stop' }, 'stopped')));
  await sleep(2500);
  return res;
}

// ---------------------------------------------------------------- run
const results = { mode, startedAt: new Date().toISOString(), cores: availableParallelism(), memGb: r1(totalmem() / 2 ** 30), warm: WARM, measure: MEASURE, startDay: START_DAY, steps: [] };
const save = () => writeFileSync(OUT, JSON.stringify(results, null, 2));
console.log(`stress ${mode}: steps ${STEPS.join(', ')}, ${WARM} s into the night then ${MEASURE} s measured (night ${START_DAY}); server log ${LOG}`);
for (const n of STEPS) {
  const res = mode === 'game' ? await step(1, n) : await step(n, PER);
  results.steps.push(res);
  save();
  console.log(
    `  game cpu ${res.gameCpuMs} ms/s (max ${res.gameCpuMsMax}) elu ${res.gameElu} | tick ${res.tickMean} p99 ${res.tickP99} (worst ${res.tickP99Worst}) max ${res.tickMax} over ${res.over}/${res.ticks} | zombies ${res.zombies}` +
      ` | contention x${res.contention} | net cpu ${res.netCpuMs} ms/s elu ${res.netElu} | rss ${res.rssMb} MB (${res.gamesAlive} games alive) | down ${res.botKBs} KB/s, ${res.botSnapsPerS} snaps/s, worst gap ${res.botWorstGapMs} ms, ${res.botSlowGaps} hitches | bot threads cpu ${res.botThreadCpuMs.join('/')} ms/s | load ${res.loadAvg}->${res.loadAvgAfter}` +
      (res.botErrors.length ? ` | bot errors ${res.botErrors.join(', ')}` : ''),
  );
  // A step that falls over ends the run: the next would only fall over harder. Judged on CPU (a game thread using
  // most of a core, the network thread past half of one) and on what the bots got, not on wall-clock tick times,
  // which a busy machine inflates without the game costing any more (see contention).
  if (res.gameCpuMs > 600 || res.netCpuMs > 500 || res.botSnapsPerS < 15) {
    console.log('  (past what it can carry: stopping here)');
    break;
  }
}

console.log('\n' + ['step', 'game cpu ms/s', 'tick mean/p99/max ms', 'zombies', 'net cpu ms/s', 'rss MB', 'KB/s/client', 'snaps/s', 'worst gap'].join(' | '));
for (const s of results.steps) console.log([s.label, s.gameCpuMs, `${s.tickMean}/${s.tickP99}/${s.tickMax}`, s.zombies, s.netCpuMs, s.rssMb, s.botKBs, s.botSnapsPerS, s.botWorstGapMs].join(' | '));
console.log(`\nresults: ${OUT}`);
await cleanup(0);
