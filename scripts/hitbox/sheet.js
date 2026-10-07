// Contact sheets of the overlays in a folder: six to a sheet at half size, to look through them quickly.
// usage: node scripts/hitbox/sheet.js <folder> [--cols 2] [--rows 3]
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Canvas, readPng } from './draw.js';
import { parseArgs } from '../clip/lib.js';

const args = parseArgs(process.argv.slice(2), { cols: '2', rows: '3' });
const dir = resolve(String(args._[0]));
const files = readdirSync(dir).filter((f) => f.endsWith('.png') && !f.startsWith('00-')).sort();
const per = +args.cols * +args.rows;
for (let s = 0; s * per < files.length; s++) {
  const tiles = files.slice(s * per, s * per + per).map((f) => readPng(readFileSync(join(dir, f))));
  const w = Math.floor(tiles[0].w / 2), h = Math.floor(tiles[0].h / 2);
  const cv = new Canvas(w * +args.cols, h * +args.rows, [0, 0, 0]);
  tiles.forEach((t, i) => {
    const ox = (i % +args.cols) * w, oy = Math.floor(i / +args.cols) * h;
    for (let y = 0; y < h && y * 2 + 1 < t.h; y++) for (let x = 0; x < w && x * 2 + 1 < t.w; x++) {
      for (let c = 0; c < 3; c++) cv.rgb[((oy + y) * cv.w + ox + x) * 3 + c] = (t.rgb[(y * 2 * t.w + x * 2) * 3 + c] + t.rgb[(y * 2 * t.w + x * 2 + 1) * 3 + c] + t.rgb[((y * 2 + 1) * t.w + x * 2) * 3 + c] + t.rgb[((y * 2 + 1) * t.w + x * 2 + 1) * 3 + c]) >> 2;
    }
  });
  const out = join(dir, `00-sheet-${s + 1}.png`);
  cv.save(out);
  console.log(out);
}
