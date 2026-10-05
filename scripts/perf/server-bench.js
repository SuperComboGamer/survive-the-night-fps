// What the server costs (docs/performance.md), in node alone, no browser: a tick of the simulation with a night-4
// horde up for 4 and for 8 players on the island and on the mainland (mean, p99, worst), the bytes of snapshot a
// player is sent a second, the time it takes to generate each world and to start a game on it - and a fingerprint of
// what the simulation did, tick by tick, so two builds can be shown to have simulated the very same thing.
//
// usage: node scripts/perf/server-bench.js [--before perf-baseline | <dir> | none] [--rounds 3] [--out shots/perf]
//        node scripts/perf/server-bench.js --tree <dir> --json      (one measurement of one tree: what the above runs)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { REPO, parseArgs, tempWorktree } from '../clip/lib.js';
import { median } from './lib.js';

const args = parseArgs(process.argv.slice(2), { before: 'perf-baseline', rounds: '3', out: join(REPO, 'shots', 'perf') });
const SEED = 4242;

async function one(tree) {
  const imp = (p) => import(pathToFileURL(join(tree, p)).href);
  const { Game } = await imp('server/game.js');
  const { C2S, S2C, PROTOCOL_VERSION, Writer } = await imp('shared/protocol.js');
  const { WORLD } = await imp('shared/acts.js');
  const { ZONE } = await imp('shared/defs.js');
  const { worldFor } = await imp('shared/worlds.js');
  const quiet = () => {};
  const out = { gen: {}, tick: {} };
  // generating a world (the second and third of three: the first pays for the code being compiled)
  for (const [name, act] of [['island', WORLD.ISLAND], ['mainland', WORLD.MAINLAND]]) {
    const ms = [];
    for (let k = 0; k < 3; k++) {
      const t = performance.now();
      worldFor(SEED + k, act);
      ms.push(performance.now() - t);
    }
    out.gen[name] = Math.min(ms[1], ms[2]);
  }
  const client = (game, name) => {
    const c = { id: 0, bytes: 0 };
    c.conn = {
      ip: name,
      send(b) {
        if (b[0] === S2C.WELCOME) c.id = b[1] | (b[2] << 8);
        else if (b[0] === S2C.SNAPSHOT) c.bytes += b.length;
      },
    };
    c.session = game.onOpen(c.conn);
    const w = new Writer(64);
    w.u8(C2S.JOIN);
    w.u8(PROTOCOL_VERSION);
    w.str(name);
    w.str(randomUUID());
    game.onMessage(c.session, w.bytes());
    return c;
  };
  for (const [name, act] of [['island', WORLD.ISLAND], ['mainland', WORLD.MAINLAND]]) {
    for (const players of [4, 8]) {
      global.gc?.();
      const h0 = process.memoryUsage();
      const t0 = performance.now();
      const game = new Game({ seed: SEED, log: quiet, godMode: true, themes: false });
      const startMs = performance.now() - t0;
      const cs = Array.from({ length: players }, (_, i) => client(game, 'P' + i));
      for (let i = 0; i < 20; i++) game.update();
      if (act === WORLD.MAINLAND) {
        game.cross(game.players.get(cs[0].id));
        game.arrive();
        const city = game.world.zoneById[ZONE.CITY];
        cs.forEach((c, k) => {
          const p = game.players.get(c.id);
          p.state.x = city.x - 20 + k * 3;
          p.state.z = city.z + 4;
          p.state.y = game.world.heightAt(p.state.x, p.state.z) + 0.05;
          p.state.vx = p.state.vy = p.state.vz = 0;
        });
      }
      global.gc?.();
      const h1 = process.memoryUsage();
      game.day = 4;
      game.startNight();
      // what the simulation did: every zombie's place, facing, state and health and every player's place, each tick
      const hash = createHash('sha1');
      const f = new Float64Array(6);
      const digest = () => {
        for (const z of game.zombies) {
          f[0] = z.x;
          f[1] = z.y;
          f[2] = z.z;
          f[3] = z.yaw;
          f[4] = z.hp;
          f[5] = (z.anim << 8) | (z.dead ? 1 : 0) | (z.target << 16);
          hash.update(new Uint8Array(f.buffer));
        }
        for (const p of game.players.values()) {
          f[0] = p.state.x;
          f[1] = p.state.y;
          f[2] = p.state.z;
          f[3] = p.hp ?? 0;
          hash.update(new Uint8Array(f.buffer, 0, 32));
        }
      };
      for (let i = 0; i < 112 * 20; i++) {
        game.update(); // (all three waves come up)
        digest();
      }
      for (const c of cs) c.bytes = 0;
      const n = 1200;
      const ms = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        game.timeLeft += 0.05; // (the night does not end under the measurement)
        const t = performance.now();
        game.update();
        ms[i] = performance.now() - t;
        digest();
      }
      const s = Array.from(ms).sort((a, b) => a - b);
      out.tick[`${name}, ${players} players`] = {
        mean: s.reduce((a, b) => a + b, 0) / n,
        p99: s[Math.floor(n * 0.99)],
        worst: s[n - 1],
        zombies: game.zombies.length,
        ents: game.all.length,
        bytesPerPlayerPerSec: cs.reduce((a, c) => a + c.bytes, 0) / players / (n / 20),
        startMs,
        heapMB: (h1.heapUsed - h0.heapUsed) / 1048576,
        buffersMB: (h1.arrayBuffers - h0.arrayBuffers) / 1048576,
        hash: hash.digest('hex').slice(0, 16),
      };
    }
  }
  return out;
}

