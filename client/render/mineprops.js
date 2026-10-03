// A Shaft Nine stop, built: the rock (minegeo.js) plus its props, lamps and liquids, as a THREE.Group of a few merged meshes
// and the list of light sources the scene's light pool picks from. Everything is deterministic from the stop's index.
import * as THREE from 'three';
import { STOP_NX, STOP_NZ, STOP_X0, STOP_Z0, CELL, VOID, CAGE_RECT } from '../../shared/mine.js';
import { Mesher, STYLE, buildRock, col, hash2, rng } from './minegeo.js';

const STEEL = 0x4a4d52;
const RUST = 0x6e4a2c;
const TIMBER = 0x4e3a26;
const TIMBER_D = 0x3a2b1c;

// open cells that have rock beside them, as lamp spots spaced `gap` metres apart: [{x, z, nx, nz}] (stop frame; nx, nz point away from the wall)
function wallSpots(stop, gap, max, seed, filter = null) {
  const g = stop.grid;
  const spots = [];
  const r = rng(seed);
  const cells = [];
  for (let j = 1; j < STOP_NZ - 1; j++) {
    for (let i = 1; i < STOP_NX - 1; i++) {
      const v = g[j * STOP_NX + i];
      if (!v || v === VOID) continue;
      let nx = 0;
      let nz = 0;
      if (!g[j * STOP_NX + i - 1]) nx += 1;
      if (!g[j * STOP_NX + i + 1]) nx -= 1;
      if (!g[(j - 1) * STOP_NX + i]) nz += 1;
      if (!g[(j + 1) * STOP_NX + i]) nz -= 1;
      if (!nx && !nz) continue;
      const l = Math.hypot(nx, nz);
      const x = STOP_X0 + (i + 0.5) * CELL;
      const z = STOP_Z0 + (j + 0.5) * CELL;
      if (filter && !filter(x, z, v - 1)) continue;
      cells.push({ x, z, nx: nx / l, nz: nz / l });
    }
  }
  // shuffled greedy pick
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  for (const c of cells) {
    if (spots.length >= max) break;
    if (spots.some((s) => Math.hypot(s.x - c.x, s.z - c.z) < gap)) continue;
    spots.push(c);
  }
  return spots;
}

function gable(M, cx, y0, cz, sx, sz, h, color) {
  // a roof prism along x: ridge over the middle of z
  const x0 = cx - sx / 2;
  const x1 = cx + sx / 2;
  const z0 = cz - sz / 2;
  const z1 = cz + sz / 2;
  const ym = y0 + h;
  const l = Math.hypot(h, sz / 2);
  M.quad([x0, y0, z0], [x1, y0, z0], [x1, ym, cz], [x0, ym, cz], 0, (sz / 2) / l, -h / l, color, null, [0.8, 0.8, 1, 1]);
  M.quad([x1, y0, z1], [x0, y0, z1], [x0, ym, cz], [x1, ym, cz], 0, (sz / 2) / l, h / l, color, null, [0.8, 0.8, 1, 1]);
  const tri = (x, n) => {
    M.v(x, y0, z0, n, 0, 0, 0, 0, color.r * 0.6, color.g * 0.6, color.b * 0.6);
    M.v(x, y0, z1, n, 0, 0, 1, 0, color.r * 0.6, color.g * 0.6, color.b * 0.6);
    M.v(x, ym, cz, n, 0, 0, 0.5, 1, color.r * 0.7, color.g * 0.7, color.b * 0.7);
  };
  tri(x1, 1);
  tri(x0, -1);
}

