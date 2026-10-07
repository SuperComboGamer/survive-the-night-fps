// (working aid) a prop seen from above as two maps of characters, to fit boxes by eye: the model's top, and the
// height of its underside, in tenths of a metre (0-9 a=1.0 b=1.1 ... z=3.5, then A-Z from 3.6; '.': nothing there).
// rows: z (the nose, -Z, at the top), columns: x (-X left). usage: node scripts/hitbox/sil.js <type>[:variant][@cell] ...
import { variantsOf, measure } from './lib.js';
const CH = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
for (const what of process.argv.slice(2)) {
  const [tv, cs] = what.split('@');
  const [type, vi] = tv.split(':');
  const m = variantsOf(type)[+(vi || 0)];
  const [cellX, cellZ] = String(cs || 0.25).split(',').map(Number);
  const cell = cellX, cz_ = cellZ || cellX;
  const r = measure(m, [], { keep: true, cells: 2_000_000, min: 0.05 });
  const { grid: g, Mmove: S } = r;
  const x0 = Math.floor(m.box[0] / cell) * cell, z0 = Math.floor(m.box[2] / cz_) * cz_;
  const nx = Math.ceil((m.box[3] - x0) / cell), nz = Math.ceil((m.box[5] - z0) / cz_);
  const top = new Float32Array(nx * nz).fill(-1), bot = new Float32Array(nx * nz).fill(99), cnt = new Int32Array(nx * nz);
  for (let k = 0; k < g.nz; k++) for (let i = 0; i < g.nx; i++) {
    const cx = Math.floor((g.x0 + (i + 0.5) * g.v - x0) / cell), cz = Math.floor((g.z0 + (k + 0.5) * g.v - z0) / cz_);
    if (cx < 0 || cz < 0 || cx >= nx || cz >= nz) continue;
    let lo = -1, hi = -1;
    for (let j = 0; j < g.ny; j++) if (S[(k * g.ny + j) * g.nx + i]) { if (lo < 0) lo = j; hi = j; }
    if (hi < 0) continue;
    const a = cz * nx + cx;
    cnt[a]++;
    top[a] = Math.max(top[a], g.y0 + (hi + 1) * g.v);
    bot[a] = Math.min(bot[a], g.y0 + lo * g.v);
  }
  const need = Math.max(1, Math.round((cell / g.v) * (cz_ / g.v) * 0.3)); // (a cell counts when a third of it is solid)
  console.log(`${what}: x ${m.box[0].toFixed(2)}..${m.box[3].toFixed(2)}  y ..${m.box[4].toFixed(2)}  z ${m.box[2].toFixed(2)}..${m.box[5].toFixed(2)}   cell ${cell} x ${cz_} m, first column x=${x0.toFixed(2)}, first row z=${z0.toFixed(2)}     TOP | UNDERSIDE`);
  for (let cz = 0; cz < nz; cz++) {
    let a = '', b = '';
    for (let cx = 0; cx < nx; cx++) {
      const k = cz * nx + cx;
      const on = cnt[k] >= need;
      a += on ? CH[Math.min(CH.length - 1, Math.max(0, Math.round(top[k] / 0.1)))] : '.';
      b += on ? CH[Math.min(CH.length - 1, Math.max(0, Math.round(bot[k] / 0.1)))] : '.';
    }
    console.log(`${(z0 + cz * cz_).toFixed(2).padStart(6)} ${a} | ${b}`);
  }
}
