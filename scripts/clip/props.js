// World props standing in each other, over many valleys (docs/object-clipping.md, "World placement"). Generates
// createWorld(seed) for each seed and finds every pair of solids that go into each other, seen from above with their
// heights overlapping: props (their collider boxes and cylinders, shared/props.js), trees, boulders, and the upright
// pieces a place builds (walls, posts, machines: world.parts). Prints the count per kind of pair and, with --show,
// each one with the /tp to stand at it in the game (as an admin: an is_admin account, or DEV_ADMIN=1 on a test server).
// scripts/test-world.js checks the same on its four valleys as part of npm test; this is the wide net.
//
// usage: node scripts/clip/props.js [--seeds 1-30] [--root <tree>] [--min 0.1] [--show car_wreck] [--all] [--world mainland]
//   --seeds  a range a-b or a list (default 1-30)
//   --min    how far into each other counts (m, default 0.1: touching is fine)
//   --show   list each overlap whose pair names match (a regular expression)
//   --all    count sandbag against sandbag too (walls of them are laid overlapping on purpose)
//   --world  mainland: the run's second map (shared/mainland.js) instead of the island
// npm run clip:props -- --seeds 1-100
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { parseArgs, REPO } from './lib.js';

const args = parseArgs(process.argv.slice(2), { seeds: '1-30', min: '0.1' });
const root = resolve(args.root || REPO);
const { createWorld: createIsland, TREE_TYPES, ROCK_TYPES } = await import(pathToFileURL(join(root, 'shared', 'world.js')).href);
const createWorld = args.world === 'mainland' ? (await import(pathToFileURL(join(root, 'shared', 'mainland.js')).href)).createMainland : createIsland;
const { PROPS } = await import(pathToFileURL(join(root, 'shared', 'props.js')).href);
const { ZONE_NAMES } = await import(pathToFileURL(join(root, 'shared', 'defs.js')).href);
const seeds = String(args.seeds).includes('-') ? (([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i))(String(args.seeds).split('-').map(Number)) : String(args.seeds).split(',').map(Number);

// a solid seen from above: a turned box (half sizes hx, hz, axes c / s) or a circle (r), and its height range
function solids(world) {
  const out = [];
  world.props.forEach((p, i) => {
    const def = PROPS[p.type];
    if (!def) return;
    const c = Math.cos(p.ry), s = Math.sin(p.ry);
    for (const [lx, ly, lz, sx, sy, sz] of def.boxes || []) out.push({ x: p.x + c * lx + s * lz, z: p.z - s * lx + c * lz, hx: sx / 2, hz: sz / 2, c, s, r: 0, y0: p.y + ly - sy / 2, y1: p.y + ly + sy / 2, who: p.type, id: 'p' + i });
    for (const [lx, lz, r, h] of def.cyls || []) out.push({ x: p.x + c * lx + s * lz, z: p.z - s * lx + c * lz, hx: 0, hz: 0, c: 1, s: 0, r, y0: p.y, y1: p.y + h, who: p.type, id: 'p' + i });
  });
  const t = world.trees;
  for (let i = 0; i < t.length; i += 6) out.push({ x: t[i], z: t[i + 2], hx: 0, hz: 0, c: 1, s: 0, r: TREE_TYPES[t[i + 5]].r * t[i + 3], y0: t[i + 1] - 1, y1: t[i + 1] + 14 * t[i + 3], who: 'tree', id: 't' + i });
  const k = world.rocks;
  for (let i = 0; i < k.length; i += 6) out.push({ x: k[i], z: k[i + 2], hx: 0, hz: 0, c: 1, s: 0, r: ROCK_TYPES[k[i + 5]].r * k[i + 3] * 0.85, y0: k[i + 1] - 1, y1: k[i + 1] + ROCK_TYPES[k[i + 5]].r * k[i + 3] * 0.9, who: 'rock', id: 'r' + i });
  world.parts.forEach((p, i) => {
    if (p.rx || p.rz || p.sy < 1 || (p.shape !== 'box' && p.shape !== 'cyl')) return;
    const box = p.shape === 'box';
    out.push({ x: p.x, z: p.z, hx: box ? p.sx / 2 : 0, hz: box ? p.sz / 2 : 0, c: Math.cos(p.ry), s: Math.sin(p.ry), r: box ? 0 : p.sx / 2, y0: p.y - p.sy / 2, y1: p.y + p.sy / 2, who: 'wall:' + p.mat, id: 'w' + i, wall: true });
  });
  return out;
}
// how far two solids go into each other across (0: apart), by separating axes; a circle against a box near its corner
// by the nearest point
function depth(a, b) {
  if (Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) < 0.05) return 0;
  if (!a.hx && !b.hx) return Math.max(0, a.r + b.r - Math.hypot(a.x - b.x, a.z - b.z));
  let d = Infinity;
  for (const o of [a, b]) {
    if (!o.hx) continue;
    for (const [ax, az] of [[o.c, -o.s], [o.s, o.c]]) {
      const ext = (q) => q.hx * Math.abs(q.c * ax - q.s * az) + q.hz * Math.abs(q.s * ax + q.c * az) + q.r;
      d = Math.min(d, ext(a) + ext(b) - Math.abs((a.x - b.x) * ax + (a.z - b.z) * az));
      if (d <= 0) return 0;
    }
  }
  if (!a.hx || !b.hx) {
    const [cy, bx] = a.hx ? [b, a] : [a, b];
    const dx = cy.x - bx.x, dz = cy.z - bx.z;
    const lx = bx.c * dx - bx.s * dz, lz = bx.s * dx + bx.c * dz;
    d = Math.min(d, cy.r - Math.hypot(Math.max(0, Math.abs(lx) - bx.hx), Math.max(0, Math.abs(lz) - bx.hz)));
  }
  return Math.max(0, d);
}
export function overlaps(world, min = 0.1, all = false) {
  const items = solids(world);
  const cells = new Map();
  items.forEach((o, i) => {
    const e = Math.hypot(o.hx, o.hz) + o.r;
    for (let gx = Math.floor((o.x - e) / 8); gx <= Math.floor((o.x + e) / 8); gx++)
      for (let gz = Math.floor((o.z - e) / 8); gz <= Math.floor((o.z + e) / 8); gz++) {
        const key = gx * 65536 + gz;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(i);
      }
  });
  const veg = (o) => o.who === 'tree' || o.who === 'rock';
  const best = new Map();
  for (const ids of cells.values())
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const a = items[ids[i]], b = items[ids[j]];
        if (a.id === b.id || (veg(a) && veg(b)) || (a.wall && b.wall)) continue;
        if (!all && a.who === 'sandbags' && b.who === 'sandbags') continue;
        const d = depth(a, b);
        if (d < min) continue;
        const key = [a.id, b.id].sort().join('|');
        if (!best.has(key) || best.get(key).d < d) best.set(key, { d, a: a.who, b: b.who, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
      }
  return [...best.values()];
}

const pairs = new Map();
let total = 0;
const shown = [];
for (const seed of seeds) {
  const w = createWorld(seed);
  for (const h of overlaps(w, +args.min, !!args.all)) {
    const k = [h.a.replace(/^wall:.*/, 'wall'), h.b.replace(/^wall:.*/, 'wall')].sort().join(' x ');
    pairs.set(k, (pairs.get(k) || 0) + 1);
    total++;
    if (args.show && new RegExp(args.show).test(`${h.a} ${h.b}`)) {
      const zn = w.zones.reduce((m, z) => (Math.hypot(z.x - h.x, z.z - h.z) < Math.hypot(m.x - h.x, m.z - h.z) ? z : m));
      shown.push(`seed ${seed}: a ${h.a} ${Math.round(h.d * 100)} cm into a ${h.b}, near ${ZONE_NAMES[zn.id] || zn.id}: /tp ${h.x.toFixed(1)} ${h.z.toFixed(1)}`);
    }
  }
}
console.log(`${total} overlaps over ${args.min} m in ${seeds.length} valleys (seeds ${args.seeds})${args.all ? '' : ', not counting sandbag on sandbag'}`);
for (const [k, n] of [...pairs].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(6)}  ${k}`);
for (const s of shown) console.log('  ' + s);
