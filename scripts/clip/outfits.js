// Clothes against clothes: on every survivor the character creator can make, how far one thing worn pokes through
// another - a shirt through a vest, a pocket through the overalls' bib, hair through a hat, a collar through a beard or
// a ponytail, a vest through the badge pinned on it. (The clip survey, scripts/clip/survey.js, measures what is held
// and the worn pack against the body; this measures the body's own layers, which nothing else does.)
//
// Run in node, no browser: each look is built (models/characters.js, MeshBuilder.debugParts tagging each part:
// people.js mb.tag) and measured in its bind pose - the layers are skinned alike (the clothes take the body's weights
// where they lie: humans.js sheet), so a pose moves them together. For each pair (inner, outer), from every vertex of
// the inner part (its outside: facing away from the trunk's axis, or from the middle of the head) straight back in
// along its normal, as far as REACH: where the outer part is crossed on the way, the vertex is through it by that much.
//
// usage: node scripts/clip/outfits.js [--looks roster,cover,random:N,<label prefix>,...] [--top 30]
//          [--save-baseline file.json] [--baseline file.json] [--tolerance 1]
//   --looks   which: 'roster' (the ten), 'cover' (every part the wardrobe offers, each on the smallest and biggest of
//             both bodies: shared/appearance.js coveringLooks), 'random:N' (N made up), or label prefixes of the covering
//             looks ('hat:', 'layer:overalls'). Default: roster,cover,random:40
//   --save-baseline / --baseline / --tolerance: as the clip survey's (exits 1 when a look gets worse by more than
//             --tolerance mm and is over 3 mm)
// npm run clip:outfits -- --looks hat:
import './dom-stub.js';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO, parseArgs, list } from './lib.js';

const args = parseArgs(process.argv.slice(2), { looks: 'roster,cover,random:40', top: '30', tolerance: '1' });
const imp = (p) => import(pathToFileURL(join(REPO, p)).href);
const C = await imp('client/render/models/characters.js');
const { MeshBuilder } = await imp('client/render/models/skinning.js');
const AP = await imp('shared/appearance.js');
const { CHARACTERS } = await imp('shared/characters.js');
MeshBuilder.debugParts = true;
const THRESH = [3, 8];

// [inner, outer, seen from]: inner's vertices that are outside outer
const PAIRS = [
  ['top', 'vest', 'trunk'],
  ['pockets', 'vest', 'trunk'],
  ['pouch', 'vest', 'trunk'],
  ['top', 'overalls', 'trunk'],
  ['pockets', 'overalls', 'trunk'],
  ['pouch', 'overalls', 'trunk'],
  ['pants', 'top', 'trunk'],
  ['vest', 'gear', 'trunk'],
  ['overalls', 'gear', 'trunk'],
  ['top', 'gear', 'trunk'],
  ['collar', 'beard', 'trunk'],
  ['collar', 'hair', 'trunk'],
  ['hair', 'hat', 'head'],
  // (not the head itself against what is on it: its nose, ears and lips stand out of the hair, beard and hat as they
  // should)
];

// ---------------------------------------------------------------- the looks
const looks = [];
for (const sel of list(args.looks)) {
  if (sel === 'roster') CHARACTERS.forEach((c) => looks.push({ label: `roster:${c.name}`, ref: c.id }));
  else if (sel.startsWith('random:')) for (let i = 0; i < (+sel.slice(7) || 10); i++) looks.push({ label: `random:${i + 1}`, values: AP.randomLook(AP.mulberry(9000 + i)) });
  else {
    const cover = AP.coveringLooks({ bodies: 'extremes' });
    for (const c of cover) if (sel === 'cover' || c.label.startsWith(sel)) looks.push(c);
  }
}

