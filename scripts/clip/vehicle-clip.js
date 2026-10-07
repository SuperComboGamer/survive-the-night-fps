// The riders of the vehicles, measured (docs/object-clipping.md): every one of the ten survivors in every seat of
// the moped, the car and the bicycle, posed as the game poses them (the models sandbox, ?veh=: models-veh.js), and
// for each the deepest vertex of the body inside the vehicle, of the vehicle inside the body, and how far the
// driver's fists are from the grips. One headless browser through lib.js's launchChrome, software rendering.
//   node scripts/clip/vehicle-clip.js [--out shots/pr/vehicles] [--sheets 1] [--veh 1,2,3]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REPO, parseArgs, startVite, launchChrome, shoot, LIFE_MAX } from './lib.js';

const args = parseArgs(process.argv.slice(2), { out: join(REPO, 'shots', 'pr', 'vehicles'), veh: '1,2,3' });
const out = resolve(args.out);
mkdirSync(out, { recursive: true });
const NAMES = { 1: 'moped', 2: 'car', 3: 'bicycle' };
const SEATS = { 1: 2, 2: 4, 3: 1 };
const kinds = String(args.veh).split(',').map(Number);
let vite = null, chrome = null;
const rows = [];
try {
  chrome = await launchChrome({ width: 1280, height: 800, life: LIFE_MAX, wait: 45 * 60_000 });
  vite = await startVite(REPO);
  for (const vk of kinds) {
    for (let seed = 0; seed < 10; seed++) {
      // the survivor `seed` at the bars or the wheel, the next ones along in the other seats
      const q = `veh=${vk}&seed=${seed}&pass=${SEATS[vk] - 1}&views=q,side,rq,${vk === 2 ? 'in' : 'hands'}&cell=320,240&clip=1&tint=${seed % 6}`;
      const r = await shoot(chrome.page, `${vite.url}/sandbox/models-test.html?${q}`, { w: 1280, h: 240, wait: 700, file: args.sheets ? join(out, `clip-${NAMES[vk]}-${seed}.png`) : null, evaluate: () => window.__clip });
      for (const e of r.each) rows.push({ veh: NAMES[vk], seat: e.seat, who: e.who, bodyInVeh: e.bodyInVeh, vehInBody: e.vehInBody, grips: e.grips });
      process.stdout.write('.');
    }
  }
  process.stdout.write('\n');
} finally {
  if (chrome) await chrome.close();
  if (vite) vite.stop();
}
const mm = (d) => (d * 1000).toFixed(0).padStart(4);
console.log('vehicle  seat  survivor   body in vehicle (mm, vertices, what)                     vehicle in body (mm, vertices, what)   fists from the grips (mm)');
for (const r of rows) console.log(`${r.veh.padEnd(8)} ${r.seat}     ${r.who.padEnd(9)}  ${mm(r.bodyInVeh.d)} ${String(r.bodyInVeh.n).padStart(5)}  ${(r.bodyInVeh.what || '-').padEnd(36)}  ${mm(r.vehInBody.d)} ${String(r.vehInBody.n).padStart(5)}  ${(r.vehInBody.what || '-').padEnd(16)}  ${r.grips.map((g) => `${g.side} ${g.mm.toFixed(0)}`).join(' ')}`);
console.log('\nworst by seat (over the ten survivors):');
for (const vk of kinds) {
  for (let k = 0; k < SEATS[vk]; k++) {
    const rs = rows.filter((r) => r.veh === NAMES[vk] && r.seat === k);
    const a = rs.reduce((b, r) => (r.bodyInVeh.d > b.bodyInVeh.d ? r : b));
    const c = rs.reduce((b, r) => (r.vehInBody.d > b.vehInBody.d ? r : b));
    const g = Math.max(0, ...rs.flatMap((r) => r.grips.map((x) => x.mm)));
    console.log(`  ${NAMES[vk].padEnd(8)} seat ${k}: body in vehicle ${mm(a.bodyInVeh.d)} mm (${a.who}: ${a.bodyInVeh.what || '-'}), vehicle in body ${mm(c.vehInBody.d)} mm (${c.who}: ${c.vehInBody.what || '-'})${k === 0 ? `, fists within ${g.toFixed(0)} mm of the grips` : ''}`);
  }
}
writeFileSync(join(out, 'clip-vehicles.json'), JSON.stringify(rows, null, 1));
