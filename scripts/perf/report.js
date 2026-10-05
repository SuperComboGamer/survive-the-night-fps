// The tables of a benchmark (bench.js, server-bench.js), from the JSON its runs left in shots/perf/: the owner's
// before / after table - | Scene | before FPS | after FPS | Change | p99 frame time | - medians of the rounds, then
// the other counters, then how it was measured.
//
// usage: node scripts/perf/report.js [--out shots/perf] [--stamp <prefix of the files>] [--write docs/pr-images/perf/RESULTS.md]
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { median } from './lib.js';

const f1 = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? 'n/a' : v.toFixed(d));
const med = (rows, get) => median(rows.map(get).filter((v) => v !== null && v !== undefined && !Number.isNaN(v)));
const range = (rows, get) => {
  const v = rows.map(get).filter((x) => x !== null && x !== undefined);
  return v.length > 1 ? `${f1(Math.min(...v))}-${f1(Math.max(...v))}` : '';
};

/** The Markdown of the runs in `dir` whose file names start with `stamp` (default: the latest stamp there). */
export function report(dir, { stamp = null, label = null, server = null } = {}) {
  let files = readdirSync(dir).filter((f) => /-(before|after)-r\d+-(island|mainland)\.json$/.test(f)).sort();
  if (label) files = files.filter((f) => f.includes(`-${label}-`));
  if (!stamp && files.length) stamp = files[files.length - 1].replace(/-(before|after)-r\d+-(island|mainland)\.json$/, '');
  if (stamp) files = files.filter((f) => f.startsWith(stamp));
  if (!files.length) return '(no runs)';
  const runs = files.map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
  const by = { before: {}, after: {} };
  const extra = { before: [], after: [] };
  for (const r of runs) {
    for (const [name, m] of Object.entries(r.scenes)) (by[r.label][name] ||= []).push(m);
    extra[r.label].push(r.extra || {});
  }
  const names = [...new Set([...Object.keys(by.before), ...Object.keys(by.after)])].sort();
  const has = Object.keys(by.before).length > 0;
  const machine = runs[0].machine || {};
  const rounds = Math.max(...runs.map((r) => r.round));
  const lines = [];
  const stalls = runs.reduce((n, r) => n + Object.values(r.scenes).filter((m) => m.stalled).length, 0);
  const errs = runs.filter((r) => r.error).map((r) => `${r.label} r${r.round} ${r.part}: ${r.error.split('\n')[0]}`);
  lines.push(`| Scene | before FPS | after FPS | Change | p99 frame time |`, `|---|---|---|---|---|`);
  for (const n of names) {
    const b = by.before[n] || [], a = by.after[n] || [];
    const fb = med(b, (m) => m.fps), fa = med(a, (m) => m.fps);
    const ch = has && fb && fa ? `${fa >= fb ? '+' : ''}${(((fa - fb) / fb) * 100).toFixed(0)}% (${(fa / fb).toFixed(2)}x)` : '';
    const p99 = `${has ? f1(med(b, (m) => m.ms.p99)) + ' -> ' : ''}${f1(med(a, (m) => m.ms.p99))} ms`;
    lines.push(`| ${n.replace(/^\d+ /, '')} | ${has ? f1(fb) : ''} | ${f1(fa)} | ${ch} | ${p99} |`);
  }
  lines.push('', `Spread of the rounds (lowest-highest FPS): ` + names.map((n) => `${n.slice(0, 2)}: ${has ? range(by.before[n] || [], (m) => m.fps) + ' / ' : ''}${range(by.after[n] || [], (m) => m.fps)}`).join('; ') + '.', '');
  const pair = (b, a, d = 1, unit = '') => `${has ? f1(b, d) + ' -> ' : ''}${f1(a, d)}${unit}`;
  lines.push(`| Scene | draw calls | triangles (M) | JS per frame (ms) | GPU per frame (ms) | worst frame (ms) | dead in view |`, `|---|---|---|---|---|---|---|`);
  for (const n of names) {
    const b = by.before[n] || [], a = by.after[n] || [];
    const g = (k) => [med(b, k), med(a, k)];
    lines.push(`| ${n.replace(/^\d+ /, '')} | ${pair(...g((m) => m.calls), 0)} | ${pair(...g((m) => m.tris / 1e6), 2)} | ${pair(...g((m) => m.jsMs), 2)} | ${pair(...g((m) => m.gpuMs), 2)} | ${pair(...g((m) => m.ms.worst), 0)} | ${pair(...g((m) => m.zombies?.seen), 0)} |`);
  }
  const ex = (k) => [med(extra.before, k), med(extra.after, k)];
  lines.push('', `| Counter | ${has ? 'before | after' : 'value'} |`, has ? `|---|---|---|` : `|---|---|`);
  const row = (name, k, d = 0, unit = '') => {
    const [b, a] = ex(k);
    if (b === null && a === null) return;
    lines.push(has ? `| ${name} | ${f1(b, d)}${unit} | ${f1(a, d)}${unit} |` : `| ${name} | ${f1(a, d)}${unit} |`);
  };
  row('Load to the menu (page opened to the splash scene drawn, shaders built)', (e) => e.loadMs / 1000, 2, ' s');
  row('Join (click to playing)', (e) => e.joinMs / 1000, 2, ' s');
  row('Survivor picker opening: longest frame', (e) => e.picker?.worstFrameMs, 0, ' ms');
  row('Survivor picker opening: longest JavaScript', (e) => e.picker?.worstJsMs, 0, ' ms');
  row("The crossing's world swap: longest frame", (e) => e.swapHitchMs, 0, ' ms');
  row('Worst frame of JavaScript while 200 of the dead spawn', (e) => e.spawnWorstJsMs, 1, ' ms');
  row('JS heap, island, after the horde scenes', (e) => e.heapIslandMB?.heapMB, 0, ' MB');
  row('...with its typed arrays', (e) => e.heapIslandMB?.withBuffersMB, 0, ' MB');
  row('JS heap, mainland, after the crossing cutscene', (e) => e.heapAfterCrossingMB?.heapMB, 0, ' MB');
  row('...with its typed arrays', (e) => e.heapAfterCrossingMB?.withBuffersMB, 0, ' MB');
  row('JS heap, mainland, just arrived (crossing skipped)', (e) => e.heapMainlandMB?.heapMB, 0, ' MB');
  row('...with its typed arrays', (e) => e.heapMainlandMB?.withBuffersMB, 0, ' MB');
  row('Vertex + index buffers, island with the horde (estimate)', (e) => e.gpuMemIsland?.geometryMB, 0, ' MB');
  row('Textures, island (estimate)', (e) => e.gpuMemIsland?.textureMB, 0, ' MB');
  row('Vertex + index buffers, mainland (estimate)', (e) => e.gpuMemMainland?.geometryMB, 0, ' MB');
  row('Textures, mainland (estimate)', (e) => e.gpuMemMainland?.textureMB, 0, ' MB');
  if (server) lines.push('', server);
  const gpuOk = runs.some((r) => Object.values(r.scenes).some((m) => m.gpuMs !== null && m.gpuMs !== undefined));
  lines.push(
    '',
    '### How it was measured',
    `- Machine: ${machine.gpu || '?'}, ${machine.cores || '?'} logical cores, Windows, ${/Chrome\/([\d.]+)/.exec(machine.ua || '')?.[0] || 'Chrome'} headless. ${machine.size ? machine.size.join(' x ') : ''}, device scale factor ${machine.dpr ?? 1}, quality "${machine.quality}", ${runs[0].capped ? 'vsync ON (a capped run: the frame rates mean nothing)' : 'vsync and the frame limit off'}.`,
    `- Production builds (\`npm run build\`), each against its own local server with the seed ${runs[0].seed} (\`GODMODE=1 DEV_ADMIN=1 NODE_ENV=test\`); "before" is the tag \`perf-baseline\`.`,
    `- ${rounds} round${rounds > 1 ? 's' : ''}, the builds alternating (before, after, before, after, ...); ${runs[0].seconds} s per scene; the figures are medians of the rounds. FPS is frames over the time they took; p99 and worst are frame-to-frame times.`,
    `- The same scenes, spots, hour and camera in both builds (scripts/perf/lib.js SPOT). The dead are called up with the admin \`/spawn\` round a second player who stands ahead of the camera, so they gather in view; the count in view is asserted and is the last column of the second table.`,
    `- "JS per frame" is the game's update plus the issuing of its draw calls (the time in the frame callback). "GPU per frame" is ${gpuOk ? 'one EXT_disjoint_timer_query_webgl2 query round the whole frame' : 'NOT AVAILABLE: this browser has no EXT_disjoint_timer_query_webgl2'}.`,
    `- Draw calls and triangles are of one whole frame, every pass (shadow maps included).`,
    '',
    '### Limits',
    `- A headless browser on the machine of somebody who may have been using it: ${stalls ? stalls + ' timed stretch(es) still had a stall in them after two retakes' : 'no timed stretch had a stall left in it'}; the spread of the rounds is above.`,
    `- The dead move: the two builds do not have each of them on the same pixel, only the same number of them at the same place.`,
    `- The 4x slower CPU is Chrome's own throttle (Emulation.setCPUThrottlingRate), on the page's main thread only.`,
  );
  if (errs.length) lines.push('', '**Runs that failed:**', ...errs.map((e) => `- ${e}`));
  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const opt = (k, d) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
  const dir = resolve(opt('--out', join(dirname(fileURLToPath(import.meta.url)), '../../shots/perf')));
  let server = null;
  try {
    server = readFileSync(join(dir, 'server.md'), 'utf8');
  } catch {}
  const md = report(dir, { stamp: opt('--stamp', null), server });
  const to = opt('--write', null);
  if (to) {
    mkdirSync(dirname(resolve(to)), { recursive: true });
    writeFileSync(resolve(to), md + '\n');
  }
  console.log(md);
}