// ---------------------------------------------------------------- measuring
// From each vertex of the inner part, straight back into the body along its own normal (the outside of the inner
// part: the copy of a two-sided part facing in is skipped), as far as REACH: the outer part crossed on the way is
// under it, and the vertex is through it by that far.
const REACH = 0.03; // m
const CELL = 0.02; // m: the outer part's triangles in a grid of these
const cellKey = (x, y, z) => (Math.floor(x / CELL) + 512) * 1048576 + (Math.floor(y / CELL) + 512) * 1024 + (Math.floor(z / CELL) + 512);
function gridOf(rig, ranges) {
  const pos = rig.geometry.attributes.position.array, idx = rig.geometry.index.array;
  const grid = new Map();
  for (const r of ranges)
    for (let t = r.t0; t < r.t1; t += 3) {
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let k = 0; k < 3; k++) {
        const i = idx[t + k] * 3;
        x0 = Math.min(x0, pos[i]), x1 = Math.max(x1, pos[i]);
        y0 = Math.min(y0, pos[i + 1]), y1 = Math.max(y1, pos[i + 1]);
        z0 = Math.min(z0, pos[i + 2]), z1 = Math.max(z1, pos[i + 2]);
      }
      for (let x = Math.floor(x0 / CELL); x <= Math.floor(x1 / CELL); x++)
        for (let y = Math.floor(y0 / CELL); y <= Math.floor(y1 / CELL); y++)
          for (let z = Math.floor(z0 / CELL); z <= Math.floor(z1 / CELL); z++) {
            const k = cellKey(x * CELL + 1e-6, y * CELL + 1e-6, z * CELL + 1e-6);
            let c = grid.get(k);
            if (!c) grid.set(k, (c = []));
            c.push(t);
          }
    }
  return grid;
}

// Moller-Trumbore: the distance along the ray (o, d) to triangle t, or Infinity
function hit(pos, idx, t, o, d) {
  const i0 = idx[t] * 3, i1 = idx[t + 1] * 3, i2 = idx[t + 2] * 3;
  const e1x = pos[i1] - pos[i0], e1y = pos[i1 + 1] - pos[i0 + 1], e1z = pos[i1 + 2] - pos[i0 + 2];
  const e2x = pos[i2] - pos[i0], e2y = pos[i2 + 1] - pos[i0 + 1], e2z = pos[i2 + 2] - pos[i0 + 2];
  const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return Infinity;
  const inv = 1 / det;
  const tx = o[0] - pos[i0], ty = o[1] - pos[i0 + 1], tz = o[2] - pos[i0 + 2];
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return Infinity;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
  if (v < 0 || u + v > 1) return Infinity;
  const s = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return s > 0.0002 ? s : Infinity;
}

function measureLook(rig) {
  const pos = rig.geometry.attributes.position.array, idx = rig.geometry.index.array, nor = rig.geometry.attributes.normal.array;
  const by = new Map();
  for (const t of rig.tags || []) {
    if (!by.has(t.tag)) by.set(t.tag, []);
    by.get(t.tag).push(t);
  }
  const head = rig.bones.find((b) => b.name === 'head').pos;
  const headC = [head[0], head[1] + rig.P.headR * 0.9, head[2]];
  // (which way is out: from the trunk's axis at the vertex's height, or from the middle of the head)
  const ORIGIN = { trunk: (x, y) => [0, y, 0], head: () => headC };
  const out = [];
  for (const [inner, outer, frame] of PAIRS) {
    if (!by.has(inner) || !by.has(outer)) continue;
    const origin = ORIGIN[frame];
    const grid = gridOf(rig, by.get(outer));
    let worst = 0, over = 0, at = null;
    const d = [0, 0, 0], o = [0, 0, 0];
    for (const r of by.get(inner))
      for (let i = r.v0; i < r.v1; i++) {
        const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
        const nx = nor[i * 3], ny = nor[i * 3 + 1], nz = nor[i * 3 + 2];
        const c = origin(x, y, z);
        if (nx * (x - c[0]) + ny * (y - c[1]) + nz * (z - c[2]) <= 0) continue; // (facing in)
        const nl = Math.hypot(nx, ny, nz) || 1;
        d[0] = -nx / nl;
        d[1] = -ny / nl;
        d[2] = -nz / nl;
        o[0] = x - d[0] * 0.0002;
        o[1] = y - d[1] * 0.0002;
        o[2] = z - d[2] * 0.0002;
        // the cells the short way in passes through
        const seen = new Set();
        let near = Infinity;
        for (let s = 0; s <= REACH + CELL * 0.25; s += CELL * 0.25) {
          const k = cellKey(x + d[0] * Math.min(s, REACH), y + d[1] * Math.min(s, REACH), z + d[2] * Math.min(s, REACH));
          if (seen.has(k)) continue;
          seen.add(k);
          const cand = grid.get(k);
          if (cand) for (const t of cand) near = Math.min(near, hit(pos, idx, t, o, d));
        }
        if (near < REACH) {
          const mm = near * 1000;
          if (mm > worst) (worst = mm), (at = [x, y, z].map((v) => +v.toFixed(3)));
          if (mm > THRESH[0]) over++;
        }
      }
    if (worst > 0.5) out.push({ pair: `${inner}>${outer}`, worst: +worst.toFixed(1), over, at });
  }
  return out;
}

