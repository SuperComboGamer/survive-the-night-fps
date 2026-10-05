// "World generation's output did not change": a fingerprint of everything a generated world holds - its heightfield
// and road fields, trees, rocks, bushes, every part, prop, light, roof, opening, container, loot and spawn spot,
// zone, road, and on the mainland its river, city (buildings, rooms, shells, heaps, signs), runway and farms - for
// each of a list of seeds on both maps, from this tree and from another (by default the tag perf-baseline, in a
// temporary worktree), compared.
// usage: node scripts/perf/world-hash.js [--before perf-baseline | <dir> | none] [--seeds 1-16]
//        node scripts/perf/world-hash.js --tree <dir> --seeds 1-16     (one tree's fingerprints, as JSON)
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO, parseArgs, tempWorktree } from '../clip/lib.js';

const args = parseArgs(process.argv.slice(2), { before: 'perf-baseline', seeds: '1-16' });
const [s0, s1] = String(args.seeds).split('-').map(Number);
const seeds = [];
for (let s = s0; s <= (s1 || s0); s++) seeds.push(s);

function digest(world) {
  const h = createHash('sha256');
  const seen = new Set();
  // every own value of the world that is data: typed arrays as their bytes, the rest as JSON (functions, the
  // collider grids built from the parts, and anything met twice are left out)
  const walk = (v, depth) => {
    if (v === null || v === undefined) return void h.update('n');
    if (ArrayBuffer.isView(v)) return void h.update(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
    if (typeof v === 'function') return;
    if (typeof v !== 'object') return void h.update(typeof v === 'number' ? String(Object.is(v, -0) ? 0 : v) : String(v));
    if (seen.has(v) || depth > 12) return;
    seen.add(v);
    if (v instanceof Map || v instanceof Set) return void walk([...v], depth + 1);
    if (Array.isArray(v)) {
      h.update('[' + v.length);
      for (const x of v) walk(x, depth + 1);
      return;
    }
    for (const k of Object.keys(v).sort()) {
      if (/Grid$|^colliderGrids$|^zoneById$/.test(k)) continue;
      h.update(k);
      walk(v[k], depth + 1);
    }
  };
  walk(world, 0);
  return h.digest('hex').slice(0, 20);
}

if (args.tree) {
  const tree = resolve(String(args.tree));
  const { worldFor } = await import(pathToFileURL(join(tree, 'shared/worlds.js')).href);
  const out = {};
  for (const s of seeds) out[s] = [digest(worldFor(s, 1)), digest(worldFor(s, 2))];
  process.stdout.write('\n@@' + JSON.stringify(out) + '\n');
  process.exit(0);
}

const one = (tree) => {
  const o = execFileSync(process.execPath, [join(REPO, 'scripts', 'perf', 'world-hash.js'), '--tree', tree, '--seeds', String(args.seeds)], { encoding: 'utf8', maxBuffer: 1 << 26 });
  return JSON.parse(o.slice(o.lastIndexOf('@@') + 2));
};
let wt = null;
try {
  const after = one(REPO);
  if (args.before === 'none') {
    for (const s of seeds) console.log(`seed ${s}: island ${after[s][0]}  mainland ${after[s][1]}`);
  } else {
    let tree = resolve(String(args.before));
    if (!existsSync(join(tree, 'package.json'))) {
      wt = tempWorktree(String(args.before));
      tree = wt.dir;
    }
    const before = one(tree);
    let diff = 0;
    for (const s of seeds) {
      const same = [before[s][0] === after[s][0], before[s][1] === after[s][1]];
      if (!same[0] || !same[1]) diff++;
      console.log(`seed ${String(s).padStart(3)}: island ${after[s][0]} ${same[0] ? 'same' : 'DIFFERS (' + before[s][0] + ')'}   mainland ${after[s][1]} ${same[1] ? 'same' : 'DIFFERS (' + before[s][1] + ')'}`);
    }
    console.log(diff ? `\n${diff} of ${seeds.length} seeds DIFFER from ${args.before}` : `\nall ${seeds.length} seeds: both worlds identical to ${args.before}`);
    process.exitCode = diff ? 1 : 0;
  }
} finally {
  wt?.remove();
}
