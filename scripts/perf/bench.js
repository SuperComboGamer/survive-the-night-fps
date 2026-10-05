// The frame-rate benchmark (docs/performance.md): fourteen fixed scenes in the real game, each build against its own
// server on a fixed seed, in headless Chrome on the real GPU at 1920 x 1080 and High quality with vsync and the frame
// limit off (lib.js launchChrome's perf: true - the one thing that may draw uncapped, for six minutes at the most).
// "Before" is a tree of another commit (by default the tag perf-baseline, in a temporary worktree), "after" is this
// tree; the builds alternate (A, B, A, B, ...) and the table is the median of the rounds.
//
// usage: node scripts/perf/bench.js [--rounds 3] [--before perf-baseline | <dir> | none] [--part island,mainland]
//                                   [--seconds 6] [--capped] [--label name] [--out shots/perf] [--report]
//   --before none   this tree only (a baseline run, a look while working)
//   --capped        vsync on, 1280 x 720 at the most: frame rates mean nothing then, but draw calls, triangles, the
//                   JavaScript per frame and the GPU's time per frame do - what a working iteration needs
//   --report        no run: the tables from the JSON already in --out (see report.js)
//
// A browser lives one "part" of one build in one round: the island (the menu, the picker, the join, scenes 1-7 and
// the crossing) or the mainland (scenes 8-13). Between the timed stretches the page draws at 60 frames a second at
// the most, so the machine is only driven flat out while a scene is being timed.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join as pjoin, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO, parseArgs, sleep, startGame, launchChrome, tempWorktree, badPasswordAttempts, list, PERF_LIFE_MAX } from '../clip/lib.js';
import { SEED, SPOT, DAY, NIGHT, baitOf, joinBot, INSTRUMENT, chat, throttle, loadMenu, pickerFreeze, join, stand, flashlight, measure, summarize } from './lib.js';
import { CROSSING } from '../../shared/acts.js';
import { report } from './report.js';

const args = parseArgs(process.argv.slice(2), { rounds: '3', before: 'perf-baseline', part: 'island,mainland', seconds: '6', out: pjoin(REPO, 'shots', 'perf'), label: '' });
const OUT = resolve(args.out);
mkdirSync(OUT, { recursive: true });
if (args.report) {
  console.log(report(OUT, { label: args.label || null }));
  process.exit(0);
}
const SECONDS = Math.min(8, +args.seconds);
const CAPPED = !!args.capped;
const parts = list(args.part);
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const launches = { capped: 0, uncapped: 0, uncappedSeconds: 0 };
const counter = [badPasswordAttempts()];
let retakes = 0;

const page0 = { quality: 'high', renderScale: 1 };
const HORDE = [['walker', 20], ['walker', 20], ['runner', 20], ['walker', 20], ['walker', 20], ['runner', 20], ['walker', 20], ['walker', 20]]; // + scene 3's 40 = 200
// (no boomers: one that bursts takes thirty of the horde with it, and the scene is another scene)
const SPECIALS = [['walker', 20], ['runner', 5], ['spitter', 5], ['leaper', 5], ['roper', 5]];
const BOSSES = ['tank', 'boss_brute', 'boss_bloater', 'boss_abomination', 'boss_hivequeen'];

const zombies = (page) => page.evaluate(() => window.__bench.zombies());
// the bait stands `d` ahead of the camera and calls the dead up round itself: each lot 12 m from it, on the side away
// from the camera (the dead go for whoever is nearest: every one of them is then nearer the bait)
async function spawnRound(bait, spot, lots) {
  let k = 0;
  for (const [type, n] of lots) {
    bait.face(spot.yaw + ((k++ % 5) - 2) * 0.55);
    await sleep(260);
    bait.chat(`/spawn ${type} ${n}`);
    await sleep(240);
  }
  bait.face(spot.yaw + Math.PI); // (it looks back at the camera)
}
// wait until `want` of the dead are in the camera's view (and no fewer the next second), `max` seconds at the most
async function settle(page, want, max = 30) {
  let z = null;
  for (let t = 0; t < max; t++) {
    await sleep(1000);
    z = await zombies(page);
    if (z.seen >= want) {
      await sleep(1500);
      const z2 = await zombies(page);
      if (z2.seen >= want) return { ...z2, waited: t + 2.5 };
    }
  }
  return { ...z, waited: max, short: true };
}
async function heap(page) {
  const cdp = await page.createCDPSession();
  try {
    await cdp.send('HeapProfiler.collectGarbage');
    await sleep(300);
    // (the heap proper, and with the memory its typed arrays hold outside it: the world's vertex data lives there)
    const h = await cdp.send('Runtime.getHeapUsage');
    return { heapMB: h.usedSize / 1048576, withBuffersMB: (h.usedSize + (h.backingStorageSize || 0)) / 1048576 };
  } finally {
    await cdp.detach().catch(() => {});
  }
}
// (the throttle lasts as long as the session that set it: one session is kept for the page)
const cpuSessions = new WeakMap();
async function cpuRate(page, rate) {
  let cdp = cpuSessions.get(page);
  if (!cdp) cpuSessions.set(page, (cdp = await page.createCDPSession()));
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
}

