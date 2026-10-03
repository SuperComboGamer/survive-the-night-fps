// Shaft Nine: the world of the Zombies mode. Five stops (surface yard, timbered tunnels, flooded level, crystal
// cavern, magma chamber) laid out side by side on the map (each is its own sealed pocket of rock; the cage elevator
// carries the team from one to the next), generated the same way on the server and every client.
//
// A stop is authored as shapes in its own frame (x east, z towards the player; the shaft is at the origin and the cage
// opens towards +z) and rasterised onto a 1 m grid: rock / walkable (the area it belongs to) / void (lava, lake: a low
// barrier). Colliders are only made for the rock within WALL_SHELL cells of the open ground (merged into few boxes), so
// the collider grid stays cheap and nothing walks out of the pocket. The client builds its meshes from the same grid.
import { makeBox, makeCyl, ColliderGrid, COL } from './collision.js';
import { MAP_HALF } from './constants.js';
import { ITEM } from './defs.js';

export const CELL = 1;
export const STOP_NX = 124;
export const STOP_NZ = 108;
export const STOP_X0 = -62; // local x of the grid's first cell edge
export const STOP_Z0 = -10;
export const WALL_SHELL = 3; // rock this thick around the open ground is solid
export const WALL_TOP = 9;
export const POOL_DEPTH = 0.4;
export const CAGE_RECT = [-1.7, -1.25, 1.7, 1.6]; // the cage's floor (local)
export const CAGE_GATE_Z = 1.7; // the gate / landing leaves stand across the opening here

export const VOID = 255;

// stop origins on the map (the sealed pockets are far enough apart that nothing sees or hears across them)
export const STOP_ORIGINS = [
  [-190, -280],
  [0, -280],
  [190, -280],
  [-95, -100],
  [95, -100],
];

// shapes: ['+', area, 'r', x0,z0,x1,z1] / ['+', area, 'e', cx,cz,rx,rz] / ['+', area, 'c', ax,az,bx,bz,halfWidth]
// '-' carves rock back in, '~' makes void (lava, lake). Applied in order.
const LANDING = [
  ['+', 0, 'r', ...CAGE_RECT],
  ['+', 0, 'r', -4, 1.5, 4, 9],
];

// Each buy: [kind, a, b, x, z] kind 'gun' (item, cost) | 'perk' (perk id, cost) | 'box' (-, cost); x, z approximate, snapped to the nearest wall.
// Each stop: areas (name), gates [{area, rect, cost, name}], obstacles, deco, pools (shallow water), liquids (render-only planes).
export const PERK = { JUGGERNOG: 1, SPEED_COLA: 2, DOUBLE_TAP: 4, QUICK_REVIVE: 8, STAMIN_UP: 16, DEADSHOT: 32 };
export const PERKS = [
  { bit: PERK.JUGGERNOG, name: 'Juggernog', cost: 2500, color: '#d8342a', tip: '+150 max health' },
  { bit: PERK.SPEED_COLA, name: 'Speed Cola', cost: 3000, color: '#3cc46a', tip: 'reload twice as fast' },
  { bit: PERK.DOUBLE_TAP, name: 'Double Tap', cost: 2000, color: '#f0b030', tip: 'fire a third faster, hit harder' },
  { bit: PERK.QUICK_REVIVE, name: 'Quick Revive', cost: 1500, color: '#46b4e8', tip: 'revive in half the time, once more on your feet alone' },
  { bit: PERK.STAMIN_UP, name: 'Stamin-Up', cost: 2000, color: '#e8873a', tip: 'sprint twice as long' },
  { bit: PERK.DEADSHOT, name: 'Deadshot', cost: 1500, color: '#b36bff', tip: 'headshots hit much harder' },
];
export const MAX_PERK_BITS = PERKS.reduce((a, p) => a | p.bit, 0);

// What the box can hand out (and what it costs to roll)
export const BOX_COST = 950;
export const BOX_POOL = [ITEM.SHOTGUN, ITEM.DB_SHOTGUN, ITEM.MP5, ITEM.AK47, ITEM.M4A1, ITEM.HUNTING_RIFLE, ITEM.CROSSBOW, ITEM.FLAMETHROWER];

