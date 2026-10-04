// Clip survey: every held item in every state it is drawn in, measured for how far the hands, the item and the body
// pass into each other (docs/object-clipping.md). Renders each frame through the models sandbox's clip check in
// headless Chrome and writes a report.
//
//   first person  (fp)       every gun, melee weapon, throwable and the walkie-talkie: idle, walk, sprint, ADS, fire,
//                            crouch, the reload at many points, the bolt / pump cycle, the shove, the swing, the throw
//                            from wind-up to re-draw, the draw; and every consumable being used (empty-handed, and
//                            with a gun put away). ?vm=ID&...&clip=1, read from window.__clip.
//   third person  (tp)       a survivor holding each item: idle, walk, sprint, crouch, looking up and down, downed,
//                            seated, reload / fire / shove, the swing, the throw; and the worn backpack in every pose,
//                            swimming too. ?hold=ID&pose=...&clip=1.
//   ground items  (pickups)  every item as it lies on the ground: sunk into it or floating above it (pickups.js).
//
// usage: node scripts/clip/survey.js [--sections fp,tp,pickups] [--item ak47,grenade] [--state reload,idle]
//          [--against <worktree>] [--out shots/clip/survey] [--shots] [--top 40]
//          [--save-baseline file.json] [--baseline file.json] [--tolerance 1] [--seed N]
//   --item / --state  only frames whose item / state name contains one of these (item names: ITEM keys in lower case,
//                     e.g. ak47, hunting_rifle, grenade; state names as printed, e.g. reload-0.42, 3p-lookup)
//   --against         also measure another checkout and print the two side by side: a path, or a git ref (origin/main)
//                     to measure in a temporary worktree (removed after). Its client/sandbox files are swapped for
//                     ours for the run and put back after.
//   --shots           keep a screenshot of every frame (in --out/<tree>/)
//   --seed            the survivor the third-person frames are measured on (?hold=&seed=: the character seed % 10)
//   --save-baseline   write each frame's worst clip (mm) to a file, to be compared against later
//   --baseline        compare against such a file: exits 1 when a frame that was clean enough gets worse
//                     (more than --tolerance mm, default 1, and over 3 mm), so a PR can be gated on it
// npm run clip:survey -- --item grenade
//
// Thresholds: a clip under 3 mm is invisible at play distance (a glove's thickness); 3-8 mm shows on a close look;
// over 8 mm is a visible finger through a gun. The report counts frames over each.
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { REPO, OUT, parseArgs, list, startVite, renewChrome, shoot, lendSandbox, tempWorktree } from './lib.js';

const args = parseArgs(process.argv.slice(2), { sections: 'fp,tp,pickups', top: '40', tolerance: '1', out: join(OUT, 'survey') });
const sections = list(args.sections);
const { ITEM, WEAPONS, CONSUMABLES } = await import(pathToFileURL(join(REPO, 'shared', 'defs.js')).href);
const NAME = {};
for (const k in ITEM) NAME[ITEM[k]] = k.toLowerCase();
export const THRESH = [3, 8];