// How fast the machine is just now: a fixed piece of arithmetic timed in the page (ms). A session in which it took
// much longer than in the others had the machine busy with something else, and is taken again.
const cpuProbe = (page) =>
  page.evaluate(() => {
    const run = () => {
      const t = performance.now();
      let h = 1;
      for (let i = 0; i < 30_000_000; i++) h = Math.imul(h ^ i, 2654435761) >>> 0;
      return [performance.now() - t, h];
    };
    return Math.min(run()[0], run()[0], run()[0]);
  });
let bestProbe = Infinity;

async function session(tree, label, round, part, retake = false) {
  const res = { retake, label, round, part, seed: SEED, capped: CAPPED, seconds: SECONDS, started: new Date().toISOString(), scenes: {}, extra: {} };
  let game = null, chrome = null;
  const bots = [];
  const t0 = Date.now();
  try {
    game = await startGame(tree, { seed: SEED, env: { NODE_ENV: 'test', DEV_ADMIN: '1' } });
    chrome = await launchChrome({ width: CAPPED ? 1280 : 1920, height: CAPPED ? 720 : 1080, gpu: true, perf: !CAPPED, life: PERF_LIFE_MAX, storage: { 'stn.settings': JSON.stringify(page0), 'stn.character': '3', 'stn.name': 'bench' } });
    launches[CAPPED ? 'capped' : 'uncapped']++;
    const page = chrome.page;
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
    await page.evaluateOnNewDocument(INSTRUMENT);
    res.extra.loadMs = await loadMenu(page, game.url);
    res.probe = [await cpuProbe(page)];
    res.machine = await page.evaluate(() => {
      const gl = window.__game.renderer.renderer.getContext();
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      return { gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '?', ua: navigator.userAgent, size: [innerWidth, innerHeight], dpr: devicePixelRatio, quality: window.__game.renderer.quality, cores: navigator.hardwareConcurrency };
    });
    const sc = async (name, opts) => {
      if (args.shots) await page.screenshot({ path: pjoin(OUT, `${args.label || 'shot'}-${label}-${name.slice(0, 2)}.jpg`), type: 'jpeg', quality: 85 });
      const m = await measure(page, SECONDS, opts);
      m.zombies = await zombies(page);
      res.scenes[name] = m;
      console.log(`  ${label} r${round} ${name.padEnd(28)} ${m.fps.toFixed(1).padStart(6)} fps  p99 ${m.ms.p99?.toFixed(1)} worst ${m.ms.worst?.toFixed(1)} ms  js ${m.jsMs?.toFixed(2)} gpu ${m.gpuMs?.toFixed(2) ?? 'n/a'}  calls ${m.calls} tris ${(m.tris / 1e6).toFixed(2)}M  dead ${m.zombies.seen}/${m.zombies.all}${m.stalled ? '  STALLED' : ''}`);
      return m;
    };
    if (part === 'island') {
      res.extra.picker = await pickerFreeze(page);
      res.extra.joinMs = await join(page);
      for (let i = 0; i < 7; i++) bots.push(await joinBot(game.url, `survivor${i + 1}`, i < 3 ? i : i + 1));
      const S = SPOT.island;
      const park = (from = 0) => bots.slice(from).forEach((b, i) => b.tp(S.at[0] + Math.sin(S.yaw) * (160 + i * 2), S.at[1] + Math.cos(S.yaw) * (160 + i * 2)));
      park();
      await stand(page, S);
      await sleep(3500);
      await sc('01 island, nothing around');
      // seven survivors in an arc in front of the camera, facing it
      bots.forEach((b, i) => {
        const a = S.yaw + (i - 3) * 0.2;
        b.tp(S.at[0] - Math.sin(a) * (6 + (i % 2) * 2.5), S.at[1] - Math.cos(a) * (6 + (i % 2) * 2.5));
        b.face(a + Math.PI);
      });
      await sleep(3000);
      await sc('02 island, 7 survivors');
      // the dead: called up round a bait that stands ahead of the camera
      park(1);
      const bait = bots[0];
      const bp = baitOf(S);
      bait.tp(bp[0], bp[1]);
      await sleep(1200);
      await page.evaluate(() => (window.__bench.watch = { max: 0 }));
      await spawnRound(bait, S, SPECIALS);
      let st = await settle(page, 36, 25);
      res.extra.spawn40 = st;
      await sc('03 island, 40 specials');
      await spawnRound(bait, S, HORDE);
      st = await settle(page, 180, 35);
      res.extra.spawn200 = st;
      res.extra.spawnWorstJsMs = await page.evaluate(() => window.__bench.watch.max);
      await page.evaluate(() => (window.__bench.watch = null)); // (the longest a frame's JavaScript ran while 200 of the dead came into being)
      await sc('04 island, 200 horde, day');
      await page.evaluate((c) => (window.__game.debugCycle = c), NIGHT);
      res.extra.flash = await flashlight(page, true);
      await sleep(4000);
      await sc('05 island, 200 horde, night');
      await flashlight(page, false);
      await page.evaluate((c) => (window.__game.debugCycle = c), DAY);
      bait.face(S.yaw);
      await sleep(300);
      for (const b of BOSSES) {
        bait.chat(`/spawn ${b}`);
        await sleep(250);
      }
      bait.face(S.yaw + Math.PI);
      await settle(page, 185, 14);
      await sleep(2500);
      await sc('06 island, horde + 5 bosses');
      await cpuRate(page, 4);
      await sc('07 same, CPU 4x slower');
      await cpuRate(page, 1);
      res.extra.heapIslandMB = await heap(page);
      res.extra.gpuMemIsland = await page.evaluate(() => window.__bench.gpuMem());
      // the crossing: every frame of the cutscene, from the car leaving to the bridgehead
      await throttle(page, 0);
      await page.evaluate(() => window.__bench.start());
      const c0 = Date.now();
      await chat(page, '/cross');
      let swapped = 0;
      for (let i = 0; i < 520; i++) {
        await sleep(100);
        const s = await page.evaluate(() => ({ act: window.__game.act, phase: window.__game.global.phase }));
        if (!swapped && s.act === 2) swapped = Date.now() - c0;
        if (swapped && s.phase !== 5) break; // (PHASE.CROSSING)
      }
      const R = await page.evaluate(() => window.__bench.stop());
      await throttle(page, 16);
      const all = summarize(R);
      // the world swap: the longest frame from the cut to black (CROSSING.SWAP) until the mainland is up
      const dts = R.t.slice(1).map((t, i) => [t - R.t[0], t - R.t[i]]);
      const swapWin = dts.filter(([at]) => at > (CROSSING.SWAP - 1) * 1000 && at < (CROSSING.SWAP + 12) * 1000).map((d) => d[1]);
      const rest = dts.filter(([at]) => !(at > (CROSSING.SWAP - 1) * 1000 && at < (CROSSING.SWAP + 12) * 1000)).map((d) => d[1]);
      const hitch = swapWin.length ? Math.max(...swapWin) : null;
      res.scenes['14 the crossing (40 s)'] = { ...all, stalled: false, ms: { ...all.ms, worstOutsideSwap: rest.length ? Math.max(...rest) : null }, swapHitchMs: hitch, swapAfterMs: swapped, calls: 0, tris: 0, zombies: { all: 0, seen: 0 } };
      res.extra.swapHitchMs = hitch;
      console.log(`  ${label} r${round} 14 the crossing              ${all.fps.toFixed(1).padStart(6)} fps  worst ${all.ms.worst?.toFixed(0)} ms (the world swap ${hitch?.toFixed(0)} ms, elsewhere ${rest.length ? Math.max(...rest).toFixed(0) : '?'} ms)  ${all.seconds.toFixed(1)} s`);
      await sleep(2500);
      res.extra.heapAfterCrossingMB = await heap(page);
    } else {
      res.extra.joinMs = await join(page);
      const bait = await joinBot(game.url, 'bait', 5);
      bots.push(bait);
      await chat(page, '/cross skip');
      for (let i = 0; i < 400 && !(await page.evaluate(() => window.__game.act === 2 && !window.__game.warm && window.__game.global.phase !== 5)); i++) await sleep(100);
      await sleep(3000);
      res.extra.heapMainlandMB = await heap(page);
      const S = SPOT.street;
      bait.tp(SPOT.airfield.at[0], SPOT.airfield.at[1] + 60);
      await stand(page, S);
      await sleep(3500);
      await sc('08 mainland, Main Street');
      await stand(page, SPOT.roof);
      await sleep(3500);
      await sc('09 mainland, city from a roof');
      await stand(page, SPOT.shop);
      await sleep(3500);
      await sc('10 mainland, inside a shop');
      await stand(page, S, NIGHT);
      res.extra.flash = await flashlight(page, true);
      const bp = baitOf(S);
      bait.tp(bp[0], bp[1]);
      await sleep(1500);
      await page.evaluate(() => (window.__bench.watch = { max: 0 }));
      // (a street between its walls: some of a lot find no room, so lots are called until there are 200)
      for (let k = 0; k < 4; k++) {
        await spawnRound(bait, S, k ? HORDE.slice(0, 3) : [...HORDE, ['walker', 20], ['walker', 20]]);
        await sleep(600);
        if ((await zombies(page)).all >= 195) break;
      }
      res.extra.spawnCity = await settle(page, 150, 35);
      res.extra.spawnWorstJsMs = await page.evaluate(() => window.__bench.watch.max);
      await page.evaluate(() => (window.__bench.watch = null));
      await sc('11 mainland, street horde, night');
      await cpuRate(page, 4);
      await sc('13 same, CPU 4x slower');
      await cpuRate(page, 1);
      // the runway stand: the engines started, the dead on the strip, a boss among them
      await flashlight(page, false);
      const A = SPOT.airfield;
      await stand(page, A);
      const ap = baitOf(A, 16);
      bait.tp(ap[0], ap[1]);
      await sleep(2500);
      await chat(page, '/engine');
      await sleep(1200);
      await spawnRound(bait, A, [...SPECIALS.slice(0, 1), ...HORDE]);
      bait.face(A.yaw);
      await sleep(300);
      bait.chat('/spawn boss_abomination');
      await sleep(300);
      bait.face(A.yaw + Math.PI);
      res.extra.spawnAirfield = await settle(page, 150, 35);
      res.extra.finale = await page.evaluate(() => !!window.__game.global.finale);
      await sc('12 mainland, runway stand');
      res.extra.gpuMemMainland = await page.evaluate(() => window.__bench.gpuMem());
    }
    res.probe.push(await cpuProbe(page));
    res.errors = errors;
  } catch (e) {
    res.error = String(e && e.stack ? e.stack : e).slice(0, 1500);
    console.error(`  ${label} r${round} ${part}: ${res.error}`);
  } finally {
    for (const b of bots) b.close();
    res.browserSeconds = chrome ? (Date.now() - chrome.born) / 1000 : 0;
    if (!CAPPED) launches.uncappedSeconds += res.browserSeconds;
    await chrome?.close().catch((e) => {
      console.error(String(e));
      res.fatal = String(e);
    });
    game?.stop();
    counter.push(badPasswordAttempts());
  }
  res.took = (Date.now() - t0) / 1000;
  if (res.fatal) throw new Error(res.fatal); // (the failed sign-in counter rose: nothing more is launched)
  // a session the machine was busy in (its arithmetic half as slow again as the quickest session's, or a run that
  // failed) is not kept: it is taken again, once
  const probe = res.probe?.length ? Math.max(...res.probe) : Infinity;
  bestProbe = Math.min(bestProbe, probe);
  res.busy = probe > bestProbe * 1.5;
  const file = pjoin(OUT, `${stamp}${args.label ? '-' + args.label : ''}-${label}-r${round}-${part}.json`);
  if ((res.busy || res.error) && !res.retake) {
    console.log(`  ${label} r${round} ${part}: ${res.error ? 'failed' : `the machine was busy (probe ${probe.toFixed(0)} ms against ${bestProbe.toFixed(0)})`} - taken again`);
    writeFileSync(file.replace(/\.json$/, '.discarded'), JSON.stringify(res));
    retakes++;
    await sleep(6000);
    const again = await session(tree, label, round, part, true);
    return again;
  }
  writeFileSync(file, JSON.stringify(res));
  return res;
}