if (args.tree) {
  const r = await one(resolve(String(args.tree)));
  process.stdout.write('\n@@' + JSON.stringify(r) + '\n');
  process.exit(0);
}

// ---------------------------------------------------------------- before / after
let before = null, wt = null;
if (args.before !== 'none') {
  if (existsSync(resolve(String(args.before), 'package.json'))) before = resolve(String(args.before));
  else {
    wt = tempWorktree(String(args.before));
    before = wt.dir;
  }
}
const runs = { before: [], after: [] };
try {
  for (let r = 0; r < +args.rounds; r++) {
    for (const [label, tree] of before ? [['before', before], ['after', REPO]] : [['after', REPO]]) {
      const o = execFileSync(process.execPath, ['--expose-gc', join(REPO, 'scripts', 'perf', 'server-bench.js'), '--tree', tree, '--json'], { encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'inherit'] });
      runs[label].push(JSON.parse(o.slice(o.lastIndexOf('@@') + 2)));
      process.stderr.write(`${label} ${r + 1} `);
    }
  }
} finally {
  wt?.remove();
}
const has = runs.before.length > 0;
const f = (v, d = 2) => (v === null || v === undefined ? 'n/a' : v.toFixed(d));
const m = (label, get) => median(runs[label].map(get));
const pair = (get, d = 2, unit = '') => (has ? `${f(m('before', get), d)}${unit} | ${f(m('after', get), d)}${unit}` : `${f(m('after', get), d)}${unit}`);
const lines = [`| Server (node only) | ${has ? 'before | after' : 'value'} |`, has ? '|---|---|---|' : '|---|---|'];
const keys = Object.keys(runs.after[0].tick);
for (const k of keys) {
  const T = (r) => r.tick[k];
  lines.push(`| Tick, night-4 horde, ${k}: mean | ${pair((r) => T(r).mean, 3, ' ms')} |`);
  lines.push(`| ...p99 | ${pair((r) => T(r).p99, 2, ' ms')} |`);
  lines.push(`| ...worst | ${pair((r) => T(r).worst, 1, ' ms')} |`);
  lines.push(`| ...snapshot bytes per player per second | ${pair((r) => T(r).bytesPerPlayerPerSec, 0)} |`);
  lines.push(`| ...zombies / entities in it | ${has ? `${T(runs.before[0]).zombies} / ${T(runs.before[0]).ents} | ` : ''}${T(runs.after[0]).zombies} / ${T(runs.after[0]).ents} |`);
}
for (const w of ['island', 'mainland']) lines.push(`| World generation, ${w} | ${pair((r) => r.gen[w], 0, ' ms')} |`);
lines.push(`| A game's memory once started, island: JS heap / typed arrays | ${pair((r) => r.tick['island, 4 players'].heapMB, 0, ' MB')} / ${pair((r) => r.tick['island, 4 players'].buffersMB, 0, ' MB')} |`);
lines.push(`| A game's memory after the crossing: JS heap / typed arrays | ${pair((r) => r.tick['mainland, 4 players'].heapMB, 0, ' MB')} / ${pair((r) => r.tick['mainland, 4 players'].buffersMB, 0, ' MB')} |`);
if (has) {
  const same = keys.every((k) => runs.before.every((b) => b.tick[k].hash === runs.after[0].tick[k].hash) && runs.after.every((a) => a.tick[k].hash === runs.after[0].tick[k].hash));
  lines.push('', same ? `The simulation is the same in both builds: every zombie's place, facing, state and health and every player's place, hashed after each of ${112 * 20 + 1200} ticks of each of the four runs, give the same fingerprints (${keys.map((k) => runs.after[0].tick[k].hash.slice(0, 8)).join(', ')}).` : `**The simulation differs between the builds:** ${keys.map((k) => `${k}: ${runs.before[0].tick[k].hash.slice(0, 8)} / ${runs.after[0].tick[k].hash.slice(0, 8)}`).join('; ')}.`);
}
lines.push('', `${args.rounds} round${+args.rounds > 1 ? 's' : ''}${has ? ', the builds alternating' : ''}, medians; seed ${SEED}; ${process.version}; 1200 timed ticks after the night's three waves are up.`);
mkdirSync(resolve(args.out), { recursive: true });
writeFileSync(join(resolve(args.out), 'server.md'), lines.join('\n') + '\n');
writeFileSync(join(resolve(args.out), 'server.json'), JSON.stringify(runs));
console.log('\n' + lines.join('\n'));