// ---------------------------------------------------------------- the frames
// each: { section, name, item, state, path (sandbox URL path + query) }
function frames() {
  const out = [];
  const sb = 'sandbox/models-test.html?';
  const fp = (item, state, q) => out.push({ section: 'fp', item: NAME[item] || 'hands', state, name: `${NAME[item] || 'hands'}-${state}`, path: `${sb}vm=${item}&${q}&clip=1` });
  const guns = Object.keys(WEAPONS).map(Number).filter((id) => !WEAPONS[id].melee);
  const melee = Object.keys(WEAPONS).map(Number).filter((id) => WEAPONS[id].melee);
  const throws = [ITEM.MOLOTOV, ITEM.PIPEBOMB, ITEM.FLARE, ITEM.GRENADE, ITEM.DECOY].filter(Boolean);
  if (sections.includes('fp')) {
    for (const id of guns) {
      const w = WEAPONS[id];
      for (const [s, q] of [['idle', 't=1'], ['walk', 'act=walk&t=0.45'], ['sprint', 'act=sprint&t=1'], ['ads', 'act=ads&t=1'], ['fire', 'act=fire&t=0.04'], ['crouch', 'act=crouch&t=1'], ['bash-0.2', 'act=melee&t=0.2']]) fp(id, s, q);
      const at = w.reloadEach ? [0.1, 0.25, 0.4, 0.5, 0.6, 0.7] : [0.08, 0.18, 0.3, 0.42, 0.52, 0.62, 0.72, 0.8, 0.86, 0.94];
      for (const f of at) fp(id, `reload-${f}`, `act=reload&t=${(f * w.reload).toFixed(3)}`);
      // pump / bolt: worked after each shot
      if (w.slot === 0 && (id === ITEM.SHOTGUN || id === ITEM.HUNTING_RIFLE || id === ITEM.DB_SHOTGUN || id === ITEM.AT_RIFLE)) for (const t of [0.2, 0.35, 0.5, 0.65]) fp(id, `cycle-${t}`, `act=fire&t=${t}`);
    }
    // (the sandbox's swing lengths: weapons.js SWINGS)
    const swing = { [ITEM.KNIFE]: 0.36, [ITEM.BAT]: 0.62, [ITEM.SPIKED_BAT]: 0.62, [ITEM.MACHETE]: 0.5, [ITEM.HAMMER]: 0.5 };
    for (const id of melee) {
      for (const [s, q] of [['idle', 't=1'], ['walk', 'act=walk&t=0.45'], ['sprint', 'act=sprint&t=1']]) fp(id, s, q);
      for (const f of [0.15, 0.28, 0.4, 0.55, 0.7, 0.85]) fp(id, `melee-${f}`, `act=melee&t=${(f * (swing[id] || 0.5)).toFixed(3)}`);
      if (id === ITEM.KNIFE) for (const f of [0.3, 0.48, 0.66]) fp(id, `heavy-${f}`, `act=heavy&t=${(f * 0.62).toFixed(3)}`);
    }
    for (const id of throws) {
      for (const [s, q] of [['idle', 't=1'], ['walk', 'act=walk&t=0.45'], ['sprint', 'act=sprint&t=1'], ['draw', 't=-0.45'], ['shove', 'act=melee&t=0.22']]) fp(id, s, q);
      // (the throw lasts 1.15 s: wind-up to 0.38, release at 0.46, re-draw from 0.8)
      for (const f of [0.08, 0.2, 0.3, 0.38, 0.44, 0.5, 0.6, 0.85, 0.95]) fp(id, `throw-${f}`, `act=throw&t=${(f * 1.15).toFixed(3)}`);
    }
    if (ITEM.WALKIE) for (const [s, q] of [['idle', 't=1'], ['walk', 'act=walk&t=0.45'], ['sprint', 'act=sprint&t=1'], ['talk', 'act=talk&t=1'], ['draw', 't=-0.45']]) fp(ITEM.WALKIE, s, q);
    for (const id of Object.keys(CONSUMABLES).map(Number)) {
      if (CONSUMABLES[id].flashlight) continue; // (batteries go into the flashlight: no hands)
      fp(0, `use-${NAME[id]}`, `act=use&use=${id}&t=0.9`);
      fp(ITEM.AK47, `use-${NAME[id]}`, `act=use&use=${id}&t=1.3`);
    }
  }
  if (sections.includes('tp')) {
    const tp = (item, pose, t = 1, extra = '') => {
      const state = `3p-${pose}${t !== 1 ? '-' + t : ''}${extra ? '-pack' : ''}`;
      out.push({ section: 'tp', item: NAME[item] || 'none', state, name: `${NAME[item] || 'none'}-${state}`, path: `${sb}hold=${item}&pose=${pose}&t=${t}&clip=1${extra}${args.seed !== undefined ? `&seed=${args.seed}` : ''}` });
    };
    for (const id of [...guns, ...melee, ...throws]) {
      for (const p of ['idle', 'walk', 'sprint', 'crouch', 'lookup', 'lookdown', 'downed', 'seated']) tp(id, p, p === 'walk' || p === 'sprint' ? 1.15 : 1);
      if (guns.includes(id)) {
        tp(id, 'reload');
        tp(id, 'fire', 0.05);
        tp(id, 'melee', 0.2);
      }
      if (melee.includes(id)) for (const t of [0.1, 0.2, 0.3, 0.4]) tp(id, 'melee', t);
      if (throws.includes(id)) for (const t of [0.1, 0.24, 0.32, 0.45]) tp(id, 'throw', t);
    }
    // the worn backpack against the body, with a few holds and in every pose
    for (const id of [ITEM.AK47, ITEM.PISTOL, ITEM.BAT, 0]) for (const p of ['idle', 'walk', 'sprint', 'crouch', 'downed', 'seated', 'swim', 'lookup']) tp(id, p, 1, '&pack=1');
  }
  const keep = (f) => (!list(args.item) || list(args.item).some((s) => f.item.includes(s))) && (!list(args.state) || list(args.state).some((s) => f.state.includes(s)));
  return out.filter(keep);
}

