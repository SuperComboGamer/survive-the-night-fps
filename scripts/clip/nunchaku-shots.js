// Nunchucks: stills and strips out of the models sandbox, many in one browser (docs/object-clipping.md's rules: one
// headless browser, through lib.js's launchChrome, software rendering).
//   node scripts/clip/nunchaku-shots.js <list.json> [--out shots/pr/nunchucks/sandbox]
// list.json: [{ "name": "fp-whip", "q": "vm=57&nk=whip&ts=0.05,0.1,0.15,0.2", "w": 1280, "h": 720, "wait": 400 }]
//   q: the sandbox's query (models-test.html?...): ?vm=57&nk=... the first person, ?hold=57&nk=... the third
//   page: "props" for props-test.html (ground items); clip: true prints the page's clip check (&clip=1)
import { readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REPO, parseArgs, startVite, launchChrome, shoot, LIFE_MAX } from './lib.js';

const args = parseArgs(process.argv.slice(2), { out: join(REPO, 'shots', 'pr', 'nunchucks', 'sandbox') });
if (!args._.length) {
  console.log('usage: node scripts/clip/nunchaku-shots.js <list.json> [--out dir]  (see the top of the file)');
  process.exit(1);
}
const list = JSON.parse(readFileSync(resolve(args._[0]), 'utf8'));
const out = resolve(args.out);
mkdirSync(out, { recursive: true });
let vite = null, chrome = null;
try {
  vite = await startVite(REPO);
  chrome = await launchChrome({ width: 1280, height: 800, life: LIFE_MAX });
  for (const s of list) {
    const r = await shoot(chrome.page, `${vite.url}/sandbox/${s.page === 'props' ? 'props-test.html' : 'models-test.html'}?${s.q}`, { w: s.w || 1280, h: s.h || 720, wait: s.wait ?? 400, file: join(out, s.name + '.png'), evaluate: s.clip ? () => (window.__clip && (Array.isArray(window.__clip) ? window.__clip.map((c) => c.text) : window.__clip.text)) || null : null });
    if (s.clip) console.log(s.name + ': ' + JSON.stringify(r));
    else process.stdout.write('.');
  }
  process.stdout.write('\n');
} finally {
  if (chrome) await chrome.close();
  if (vite) vite.stop();
}
console.log(`${list.length} shots in ${out}`);