export const MINE_STOPS = [
  {
    id: 'surface',
    name: 'Surface Yard',
    depth: 0,
    sky: true,
    exit: [50, 2.25], // the cage that takes the team down: a niche in a far room
    areas: ['The yard', 'Tool shed adit', 'Coal lot'],
    shapes: [
      ...LANDING,
      ['+', 0, 'r', -40, 1.5, 40, 36],
      ['+', 1, 'r', -58, 5, -41, 25],
      ['+', 1, 'r', -41, 10, -40, 16],
      ['+', 2, 'r', 41, 4, 58, 26],
      ['+', 2, 'r', 40, 10, 41, 16],
      ['+', 2, 'r', 48.3, 1.0, 51.7, 3.85],
    ],
    gates: [],
    obstacles: [
      ['box', 0, 26, 18, 7, 8, 'engine'],
      ['cyl', -5.4, 3.4, 0.4, 9, 'leg'],
      ['cyl', 5.4, 3.4, 0.4, 9, 'leg'],
      ['cyl', 25, 16, 2.4, 3, 'coal'],
      ['cyl', -30, 26, 2.2, 2.5, 'coal'],
      ['box', -20, 9, 1.6, 0.9, 0.9, 'tub'],
      ['box', -18, 9, 1.6, 0.9, 0.9, 'tub'],
      ['cyl', 18, 5, 2.4, 5.6, 'hopper'],
      ['cyl', 30, 29, 0.4, 9, 'leg'],
      ['cyl', 34, 29, 0.4, 9, 'leg'],
      ['box', 24, 28, 5, 2.2, 1.6, 'truck'],
      ['box', -28, 30, 4, 3, 2.4, 'crate'],
      ['box', 12, 20, 1.2, 1.2, 1.2, 'crate'],
    ],
    buys: [
      ['gun', ITEM.SHOTGUN, 500, -15, 2],
      ['gun', ITEM.MP5, 1000, -10, 2],
      ['gun', ITEM.DB_SHOTGUN, 1200, 10, 2],
      ['box', 0, BOX_COST, 15, 2],
      ['perk', PERK.QUICK_REVIVE, 1500, 20, 2],
      ['perk', PERK.JUGGERNOG, 2500, -20, 2],
    ],
    env: { fog: 0x1a2236, fogD: 0.0085, hemiSky: 0x39466e, hemiGround: 0x14161c, hemi: 0.55, exposure: 1.5, wall: 0x6b5d4c, floor: 0x4c453b, ceil: 30, lamp: 0xffb468 },
  },
  {
    id: 'tunnels',
    name: 'Timbered Tunnels',
    depth: 90,
    exit: [-33.5, 2], // the cage that takes the team down: a niche in a far room
    areas: ['Junction hall', 'West gallery', 'East gallery & magazine', 'Main drift'],
    shapes: [
      ...LANDING,
      ['+', 0, 'r', -8, 1.5, 8, 16],
      ['+', 1, 'r', -30, 5.9, -8, 10.1],
      ['+', 1, 'r', -37, 3.6, -30, 12.4],
      ['+', 2, 'r', 8, 5.9, 28, 10.1],
      ['+', 2, 'r', 12, 10.1, 18, 18],
      ['+', 3, 'r', -2.1, 16, 2.1, 54],
      ['+', 1, 'r', -35.2, 0.75, -31.8, 3.6],
    ],
    gates: [],
    obstacles: [
      ['box', -4.6, 5.6, 0.56, 0.56, 4.8, 'post'],
      ['box', 4.6, 5.6, 0.56, 0.56, 4.8, 'post'],
      ['box', -4.6, 11, 0.56, 0.56, 4.8, 'post'],
      ['box', 4.6, 11, 0.56, 0.56, 4.8, 'post'],
      ['box', 0.5, 23, 1.4, 0.9, 1.0, 'tub'],
      ['box', 0.5, 33, 1.4, 0.9, 1.0, 'tub'],
      ['box', -22, 6.8, 1.2, 1.2, 1.1, 'crate'],
      ['box', 20, 9, 1.2, 1.2, 1.1, 'crate'],
      ['box', 15, 15, 1.4, 1.4, 1.3, 'crate'],
      ['box', -33, 8, 1.6, 2.6, 1.0, 'crate'],
    ],
    buys: [
      ['gun', ITEM.SHOTGUN, 500, -7.5, 3.5],
      ['gun', ITEM.AK47, 1200, -7.5, 12.5],
      ['gun', ITEM.M4A1, 1500, -7.5, 14.8],
      ['box', 0, BOX_COST, 7.5, 3.5],
      ['perk', PERK.SPEED_COLA, 3000, 7.5, 12.5],
      ['gun', ITEM.HUNTING_RIFLE, 1500, 7.5, 14.8],
    ],
    env: { fog: 0x060403, fogD: 0.024, hemiSky: 0x3a2c20, hemiGround: 0x120c08, hemi: 0.42, exposure: 2.4, wall: 0x4a3a29, floor: 0x37302a, ceil: 3.4, lamp: 0xffb670 },
  },
  {
    id: 'flooded',
    name: 'Flooded Level',
    depth: 180,
    exit: [18, 18.25], // the cage that takes the team down: a niche in a far room
    areas: ['Pump hall', 'West drift', 'Electrical annex', 'Far corridor'],
    shapes: [
      ...LANDING,
      ['+', 0, 'r', -13.2, 1.5, 13.2, 55],
      ['+', 1, 'r', -40, 28.25, -13.2, 31.75],
      ['+', 2, 'r', 13.2, 20, 22.8, 32],
      ['+', 3, 'r', 6, 55, 10, 64],
      ['+', 2, 'r', 16.3, 17.0, 19.7, 19.85],
    ],
    gates: [],
    pools: [
      [-11.6, 9, -6.2, 47],
      [6.2, 9, 11.6, 47],
    ],
    liquids: [{ kind: 'water', r: [-13.2, 9, 13.2, 47], y: -0.12, color: 0x0b2a28 }],
    obstacles: [
      ['box', -3.6, 14, 2.5, 7, 2.6, 'pump'],
      ['box', 3.6, 14, 2.5, 7, 2.6, 'pump'],
      ['box', -3.6, 28, 2.5, 7, 2.6, 'pump'],
      ['box', 3.6, 28, 2.5, 7, 2.6, 'pump'],
      ['box', 0, 50.5, 12.6, 1.6, 2.2, 'header'],
      ['box', 18, 26, 3, 2.4, 2.2, 'transformer'],
      ['box', -9, 3.5, 1.2, 1.2, 1.1, 'crate'],
    ],
    buys: [
      ['gun', ITEM.MP5, 1000, -12.7, 3],
      ['gun', ITEM.M4A1, 1500, -12.7, 6],
      ['gun', ITEM.CROSSBOW, 1500, 12.7, 6],
      ['box', 0, BOX_COST, 12.7, 3],
      ['perk', PERK.DOUBLE_TAP, 2000, -8, 2],
      ['gun', ITEM.AK47, 1200, 8, 2],
    ],
    env: { fog: 0x02080a, fogD: 0.0105, hemiSky: 0x2c5a58, hemiGround: 0x081412, hemi: 0.5, exposure: 2.3, wall: 0x59605c, floor: 0x3f4643, ceil: 7.5, lamp: 0xbff6ee },
  },
  {
    id: 'crystal',
    name: 'Crystal Cavern',
    depth: 285,
    exit: [-36, 28.25], // the cage that takes the team down: a niche in a far room
    areas: ['Cavern', 'East ledge', 'Old level 285', 'Rear passage'],
    shapes: [
      ...LANDING,
      ['+', 0, 'r', -9.5, 1.5, 9.5, 11.5],
      ['+', 0, 'r', -5, 11.5, 5, 17],
      ['+', 0, 'e', 0, 38, 28, 25],
      ['~', 0, 'e', 0, 37, 13, 15],
      ['+', 0, 'c', 0, 17, 0, 32, 2.5],
      ['+', 0, 'e', 0, 37, 6.4, 6.4],
      ['+', 1, 'r', 29.5, 32, 38, 44],
      ['+', 1, 'r', 28, 36, 29.5, 40],
      ['+', 2, 'r', -42, 30, -30, 36],
      ['+', 2, 'r', -30, 31, -28, 35],
      ['+', 3, 'r', 19, 54, 25, 76],
      ['+', 2, 'r', -37.7, 27.0, -34.3, 29.85],
    ],
    gates: [],
    liquids: [{ kind: 'lake', e: [0, 37, 13, 15], y: -0.55, color: 0x05061a }],
    obstacles: [
      ['cyl', -14, 22, 1.3, 14, 'column'],
      ['cyl', 14, 22, 1.3, 14, 'column'],
      ['cyl', -19, 46, 1.5, 14, 'column'],
      ['cyl', 19, 46, 1.5, 14, 'column'],
      ['cyl', -9, 60, 1.2, 14, 'column'],
      ['cyl', 9, 60, 1.2, 14, 'column'],
      ['cyl', 0, 37, 2.0, 16, 'spire'],
      ['box', 7.2, 4, 1, 1, 1.2, 'crate'],
    ],
    buys: [
      ['gun', ITEM.HUNTING_RIFLE, 1500, -9, 3],
      ['gun', ITEM.DB_SHOTGUN, 1200, -9, 6],
      ['gun', ITEM.M4A1, 1500, -9, 9],
      ['box', 0, BOX_COST, 9, 3],
      ['perk', PERK.STAMIN_UP, 2000, 9, 6],
      ['perk', PERK.DEADSHOT, 1500, 9, 9],
    ],
    env: { fog: 0x150c34, fogD: 0.0115, hemiSky: 0x5a3fa8, hemiGround: 0x120a28, hemi: 0.62, exposure: 2.0, wall: 0x4a3f66, floor: 0x32294a, ceil: 15, lamp: 0x9a5cff },
  },
  {
    id: 'magma',
    name: 'Magma Chamber',
    depth: 400,
    exit: [-44, 28.25], // the cage that takes the team down: a niche in a far room
    areas: ['Cavern', 'East ledge', 'West drain tunnel', 'South tunnel'],
    shapes: [
      ...LANDING,
      ['+', 0, 'r', -8.8, 1.5, 8.8, 11.1],
      ['+', 0, 'r', -3, 11.1, 3, 16],
      ['+', 0, 'e', 2, 38, 34, 26],
      ['~', 0, 'e', 13, 38, 13, 14],
      ['~', 0, 'r', -22, 32, 0, 35],
      ['+', 0, 'c', -2, 38, 9, 38, 1.2],
      ['+', 0, 'c', -14, 29, -14, 38, 1.1],
      ['+', 0, 'e', 13, 38, 5.5, 5.5],
      ['+', 1, 'r', 38, 38, 50, 52],
      ['+', 1, 'r', 34, 43, 38, 47],
      ['+', 2, 'r', -52, 30, -36, 36],
      ['+', 2, 'r', -36, 30, -32, 36],
      ['+', 3, 'r', 16, 62, 22, 82],
      ['+', 3, 'r', 16, 58, 22, 62],
      ['+', 2, 'r', -45.7, 27.0, -42.3, 29.85],
    ],
    gates: [],
    liquids: [
      { kind: 'lava', e: [13, 38, 13, 14], y: -0.7, color: 0xff5a10 },
      { kind: 'lava', r: [-22, 32, 0, 35], y: -0.7, color: 0xff5a10 },
    ],
    obstacles: [
      ['cyl', 13, 38, 1.9, 4.2, 'crucible'],
      ['cyl', -26, 18, 1.4, 8, 'column'],
      ['cyl', -28, 26, 1.2, 6, 'column'],
      ['cyl', -26, 48, 1.4, 8, 'column'],
      ['cyl', 6, 58, 1.3, 7, 'column'],
      ['cyl', 24, 16, 1.2, 4, 'spire'],
      ['cyl', 28, 52, 1.0, 4, 'spire'],
    ],
    buys: [
      ['gun', ITEM.AK47, 1200, -8.5, 3.5],
      ['gun', ITEM.FLAMETHROWER, 2000, -8.5, 6.5],
      ['gun', ITEM.HUNTING_RIFLE, 1500, -8.5, 9.5],
      ['box', 0, BOX_COST, 8.5, 3.5],
      ['perk', PERK.JUGGERNOG, 2500, 8.5, 6.5],
      ['gun', ITEM.CROSSBOW, 1500, 8.5, 9.5],
    ],
    env: { fog: 0x0c0608, fogD: 0.0185, hemiSky: 0x6a2a14, hemiGround: 0x1c0a06, hemi: 0.6, exposure: 2.0, wall: 0x2a2220, floor: 0x241c1a, ceil: 17, lamp: 0xff6a24 },
  },
];