// the deepest clip in a sandbox report text ("hand-in-item 12.3mm R.hand>item.body (40v) | ..."), not the near-plane figure
export function worstOf(text) {
  let worst = 0, what = '';
  for (const part of String(text || '').split(' | ')) {
    // (the near plane is a distance, not a clip; a handle in a third-person fist is how it is held)
    if (part.startsWith('near') || part.startsWith('INSIDE-OUT') || part.startsWith('item-in-fist')) continue;
    const m = part.match(/([\d.]+)mm/);
    if (m && +m[1] > worst) {
      worst = +m[1];
      what = part.replace(/ @[-\d.,]+/, '');
    }
  }
  return { worst, what };
}

async function measure(tree, fr, label) {
  const restore = tree === REPO ? () => {} : lendSandbox(tree);
  let vite = null, chrome = null;
  const rows = [];
  try {
    vite = await startVite(tree);
    const dir = join(resolve(args.out), label);
    if (args.shots) mkdirSync(dir, { recursive: true });
    let n = 0;
    for (const f of fr) {
      chrome = await renewChrome(chrome); // (a browser lives a few minutes: lib.js's watchdog)
      const r = await shoot(chrome.page, `${vite.url}/${f.path}`, {
        w: 640,
        h: 400,
        wait: 250,
        file: args.shots ? join(dir, f.name + '.png') : null,
        evaluate: f.section === 'tp' ? () => window.__clip && window.__clip.text : () => window.__clip && window.__clip[0] && window.__clip[0].text,
      });
      const text = typeof r === 'string' ? r : r && r.error ? 'ERROR ' + r.error : '';
      rows.push({ ...f, text, ...worstOf(text), inverted: /INSIDE-OUT/.test(text) });
      if (++n % 25 === 0) process.stdout.write(`  ${label}: ${n}/${fr.length}\r`);
    }
    process.stdout.write('\n');
  } finally {
    if (chrome) await chrome.close();
    if (vite) vite.stop();
    restore();
  }
  if (sections.includes('pickups')) {
    const json = execFileSync(process.execPath, [join(REPO, 'scripts', 'clip', 'pickups.js'), '--root', tree, '--json'], { encoding: 'utf8' });
    for (const p of JSON.parse(json)) {
      const off = p.lowest < -4 ? -p.lowest : p.lowest > 8 ? p.lowest : 0;
      if (list(args.item) && !list(args.item).some((s) => p.name.includes(s))) continue;
      rows.push({ section: 'pickups', item: p.name, state: 'ground', name: `${p.name}-ground`, text: `lowest point ${p.lowest} mm`, worst: off, what: p.lowest < 0 ? `sunk ${-p.lowest} mm into the ground` : `${p.lowest} mm above the ground` });
    }
  }
  return rows;
}

function summary(rows) {
  return { frames: rows.length, over3: rows.filter((r) => r.worst > THRESH[0]).length, over8: rows.filter((r) => r.worst > THRESH[1]).length, errors: rows.filter((r) => /ERROR/.test(r.text)).length };
}
function save(rows, label) {
  mkdirSync(resolve(args.out), { recursive: true });
  writeFileSync(join(resolve(args.out), `${label}.json`), JSON.stringify({ tree: label, at: new Date().toISOString(), summary: summary(rows), frames: rows }, null, 1));
  const csv = ['section,name,item,state,worst_mm,what', ...rows.map((r) => [r.section, r.name, r.item, r.state, r.worst, `"${String(r.what).replace(/"/g, "'")}"`].join(','))];
  writeFileSync(join(resolve(args.out), `${label}.csv`), csv.join('\n'));
}

