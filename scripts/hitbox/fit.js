// Boxes fitted to a prop's model, to paste into shared/props.js and tidy by hand (docs/hitboxes.md).
// The model's solid (lib.js) is read from above as a field of heights - for each 5 cm square its top and whether it
// stands on the ground or hangs over it (a wing, a trailer between its axles) - and that field is cut into the few
// largest rectangles of nearly one height: a bonnet, a cabin, a boot.
//
// usage: node scripts/hitbox/fit.js <type>[:variant] [--max 8] [--up 0.1] [--down 0.3] [--gain 0.04] [--gap 0.5] [--span 1]
//   :variant  fit that variant only (default: the median of them all, square by square)
//   --max     at most this many boxes
//   --up      a box's top may stand this far over the model in it (solid air)
//   --down    a box is grown over the rounded edge of a body while most of each row is no further under its top than this
//   --gain    stop when the best box left would add less than this (m3)
//   --gap     what hangs this far or more over the ground, from side to side, for --span metres or more keeps the
//             room under it: a shot or a look goes through under a trailer (a body does not - it still stops whoever
//             walks into it)
import { PROPS, variantsOf, solidOf, collidersOf, measure, NOT_SOLID } from './lib.js';
import { parseArgs } from '../clip/lib.js';

const THIN = 0.46; // server/nav.js takes a box thinner than 0.45 m for a deck: none is made thinner