// ---------------------------------------------------------------- the builds
const build = (dir) => execFileSync(process.execPath, [pjoin(dir, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { cwd: dir, stdio: 'ignore' });
let before = null, wt = null;
if (args.before !== 'none') {
  if (existsSync(resolve(String(args.before), 'package.json'))) before = resolve(String(args.before));
  else {
    wt = tempWorktree(String(args.before));
    before = wt.dir;
  }
}
try {
  console.log(`building ${before ? 'before (' + args.before + ') and ' : ''}after ...`);
  if (before) build(before);
  build(REPO);
  for (let round = 1; round <= +args.rounds; round++) {
    for (const part of parts) {
      for (const [label, tree] of before ? [['before', before], ['after', REPO]] : [['after', REPO]]) {
        await session(tree, label, round, part);
        await sleep(CAPPED ? 500 : 4000); // (the machine gets its breath back between two uncapped browsers)
      }
    }
  }
} finally {
  wt?.remove();
}
console.log(`\nbrowsers: ${launches.capped} capped, ${launches.uncapped} uncapped (${launches.uncappedSeconds.toFixed(0)} s of browser in all, ${retakes} sessions taken again); the account's failed sign-in counter read ${counter.join(', ')}`);
console.log('\n' + report(OUT, { stamp: stamp + (args.label ? '-' + args.label : '') }));
