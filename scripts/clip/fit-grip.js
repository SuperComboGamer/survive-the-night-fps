// Fit a first-person hand pose to an item (docs/object-clipping.md, "Fitting a hand pose"). Takes the hand pose an
// item uses now, measures how far each part of it is inside the item's real mesh (mm, negative = inside), then seats
// the palm on the surface and closes every finger until it touches, and prints the fitted pose as a HAND_POSES entry
// to paste into client/render/models/weapons.js (give it a name, and the item's VM entry that name as rPose, or as
// lGrip.pose for the left hand).
//
// usage: node scripts/clip/fit-grip.js <item> [--side R|L] [--base <pose>] [--act reload] [--t 0.69] [--use <item>]
//          [--search | --open] [--loose] [--keep 0] [--keep-thumb] [--dx m] [--dy m] [--dz m] [--seat m] [--spread r]
//        node scripts/clip/fit-grip.js --spec poses.json    (a batch: [{ name, item, side, base, act, t, use, opt }])
//   <item>      an ITEM id or name (61, ak47, grenade); 0 for empty hands (with --act use --use <item>)
//   --side      which hand (default R)
//   --base      the pose to start from (default: the one the item uses on that side)
//   --act/--t   pose the viewmodel in a state first (the sandbox's &act / &t), e.g. a reload hold
//   --search    every finger by search for the snuggest fit (best on odd shapes: a pistol grip under a trigger guard)
//   --open      open the base pose's fingers until clear, then close the free outer joints (keeps its character)
//               (default: close each finger from straight)
//   --loose     let the thumb go further from the base pose's to find a clear lie
//   --keep 0,1  leave these fingers (0 index .. 3 little) as the base has them
//   --dy/--dz   slide the grip along the fingers / along the tunnel (m) before fitting; --dx fixes the palm shift
//   --seat      how far off the surface the palm sits (m, default 0.0006)
// npm run clip:fit -- grenade
//
// It also prints the fitted pose's clearances: every number should be >= 0 (touching is about +0.5). A thumb or finger
// left far out (> 10 mm) is not inside anything but may look loose: look at it in the sandbox with &hp= before using it.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs, list } from './lib.js';
import { posedVM, fitPose, fmtReport, mm, poseStr, HAND_POSES, W, DEFS } from './grip-lib.js';

const args = parseArgs(process.argv.slice(2), { side: 'R' });
const itemId = (v) => (/^\d+$/.test(String(v)) ? +v : DEFS.ITEM[String(v).toUpperCase()]);

function run(s) {
  const id = itemId(s.item);
  if (id === undefined) throw new Error(`no item ${s.item}`);
  const cfg = W.VM_DEBUG.VM[id];
  const base = s.base || (s.side === 'L' ? cfg?.lGrip?.pose : cfg?.rPose) || (s.side === 'L' ? 'support' : 'grip');
  if (!HAND_POSES[base]) throw new Error(`no hand pose ${base} (HAND_POSES in weapons.js)`);
  const vm = posedVM(id, { act: s.act || '', t: s.t ?? 1, use: itemId(s.use || 0) || 0 });
  const r = fitPose(vm, s.side, base, s.opt || {});
  console.log(`== ${s.name || s.item} (${s.side} hand, from '${base}'${s.act ? `, ${s.act} at ${s.t ?? 1} s` : ''}): grip center moved ${r.shift.map(mm).join(', ')} mm${r.thumbFound ? '' : ' (no clear thumb found: kept)'}`);
  console.log(`   before  ${fmtReport(r.before)}`);
  console.log(`   after   ${fmtReport(r.after)}`);
  console.log(`   ${s.name || 'fitted'}: ${poseStr(r.pose).replace(/^\{/, '{ ').replace(/\}$/, ' }')},`);
  return r;
}

if (args.spec) {
  for (const s of JSON.parse(readFileSync(resolve(args.spec), 'utf8'))) run({ side: 'R', ...s });
} else {
  if (!args._.length) {
    console.log('usage: node scripts/clip/fit-grip.js <item> [--side R|L] [--base pose] [--act a --t s] [--search|--open] ...  (see the top of the file)');
    process.exit(1);
  }
  const num = (k) => (args[k] !== undefined ? +args[k] : undefined);
  const opt = { search: !!args.search, open: !!args.open, loose: !!args.loose, keepThumb: !!args['keep-thumb'], keep: list(args.keep)?.map(Number), dx: num('dx'), dy: num('dy'), dz: num('dz'), seat: num('seat'), spread: num('spread') };
  for (const k of Object.keys(opt)) if (opt[k] === undefined || opt[k] === false) delete opt[k];
  run({ item: args._[0], side: String(args.side).toUpperCase(), base: args.base, act: args.act, t: num('t'), use: args.use, opt });
}