export function fit(models, o = {}) {
  const down = o.down ?? 0.3, up = o.up ?? 0.1, gap = o.gap ?? 0.5, max = o.max ?? 8;
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const m of models) for (let a = 0; a < 3; a++) {
    b[a] = Math.min(b[a], m.box[a]);
    b[3 + a] = Math.max(b[3 + a], m.box[3 + a]);
  }
  const v = o.v ?? Math.max(0.05, Math.cbrt(((b[3] - b[0]) * (b[4] - b[1]) * (b[5] - b[2])) / 1_200_000));
  const pad = 2 * v;
  const grid = { x0: Math.floor((b[0] - pad) / v) * v, y0: Math.floor((b[1] - pad) / v) * v, z0: Math.floor((b[2] - pad) / v) * v, v };
  grid.nx = Math.ceil((b[3] + pad - grid.x0) / v);
  grid.ny = Math.ceil((b[4] + pad - grid.y0) / v);
  grid.nz = Math.ceil((b[5] + pad - grid.z0) / v);
  const { nx, ny, nz } = grid;
  const n2 = nx * nz;
  const tops = [], bots = [];
  for (const m of models) {
    const S = solidOf(m, grid, (name) => !NOT_SOLID.has(name));
    // (what is one square thin - an aerial, a mirror's stalk - is not the shape: a cube counts where most of the
    // squares round it are solid at that height too)
    const top = new Float32Array(n2).fill(-1), bot = new Float32Array(n2).fill(-1);
    for (let k = 1; k < nz - 1; k++) for (let i = 1; i < nx - 1; i++) {
      let lo = -1, hi = -1;
      for (let j = 0; j < ny; j++) {
        if (!S[(k * ny + j) * nx + i]) continue;
        let near = 0;
        for (let dk = -1; dk <= 1; dk++) for (let di = -1; di <= 1; di++) near += S[((k + dk) * ny + j) * nx + i + di];
        if (near < 5) continue;
        if (lo < 0) lo = j;
        hi = j;
      }
      if (hi < 0) continue;
      top[k * nx + i] = grid.y0 + (hi + 1) * v;
      bot[k * nx + i] = grid.y0 + lo * v;
    }
    tops.push(top);
    bots.push(bot);
  }
  const med = (list, a) => {
    const vals = list.map((l) => l[a]).sort((p, q) => p - q);
    return vals[(vals.length - 1) >> 1]; // (the lower middle: what most variants have at least)
  };
  const top = new Float32Array(n2), bot = new Float32Array(n2);
  for (let a = 0; a < n2; a++) {
    top[a] = med(tops, a);
    bot[a] = med(bots, a);
  }
  let base = 0;
  for (let a = 0; a < n2; a++) if (bot[a] >= -1 + 1e-6 && top[a] > 0 && bot[a] < base) base = bot[a]; // (the ground it stands on)
  const covered = new Float32Array(n2).fill(base); // the top of the highest box over each square
  const boxes = [];
  const levels = [...new Set([...top].filter((y) => y > base + 0.1).map((y) => Math.round(y / 0.05) * 0.05))].sort((p, q) => q - p);
  const h = new Int32Array(nx);
  const stack = [];
  const r2 = (x) => Math.round(x * 100) / 100;
  const minGain = o.gain ?? 0.04;
  while (boxes.length < max) {
    // of every level: the largest rectangle of squares where the model stands at least that high (a box with its top
    // there holds no air but `up`), and what it adds to what the boxes so far already fill
    let best = null;
    for (const L of levels) {
      const ok = (a) => top[a] >= L - up - 1e-6;
      let rect = null;
      h.fill(0);
      for (let k = 0; k < nz; k++) {
        for (let i = 0; i < nx; i++) h[i] = ok(k * nx + i) ? h[i] + 1 : 0;
        stack.length = 0;
        for (let i = 0; i <= nx; i++) {
          const cur = i < nx ? h[i] : 0;
          let start = i;
          while (stack.length && stack[stack.length - 1][1] > cur) {
            const [s0, hh] = stack.pop();
            const area = hh * (i - s0);
            if (!rect || area > rect.area) rect = { area, i0: s0, i1: i, k0: k - hh + 1, k1: k + 1, L };
            start = s0;
          }
          if (cur && (!stack.length || stack[stack.length - 1][1] < cur)) stack.push([start, cur]);
        }
      }
      if (!rect) continue;
      // grow it over the rounded edges of that body: a row more on a side while most of the row is that high too
      for (let again = true; again; ) {
        again = false;
        const sides = [
          [rect.k0 - 1, null, () => rect.k0--],
          [rect.k1, null, () => rect.k1++],
          [null, rect.i0 - 1, () => rect.i0--],
          [null, rect.i1, () => rect.i1++],
        ];
        for (const [k, i, take] of sides) {
          let n = 0, yes = 0;
          if (k !== null) {
            if (k < 0 || k >= nz) continue;
            for (let x = rect.i0; x < rect.i1; x++, n++) yes += top[k * nx + x] >= L - down - 1e-6 ? 1 : 0;
          } else {
            if (i < 0 || i >= nx) continue;
            for (let z = rect.k0; z < rect.k1; z++, n++) yes += top[z * nx + i] >= L - down - 1e-6 ? 1 : 0;
          }
          if (n && yes / n >= 0.7) {
            take();
            again = true;
          }
        }
      }
      let gain = 0;
      for (let k = rect.k0; k < rect.k1; k++) for (let i = rect.i0; i < rect.i1; i++) gain += Math.max(0, Math.min(L, top[k * nx + i] + up) - covered[k * nx + i]);
      rect.gain = gain * v * v;
      if (!best || rect.gain > best.gain) best = rect;
    }
    if (!best || best.gain < minGain) break;
    for (let k = best.k0; k < best.k1; k++) for (let i = best.i0; i < best.i1; i++) covered[k * nx + i] = Math.max(covered[k * nx + i], best.L);
    // what of it hangs clear of the ground from side to side for a metre or more keeps the room under it: cut the
    // rectangle along its length into the stretches that stand on the ground and the ones that do not
    const alongZ = best.k1 - best.k0 >= best.i1 - best.i0;
    const n = alongZ ? best.k1 - best.k0 : best.i1 - best.i0;
    const under = new Float32Array(n).fill(Infinity);
    for (let k = best.k0; k < best.k1; k++) for (let i = best.i0; i < best.i1; i++) {
      const a = k * nx + i;
      if (top[a] <= 0) continue;
      const s = alongZ ? k - best.k0 : i - best.i0;
      if (bot[a] < under[s]) under[s] = bot[a];
    }
    const runs = []; // [from, to, y0]
    let s0 = 0;
    const hangs = (s) => under[s] - base >= gap && under[s] < best.L - THIN;
    for (let s = 1; s <= n; s++) {
      if (s < n && hangs(s) === hangs(s0)) continue;
      runs.push([s0, s, hangs(s0)]);
      s0 = s;
    }
    // (a short stretch is not worth a box of its own: it goes with its neighbours, on the ground)
    for (const r of runs) if (r[2] && (r[1] - r[0]) * v < (o.span ?? 1)) r[2] = false;
    const merged = [];
    for (const r of runs) {
      const last = merged[merged.length - 1];
      if (last && last[2] === r[2]) last[1] = r[1];
      else merged.push(r.slice());
    }
    for (const [a0, a1, hang] of merged) {
      let y0 = base;
      if (hang) {
        y0 = Infinity;
        for (let s = a0; s < a1; s++) y0 = Math.min(y0, under[s]);
        y0 = Math.floor(y0 / 0.05 + 1e-6) * 0.05;
      }
      const y1 = best.L;
      const i0 = alongZ ? best.i0 : best.i0 + a0, i1 = alongZ ? best.i1 : best.i0 + a1;
      const k0 = alongZ ? best.k0 + a0 : best.k0, k1 = alongZ ? best.k0 + a1 : best.k1;
      const X0 = grid.x0 + i0 * v, X1 = grid.x0 + i1 * v, Z0 = grid.z0 + k0 * v, Z1 = grid.z0 + k1 * v;
      boxes.push([r2((X0 + X1) / 2), r2((y0 + y1) / 2), r2((Z0 + Z1) / 2), r2(X1 - X0), r2(y1 - y0), r2(Z1 - Z0)]);
    }
  }
  return boxes;
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/hitbox/fit.js')) {
  const args = parseArgs(process.argv.slice(2), {});
  for (const what of args._) {
    const [type, vi] = String(what).split(':');
    let models = variantsOf(type);
    if (vi !== undefined) models = [models[+vi]];
    const num = (k) => (args[k] === undefined ? undefined : +args[k]);
    const boxes = fit(models, { max: num('max'), down: num('down'), up: num('up'), area: num('area'), gap: num('gap'), gain: num('gain'), span: num('span') });
    const worst = (cols) => {
      const w = { shotAir: 0, shotAirMax: 0, shotHole: 0, shotHoleThick: 0, moveAirMax: 0, moveHoleMax: 0, standMax: 0 };
      for (const m of variantsOf(type)) {
        const r = measure(m, cols);
        for (const k of Object.keys(w)) w[k] = Math.max(w[k], r[k]);
      }
      return Object.entries(w).map(([k, x]) => `${k} ${x.toFixed(2)}`).join('  ');
    };
    console.log(`${type}${vi !== undefined ? ':' + vi : ''}: ${boxes.length} boxes`);
    console.log('    boxes: [\n' + boxes.map((bx) => `      [${bx.join(', ')}],`).join('\n') + '\n    ],');
    console.log('  now:    ' + worst(collidersOf(PROPS[type])));
    console.log('  fitted: ' + worst(collidersOf({ boxes })));
  }
}