// ---------------------------------------------------------------- rasterising
function inShape(sh, cx, cz) {
  const k = sh[2];
  if (k === 'r') return cx >= sh[3] && cx < sh[5] && cz >= sh[4] && cz < sh[6];
  if (k === 'e') {
    const dx = (cx - sh[3]) / sh[5];
    const dz = (cz - sh[4]) / sh[6];
    return dx * dx + dz * dz <= 1;
  }
  const ax = sh[3];
  const az = sh[4];
  const bx = sh[5];
  const bz = sh[6];
  const vx = bx - ax;
  const vz = bz - az;
  const l2 = vx * vx + vz * vz || 1;
  const t = Math.max(0, Math.min(1, ((cx - ax) * vx + (cz - az) * vz) / l2));
  const px = ax + vx * t - cx;
  const pz = az + vz * t - cz;
  return px * px + pz * pz <= sh[7] * sh[7];
}

export const cellIndex = (lx, lz) => {
  const i = Math.floor((lx - STOP_X0) / CELL);
  const j = Math.floor((lz - STOP_Z0) / CELL);
  return i < 0 || j < 0 || i >= STOP_NX || j >= STOP_NZ ? -1 : j * STOP_NX + i;
};

// 0 rock, VOID hazard, else area + 1
export function rasterStop(def) {
  const g = new Uint8Array(STOP_NX * STOP_NZ);
  for (const sh of def.shapes) {
    const val = sh[0] === '+' ? sh[1] + 1 : sh[0] === '~' ? VOID : 0;
    for (let j = 0; j < STOP_NZ; j++) {
      const cz = STOP_Z0 + (j + 0.5) * CELL;
      for (let i = 0; i < STOP_NX; i++) {
        if (inShape(sh, STOP_X0 + (i + 0.5) * CELL, cz)) g[j * STOP_NX + i] = val;
      }
    }
  }
  return g;
}

