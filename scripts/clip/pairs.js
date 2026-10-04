// Before/after images for a PR (docs/object-clipping.md, "Before and after"). Shoots the same views in two builds -
// this tree and another (by default a temporary worktree of origin/main) - with the same camera, pose and clock, and
// composes each pair into one labelled panel: before on the left, after on the right, a row per view. Also writes a
// contact sheet of every after shot.
//
// usage: node scripts/clip/pairs.js <shots.json> [--before <worktree>] [--ref origin/main] [--only <regexp>]
//          [--out shots/clip/pairs]
// npm run clip:pairs -- scripts/clip/pairs.example.json
//
// shots.json: a list of panels, each one of
//   { "id": "01-grenade-idle", "title": "...", "vm": "vm=33&t=1", "side": "R", "views": "eye zoom xray far" }
//       first person (models sandbox ?vm=). views: eye (the player's view), zoom (from the eye, narrowed onto the hand),
//       xray (the same with the item see-through), far (from outside, the far side of the grip). zoom / xray / far are
//       aimed at where that hand is in the BEFORE build, so both shots of the pair use one camera.
//   { "id": "54-3p-ak47", "title": "...", "hold": "hold=61&pose=idle&cam=body,1.3,0.25,1.7" }
//       third person (models sandbox ?hold=): the survivor, then the same with the item see-through
//   { "id": "66-pickup-sticks", "title": "...", "pickup": "STICK" }
//       a ground item (props sandbox): low along the ground, then from above
//   { "id": "...", "title": "...", "views": [{ "path": "sandbox/...", "label": "...", "w": 900, "h": 600, "wait": 700 }] }
//       anything else: sandbox paths shot as they are
// --before   an existing checkout to shoot the "before" in (its client/sandbox files are swapped for ours for the run
//            and put back); without it a worktree of --ref is made in the temp folder and removed afterwards
import { readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REPO, OUT, parseArgs, startVite, launchChrome, shoot, composeSheets, lendSandbox, tempWorktree } from './lib.js';

const args = parseArgs(process.argv.slice(2), { ref: 'origin/main', out: join(OUT, 'pairs') });
if (!args._.length) {
  console.log('usage: node scripts/clip/pairs.js <shots.json> [--before <worktree>] [--only <regexp>]  (see the top of the file)');
  process.exit(1);
}
const out = resolve(args.out);
let panels = JSON.parse(readFileSync(resolve(args._[0]), 'utf8'));
if (args.only) panels = panels.filter((p) => new RegExp(args.only).test(p.id));
const sb = (q) => `sandbox/models-test.html?${q}`;

// the views of a panel; at: the hand's grip center (view space) in the before build, for the hand-centred cameras
function views(p, at) {
  if (p.views && typeof p.views !== 'string') return p.views;
  if (p.hold) return [{ path: sb(p.hold), label: 'third person', w: 700, h: 500 }, { path: sb(`${p.hold}&xray=1`), label: 'the item see-through', w: 700, h: 500 }];
  if (p.pickup) {
    const q = `sandbox/props-test.html?cat=sheet&set=pickups&names=${p.pickup}&cols=1&rows=1&bright=1`;
    return [{ path: `${q}&pitch=6&zoom=1.25`, label: 'on the ground, low', w: 700, h: 450, wait: 3500 }, { path: `${q}&pitch=35&zoom=0.8`, label: 'from above', w: 700, h: 450, wait: 3500 }];
  }
  const a = (at || [0.1, -0.15, -0.35]).join(',');
  const v = [];
  for (const k of String(p.views || 'eye').split(' ')) {
    if (k === 'eye') v.push({ path: sb(p.vm), label: 'first person' });
    if (k === 'zoom') v.push({ path: sb(`${p.vm}&zoom=24,${a}`), label: 'from the eye, narrowed onto the hand' });
    if (k === 'xray') v.push({ path: sb(`${p.vm}&zoom=24,${a}&xray=1`), label: 'the item see-through: a buried finger shows' });
    if (k === 'far') v.push({ path: sb(`${p.vm}&orbit=${p.side === 'L' ? '1.9,-0.5' : '-1.6,-0.3'},0.32,${a}`), label: 'from outside, the far side of the grip' });
  }
  return v;
}

let wt = null, restore = () => {}, viteB = null, viteA = null, chrome = null;
try {
  const before = args.before ? resolve(args.before) : (wt = tempWorktree(args.ref)).dir;
  restore = lendSandbox(before);
  console.log(`pairs: ${panels.length} panels, before = ${args.before ? before : `${args.ref} (a temporary worktree)`}, after = this tree`);
  [viteB, viteA] = await Promise.all([startVite(before), startVite(REPO)]);
  chrome = await launchChrome();
  const page = chrome.page;
  // where each first-person panel's hand is, in the before build (window.__hands, set by the sandbox once posed)
  const at = {};
  for (const p of panels) {
    if (!p.vm) continue;
    const h = await shoot(page, `${viteB.url}/${sb(p.vm)}`, { w: 400, h: 300, wait: 300, evaluate: () => window.__hands });
    at[p.id] = h && (h[p.side || 'R'] || h.R);
  }
  const sheets = [];
  const overview = [];
  for (const p of panels) {
    const vs = views(p, at[p.id]);
    const cells = [];
    for (const [i, v] of vs.entries()) {
      for (const [tag, vite] of [['before', viteB], ['after', viteA]]) {
        const dir = join(out, tag);
        mkdirSync(dir, { recursive: true });
        const file = join(dir, `${p.id}-${i}.png`);
        await shoot(page, `${vite.url}/${v.path}`, { file, w: v.w || 900, h: v.h || 600, wait: v.wait ?? 700, evaluate: () => document.getElementById('info') && (document.getElementById('info').style.display = 'none') });
        cells.push({ img: file, tag, label: v.label || '' });
        if (tag === 'after' && i === 0) overview.push({ img: file, label: p.id });
      }
    }
    const v0 = vs[0];
    const cw = v0.cw || 640;
    sheets.push({ out: join(out, `${p.id}.png`), title: p.title || p.id, cols: 2, cellW: cw, cellH: Math.round((cw * (v0.h || 600)) / (v0.w || 900)), cells });
    process.stdout.write('.');
  }
  sheets.push({ out: join(out, '00-overview-after.png'), title: 'every after shot (the first view of each panel)', cols: Math.min(8, Math.max(2, Math.ceil(Math.sqrt(overview.length)))), cellW: 300, cellH: 200, cells: overview });
  await composeSheets(page, sheets);
  console.log(`\n${sheets.length} images in ${out}`);
} finally {
  if (chrome) await chrome.close();
  if (viteA) viteA.stop();
  if (viteB) viteB.stop();
  restore();
  if (wt) wt.remove();
}
