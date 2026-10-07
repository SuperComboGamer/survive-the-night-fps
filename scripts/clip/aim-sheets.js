// The before / after sheets of scripts/clip/aim-shots.js's pictures: each scene's pictures side by side, labelled,
// with close-ups of the sights cut out of the same frames. One headless browser (lib.js's launchChrome) lays them out.
//
// usage: node scripts/clip/aim-sheets.js --before <dir> --after <dir> [--prev <dir>] [--extra <dir>] [--out <dir>]
//          [--gun ak47] [--other m4a1]
//   --prev   an earlier attempt's pictures: the aimed sheets get a middle column of them
//   --extra  sandbox stills of the gun's other models (third-person.png, low-detail.png, and the same with a
//            "-before" suffix): one more sheet
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, launchChrome } from './lib.js';

const args = parseArgs(process.argv.slice(2), { gun: 'ak47', other: 'm4a1' });
if (!args.before || !args.after) {
  console.log('usage: node scripts/clip/aim-sheets.js --before <dir> --after <dir> [--prev <dir>] [--extra <dir>] [--out <dir>]');
  process.exit(1);
}
const B = resolve(String(args.before)), A = resolve(String(args.after)), OUT = resolve(String(args.out || join(A, '..')));
const P = args.prev ? resolve(String(args.prev)) : null, X = args.extra ? resolve(String(args.extra)) : null;
mkdirSync(OUT, { recursive: true });
const GUN = String(args.gun).toUpperCase(), OTHER = String(args.other).toLowerCase();
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// a cell: { img, tag ('before' | 'previous' | 'after' | ''), label, crop: [x, y, w, h] of the 1280 x 720 picture }
// a sheet: { out, title, note, cols, cellW, cells }
const cell = (dir, name, tag, label, crop) => ({ img: join(dir, name + '.png'), tag, label, crop });
// before | (the earlier attempt) | after
const row = (name, label, crop) => [cell(B, name, 'before', label, crop), ...(P ? [cell(P, name, 'previous', label, crop)] : []), cell(A, name, 'after', label, crop)];
const SIGHT = [500, 247, 280, 158]; // the middle of the frame, where the sights are
const N = P ? 3 : 2;
const sheets = [];
for (const [i, [name, said]] of [
  ['aim-10m', 'a walker 10 m out'],
  ['aim-25m', 'a walker 25 m out'],
  ['aim-50m', 'a walker 50 m out'],
  ['aim-night-10m', 'a walker 10 m out, at night by the flashlight'],
].entries()) {
  sheets.push({
    out: `0${i + 1}-${name}.png`,
    title: `${GUN} aimed: ${said}`,
    note: 'Top: what the player sees (1280 x 720, the sights up, the aim on the walker\'s chest). Bottom: the middle of the same frame, four times the size.',
    cols: N,
    cellW: P ? 800 : 960,
    cells: [...row(name, 'the whole view'), ...row(name, 'the sights, x4', SIGHT)],
  });
}
sheets.push({
  out: '05-hip-10m.png',
  title: `${GUN} at the hip: the gun on screen and the crosshair, a walker 10 m out`,
  note: 'Bottom: the crosshair, four times the size. Its ticks stand on the edge of the cone the next round is drawn from.',
  cols: 2,
  cellW: 960,
  cells: [cell(B, 'hip-10m', 'before', 'the whole view'), cell(A, 'hip-10m', 'after', 'the whole view'), cell(B, 'hip-10m', 'before', 'the crosshair, x4', SIGHT), cell(A, 'hip-10m', 'after', 'the crosshair, x4', SIGHT)],
});
const CLIMB = [340, 100, 600, 420];
const climb = [['climb-0-before', 'sights up, nothing fired'], ['climb-1-first', 'after the first round'], ['climb-2-middle', 'after round 15'], ['climb-3-last', 'after round 29']];
sheets.push({
  out: '06-climb-strip.png',
  title: `${GUN} aimed at a barn wall 25 m out, the trigger held for a magazine and the aim never corrected`,
  note: 'Before: the view hardly moves while the rounds go up to 2 m over it (the holes high on the wall). After: the view climbs with the rounds, and the holes are where the sights are.',
  cols: 4,
  cellW: 600,
  cells: [...climb.map(([n, l]) => cell(B, n, 'before', l, CLIMB)), ...climb.map(([n, l]) => cell(A, n, 'after', l, CLIMB))],
});
let n = 7;
for (const [D, stance, kinds] of [
  [10, 'aimed', ['1-first-close', '2-burst-close', '3-magazine']],
  [10, 'hip', ['1-first-close', '2-burst-close', '3-magazine']],
  [25, 'aimed', ['1-first-close', '2-burst', '3-magazine']],
  [25, 'hip', ['1-first', '2-burst', '3-magazine']],
]) {
  const said = ['six first shots, the gun settled between them', 'a burst of five', 'a whole magazine, the trigger held'];
  sheets.push({
    out: `${String(n++).padStart(2, '0')}-groups-${D}m-${stance}.png`,
    title: `${GUN} from ${D} m, ${stance === 'aimed' ? 'aimed' : 'from the hip'}: the holes in a barn wall`,
    note: 'The wall square on. The ring is the point of aim (it was never moved), the bar a metre on the wall (the close pictures are three times the scale of the wide ones).',
    cols: 3,
    cellW: 640,
    cells: [...kinds.map((k, i) => cell(B, `group-${D}m-${stance}-${k}`, 'before', said[i])), ...kinds.map((k, i) => cell(A, `group-${D}m-${stance}-${k}`, 'after', said[i]))],
  });
}
const o25 = `other-${OTHER}-aim-25m`, oN = `other-${OTHER}-aim-night-10m`;
sheets.push({
  out: `${String(n++).padStart(2, '0')}-other-rifle.png`,
  title: `Another rifle aimed, to compare: the ${OTHER.toUpperCase()} (its model not changed) and the ${GUN}, a walker 25 m out`,
  note: 'Bottom: the sights, four times the size.',
  cols: N + 1,
  cellW: P ? 600 : 640,
  cells: [cell(A, o25, '', `${OTHER.toUpperCase()} (as it was and is)`), ...row('aim-25m', GUN), cell(A, o25, '', `${OTHER.toUpperCase()}: the sights, x4`, SIGHT), ...row('aim-25m', `${GUN}: the sights, x4`, SIGHT)],
});
sheets.push({
  out: `${String(n++).padStart(2, '0')}-other-rifle-night.png`,
  title: `The ${OTHER.toUpperCase()} aimed at night by the flashlight, a walker 10 m out: the flashlight's spill on an aimed gun changed for every gun`,
  note: 'Before: the spill comes from beside the head and lights whatever faces the eye. After: from the torch\'s side, ahead of the rear sight. Bottom: the sights, four times the size.',
  cols: 2,
  cellW: 960,
  cells: [cell(B, oN, 'before', OTHER.toUpperCase()), cell(A, oN, 'after', OTHER.toUpperCase()), cell(B, oN, 'before', 'the sights, x4', SIGHT), cell(A, oN, 'after', 'the sights, x4', SIGHT)],
});
const trans = [['transition-in-02', 'aim pressed: frame 2'], ['transition-in-05', 'frame 5'], ['transition-in-09', 'frame 9'], ['transition-in-14', 'frame 14'], ['transition-in-40', 'settled'], ['transition-out-03', 'let go: frame 3'], ['transition-out-08', 'frame 8']];
sheets.push({
  out: `${String(n++).padStart(2, '0')}-transition.png`,
  title: `${GUN}: the sights coming up and going down (frames at 60 a second), a walker 10 m out`,
  note: 'The viewmodel\'s field of view narrows with the same easing as the gun\'s move to the eye: no frame should jump in size.',
  cols: 4,
  cellW: 600,
  cells: trans.map(([f, l]) => cell(A, f, 'after', l)),
});
if (X) {
  sheets.push({
    out: `${String(n++).padStart(2, '0')}-other-models.png`,
    title: `${GUN}: the same sights on the gun another player holds (third person) and on the low-detail model (the sandbox)`,
    note: 'The third person and the ground pickup use the low-detail build of the same model: the notch plate, the leaf, the hood and the post, without the worn edges.',
    cols: 2,
    cellW: 960,
    cells: [cell(X, 'third-person-before', 'before', 'held by a survivor'), cell(X, 'third-person', 'after', 'held by a survivor'), cell(X, 'low-detail-before', 'before', 'the low-detail model, from behind and above'), cell(X, 'low-detail', 'after', 'the low-detail model, from behind and above')],
  });
}

