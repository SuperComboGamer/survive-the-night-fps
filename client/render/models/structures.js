// Player-built base structures. Origin at ground centre, length along X, thickness along Z (front = -Z).
// Damage is shown by switching between 3 precomputed stages (intact / damaged / wrecked): no rebuilds.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { STRUCT, STRUCT_DEFS } from '../../../shared/defs.js';
import { MeshBuilder, partsToGroup, makeRng } from '../materials.js';

const PI = Math.PI;
const cache = new Map();

const WOOD = [0.86, 0.8, 0.72];
const GATE_WOOD = [1.12, 1.02, 0.88];

/** stage 0 intact, 1 damaged, 2 wrecked */
function buildStage(type, d) {
  const b = new MeshBuilder(type * 101 + d * 7, { ao: true, aoHeight: 0.9 });
  const r = makeRng(type * 977 + 13); // same layout for all stages; damage decisions use a separate stream
  const dr = makeRng(type * 31 + d * 1009 + 3);
  const dark = 1 - d * 0.17;
  const tint = (c) => [c[0] * dark, c[1] * dark, c[2] * dark];
  // helpers: a board that may go missing / hang loose depending on damage
  const board = (sx, sy, sz, p, rot = [0, 0, 0], col = WOOD, { fragile = 0.5, mat = 'wood' } = {}) => {
    const roll = dr();
    const lose = d === 0 ? 0 : d === 1 ? fragile * 0.25 : fragile * 0.6;
    const loosen = d === 0 ? 0 : d === 1 ? 0.3 : 0.55;
    const jit = () => (r() - 0.5) * 0.04;
    if (roll < lose) return;
    let rr = [rot[0] + jit() * 0.5, rot[1], rot[2] + jit()];
    let pp = [...p];
    if (roll < lose + loosen * fragile) {
      // hanging from one nail: rotate about one end so the free end drops / swings
      const sw = (0.1 + dr() * 0.22) * d;
      const side = dr() < 0.5 ? -1 : 1;
      if (sx >= sy) {
        const phi = rot[2];
        const half = sx * 0.5;
        const piv = [p[0] + side * half * Math.cos(phi), p[1] + side * half * Math.sin(phi)];
        let th = side * sw;
        // keep the free end above ground
        for (let it = 0; it < 6; it++) {
          const endY = piv[1] - side * sx * Math.sin(phi + th);
          if (endY > 0.04) break;
          th *= 0.6;
        }
        pp = [piv[0] - side * half * Math.cos(phi + th), piv[1] - side * half * Math.sin(phi + th), p[2] - 0.015 * d];
        rr = [rr[0], rr[1], phi + th];
      } else {
        const th = side * sw * 0.6;
        const top = [p[0], p[1] + sy * 0.5];
        pp = [top[0] + Math.sin(th) * sy * 0.5, top[1] - Math.cos(th) * sy * 0.5, p[2] - 0.015 * d];
        rr = [rr[0], rr[1], rr[2] + th];
      }
    }
    b.box(mat, sx, sy, sz, { grain: true, p: pp, r: rr, c: tint(col.map((c) => c * (0.9 + r() * 0.2))) });
  };
  const nails = (pts) => {
    for (const p of pts) b.cyl('steel', 0.012, 0.012, 0.02, 4, { p, r: [PI / 2, 0, 0] });
  };
  switch (type) {
    case STRUCT.BARRICADE: {
      for (const x of [-1.38, 1.38]) board(0.14, 1.15, 0.14, [x, 0.575, 0.08], [0, 0, 0], WOOD, { fragile: 0 });
      board(0.12, 0.9, 0.12, [0, 0.45, 0.08], [0, 0, 0.05], WOOD, { fragile: 0 });
      const ys = [0.28, 0.62, 0.98];
      ys.forEach((y, k) => board(3.0, 0.2, 0.05, [0, y, -0.02], [0, 0, (r() - 0.5) * 0.06], WOOD, { fragile: k === 1 ? 0.8 : 0.5 }));
      board(3.25, 0.18, 0.05, [0, 0.62, -0.08], [0, 0, 0.33], WOOD, { fragile: 0.6 });
      board(3.25, 0.18, 0.05, [0, 0.62, -0.11], [0, 0, -0.33], WOOD, { fragile: 0.9 });
      nails([[-1.38, 0.28, -0.05], [1.38, 0.62, -0.05], [-1.38, 0.98, -0.05], [0, 0.62, -0.14]]);
      // sandbag / rubble at the foot for grounding
      b.box('wood', 0.3, 0.1, 0.3, { p: [-1.38, 0.05, 0.08], c: tint([0.6, 0.55, 0.5]) });
      b.box('wood', 0.3, 0.1, 0.3, { p: [1.38, 0.05, 0.08], c: tint([0.6, 0.55, 0.5]) });
      break;
    }
    case STRUCT.WALL: {
      for (const x of [-1.42, 1.42]) board(0.18, 2.8, 0.18, [x, 1.4, 0.08], [0, 0, 0], WOOD, { fragile: 0 });
      for (const y of [0.45, 1.5, 2.45]) board(3.0, 0.14, 0.08, [0, y, 0.1], [0, 0, 0], WOOD, { fragile: 0.2 });
      board(3.3, 0.14, 0.06, [0, 1.45, 0.17], [0, 0, 0.62], WOOD, { fragile: 0.2 });
      const n = 14;
      for (let k = 0; k < n; k++) {
        const x = -1.4 + (k + 0.5) * (2.8 / n);
        const h = 2.6 + (r() - 0.5) * 0.14;
        board(2.8 / n - 0.012, h, 0.05, [x, h / 2 + 0.03, 0.03], [0, 0, (r() - 0.5) * 0.02], WOOD, { fragile: 0.7 });
        // sharpened tip
        if (dr() > d * 0.3) b.frustum('wood', 2.8 / n - 0.012, 0.05, 0.01, 0.05, h + 0.03, h + 0.16, { p: [x, 0, 0.03], c: tint(WOOD) });
      }
      nails([[-1.0, 0.45, 0.0], [0.4, 0.45, 0.0], [-0.6, 2.45, 0.0], [1.0, 2.45, 0.0], [0, 1.5, 0.0]]);
      break;
    }
    case STRUCT.METAL_WALL: {
      for (const x of [-1.42, 1.42]) board(0.16, 2.8, 0.16, [x, 1.4, 0.07], [0, 0, 0], WOOD, { fragile: 0 });
      for (const y of [0.35, 1.4, 2.5]) board(3.0, 0.12, 0.08, [0, y, 0.09], [0, 0, 0], WOOD, { fragile: 0.15 });
      // overlapping corrugated sheets (3 columns x 2 rows), some rust
      const cols = 3;
      for (let c = 0; c < cols; c++)
        for (let row = 0; row < 2; row++) {
          const x = -1.0 + c * 1.0, y = 0.72 + row * 1.32;
          const roll = dr();
          const lose = d === 2 ? 0.35 : d === 1 ? 0.1 : 0;
          if ((c + row) % 2 === 1 && roll < lose) continue;
          const bent = d > 0 && roll < 0.2 + d * 0.2;
          const mat = (c * 2 + row) % 3 === 1 || (d === 2 && roll < 0.6) ? 'tin_rust' : 'tin';
          b.box(mat, 1.08, 1.4, 0.02, { p: [x + (r() - 0.5) * 0.06, y, -0.01 - row * 0.012], r: [bent ? -0.12 * d : 0, 0, (r() - 0.5) * 0.03 + (bent ? 0.08 * d : 0)] });
          for (const sx of [-0.45, 0.45]) for (const sy of [-0.6, 0.6]) b.cyl('steel', 0.015, 0.015, 0.02, 4, { p: [x + sx, y + sy, -0.03 - row * 0.012], r: [PI / 2, 0, 0] });
        }
      // tape patches
      b.box('wire', 0.3, 0.06, 0.005, { p: [0.5, 1.4, -0.035], r: [0, 0, 0.2] });
      break;
    }
    case STRUCT.SPIKES: {
      // low frame of two crossed logs + rows of sharpened stakes angled outward
      board(2.2, 0.12, 0.12, [0, 0.07, -0.55], [0, 0, 0], WOOD, { fragile: 0 });
      board(2.2, 0.12, 0.12, [0, 0.07, 0.55], [0, 0, 0], WOOD, { fragile: 0 });
      board(0.12, 0.12, 2.2, [-0.55, 0.14, 0], [0, 0, 0], WOOD, { fragile: 0 });
      board(0.12, 0.12, 2.2, [0.55, 0.14, 0], [0, 0, 0], WOOD, { fragile: 0 });
      for (let i = 0; i < 5; i++)
        for (let j = 0; j < 5; j++) {
          const x = -0.88 + i * 0.44 + (r() - 0.5) * 0.12, z = -0.88 + j * 0.44 + (r() - 0.5) * 0.12;
          const roll = dr();
          if (roll < d * 0.18) {
            b.cylBetween('wood', [x, 0.03, z], [x + 0.35, 0.05, z + 0.1], 0.004, 0.03, 4, { c: tint(WOOD) }); // snapped, lying
            continue;
          }
          const lean = 0.35 + r() * 0.3 + (roll < d * 0.35 ? 0.4 : 0);
          const a = Math.atan2(z, x) + (r() - 0.5) * 0.6;
          const L = 0.55 + r() * 0.12;
          const top = [x + Math.cos(a) * Math.sin(lean) * L, Math.cos(lean) * L, z + Math.sin(a) * Math.sin(lean) * L];
          b.cylBetween('wood', [x, 0, z], top, 0.004, 0.05, 5, { c: tint([1.1, 1.0, 0.85]) });
          if (d > 0 && dr() < 0.5) b.cylBetween('blood', [top[0] * 0.98, top[1] * 0.85, top[2] * 0.98], top, 0.006, 0.03, 4);
        }
      break;
    }
    case STRUCT.BARBED_WIRE: {
      // X-frame supports + coiled razor wire along X
      for (const x of [-1.3, 0, 1.3]) {
        const sag = d === 2 && x === 0 ? -0.25 : 0;
        for (const s of [-1, 1]) b.beam('wood', [x, 0, s * 0.42], [x + sag * 0.3, 0.85 + sag, -s * 0.12], 0.06, 0.06, { c: tint(WOOD), side: [1, 0, 0] });
        b.cylBetween('rope', [x - 0.04, 0.5 + sag * 0.6, -0.08], [x + 0.04, 0.5 + sag * 0.6, 0.08], 0.03, 0.03, 5);
      }
      const pts = [];
      const turns = 16, R = 0.36;
      const N = turns * 6;
      for (let k = 0; k <= N; k++) {
        const t = k / N, a = t * turns * PI * 2;
        const x = -1.45 + t * 2.9;
        const sagY = d === 2 ? -Math.sin(t * PI) * 0.18 : d === 1 ? -Math.sin(t * PI * 2) * 0.05 : 0;
        pts.push([x + Math.sin(a) * 0.04, 0.48 + Math.cos(a) * R + sagY, Math.sin(a) * R]);
      }
      if (d < 2) b.tube('wire', pts, 0.006, N, 3);
      else {
        b.tube('wire', pts.slice(0, Math.floor(N * 0.55)), 0.006, Math.floor(N * 0.55), 3);
        b.tube('wire', pts.slice(Math.floor(N * 0.62)), 0.006, Math.floor(N * 0.38), 3);
      }
      // straight tension wires with barbs
      for (const [y, z] of [[0.15, -0.3], [0.15, 0.3], [0.82, 0]]) {
        b.cylBetween('wire', [-1.45, y, z], [1.45, y + (d ? -0.05 : 0), z], 0.004, 0.004, 3);
        for (let k = 0; k < 9; k++) b.box('wire', 0.01, 0.05, 0.01, { p: [-1.35 + k * 0.33, y, z], r: [0.5, 0, 0.6] });
      }
      if (d > 0) b.box('cloth', 0.2, 0.25, 0.01, { p: [0.4, 0.55, -0.25], r: [0.2, 0.4, 0.3], c: [0.3, 0.25, 0.2] });
      break;
    }
    case STRUCT.TORCH: {
      b.cyl('wood', 0.03, 0.04, 1.55, 6, { p: [0, 0.775, 0], grain: true, c: tint([0.7, 0.62, 0.52]) });
      // wrapped cloth head, sooty
      b.cyl('cloth', 0.065, 0.05, 0.2, 7, { p: [0, 1.6, 0], c: [0.22 * dark, 0.19 * dark, 0.16 * dark] });
      b.torus('cloth', 0.058, 0.018, 4, 8, PI * 2, { p: [0, 1.53, 0], r: [PI / 2, 0, 0], c: [0.3, 0.26, 0.2] });
      b.torus('cloth', 0.06, 0.016, 4, 8, PI * 2, { p: [0, 1.66, 0], r: [PI / 2, 0.3, 0], c: [0.18, 0.15, 0.12] });
      b.cyl('charred', 0.04, 0.06, 0.05, 7, { p: [0, 1.72, 0] });
      // stones around the foot
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * PI * 2;
        b.rock('stone_rough', 0.07, { detail: 0, seed: 70 + k, p: [Math.cos(a) * 0.1, 0.03, Math.sin(a) * 0.1] });
      }
      break;
    }
    case STRUCT.GATE: {
      // frame posts + top header, a lighter plank door with Z brace, handle and hinges; gap at the top
      for (const x of [-1.45, 1.45]) board(0.2, 2.6, 0.2, [x, 1.3, 0.05], [0, 0, 0], GATE_WOOD, { fragile: 0, mat: 'wood' });
      board(3.1, 0.16, 0.2, [0, 2.52, 0.05], [0, 0, 0], GATE_WOOD, { fragile: 0.1 });
      const n = 11, x0 = -1.32, w = 2.64;
      for (let k = 0; k < n; k++) {
        const x = x0 + (k + 0.5) * (w / n);
        board(w / n - 0.02, 2.0, 0.045, [x, 1.1, -0.02], [0, 0, 0], GATE_WOOD, { fragile: 0.5 });
      }
      board(2.64, 0.16, 0.05, [0, 0.4, -0.07], [0, 0, 0], GATE_WOOD, { fragile: 0.15 });
      board(2.64, 0.16, 0.05, [0, 1.8, -0.07], [0, 0, 0], GATE_WOOD, { fragile: 0.15 });
      board(2.9, 0.16, 0.05, [0, 1.1, -0.075], [0, 0, 0.5], GATE_WOOD, { fragile: 0.2 });
      // hinges + handle + scrap-metal kick plate
      for (const y of [0.4, 1.8]) b.box('steel', 0.3, 0.06, 0.02, { p: [-1.25, y, -0.105] });
      b.box('steel', 0.04, 0.2, 0.03, { p: [1.1, 1.1, -0.11] });
      b.torus('steel', 0.06, 0.012, 4, 8, PI, { p: [1.1, 1.1, -0.14], r: [0, PI / 2, 0] });
      b.box('rust', 1.0, 0.3, 0.015, { p: [0.4, 0.22, -0.1], r: [0, 0, 0.03] });
      nails([[-1.0, 0.4, -0.1], [0.6, 0.4, -0.1], [-0.6, 1.8, -0.1], [0.9, 1.8, -0.1]]);
      break;
    }
    case STRUCT.CAMPFIRE: {
      // ash bed + glowing coals
      b.cyl('ash', 0.56, 0.62, 0.05, 12, { p: [0, 0.02, 0] });
      const coals = d === 2 ? 4 : 9;
      for (let k = 0; k < coals; k++) {
        const a = r() * PI * 2, rr = r() * 0.3;
        b.box('ember', 0.06 + r() * 0.05, 0.03, 0.05, { p: [Math.cos(a) * rr, 0.05, Math.sin(a) * rr], r: [0, r() * 3, 0] });
      }
      // ring of stones (knocked out of place as it takes damage)
      const n = 13;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * PI * 2 + (r() - 0.5) * 0.12;
        const kick = d === 0 ? 0 : dr() < d * 0.3 ? 0.08 + dr() * 0.18 * d : 0;
        const R = 0.7 + (r() - 0.5) * 0.05 + kick;
        const s = 0.13 + r() * 0.05;
        b.rock('stone_rough', s, { detail: 0, seed: 810 + k, scale: [1.25, 0.8, 1], sink: 0.25, p: [Math.cos(a) * R, s * 0.5 - (kick ? 0.03 : 0), Math.sin(a) * R], r: [kick ? 0.4 : 0, a + r(), 0] });
      }
      // teepee of split logs (bark outside, charred feet); collapses with damage
      const logs = 6;
      for (let k = 0; k < logs; k++) {
        const a = (k / logs) * PI * 2 + 0.25;
        const fallen = d > 0 && dr() < d * 0.35;
        const base = [Math.cos(a) * 0.36, 0.04, Math.sin(a) * 0.36];
        const top = fallen ? [Math.cos(a + 0.9) * 0.1, 0.1, Math.sin(a + 0.9) * 0.1] : [Math.cos(a) * 0.04, 0.56, Math.sin(a) * 0.04];
        b.cylBetween('bark', base, top, 0.035, 0.05, 6);
        const mid = [base[0] + (top[0] - base[0]) * 0.45, base[1] + (top[1] - base[1]) * 0.45, base[2] + (top[2] - base[2]) * 0.45];
        b.cylBetween('charred', base, mid, 0.046, 0.056, 6);
      }
      // kindling across the bottom
      for (let k = 0; k < 3; k++) {
        const a = r() * PI;
        b.cylBetween('charred', [Math.cos(a) * 0.3, 0.07, Math.sin(a) * 0.3], [-Math.cos(a) * 0.3, 0.07, -Math.sin(a) * 0.3], 0.022, 0.028, 5);
      }
      // cooking spit: two forked sticks + cross bar with a hanging tin pot
      const spitDown = d === 2;
      for (const sx of [-1, 1]) {
        const x = sx * 0.6;
        if (spitDown && sx > 0) {
          b.cylBetween('wood', [x, 0.03, 0.1], [x - 0.1, 0.05, 0.6], 0.018, 0.02, 5, { c: tint([0.7, 0.62, 0.52]) });
          continue;
        }
        b.cylBetween('wood', [x, 0, 0], [x, 0.56, 0], 0.02, 0.024, 5, { c: tint([0.7, 0.62, 0.52]) });
        b.cylBetween('wood', [x, 0.46, 0], [x + sx * 0.06, 0.6, 0], 0.012, 0.015, 4, { c: tint([0.7, 0.62, 0.52]) });
      }
      if (!spitDown) {
        b.cylBetween('wood', [-0.66, 0.54, 0], [0.66, 0.54, 0], 0.015, 0.015, 5, { c: tint([0.62, 0.55, 0.46]) });
        b.cylBetween('wire', [0.22, 0.54, 0], [0.22, 0.44, 0], 0.004, 0.004, 3);
        b.cyl('rust', 0.07, 0.06, 0.12, 8, { p: [0.22, 0.38, 0] });
        b.torus('wire', 0.07, 0.004, 3, 8, PI, { p: [0.22, 0.44, 0] });
      } else b.cyl('rust', 0.07, 0.06, 0.12, 8, { p: [0.95 - 0.15, 0.04, 0.5], r: [PI / 2, 0.4, 0] });
      break;
    }
    case STRUCT.WORKBENCH: {
      const BENCH = [0.8, 0.72, 0.6];
      // legs (doubled 2x4s), aprons, stretchers
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) {
          const brk = d === 2 && sx > 0 && sz < 0;
          board(0.1, 0.84, 0.1, [sx * 0.9, 0.42, sz * 0.36], [0, 0, brk ? 0.12 : 0], BENCH, { fragile: 0 });
          board(0.05, 0.6, 0.1, [sx * 0.83, 0.52, sz * 0.36], [0, 0, 0], BENCH, { fragile: 0.3 });
        }
      for (const sz of [-1, 1]) board(1.9, 0.12, 0.04, [0, 0.78, sz * 0.43], [0, 0, 0], BENCH, { fragile: 0.2 });
      for (const sx of [-1, 1]) board(0.04, 0.12, 0.76, [sx * 0.96, 0.78, 0], [0, 0, 0], BENCH, { fragile: 0.2 });
      for (const sz of [-1, 1]) board(1.86, 0.08, 0.05, [0, 0.16, sz * 0.36], [0, 0, 0], BENCH, { fragile: 0.2 });
      // thick top boards + lower shelf
      for (let k = 0; k < 5; k++) board(2.0, 0.06, 0.175, [0, 0.87, -0.36 + k * 0.18], [0, 0, 0], k % 2 ? WOOD : BENCH, { fragile: k === 0 ? 0.2 : 0.45 });
      for (let k = 0; k < 4; k++) board(1.8, 0.035, 0.17, [0, 0.21, -0.27 + k * 0.18], [0, 0, 0], BENCH, { fragile: 0.6 });
      nails([[-0.9, 0.87, -0.46], [0.9, 0.87, -0.46], [-0.9, 0.78, -0.455], [0.9, 0.78, -0.455]]);
      // bench vise on the front-left corner
      b.group({ p: [-0.66, 0.9, -0.44] }, () => {
        b.box('paint', 0.18, 0.06, 0.2, { p: [0, 0.03, 0.06], c: [0.24, 0.3, 0.36] });
        b.box('paint', 0.2, 0.1, 0.06, { p: [0, 0.1, 0.02], c: [0.24, 0.3, 0.36] });
        b.box('paint', 0.2, 0.1, 0.05, { p: [0, 0.1, -0.11], c: [0.24, 0.3, 0.36] });
        for (const z of [-0.004, -0.076]) b.box('steel', 0.2, 0.03, 0.012, { p: [0, 0.135, z] });
        b.cyl('steel', 0.012, 0.012, 0.26, 6, { p: [0, 0.08, -0.12], r: [PI / 2, 0, 0] });
        b.cyl('steel', 0.008, 0.008, 0.22, 5, { p: [0.02, 0.08, -0.24], r: [0, 0, PI / 2 + 0.3] });
        for (const s of [-1, 1]) b.sphere('steel', 0.014, 5, 3, { p: [0.02 + s * 0.105 * Math.cos(0.3), 0.08 + s * 0.105 * Math.sin(0.3), -0.24] });
        b.box('rust', 0.3, 0.02, 0.02, { p: [0.05, 0.14, -0.04], r: [0, 0.1, 0] }); // clamped pipe
      });
      // tools + scrap on top (fewer as it gets wrecked)
      const keep = () => d === 0 || dr() > d * 0.35;
      const y = 0.9;
      if (keep()) {
        // hammer
        b.cylBetween('wood', [0.05, y + 0.015, -0.2], [0.33, y + 0.015, -0.1], 0.013, 0.013, 5, { c: [0.72, 0.55, 0.38] });
        b.box('steel', 0.04, 0.035, 0.12, { p: [0.345, y + 0.02, -0.095], r: [0, -0.34, 0] });
      }
      if (keep()) {
        // hand saw
        b.box('steel', 0.45, 0.004, 0.11, { p: [0.55, y + 0.004, 0.12], r: [0, 0.3, 0] });
        b.box('wood', 0.12, 0.03, 0.1, { p: [0.33, y + 0.016, 0.19], r: [0, 0.3, 0], c: [0.6, 0.3, 0.2] });
      }
      if (keep()) b.box('steel', 0.22, 0.008, 0.03, { p: [-0.25, y + 0.005, -0.28], r: [0, 0.7, 0] }); // wrench
      if (keep()) {
        b.cyl('paint', 0.06, 0.06, 0.13, 8, { p: [-0.3, y + 0.065, 0.2], c: [0.45, 0.5, 0.52] });
        for (let k = 0; k < 4; k++) b.cyl('steel', 0.003, 0.003, 0.08, 3, { p: [-0.3 + (k - 1.5) * 0.02, y + 0.15, 0.2], r: [(k - 1.5) * 0.2, 0, 0.15] });
      }
      for (let k = 0; k < 6; k++) b.cyl('steel', 0.003, 0.003, 0.06, 3, { p: [-0.05 + r() * 0.3, y + 0.003, 0.05 + r() * 0.15], r: [PI / 2, r() * 3, 0] });
      if (keep()) b.box('tin', 0.4, 0.01, 0.3, { p: [0.72, y + 0.006, -0.2], r: [0, 0.2, 0.02] });
      // lower shelf: scrap, a crate, cans
      b.box('tin', 0.5, 0.01, 0.35, { p: [0.4, 0.235, 0], r: [0, 0.3, 0.1] });
      b.cylBetween('rust', [-0.2, 0.26, -0.1], [0.3, 0.26, 0.18], 0.02, 0.02, 5);
      b.box('wood', 0.34, 0.22, 0.28, { p: [-0.55, 0.34, 0.02], r: [0, 0.2, 0], c: tint([0.62, 0.56, 0.48]) });
      b.cyl('paint', 0.07, 0.07, 0.2, 8, { p: [-0.15, 0.33, 0.15], c: [0.55, 0.14, 0.1] });
      // tools fallen on the floor once it's been knocked around
      if (d > 0) {
        b.cylBetween('wood', [0.6, 0.015, -0.7], [0.85, 0.015, -0.6], 0.013, 0.013, 5, { c: [0.72, 0.55, 0.38] });
        b.box('steel', 0.2, 0.008, 0.03, { p: [-0.4, 0.004, -0.62], r: [0, 1.2, 0] });
      }
      break;
    }
    case STRUCT.DOOR: {
      // boards nailed across a doorway (1.3 - 1.5 m wide opening), thickness along Z, nailed on the -Z face
      const DOORW = [[0.86, 0.8, 0.72], [0.72, 0.68, 0.6], [0.8, 0.7, 0.58], [0.62, 0.7, 0.64]];
      for (const sx of [-1, 1]) board(0.11, 2.2, 0.05, [sx * 0.69, 1.1, 0.03], [0, 0, 0], WOOD, { fragile: 0 });
      const ys = [0.22, 0.6, 0.98, 1.36, 1.72, 2.08];
      ys.forEach((yy, k) => {
        const h = 0.18 + r() * 0.06;
        const L = 1.5 + r() * 0.06;
        board(L, h, 0.035, [(r() - 0.5) * 0.06, yy, -0.015], [0, 0, (r() - 0.5) * 0.08], DOORW[k % DOORW.length], { fragile: k === 0 || k === 5 ? 0.35 : 0.6 });
      });
      // cross bracing
      const diag = (x0, y0, x1, y1, z, col, fr) => {
        const L = Math.hypot(x1 - x0, y1 - y0);
        board(L, 0.16, 0.035, [(x0 + x1) / 2, (y0 + y1) / 2, z], [0, 0, Math.atan2(y1 - y0, x1 - x0)], col, { fragile: fr });
      };
      diag(-0.64, 0.3, 0.64, 1.85, -0.055, DOORW[2], 0.55);
      diag(-0.64, 1.9, 0.64, 0.4, -0.085, DOORW[1], 0.75);
      const nz = -0.04;
      const np = [];
      for (const yy of ys) for (const sx of [-1, 1]) np.push([sx * 0.69, yy + (sx > 0 ? 0.04 : -0.04), nz]);
      np.push([-0.6, 0.35, -0.08], [0.6, 1.8, -0.08], [-0.6, 1.85, -0.11], [0.6, 0.45, -0.11], [0, 1.1, -0.11]);
      nails(np);
      break;
    }
  }
  return b.build();
}