// ---------------------------------------------------------------- run
const fr = frames();
console.log(`clip survey: ${fr.length} frames (${sections.join(', ')})${args.against ? `, here and in ${args.against}` : ''}`);
const here = await measure(REPO, fr, 'here');
save(here, 'here');
let there = null;
if (args.against) {
  const wt = existsSync(resolve(args.against)) ? null : tempWorktree(args.against);
  try {
    there = await measure(wt ? wt.dir : resolve(args.against), fr, 'against');
  } finally {
    if (wt) wt.remove();
  }
  save(there, 'against');
}
const s = summary(here);
const bySection = (rows, label) => {
  for (const sec of sections) {
    const r = rows.filter((x) => x.section === sec);
    if (r.length) console.log(`  ${label} ${sec.padEnd(8)} ${String(r.length).padStart(4)} frames, ${String(summary(r).over3).padStart(4)} over ${THRESH[0]} mm, ${String(summary(r).over8).padStart(4)} over ${THRESH[1]} mm`);
  }
};
console.log(`\nhere: ${s.frames} frames, ${s.over3} over ${THRESH[0]} mm, ${s.over8} over ${THRESH[1]} mm${s.errors ? `, ${s.errors} failed to render` : ''}`);
bySection(here, 'here   ');
if (there) {
  const t = summary(there);
  console.log(`against: ${t.frames} frames, ${t.over3} over ${THRESH[0]} mm, ${t.over8} over ${THRESH[1]} mm`);
  bySection(there, 'against');
  // per item: the worst frame in each
  const worstBy = (rows) => {
    const m = {};
    for (const r of rows) if (!m[r.section + ':' + r.item] || r.worst > m[r.section + ':' + r.item].worst) m[r.section + ':' + r.item] = r;
    return m;
  };
  const a = worstBy(there), b = worstBy(here);
  console.log('\nworst frame per item     against -> here (mm)');
  for (const k of Object.keys(b).sort()) if (b[k].worst || a[k]?.worst) console.log(`  ${k.padEnd(28)} ${String(a[k]?.worst ?? '-').padStart(6)} -> ${String(b[k].worst).padStart(6)}   ${b[k].worst > 3 ? b[k].state + ': ' + b[k].what : ''}`);
}
console.log(`\nthe ${args.top} worst frames here:`);
for (const r of [...here].sort((x, y) => y.worst - x.worst).slice(0, +args.top)) if (r.worst > 0) console.log(`  ${r.worst.toFixed(1).padStart(6)}  ${r.name.padEnd(32)} ${r.what}`);
const inv = here.filter((r) => r.inverted);
if (inv.length) console.log(`\nnote: ${new Set(inv.map((r) => r.item)).size} items have faces the clip check reads as inside out (their numbers are less sure): ${[...new Set(inv.map((r) => r.item))].join(', ')}`);
console.log(`\nreport: ${join(resolve(args.out), 'here.json')} (and .csv)`);

if (args['save-baseline']) {
  const b = Object.fromEntries(here.map((r) => [r.name, r.worst]));
  writeFileSync(resolve(args['save-baseline']), JSON.stringify(b, null, 1));
  console.log(`baseline saved: ${resolve(args['save-baseline'])}`);
}
if (args.baseline) {
  const b = JSON.parse(readFileSync(resolve(args.baseline), 'utf8'));
  const tol = +args.tolerance;
  const worse = here.filter((r) => b[r.name] !== undefined && r.worst > THRESH[0] && r.worst > b[r.name] + tol);
  if (worse.length) {
    console.log(`\nFAIL  ${worse.length} frames clip worse than the baseline (by more than ${tol} mm, and over ${THRESH[0]} mm):`);
    for (const r of worse) console.log(`        ${r.name}: ${b[r.name]} -> ${r.worst} mm  ${r.what}`);
    process.exit(1);
  }
  console.log(`\nPASS  no frame clips worse than the baseline`);
}