// greedy merge of the cells flagged by pred into rectangles [i0, j0, i1, j1) (cell indices)
export function mergeCells(flag) {
  const used = new Uint8Array(flag.length);
  const out = [];
  for (let j = 0; j < STOP_NZ; j++) {
    for (let i = 0; i < STOP_NX; i++) {
      const k = j * STOP_NX + i;
      if (!flag[k] || used[k]) continue;
      let i1 = i + 1;
      while (i1 < STOP_NX && flag[j * STOP_NX + i1] && !used[j * STOP_NX + i1]) i1++;
      let j1 = j + 1;
      for (; j1 < STOP_NZ; j1++) {
        let ok = true;
        for (let x = i; x < i1 && ok; x++) ok = flag[j1 * STOP_NX + x] && !used[j1 * STOP_NX + x];
        if (!ok) break;
      }
      for (let y = j; y < j1; y++) for (let x = i; x < i1; x++) used[y * STOP_NX + x] = 1;
      out.push([i, j, i1, j1]);
    }
  }
  return out;
}

// The solid cells: rock within WALL_SHELL of anything open
function shellOf(g) {
  const flag = new Uint8Array(g.length);
  const R = WALL_SHELL;
  for (let j = 0; j < STOP_NZ; j++) {
    for (let i = 0; i < STOP_NX; i++) {
      if (g[j * STOP_NX + i] === 0) continue;
      for (let dj = -R; dj <= R; dj++) {
        const jj = j + dj;
        if (jj < 0 || jj >= STOP_NZ) continue;
        for (let di = -R; di <= R; di++) {
          const ii = i + di;
          if (ii < 0 || ii >= STOP_NX) continue;
          if (g[jj * STOP_NX + ii] === 0) flag[jj * STOP_NX + ii] = 1;
        }
      }
    }
  }
  return flag;
}