function stageParts(type, d) {
  const key = `${type}:${d}`;
  let p = cache.get(key);
  if (!p) cache.set(key, (p = buildStage(type, d)));
  return p;
}

/** @returns {THREE.Group} with children stage0..2; call setStructureDamage to switch */
export function createStructure(type) {
  if (!STRUCT_DEFS[type]) throw new Error(`createStructure: unknown type ${type}`);
  const g = new THREE.Group();
  g.name = STRUCT_DEFS[type].name;
  const stages = [];
  for (let d = 0; d < 3; d++) {
    const s = partsToGroup(stageParts(type, d), `stage${d}`);
    s.visible = d === 0;
    g.add(s);
    stages.push(s);
  }
  g.userData.stages = stages;
  g.userData.stage = 0;
  g.userData.structType = type;
  if (type === STRUCT.TORCH || type === STRUCT.CAMPFIRE) {
    // flame emitter position (base of the flames): torch head / centre of the campfire's log teepee
    const a = new THREE.Object3D();
    a.name = 'flameAnchor';
    if (type === STRUCT.TORCH) a.position.set(0, 1.76, 0);
    else a.position.set(0, 0.2, 0);
    g.add(a);
    g.userData.flameAnchor = a;
  }
  return g;
}

/** hpFrac 0..1 -> intact (>0.66) / damaged (>0.33) / wrecked. Cheap visibility switch. */
export function setStructureDamage(group, hpFrac) {
  const st = group.userData.stages;
  if (!st) return;
  const s = hpFrac > 0.66 ? 0 : hpFrac > 0.33 ? 1 : 2;
  if (s === group.userData.stage) return;
  group.userData.stage = s;
  for (let k = 0; k < st.length; k++) st[k].visible = k === s;
}