// ---------------------------------------------------------------- the run
const rows = [];
const t0 = performance.now();
for (const l of looks) {
  const ref = l.values ? AP.lookKey(l.values) : l.ref;
  const s = C.createSurvivor(1, ref, { transient: true });
  const found = measureLook(s._inst.rigH);
  s.dispose();
  const w = found.reduce((a, f) => (f.worst > a.worst ? f : a), { worst: 0, pair: '' });
  rows.push({ label: l.label, worst: w.worst, what: w.pair, found, code: l.values ? AP.lookCode(l.values) : null });
}
rows.sort((a, b) => b.worst - a.worst);
console.log(`clip outfits: ${rows.length} looks in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
console.log(`  over ${THRESH[1]} mm: ${rows.filter((r) => r.worst > THRESH[1]).length}, ${THRESH[0]}-${THRESH[1]} mm: ${rows.filter((r) => r.worst > THRESH[0] && r.worst <= THRESH[1]).length}, clean: ${rows.filter((r) => r.worst <= THRESH[0]).length}`);
// the worst pairs over every look, then the worst looks
const byPair = new Map();
for (const r of rows) for (const f of r.found) if (!byPair.has(f.pair) || byPair.get(f.pair).worst < f.worst) byPair.set(f.pair, { ...f, label: r.label });
for (const [pair, f] of [...byPair].sort((a, b) => b[1].worst - a[1].worst)) console.log(`  ${pair.padEnd(18)} worst ${String(f.worst).padStart(6)} mm  (${f.label}${f.at ? ' @' + f.at.join(',') : ''})`);
console.log('');
for (const r of rows.slice(0, +args.top)) if (r.worst > 0) console.log(`  ${String(r.worst).padStart(6)} mm  ${r.label.padEnd(34)} ${r.found.map((f) => `${f.pair} ${f.worst}${f.over ? ` (${f.over}v)` : ''}`).join(', ')}${r.code ? `  look=${r.code}` : ''}`);

let fail = false;
if (args['save-baseline']) {
  writeFileSync(args['save-baseline'], JSON.stringify(Object.fromEntries(rows.map((r) => [r.label, r.worst])), null, 1));
  console.log(`baseline saved: ${args['save-baseline']}`);
}
if (args.baseline && existsSync(args.baseline)) {
  const base = JSON.parse(readFileSync(args.baseline, 'utf8'));
  const tol = +args.tolerance;
  const worse = rows.filter((r) => r.label in base && r.worst > THRESH[0] && r.worst > base[r.label] + tol);
  for (const r of worse) console.log(`WORSE  ${r.label}: ${base[r.label]} -> ${r.worst} mm (${r.what})`);
  fail = worse.length > 0;
}
process.exit(fail ? 1 : 0);