// nearest open cell that has rock beside it, from (x, z) in the stop's frame: { x, z, nx, nz } (nx, nz: unit, away from the wall)
function snapToWall(g, x, z) {
  let best = null;
  let bd = 1e9;
  const i0 = Math.floor((x - STOP_X0) / CELL);
  const j0 = Math.floor((z - STOP_Z0) / CELL);
  for (let dj = -8; dj <= 8; dj++) {
    for (let di = -8; di <= 8; di++) {
      const i = i0 + di;
      const j = j0 + dj;
      if (i < 1 || j < 1 || i >= STOP_NX - 1 || j >= STOP_NZ - 1) continue;
      const v = g[j * STOP_NX + i];
      if (!v || v === VOID) continue;
      let nx = 0;
      let nz = 0;
      if (!g[j * STOP_NX + i - 1] || g[j * STOP_NX + i - 1] === VOID) nx += 1;
      if (!g[j * STOP_NX + i + 1] || g[j * STOP_NX + i + 1] === VOID) nx -= 1;
      if (!g[(j - 1) * STOP_NX + i] || g[(j - 1) * STOP_NX + i] === VOID) nz += 1;
      if (!g[(j + 1) * STOP_NX + i] || g[(j + 1) * STOP_NX + i] === VOID) nz -= 1;
      if (!nx && !nz) continue;
      const cx = STOP_X0 + (i + 0.5) * CELL;
      const cz = STOP_Z0 + (j + 0.5) * CELL;
      const d = Math.hypot(cx - x, cz - z);
      if (d < bd) {
        bd = d;
        const l = Math.hypot(nx, nz);
        best = { x: cx, z: cz, nx: nx / l, nz: nz / l, area: v - 1 };
      }
    }
  }
  return best;
}

