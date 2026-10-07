// Every prop's collision volume against its model, in numbers (docs/hitboxes.md; the method is in lib.js).
// usage: node scripts/hitbox/measure.js [--only car_wreck,pickup_truck] [--json out.json] [--against other.json]
//                                       [--profile car_wreck[:seed]] [--axis z|x] [--step 0.2] [--top 40] [--cells 1500000]
//   --json     save the numbers (to compare a later run with: --against)
//   --against  print each prop's worst distances before and after
//   --profile  the outline of one model in slices, to fit boxes to
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PROPS, measureType, modelOf, profile, score } from './lib.js';
import { parseArgs } from '../clip/lib.js';

const args = parseArgs(process.argv.slice(2), { top: '60', cells: '1500000', step: '0.2', axis: 'z' });
const f2 = (x) => x.toFixed(2).padStart(6);

if (args.profile) {
  const [type, seed] = String(args.profile).split(':');
  const m = modelOf(type, +(seed || 0));
  console.log(`${type} seed ${seed || 0}: model box x ${f2(m.box[0])}..${f2(m.box[3])}  y ${f2(m.box[1])}..${f2(m.box[4])}  z ${f2(m.box[2])}..${f2(m.box[5])}`);
  console.log(args.axis === 'x' ? '     x     z0     z1   bottom    top' : '     z     x0     x1   bottom    top');
  for (const s of profile(m, args.axis === 'x' ? 0 : 2, +args.step)) console.log(`${f2(s.at)} ${f2(s.a0)} ${f2(s.a1)}   ${f2(s.y0)} ${f2(s.y1)}`);
  process.exit(0);
}

const only = args.only ? String(args.only).split(',') : Object.keys(PROPS);
const rows = [];
const t0 = Date.now();
for (const type of only) {
  if (!PROPS[type]) continue;
  const r = measureType(type, { cells: +args.cells });
  delete r.per;
  rows.push(r);
}
rows.sort((a, b) => score(b) - score(a));
const before = args.against ? Object.fromEntries(JSON.parse(readFileSync(resolve(String(args.against)), 'utf8')).map((r) => [r.type, r])) : null;
console.log('distances in m, volumes in m3, areas in m2. air: collider where there is no model. hole: model with no collider.');
console.log('prop                    var col |  shot: air  worst   hole  thick | sight: air  worst   hole  thick | move: air  worst   hole  worst | stand  reach');
for (const r of rows.slice(0, +args.top)) {
  const line = (q) => `${f2(q.shotAir)} ${f2(q.shotAirMax)} ${f2(q.shotHole)} ${f2(q.shotHoleThick)} |     ${f2(q.sightAir)} ${f2(q.sightAirMax)} ${f2(q.sightHole)} ${f2(q.sightHoleMax)} |    ${f2(q.moveAir)} ${f2(q.moveAirMax)} ${f2(q.moveHole)} ${f2(q.moveHoleMax)} | ${f2(q.standMax)} ${f2(q.reachAir)}`;
  console.log(`${r.type.padEnd(24)}${String(r.variants).padStart(3)} ${String(r.colliders).padStart(3)} |     ${line(r)}`);
  if (args.where) console.log(`      worst air at ${r.airAt ? `variant ${r.airAt[0]} (${r.airAt.slice(1).join(', ')})` : '-'}   thickest hole at ${r.holeAt ? `variant ${r.holeAt[0]} (${r.holeAt.slice(1).join(', ')})` : '-'}`);
  if (before && before[r.type]) console.log(`${'   (before)'.padEnd(24)}${String(before[r.type].variants).padStart(3)} ${String(before[r.type].colliders).padStart(3)} |     ${line(before[r.type])}`);
}
const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
console.log(`\n${rows.length} props in ${((Date.now() - t0) / 1000).toFixed(1)} s. totals: shot air ${sum('shotAir').toFixed(1)} m3, shot hole ${sum('shotHole').toFixed(1)} m3, move air ${sum('moveAir').toFixed(1)} m2, move hole ${sum('moveHole').toFixed(1)} m2`);
if (args.json) {
  mkdirSync(dirname(resolve(String(args.json))), { recursive: true });
  writeFileSync(resolve(String(args.json)), JSON.stringify(rows));
}
