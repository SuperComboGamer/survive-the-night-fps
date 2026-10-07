// What the colliders cost (docs/hitboxes.md): the same rays and the same steps of a body, on the same valley, in
// this tree and in another - a bullet's ray (raycastWorld), a body pushed out of what it walked into (resolveBody), the
// ground under its feet (groundAt), an arm's reach (canReach) - and the time the dead's nav grid takes to build.
// Where things stand is the same in both trees (a prop's colliders change, nothing moves), so the spots are the same.
// usage: node scripts/hitbox/bench.js [--before <tree>] [--seed 4242] [--n 200000] [--rounds 5]
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseArgs, REPO } from '../clip/lib.js';

const args = parseArgs(process.argv.slice(2), { seed: '4242', n: '200000', rounds: '5' });
const N = +args.n;

async function load(tree) {
  const imp = (p) => import(pathToFileURL(join(tree, p)).href);
  const { worldFor } = await imp('shared/worlds.js');
  const col = await imp('shared/collision.js');
  const { Nav } = await imp('server/nav.js');
  return { worldFor, col, Nav };
}
// the spots: near the props (where the colliders that changed are), the same for every tree
function spotsOf(world, n) {
  let s = 12345;
  const rnd = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const solid = world.props.filter((p) => !p.live);
  const out = new Float64Array(n * 6);
  for (let i = 0; i < n; i++) {
    const p = solid[Math.floor(rnd() * solid.length)];
    const a = rnd() * Math.PI * 2, d = 0.5 + rnd() * 6;
    const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
    const yaw = rnd() * Math.PI * 2, pitch = (rnd() - 0.5) * 0.5;
    out.set([x, world.heightAt(x, z), z, Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch)], i * 6);
  }
  return out;
}
function run(T, world, S) {
  const { raycastWorld, resolveBody, groundAt, canReach } = T.col;
  const res = {};
  const time = (name, fn) => {
    let best = Infinity, sum = 0;
    for (let r = 0; r < +args.rounds; r++) {
      const t = performance.now();
      sum = fn();
      best = Math.min(best, performance.now() - t);
    }
    res[name] = { ns: (best * 1e6) / N, sum };
  };
  const ray = { t: -1, col: null, terrain: false };
  const pos = { x: 0, y: 0, z: 0 };
  time('a bullet (raycastWorld, 60 m)', () => {
    let hits = 0;
    for (let i = 0; i < N; i++) hits += raycastWorld(world, S[i * 6], S[i * 6 + 1] + 1.5, S[i * 6 + 2], S[i * 6 + 3], S[i * 6 + 4], S[i * 6 + 5], 60, ray).t >= 0 ? 1 : 0;
    return hits;
  });
  time('a look or a claw (raycastWorld, 8 m)', () => {
    let hits = 0;
    for (let i = 0; i < N; i++) hits += raycastWorld(world, S[i * 6], S[i * 6 + 1] + 1.0, S[i * 6 + 2], S[i * 6 + 3], 0, S[i * 6 + 5], 8, ray).t >= 0 ? 1 : 0;
    return hits;
  });
  time('a body (resolveBody + groundAt)', () => {
    let pushed = 0;
    for (let i = 0; i < N; i++) {
      pos.x = S[i * 6];
      pos.y = S[i * 6 + 1];
      pos.z = S[i * 6 + 2];
      if (resolveBody(world, pos, 0.35, 1.8)) pushed++;
      groundAt(world, pos.x, pos.z, pos.y, 0.245);
    }
    return pushed;
  });
  time('an arm (canReach, 2.8 m)', () => {
    let ok = 0;
    for (let i = 0; i < N; i++) ok += canReach(world, S[i * 6], S[i * 6 + 1] + 1.62, S[i * 6 + 2], S[i * 6] + S[i * 6 + 3] * 2.8, S[i * 6 + 1] + 0.8, S[i * 6 + 2] + S[i * 6 + 5] * 2.8, S[i * 6 + 1] + 1.62) ? 1 : 0;
    return ok;
  });
  return res;
}

// (each tree in a process of its own: the second one measured in one process pays for the first one's compiled code)
const trees = [['after', REPO]];
if (args.before) trees.unshift(['before', resolve(String(args.before))]);
const out = {};
for (const [name, tree] of trees) {
  if (!args.tree) {
    const o = execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--tree', tree, '--seed', String(args.seed), '--n', String(N), '--rounds', String(args.rounds)], { encoding: 'utf8', maxBuffer: 1 << 24 });
    out[name] = JSON.parse(o.slice(o.lastIndexOf('@@') + 2));
    continue;
  }
  const T = await load(resolve(String(args.tree)));
  out[name] = {};
  for (const [map, act] of [['island', 1], ['mainland', 2]]) {
    const world = T.worldFor(+args.seed, act);
    const S = spotsOf(world, N);
    const r = run(T, world, S);
    let nav = Infinity;
    for (let k = 0; k < 3; k++) {
      const t = performance.now();
      new T.Nav(world);
      nav = Math.min(nav, performance.now() - t);
    }
    out[name][map] = { colliders: world.staticGrid.count, nav, ...r };
  }
}
if (args.tree) {
  process.stdout.write('@@' + JSON.stringify(out.after));
  process.exit(0);
}
const f = (x, d = 0) => x.toFixed(d);
for (const map of ['island', 'mainland']) {
  console.log(`\n${map} (seed ${args.seed}, ${N} of each, the best of ${args.rounds} rounds)`);
  const b = out.before?.[map], a = out.after[map];
  console.log(`| | ${b ? 'before | ' : ''}after |\n|---|---|${b ? '---|' : ''}`);
  console.log(`| colliders in the world | ${b ? b.colliders + ' | ' : ''}${a.colliders} |`);
  for (const k of Object.keys(a)) if (a[k].ns !== undefined) console.log(`| ${k} | ${b ? `${f(b[k].ns)} ns (${b[k].sum} stopped) | ` : ''}${f(a[k].ns)} ns (${a[k].sum} stopped) |`);
  console.log(`| the dead's nav grid, built | ${b ? f(b.nav) + ' ms | ' : ''}${f(a.nav)} ms |`);
}