export function buildStop(stop, tex) {
  const idx = stop.index;
  const st = STYLE[stop.id];
  const group = new THREE.Group();
  group.position.set(stop.ox, 0, stop.oz);
  const M = new Mesher(); // lit
  const E = new Mesher(); // glowing solids (unlit)
  const A = new Mesher(); // additive halos and light pools
  const sources = []; // light-pool sources (world coordinates)
  const r = rng(idx * 7919 + 17);
  const G = { pit: -1.6, pitFloor: col(stop.id === 'magma' ? 0x2a0a04 : stop.id === 'crystal' ? 0x04040e : 0x02080a), pitWall: col(stop.id === 'magma' ? 0x3a1608 : 0x14122a) };
  const rock = buildRock(stop, M, G);
  const lampSource = (x, y, z, color, intensity, extra = {}) => sources.push({ x: stop.ox + x, y, z: stop.oz + z, color, intensity, base: intensity, ...extra });

  // a glowing lamp on a wall: fixture, bulb, cross halo, a pool of light on the floor, and a source for the light pool
  const lamp = (x, y, z, nx, nz, color, size = 1, source = 0.9, pool = 3.4) => {
    const c = col(color);
    M.box(x, y + 0.12, z, 0.16, 0.34, 0.16, col(STEEL));
    E.box(x, y, z, 0.12, 0.12, 0.12, c.clone().multiplyScalar(1.6));
    const h = 0.7 * size;
    const hc = c.clone().multiplyScalar(0.55);
    A.quad([x - h, y - h, z], [x + h, y - h, z], [x + h, y + h, z], [x - h, y + h, z], 0, 0, 1, hc);
    A.quad([x, y - h, z - h], [x, y - h, z + h], [x, y + h, z + h], [x, y + h, z - h], 1, 0, 0, hc);
    const p = pool;
    const pc = c.clone().multiplyScalar(0.16);
    A.quad([x - p, 0.03, z + p], [x + p, 0.03, z + p], [x + p, 0.03, z - p], [x - p, 0.03, z - p], 0, 1, 0, pc);
    if (source) lampSource(x, y, z, color, source, { flick: r() < 0.25 ? 1 : 0, phase: r() * 6.28 });
  };

  // ---------------------------------------------------------------- the cage's landing: portal, threshold, signal lamps
  const portal = (px, pz) => {
    const j = col(STEEL);
    M.box(px - 1.95, 1.5, pz + 1.7, 0.3, 3, 0.4, j);
    M.box(px + 1.95, 1.5, pz + 1.7, 0.3, 3, 0.4, j);
    M.box(px, 3.1, pz + 1.7, 4.2, 0.35, 0.4, j);
    M.box(px, 0.05, pz + 1.55, 3.6, 0.1, 0.8, col(0x2a2c30));
    M.box(px, 0.12, pz + 2.0, 3.8, 0.04, 0.5, col(0xa88a20)); // hazard threshold
  };
  portal(0, 0);
  portal(stop.exit.lx, stop.exit.lz); // the exit shaft, far from the one you came down
  // a sign over it, and a lamp that the scene lights when the cage is there
  E.box(stop.exit.lx, 3.55, stop.exit.lz + 1.75, 1.4, 0.3, 0.06, col(0x30ff60).multiplyScalar(0.9));
  sources.push({ x: stop.ox + stop.exit.lx, y: 2.8, z: stop.oz + stop.exit.lz + 2.5, color: 0x30ff60, intensity: 0, base: 0, flick: 0, phase: 0, exit: true });

  // ---------------------------------------------------------------- props that have a body
  for (const o of stop.obstacles) {
    const T = o.type;
    if (o.kind === 'box') {
      const { x, z, sx, sz, h } = o;
      if (T === 'engine') {
        M.box(x, h / 2, z, sx, h, sz, col(0x6a3a2c));
        gable(M, x, h, z, sx + 0.6, sz + 0.6, 2.8, col(0x3a302a));
        E.box(x, 2, z - sz / 2 - 0.02, 3.4, 3.8, 0.06, col(0x1a0e08)); // the door
        E.box(x - 5, 3.2, z - sz / 2 - 0.02, 1.4, 1.8, 0.06, col(0x2a1a0e));
        E.box(x + 5, 3.2, z - sz / 2 - 0.02, 1.4, 1.8, 0.06, col(0x2a1a0e));
        M.cyl(x + 9.6, 0, z + 1, 0.9, 0.6, 27, 8, col(0x5a3a30));
        lampSource(x, 2.6, z - sz / 2 - 1.5, 0xff6a24, 0.8);
        A.quad([x - 1.8, 0.4, z - sz / 2 - 0.1], [x + 1.8, 0.4, z - sz / 2 - 0.1], [x + 1.8, 3.8, z - sz / 2 - 0.1], [x - 1.8, 3.8, z - sz / 2 - 0.1], 0, 0, -1, col(0x401408));
      } else if (T === 'tub') {
        M.box(x, 0.45, z, sx, 0.9, sz, col(0x32302e));
        M.box(x, 0.95, z, sx - 0.2, 0.2, sz - 0.2, col(0x0c0c0c));
        M.box(x, 0.12, z, sx + 0.2, 0.08, 0.12, col(0x4a2f22));
      } else if (T === 'crate') {
        const w = col(TIMBER).lerp(col(TIMBER_D), hash2(Math.round(x), Math.round(z), 2));
        M.box(x, h / 2, z, sx, h, sz, w, hash2(Math.round(x * 3), Math.round(z), 8) * 0.4 - 0.2);
        M.box(x, h + 0.02, z, sx + 0.04, 0.05, sz + 0.04, col(TIMBER_D));
      } else if (T === 'post') {
        M.box(x, h / 2, z, sx, h, sz, col(TIMBER));
        M.box(x, h + 0.15, z, 1.2, 0.3, 0.5, col(TIMBER_D));
      } else if (T === 'pump') {
        M.box(x, 0.2, z, sx, 0.4, sz, col(0x3a3d3c));
        M.beam([x, 1.2, z - 3], [x, 1.2, z + 1.2], 1.7, col(0x4f8f80), 10);
        M.beam([x, 1.2, z + 1.2], [x, 1.2, z + 3.3], 1.3, col(0x3c6c60), 10);
        M.box(x, 1.2, z - 3.1, 1.6, 1.6, 0.4, col(0xb08f1e));
        M.beam([x, 1.2, z + 3.3], [x, 3.6, z + 3.3], 0.55, col(RUST), 8);
      } else if (T === 'header') {
        M.beam([x - sx / 2, 2.1, z], [x + sx / 2, 2.1, z], 1.5, col(RUST), 12);
        for (let k = -2; k <= 2; k++) M.box(x + k * 2.6, 2.1, z, 0.25, 1.9, 1.9, col(0x4a3220));
        E.box(x + 3, 2.1, z - 0.8, 0.5, 0.5, 0.06, col(0x30ff90));
      } else if (T === 'transformer') {
        M.box(x, h / 2, z, sx, h, sz, col(0x4a5252));
        for (let k = -1; k <= 1; k++) M.box(x + k * 0.9, h + 0.3, z, 0.25, 0.6, sz - 0.3, col(0x33383a));
        E.box(x, 1.4, z - sz / 2 - 0.02, 0.5, 0.2, 0.05, col(0xff2010));
      } else if (T === 'truck') {
        M.box(x, 0.9, z, sx, 0.3, sz, col(0x30363a));
        M.box(x - 1.6, 1.7, z, 1.6, 1.6, sz, col(0x3a4a3a));
        M.box(x + 0.7, 1.3, z, 3, 0.9, sz - 0.2, col(0x5a4a34));
        for (const wx of [-1.8, 1.8]) for (const wz of [-1, 1]) M.beam([x + wx, 0.5, z + wz * 1.0], [x + wx, 0.5, z + wz * 1.2], 1, col(0x111111), 10);
      } else {
        M.box(x, h / 2, z, sx, h, sz, col(0x555555));
      }
    } else {
      const { x, z, r: rr, h } = o;
      if (T === 'coal') {
        M.cyl(x, 0, z, rr, 0.2, h, 10, col(0x141414), true);
      } else if (T === 'hopper') {
        M.cyl(x, 0, z, rr, rr, h, 14, col(0x4a4e50), false);
        M.cyl(x, h, z, rr, 0.2, 1.4, 14, col(0x383c3e), true);
      } else if (T === 'leg') {
        M.cyl(x, 0, z, rr, rr * 0.8, h, 6, col(STEEL), true);
      } else if (T === 'column') {
        const c = col(st.wall).lerp(col(st.wall2), 0.4);
        M.cyl(x, 0, z, rr * 1.35, rr, 1.2, 9, c, false);
        M.cyl(x, 1.2, z, rr, rr * 0.9, h - 2.4, 9, c, false);
        M.cyl(x, h - 1.2, z, rr * 0.9, rr * 1.5, 1.2, 9, c, false);
        if (stop.id === 'crystal') for (let k = 0; k < 3; k++) E.crystal(x + Math.cos(k * 2.1) * rr * 0.95, 0.3, z + Math.sin(k * 2.1) * rr * 0.95, 0.18, 0.9 + k * 0.4, 0.15, k, col(k % 2 ? 0x3a8ff0 : 0x8a4cff));
      } else if (T === 'spire') {
        if (stop.id === 'crystal') {
          const cr = rng(99);
          for (let k = 0; k < 16; k++) {
            const a = cr() * 6.28;
            const d = cr() * rr * 1.3;
            const hh = 3 + cr() * 13 * (1 - d / (rr * 1.7));
            const c = k % 3 === 0 ? 0x3a8ff0 : k % 3 === 1 ? 0x8a4cff : 0xb98cff;
            E.crystal(x + Math.cos(a) * d, 0, z + Math.sin(a) * d, 0.35 + cr() * 0.55, hh, (cr() - 0.5) * 0.5, cr() * 6, col(c).multiplyScalar(0.75), col(c).multiplyScalar(1.5));
          }
          lampSource(x, 3, z, 0x9a5cff, 1.2, { big: true });
          A.quad([x - 4, 4, z], [x + 4, 4, z], [x + 4, 12, z], [x - 4, 12, z], 0, 0, 1, col(0x2a1458));
          A.quad([x, 4, z - 4], [x, 4, z + 4], [x, 12, z + 4], [x, 12, z - 4], 1, 0, 0, col(0x2a1458));
        } else {
          M.cyl(x, 0, z, rr, 0.1, h, 5, col(0x050506), false);
        }
      } else if (T === 'crucible') {
        M.cyl(x, 0, z, 1.9, 1.6, 4.2, 12, col(0x1c1816), false);
        E.cyl(x, 4.1, z, 1.55, 1.55, 0.12, 12, col(0xff7a1a).multiplyScalar(1.6), true);
        M.cyl(x, 4.2, z, 1.9, 1.7, 0.4, 12, col(0x2a2220), false);
        for (let k = 0; k < 4; k++) M.box(x + Math.cos(k * 1.57 + 0.7) * 2.6, 3.2, z + Math.sin(k * 1.57 + 0.7) * 2.6, 0.3, 6.4, 0.3, col(STEEL));
        lampSource(x, 4.5, z, 0xff6a20, 1.6, { big: true });
        A.quad([x - 3.5, 0.04, z + 3.5], [x + 3.5, 0.04, z + 3.5], [x + 3.5, 0.04, z - 3.5], [x - 3.5, 0.04, z - 3.5], 0, 1, 0, col(0x401a08));
      } else {
        M.cyl(x, 0, z, rr, rr, h, 8, col(0x555555), true);
      }
    }
  }

  // ---------------------------------------------------------------- the lamps
  const lampColor = st.glow;
  const lampH = Math.min(2.7, st.lo - 0.6);
  const drop = (s, off = 0.38) => [s.x + s.nx * off, s.z + s.nz * off];
  if (stop.id === 'surface') {
    // lamp poles round the yard
    for (const [x, z] of [[-14, 12], [14, 12], [-16, 30], [16, 32], [0, 22], [-30, 6], [30, 6], [-30, 26], [34, 20]]) {
      M.cyl(x, 0, z, 0.1, 0.07, 5.2, 6, col(0x2a2a2c), false);
      E.box(x, 5.25, z, 0.5, 0.18, 0.5, col(0xffb468).multiplyScalar(1.5));
      A.quad([x - 1.1, 4.2, z], [x + 1.1, 4.2, z], [x + 1.1, 6.3, z], [x - 1.1, 6.3, z], 0, 0, 1, col(0x6a4420));
      A.quad([x, 4.2, z - 1.1], [x, 4.2, z + 1.1], [x, 6.3, z + 1.1], [x, 6.3, z - 1.1], 1, 0, 0, col(0x6a4420));
      A.quad([x - 4.5, 0.03, z + 4.5], [x + 4.5, 0.03, z + 4.5], [x + 4.5, 0.03, z - 4.5], [x - 4.5, 0.03, z - 4.5], 0, 1, 0, col(0x2a1c0c));
      lampSource(x, 4.9, z, 0xffb468, 0.9, { flick: r() < 0.3 ? 1 : 0, phase: r() * 6 });
    }
    // the headframe over the shaft
    const top = 34;
    for (const sx of [-1, 1]) {
      M.beam([sx * 5.2, 0, 3.4], [sx * 1.3, top, 0.4], 0.5, col(STEEL), 4);
      M.beam([sx * 5.2, 0, -3.4], [sx * 1.3, top, -0.4], 0.5, col(STEEL), 4);
    }
    for (let y = 4; y < top - 2; y += 5.5) {
      const t = y / top;
      const w = 5.2 - 3.9 * t;
      M.beam([-w, y, 3.4 - 3 * t], [w, y, 3.4 - 3 * t], 0.22, col(STEEL), 4);
      M.beam([-w, y, -3.4 + 3 * t], [-w, y + 5.5, -3.4 + 3 * t], 0.14, col(STEEL), 4);
      M.beam([-w, y, 3.4 - 3 * t], [w * (1 - 0.3), y + 5.5, 3.4 - 3 * t - 0.5], 0.14, col(STEEL), 4);
    }
    M.beam([-0.75, 34.3, -2.6], [-0.75, 34.3, -2.2], 5, col(0x34383c), 14);
    M.beam([0.75, 34.3, -2.6], [0.75, 34.3, -2.2], 5, col(0x34383c), 14);
    E.box(0, top + 4.6, 0, 0.5, 0.5, 0.5, col(0xff2010).multiplyScalar(1.8));
    lampSource(0, 22, 4.8, 0xfff0d0, 1.4, { big: true });
    // the engine house's rope run, rails and tubs
    for (let k = -38; k < 30; k += 2) M.box(k, 0.04, 9, 1.8, 0.05, 0.9, col(0x4a3226));
    M.box(0, 0.08, 9, 70, 0.07, 0.07, col(0x5a4234));
    M.box(0, 0.08, 9.6, 70, 0.07, 0.07, col(0x5a4234));
    // water tower
    for (const [x, z] of [[32, 27], [36, 27], [32, 31], [36, 31]]) M.beam([x, 0, z], [34, 7, 29], 0.2, col(STEEL), 4);
    M.cyl(34, 7, 29, 2.6, 2.6, 3.2, 12, col(0x5a5c58), true);
    // fence posts along the foot of the cliff
    for (const s of wallSpots(stop, 2.4, 70, 3, (x, z) => z > 3)) {
      const [x, z] = drop(s, 0.15);
      M.box(x, 0.9, z, 0.12, 1.8, 0.12, col(TIMBER_D));
    }
    // piles of rock at the cliff foot
    for (const s of wallSpots(stop, 5, 24, 4, (x, z) => z > 3)) {
      const [x, z] = drop(s, 0.7);
      M.cyl(x, 0, z, 0.8 + r() * 0.9, 0.2, 0.8 + r() * 1.1, 6, col(st.wall2), true);
    }
  } else {
    // wall lamps, a few of them flickering
    const gap = stop.id === 'tunnels' ? 8 : stop.id === 'flooded' ? 7.5 : stop.id === 'magma' ? 11 : 12;
    const cap = stop.id === 'tunnels' ? 22 : 24;
    for (const s of wallSpots(stop, gap, cap, idx + 100)) {
      const [x, z] = drop(s);
      const isTube = stop.id === 'flooded';
      const dead = isTube && r() < 0.14;
      lamp(x, lampH, z, s.nx, s.nz, dead ? 0x303838 : lampColor, isTube ? 1.1 : 0.9, dead ? 0 : stop.id === 'crystal' ? 0.7 : stop.id === 'magma' ? 1.0 : 0.85);
    }
    // the landing's own two lamps: red (closed) and green (open) are animated by the scene; the cage lantern too
    lampSource(0, 2.2, 5, lampColor, 0.9);
  }

  // ---------------------------------------------------------------- stop-specific dressing
  if (stop.id === 'tunnels') {
    // timber sets along the narrow drifts
    const tm = col(TIMBER);
    const frame = (x, z, alongX, w) => {
      if (alongX) {
        M.box(x, 1.4, z - w / 2, 0.3, 2.8, 0.3, tm);
        M.box(x, 1.4, z + w / 2, 0.3, 2.8, 0.3, tm);
        M.box(x, 2.75, z, 0.34, 0.3, w + 0.5, col(TIMBER_D));
      } else {
        M.box(x - w / 2, 1.4, z, 0.3, 2.8, 0.3, tm);
        M.box(x + w / 2, 1.4, z, 0.3, 2.8, 0.3, tm);
        M.box(x, 2.75, z, w + 0.5, 0.3, 0.34, col(TIMBER_D));
      }
    };
    for (let x = -29; x < -9.5; x += 2.4) frame(x, 8, true, 4);
    for (let x = 10; x < 27; x += 2.4) frame(x, 8, true, 4);
    for (let z = 18; z < 53; z += 2.4) frame(0, z, false, 4);
    for (let z = 3; z < 16; z += 4.4) {
      M.box(-7.7, 1.5, z, 0.25, 3, 0.25, tm);
      M.box(7.7, 1.5, z, 0.25, 3, 0.25, tm);
    }
    // rails down the main drift and the galleries
    for (let z = 10; z < 52; z += 1.6) M.box(0.5, 0.03, z, 1.2, 0.05, 0.12, col(0x4a3226));
    M.box(0.2, 0.07, 31, 0.07, 0.06, 42, col(0x5a4234));
    M.box(0.8, 0.07, 31, 0.07, 0.06, 42, col(0x5a4234));
    // bell gantry over the landing
    M.box(-3.2, 2.05, 4.2, 0.3, 4.1, 0.3, tm);
    M.box(3.2, 2.05, 4.2, 0.3, 4.1, 0.3, tm);
    M.box(0, 4.0, 4.2, 7.5, 0.3, 0.3, col(TIMBER_D));
    M.cyl(-2.1, 3.3, 4.2, 0.35, 0.18, 0.5, 8, col(0x8a6a2a), true);
    // coal veins in the walls
    for (const s of wallSpots(stop, 3, 40, 7)) {
      const [x, z] = drop(s, 0.04);
      const a = Math.abs(s.nx) > 0.5;
      E.box(x, 0.6 + r() * 1.8, z, a ? 0.03 : 0.9, 0.12, a ? 0.9 : 0.03, col(0x0a0a0a));
    }
  } else if (stop.id === 'flooded') {
    // ribs of the vault, the crane rails and the pipes overhead
    for (let z = 4; z < 55; z += 4.4) {
      for (const sx of [-1, 1]) M.box(sx * 13, 2.4, z, 0.5, 4.8, 0.7, col(0x586260));
      M.beam([-13, 4.6, z], [0, 9.0, z], 0.5, col(0x586260), 4);
      M.beam([13, 4.6, z], [0, 9.0, z], 0.5, col(0x586260), 4);
    }
    for (const sx of [-1, 1]) M.beam([sx * 8.1, 7.05, 4], [sx * 8.1, 7.05, 54], 0.3, col(0xb08f1e), 4);
    M.beam([-8.1, 7.1, 22], [8.1, 7.1, 22], 0.5, col(0xb08f1e), 4);
    M.beam([0, 7.1, 22], [0, 5.2, 22], 0.1, col(0x222222), 4);
    for (const sx of [-5, 5]) M.beam([sx, 6.1, 4], [sx, 6.1, 50], 0.55, col(RUST), 10);
    // water-side planks and drums
    for (const [x, z] of [[-9, 20], [8, 33], [-8, 40], [9, 15]]) M.box(x, -0.2, z, 1.2, 0.08, 0.3, col(TIMBER_D), r() * 3);
    // red beacons and green exit signs
    for (const z of [12, 29, 45]) {
      for (const sx of [-4, 4]) {
        E.box(sx, 7.4, z, 0.3, 0.3, 0.3, col(0xff2410).multiplyScalar(1.6));
        lampSource(sx, 7.0, z, 0xff2410, 0.9, { flick: 2, phase: z });
        A.quad([sx - 0.9, 6.5, z], [sx + 0.9, 6.5, z], [sx + 0.9, 8.3, z], [sx - 0.9, 8.3, z], 0, 0, 1, col(0x5a0e06));
      }
    }
    E.box(-9, 2.7, 6, 0.5, 0.25, 0.05, col(0x30ff70));
    E.box(9, 2.7, 6, 0.5, 0.25, 0.05, col(0x30ff70));
  } else if (stop.id === 'crystal') {
    const cr = rng(31);
    const open = [];
    const g = stop.grid;
    for (let j = 0; j < STOP_NZ; j += 3) for (let i = 0; i < STOP_NX; i += 3) if (g[j * STOP_NX + i] && g[j * STOP_NX + i] !== VOID) open.push([STOP_X0 + (i + 0.5) * CELL, STOP_Z0 + (j + 0.5) * CELL]);
    const rockC = col(st.wall).lerp(col(st.wall2), 0.5);
    // stalactites and stalagmites
    for (let k = 0; k < 70; k++) {
      const [x0, z0] = open[Math.floor(cr() * open.length)];
      const x = x0 + (cr() - 0.5) * 2.4;
      const z = z0 + (cr() - 0.5) * 2.4;
      const c = rock.ceilAt(x, z);
      const len = 1.2 + cr() * 4.2;
      M.cyl(x, c - len, z, 0.04, 0.2 + cr() * 0.35, len, 5, rockC, false);
    }
    for (let k = 0; k < 28; k++) {
      const [x0, z0] = open[Math.floor(cr() * open.length)];
      const x = x0 + (cr() - 0.5) * 2;
      const z = z0 + (cr() - 0.5) * 2;
      if (z < 14 || Math.hypot((x / 14) * 1, (z - 37) / 16) < 1) continue;
      M.cyl(x, 0, z, 0.35 + cr() * 0.3, 0.05, 0.8 + cr() * 2.2, 5, rockC, false);
    }
    // crystal clusters around the lake and on the ledges, and a few hanging cyan ones
    const shore = [];
    for (let a = 0; a < 6.28; a += 0.4) shore.push([Math.cos(a) * 15.2, 37 + Math.sin(a) * 17.2]);
    shore.push([33, 34], [35, 42], [-36, 33], [-38, 34], [22, 62], [24, 70], [-6, 8], [6, 8]);
    shore.forEach(([x, z], k) => {
      if (z < 12 && Math.abs(x) < 8) return;
      const n = 3 + Math.floor(cr() * 4);
      const hue = k % 3;
      for (let q = 0; q < n; q++) {
        const c = hue === 0 ? 0x8a4cff : hue === 1 ? 0x3a8ff0 : 0xb98cff;
        E.crystal(x + (cr() - 0.5) * 1.6, 0, z + (cr() - 0.5) * 1.6, 0.18 + cr() * 0.3, 0.9 + cr() * 2.6, (cr() - 0.5) * 0.6, cr() * 6, col(c).multiplyScalar(0.7), col(c).multiplyScalar(1.4));
      }
      A.quad([x - 3, 0.04, z + 3], [x + 3, 0.04, z + 3], [x + 3, 0.04, z - 3], [x - 3, 0.04, z - 3], 0, 1, 0, col(hue === 1 ? 0x0c2a46 : 0x2a1458));
      if (k % 3 === 0) lampSource(x, 1.6, z, hue === 1 ? 0x40c8ff : 0x9a5cff, 0.8);
    });
    for (let k = 0; k < 7; k++) {
      const [x0, z0] = open[Math.floor(cr() * open.length)];
      E.crystal(x0, rock.ceilAt(x0, z0), z0, 0.3 + cr() * 0.3, -(1.2 + cr() * 1.8), 0, cr() * 6, col(0x3a8ff0).multiplyScalar(0.8), col(0x80d8ff));
    }
    // glowing moss patches
    for (let k = 0; k < 20; k++) {
      const [x0, z0] = open[Math.floor(cr() * open.length)];
      const s = 1 + cr() * 1.6;
      A.quad([x0 - s, 0.03, z0 + s], [x0 + s, 0.03, z0 + s], [x0 + s, 0.03, z0 - s], [x0 - s, 0.03, z0 - s], 0, 1, 0, col(k % 2 ? 0x0a5a44 : 0x2a1a5a));
    }
    // the old level's timber frame
    M.box(-30, 1.4, 31.2, 0.3, 2.8, 0.3, col(TIMBER));
    M.box(-30, 1.4, 34.8, 0.3, 2.8, 0.3, col(TIMBER));
    M.box(-30, 2.8, 33, 0.3, 0.3, 4.3, col(TIMBER_D));
  } else if (stop.id === 'magma') {
    const cr = rng(53);
    // basalt columns along the cavern wall and obsidian spires
    for (const s of wallSpots(stop, 4.2, 26, 61, (x, z) => z > 12)) {
      const n = 2 + Math.floor(cr() * 3);
      for (let k = 0; k < n; k++) {
        const x = s.x + s.nx * (0.8 + cr() * 1.2) + (cr() - 0.5) * 1.5;
        const z = s.z + s.nz * (0.8 + cr() * 1.2) + (cr() - 0.5) * 1.5;
        M.cyl(x, 0, z, 0.45 + cr() * 0.3, 0.4 + cr() * 0.2, 2 + cr() * 6.5, 6, col(0x1c1816).lerp(col(0x54473e), cr() * 0.5), true);
      }
    }
    // glowing fissures in the floor and the edge of the lava
    for (let k = 0; k < 40; k++) {
      const [x, z] = [(cr() - 0.5) * 90 + 2, 14 + cr() * 46];
      const gi = Math.floor((z - STOP_Z0) / CELL) * STOP_NX + Math.floor((x - STOP_X0) / CELL);
      if (gi < 0 || gi >= stop.grid.length || !stop.grid[gi] || stop.grid[gi] === VOID) continue;
      const len = 1.5 + cr() * 3.5;
      const a = cr() * 3.14;
      const dx = Math.cos(a) * len;
      const dz = Math.sin(a) * len;
      E.quad([x - dx - 0.05 * dz, 0.025, z - dz + 0.05 * dx], [x + dx - 0.05 * dz, 0.025, z + dz + 0.05 * dx], [x + dx + 0.05 * dz, 0.025, z + dz - 0.05 * dx], [x - dx + 0.05 * dz, 0.025, z - dz - 0.05 * dx], 0, 1, 0, col(0xff4a10).multiplyScalar(1.2));
    }
    // steel catwalk rails on the landing
    for (const sx of [-1, 1]) M.box(sx * 8.7, 0.5, 6, 0.08, 1, 9.4, col(STEEL));
    lampSource(13, 3, 38, 0xff5a1a, 1.8, { big: true });
    lampSource(-12, 2, 34, 0xff5a1a, 1.3, { big: true });
    lampSource(2, 3, 20, 0xff6a24, 1.1);
  }

  // ---------------------------------------------------------------- meshes
  const lit = new THREE.Mesh(M.build(), tex.lit);
  lit.castShadow = lit.receiveShadow = true; // (the flashlight's shadows)
  const glow = new THREE.Mesh(E.build(), tex.glow);
  const add = new THREE.Mesh(A.build(), tex.add);
  add.renderOrder = 5;
  for (const m of [lit, glow, add]) {
    m.frustumCulled = false;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    group.add(m);
  }
  group.userData.tris = (M.count + E.count + A.count) / 3;
  return { group, sources, ceilAt: rock.ceilAt, lamps: sources.length };
}