const work = mkdtempSync(join(tmpdir(), 'stn-sheet-'));
const chrome = await launchChrome({ width: 1280, height: 720 });
try {
  for (const s of sheets) {
    const missing = s.cells.filter((c) => !existsSync(c.img));
    if (missing.length) {
      console.log(`  (skipped ${s.out}: no ${missing.map((c) => c.img).join(', ')})`);
      continue;
    }
    const cellH = Math.round((s.cellW * 9) / 16);
    const rows = Math.ceil(s.cells.length / s.cols);
    const W = s.cols * s.cellW + (s.cols + 1) * 8, H = 78 + rows * (cellH + 32) + (rows + 1) * 8;
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      body{margin:0;background:#15171b;font:600 15px system-ui,Segoe UI,sans-serif;color:#e8e6e1}
      h1{margin:0;padding:10px 12px 0;font-size:20px}
      p{margin:0;padding:4px 12px 0;font-weight:400;color:#b9b6ae;height:22px;overflow:hidden}
      .g{display:grid;grid-template-columns:repeat(${s.cols},${s.cellW}px);gap:8px;padding:8px}
      .c{background:#0c0d10;border-radius:4px;overflow:hidden}
      .i{width:${s.cellW}px;height:${cellH}px;background-repeat:no-repeat;image-rendering:pixelated}
      .l{height:32px;line-height:32px;padding:0 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .t{display:inline-block;padding:0 7px;margin-right:8px;border-radius:3px;font-size:13px;line-height:20px}
      .before{background:#7a2b26}.previous{background:#7a6426}.after{background:#2b6a34}
    </style></head><body><h1>${esc(s.title)}</h1><p>${esc(s.note || '')}</p><div class="g">${s.cells
      .map((c) => {
        const [x, y, w] = c.crop || [0, 0, 1280, 720];
        const k = s.cellW / w;
        return `<div class="c"><div class="i" style="background-image:url('${pathToFileURL(c.img).href}');background-size:${1280 * k}px ${720 * k}px;background-position:${-x * k}px ${-y * k}px"></div><div class="l">${c.tag ? `<span class="t ${c.tag}">${c.tag === 'previous' ? 'first attempt' : c.tag}</span>` : ''}${esc(c.label || '')}</div></div>`;
      })
      .join('')}</div></body></html>`;
    const f = join(work, 'sheet.html');
    writeFileSync(f, html);
    await chrome.page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await chrome.page.goto(pathToFileURL(f).href, { waitUntil: 'load' });
    await chrome.page.screenshot({ path: join(OUT, s.out), fullPage: true });
    console.log(`  ${s.out}`);
  }
} finally {
  await chrome.close();
  rmSync(work, { recursive: true, force: true });
}
