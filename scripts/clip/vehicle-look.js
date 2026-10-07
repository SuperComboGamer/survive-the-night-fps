// A look at the vehicles in the models sandbox (client/sandbox/models-veh.js): each argument is a name and the page's
// query, and is shot to <out>/<name>.png. One headless browser through lib.js's launchChrome, software rendering.
//   node scripts/clip/vehicle-look.js [--out shots/pr/vehicles/look] [--w 1280] [--h 720] name=veh=2&views=fp ...
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REPO, parseArgs, startVite, launchChrome, shoot, LIFE_DEFAULT } from './lib.js';

const args = parseArgs(process.argv.slice(2), { out: join(REPO, 'shots', 'pr', 'vehicles', 'look'), w: '1280', h: '720' });
const out = resolve(args.out);
mkdirSync(out, { recursive: true });
let vite = null, chrome = null;
try {
  chrome = await launchChrome({ width: +args.w, height: +args.h, life: LIFE_DEFAULT });
  vite = await startVite(REPO);
  for (const a of args._) {
    const i = a.indexOf('=');
    const name = a.slice(0, i), q = a.slice(i + 1);
    const r = await shoot(chrome.page, `${vite.url}/sandbox/models-test.html?${q}`, { w: +args.w, h: +args.h, wait: 900, file: join(out, `${name}.png`), evaluate: () => window.__clip?.text || '' });
    console.log(`${name}: ${String(r || '').split('\n').slice(0, 6).join(' | ')}`);
  }
} finally {
  if (chrome) await chrome.close();
  if (vite) vite.stop();
}