export function stopLocal(stop, x, z) {
  return [x - stop.ox, z - stop.oz];
}

// ---------------------------------------------------------------- the world
export function createMineWorld(seed) {
  const staticGrid = new ColliderGrid(MAP_HALF, 8);
  const structGrid = new ColliderGrid(MAP_HALF, 8);
  const stops = [];
  for (let s = 0; s < MINE_STOPS.length; s++) {
    const def = MINE_STOPS[s];
    const [ox, oz] = STOP_ORIGINS[s];
    const grid = rasterStop(def);
    const stop = { index: s, def, id: def.id, name: def.name, ox, oz, grid, areas: def.areas, gates: [], obstacles: [], buys: [], pools: def.pools || [], liquids: def.liquids || [], cageGate: null };
    // rock shell
    const shell = shellOf(grid);
    const hazard = new Uint8Array(grid.length);
    for (let k = 0; k < grid.length; k++) if (grid[k] === VOID) hazard[k] = 1;
    for (const [i0, j0, i1, j1] of mergeCells(shell)) {
      const sx = (i1 - i0) * CELL;
      const sz = (j1 - j0) * CELL;
      staticGrid.add(makeBox(ox + STOP_X0 + i0 * CELL + sx / 2, oz + STOP_Z0 + j0 * CELL + sz / 2, -3, WALL_TOP, sx, sz, 0, COL.STATIC));
    }
    for (const [i0, j0, i1, j1] of mergeCells(hazard)) {
      const sx = (i1 - i0) * CELL;
      const sz = (j1 - j0) * CELL;
      staticGrid.add(makeBox(ox + STOP_X0 + i0 * CELL + sx / 2, oz + STOP_Z0 + j0 * CELL + sz / 2, -3, 1.5, sx, sz, 0, COL.STATIC | COL.NOBULLET));
    }
    // props with bodies
    for (const o of def.obstacles) {
      const e = { kind: o[0], type: o[o.length - 1] };
      if (o[0] === 'box') {
        e.x = o[1];
        e.z = o[2];
        e.sx = o[3];
        e.sz = o[4];
        e.h = o[5];
        e.collider = staticGrid.add(makeBox(ox + e.x, oz + e.z, 0, e.h, e.sx, e.sz, 0, COL.STATIC));
      } else {
        e.x = o[1];
        e.z = o[2];
        e.r = o[3];
        e.h = o[4];
        e.collider = staticGrid.add(makeCyl(ox + e.x, oz + e.z, 0, e.h, e.r, COL.STATIC));
      }
      stop.obstacles.push(e);
    }
    // debris across the way to a locked area: gone once bought
    def.gates.forEach((gt, gi) => {
      const [x0, z0, x1, z1] = gt.rect;
      const col = makeBox(ox + (x0 + x1) / 2, oz + (z0 + z1) / 2, -1, 4.5, x1 - x0, z1 - z0, 0, COL.STATIC);
      staticGrid.add(col);
      stop.gates.push({ index: gi, area: gt.area, rect: gt.rect, cost: gt.cost, name: gt.name, collider: col, open: false });
    });
    // the cage's front: shut except while the cage is in
    stop.cageGate = makeBox(ox, oz + CAGE_GATE_Z, -1, 3.4, 3.6, 0.3, 0, COL.STATIC);
    staticGrid.add(stop.cageGate);
    stop.cageClosed = true;
    // the exit: another cage landing in a far room, opening towards +z like the first
    const [exl, ezl] = def.exit;
    stop.exit = { lx: exl, lz: ezl, x: ox + exl, z: oz + ezl, rect: [exl + CAGE_RECT[0], ezl + CAGE_RECT[1], exl + CAGE_RECT[2], ezl + CAGE_RECT[3]] };
    stop.exitGate = makeBox(ox + exl, oz + ezl + CAGE_GATE_Z, -1, 3.4, 3.6, 0.3, 0, COL.STATIC);
    staticGrid.add(stop.exitGate);
    stop.exitClosed = true;
    // wall-snapped interactables
    def.buys.forEach((b, bi) => {
      const sp = snapToWall(grid, b[3], b[4]);
      if (!sp) throw new Error(`mine: buy ${bi} of ${def.id} has no wall near it`);
      const off = 0.42;
      stop.buys.push({ index: bi, kind: b[0], a: b[1], cost: b[2], x: ox + sp.x + sp.nx * off, z: oz + sp.z + sp.nz * off, nx: sp.nx, nz: sp.nz, yaw: Math.atan2(-sp.nx, -sp.nz) + Math.PI, area: sp.area });
    });
    // where the dead may come from: a lattice over the open ground, away from the cage
    stop.spawns = [];
    for (let j = 0; j < STOP_NZ; j += 4) {
      for (let i = 0; i < STOP_NX; i += 4) {
        const v = grid[j * STOP_NX + i];
        if (!v || v === VOID) continue;
        const lx = STOP_X0 + (i + 0.5) * CELL;
        const lz = STOP_Z0 + (j + 0.5) * CELL;
        if (lz < 10 && Math.abs(lx) < 12) continue;
        if (Math.hypot(lx - exl, lz - ezl) < 9) continue; // (nor round the exit)
        let blocked = false;
        for (const o of stop.obstacles) if (Math.hypot(o.x - lx, o.z - lz) < (o.r || Math.max(o.sx, o.sz)) + 1.5) blocked = true;
        for (const gt of stop.gates) if (lx >= gt.rect[0] - 1 && lx <= gt.rect[2] + 1 && lz >= gt.rect[1] - 1 && lz <= gt.rect[3] + 1) blocked = true;
        if (!blocked) stop.spawns.push({ x: ox + lx, z: oz + lz, area: v - 1 });
      }
    }
    // (a narrow area the lattice missed gets one spot of its own)
    for (let a = 0; a < def.areas.length; a++) {
      if (stop.spawns.some((sp) => sp.area === a)) continue;
      let best = null;
      for (let k = 0; k < grid.length; k++) {
        if (grid[k] !== a + 1) continue;
        const lx = STOP_X0 + ((k % STOP_NX) + 0.5) * CELL;
        const lz = STOP_Z0 + (Math.floor(k / STOP_NX) + 0.5) * CELL;
        let d = 0;
        for (const gt of stop.gates) if (gt.area === a) d = Math.max(d, Math.hypot(lx - (gt.rect[0] + gt.rect[2]) / 2, lz - (gt.rect[1] + gt.rect[3]) / 2));
        if (!best || d > best.d) best = { d, x: ox + lx, z: oz + lz, area: a };
      }
      if (best) stop.spawns.push(best);
    }
    stops.push(stop);
  }

  const stopAt = (x, z) => {
    for (const st of stops) if (x >= st.ox + STOP_X0 && x < st.ox + STOP_X0 + STOP_NX && z >= st.oz + STOP_Z0 && z < st.oz + STOP_Z0 + STOP_NZ) return st;
    return null;
  };
  const heightAt = (x, z) => {
    const st = stopAt(x, z);
    if (!st || !st.pools.length) return 0;
    const lx = x - st.ox;
    const lz = z - st.oz;
    for (const p of st.pools) if (lx >= p[0] && lx < p[2] && lz >= p[1] && lz < p[3]) return -POOL_DEPTH;
    return 0;
  };
  // same march as the valley's: a flat floor (and its shallow pools) is all there is to hit
  const rayTerrain = (ox, oy, oz, dx, dy, dz, maxT) => {
    if (oy < heightAt(ox, oz)) return 0;
    if (dy >= 0) return -1;
    const t = (heightAt(ox, oz) - oy) / dy;
    let tt = Math.min(maxT, Math.max(0, t));
    for (let k = 0; k < 4; k++) {
      const h = heightAt(ox + dx * tt, oz + dz * tt);
      tt = Math.min(maxT, Math.max(0, (h - oy) / dy));
    }
    return tt >= maxT ? -1 : tt;
  };

  const first = stops[0];
  const spawnPoints = [{ x: first.ox, z: first.oz + 6 }];
  return {
    seed,
    mode: 1,
    mine: { stops, stopAt },
    heights: new Float32Array(0),
    roadDist: new Float32Array(0),
    roadKind: new Uint8Array(0),
    roadDir: new Float32Array(0),
    heightAt,
    roadDistAt: () => 1e4,
    roadKindAt: () => 0,
    rayTerrain,
    isDeepWater: () => false,
    zoneAt: () => 0,
    zones: [],
    zoneById: {},
    roads: [],
    highway: null,
    lake: { x: 1e5, z: 1e5, r: 1 },
    ponds: [],
    trees: new Float32Array(0),
    rocks: new Float32Array(0),
    bushes: new Float32Array(0),
    parts: [],
    props: [],
    lights: [],
    roofs: [],
    staticGrid,
    structGrid,
    colliderGrids: [staticGrid, structGrid],
    lootSpawns: [],
    containers: [],
    partSpots: [],
    openings: [],
    openingNear: () => null,
    sites: [],
    resourceSpawns: [],
    hordeSpawns: [],
    spawnPoints,
    car: { x: first.ox, y: 0, z: first.oz + 4, ry: 0 },
  };
}

// Open or shut the collider of a gate / the cage front (server and client call the same thing)
export function setGateOpen(world, stop, gi, open) {
  const gt = stop.gates[gi];
  if (!gt || gt.open === open) return;
  gt.open = open;
  if (open) world.staticGrid.remove(gt.collider);
  else world.staticGrid.add(gt.collider);
}
// which: 0 the cage at the arrival shaft, 1 the one at the exit
export function setCageClosed(world, stop, closed, which = 0) {
  const key = which ? 'exitClosed' : 'cageClosed';
  if (stop[key] === closed) return;
  stop[key] = closed;
  const col = which ? stop.exitGate : stop.cageGate;
  if (closed) world.staticGrid.add(col);
  else world.staticGrid.remove(col);
}

// is the cell at this stop-frame point open ground of an area that is unlocked? (gates are open cells of their own area)
export function openAreaAt(stop, lx, lz) {
  const k = cellIndex(lx, lz);
  if (k < 0) return -1;
  const v = stop.grid[k];
  return !v || v === VOID ? -1 : v - 1;
}