// ------------------------------------------------------------------ placement ghost
let ghostValid = null, ghostInvalid = null;
const ghostGeo = new Map();
function ghostMaterials() {
  if (!ghostValid) {
    const o = { transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide };
    ghostValid = new THREE.MeshBasicMaterial({ color: 0x3cff6a, ...o });
    ghostInvalid = new THREE.MeshBasicMaterial({ color: 0xff3a2a, ...o });
    ghostValid.name = 'ghost_valid';
    ghostInvalid.name = 'ghost_invalid';
  }
}

/** semi-transparent single-mesh preview. group.userData.setValid(bool) toggles green/red. */
export function createGhost(type) {
  ghostMaterials();
  let geo = ghostGeo.get(type);
  if (!geo) {
    const list = stageParts(type, 0).map((p) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', p.geometry.attributes.position);
      g.setAttribute('normal', p.geometry.attributes.normal);
      g.setIndex(p.geometry.index);
      return g;
    });
    geo = mergeGeometries(list, false);
    ghostGeo.set(type, geo);
  }
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(geo, ghostValid);
  mesh.renderOrder = 10;
  g.add(mesh);
  g.userData.ghost = true;
  g.userData.setValid = (ok) => {
    mesh.material = ok ? ghostValid : ghostInvalid;
  };
  return g;
}
