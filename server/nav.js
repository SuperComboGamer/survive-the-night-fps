// Zombie navigation: a 1 m global walkability grid (static colliders + deep water) plus a
// structure cost overlay, and per-survivor local Dijkstra flow fields. Player-built structures are
// expensive-but-passable so hordes route around bases when a gap exists, or break through walls.
import { MAP_HALF } from '../shared/constants.js';
import { COL, BOX, CYL } from '../shared/collision.js';

const SIZE = MAP_HALF * 2; // cells per side (1 m)
const FIELD = 144; // flow field window size (cells): the horde spawns ~60-85 m out, inside the window
const HALF_FIELD = FIELD / 2;
const INF = 0x7fffffff;
const STRUCT_COST = 14; // extra cost to cross a structure cell (x10 units)

export class Nav {
  constructor(world) {
    this.world = world;
    this.blocked = new Uint8Array(SIZE * SIZE);
    this.structCost = new Uint16Array(SIZE * SIZE);
    this.structRef = new Map(); // cell -> count
    this._buildStatic();
    this.fields = new Map(); // playerId -> field
    // scratch for dijkstra
    this.heap = new Int32Array(FIELD * FIELD * 20); // (cost, idx) pairs; lazy-deletion dijkstra pushes a cell up to 8x
  }

  _cellIndex(x, z) {
    const i = Math.floor(x + MAP_HALF);
    const j = Math.floor(z + MAP_HALF);
    if (i < 0 || j < 0 || i >= SIZE || j >= SIZE) return -1;
    return j * SIZE + i;
  }

  _raster(c, fn, expand) {
    const r = c.r + expand;
    const i0 = Math.max(0, Math.floor(c.x - r + MAP_HALF));
    const i1 = Math.min(SIZE - 1, Math.floor(c.x + r + MAP_HALF));
    const j0 = Math.max(0, Math.floor(c.z - r + MAP_HALF));
    const j1 = Math.min(SIZE - 1, Math.floor(c.z + r + MAP_HALF));
    for (let j = j0; j <= j1; j++) {
      const cz = j - MAP_HALF + 0.5;
      for (let i = i0; i <= i1; i++) {
        const cx = i - MAP_HALF + 0.5;
        const dx = cx - c.x;
        const dz = cz - c.z;
        let inside;
        if (c.type === CYL) {
          const rr = c.r + expand;
          inside = dx * dx + dz * dz <= rr * rr;
        } else {
          const lx = c.c * dx - c.s * dz;
          const lz = c.s * dx + c.c * dz;
          inside = Math.abs(lx) <= c.hx + expand && Math.abs(lz) <= c.hz + expand;
        }
        if (inside) fn(j * SIZE + i);
      }
    }
  }

  _buildStatic() {
    const w = this.world;
    const grid = w.staticGrid;
    const seen = new Set();
    for (const cell of grid.cells) {
      for (const c of cell) {
        if (seen.has(c)) continue;
        seen.add(c);
        if (c.flags & COL.NOBLOCK) continue;
        const gy = w.heightAt(c.x, c.z);
        // ignore elevated colliders (walkable platforms are handled: floors are thin & low)
        if (c.y0 > gy + 1.2) continue;
        if (c.y1 < gy + 0.5) continue; // low floors / decks: walkable
        // thin building walls expand less so 1.3 m doorways stay open to the dead
        const thin = c.type === BOX && Math.min(c.hx, c.hz) < 0.2;
        this._raster(c, (k) => (this.blocked[k] = 1), c.flags & COL.TREE ? 0.05 : thin ? 0.06 : 0.25);
      }
    }
    for (let j = 0; j < SIZE; j++) {
      for (let i = 0; i < SIZE; i++) {
        const x = i - MAP_HALF + 0.5;
        const z = j - MAP_HALF + 0.5;
        if (w.isDeepWater(x, z)) {
          // decks over water stay walkable
          let deck = false;
          const col = w.staticGrid.cellAt(x, z);
          if (col) for (const c of col) if (!(c.flags & COL.TREE) && c.type === BOX && c.y1 > w.heightAt(x, z) + 0.5 && c.y1 - c.y0 < 0.5) deck = deck || Math.abs(c.c * (x - c.x) - c.s * (z - c.z)) <= c.hx && Math.abs(c.s * (x - c.x) + c.c * (z - c.z)) <= c.hz;
          if (!deck) this.blocked[j * SIZE + i] = 1;
        }
      }
    }
  }

  addStructure(c) {
    if (c.flags & COL.NOBLOCK) return;
    this._raster(c, (k) => (this.structCost[k] += STRUCT_COST), 0.35);
  }
  removeStructure(c) {
    if (c.flags & COL.NOBLOCK) return;
    this._raster(c, (k) => (this.structCost[k] = Math.max(0, this.structCost[k] - STRUCT_COST)), 0.35);
  }

  isBlocked(x, z) {
    const k = this._cellIndex(x, z);
    return k < 0 || this.blocked[k] === 1;
  }

  // (re)compute a flow field centered on (x,z) for playerId
  computeField(playerId, x, z) {
    let f = this.fields.get(playerId);
    if (!f) {
      f = { dist: new Int32Array(FIELD * FIELD), ox: 0, oz: 0, cx: x, cz: z, t: 0 };
      this.fields.set(playerId, f);
    }
    const ox = Math.floor(x + MAP_HALF) - HALF_FIELD; // global cell origin
    const oz = Math.floor(z + MAP_HALF) - HALF_FIELD;
    f.ox = ox;
    f.oz = oz;
    f.cx = x;
    f.cz = z;
    const dist = f.dist;
    dist.fill(INF);
    const heap = this.heap;
    let hn = 0;
    const cap = heap.length / 2;
    const push = (cost, idx) => {
      if (hn >= cap) return; // should not happen; drop rather than overflow
      let i = hn++;
      heap[i * 2] = cost;
      heap[i * 2 + 1] = idx;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p * 2] <= cost) break;
        heap[i * 2] = heap[p * 2];
        heap[i * 2 + 1] = heap[p * 2 + 1];
        i = p;
      }
      heap[i * 2] = cost;
      heap[i * 2 + 1] = idx;
    };
    const pop = () => {
      const top = heap[1];
      const lastC = heap[(hn - 1) * 2];
      const lastI = heap[(hn - 1) * 2 + 1];
      hn--;
      let i = 0;
      while (true) {
        let l = i * 2 + 1;
        if (l >= hn) break;
        const r = l + 1;
        if (r < hn && heap[r * 2] < heap[l * 2]) l = r;
        if (heap[l * 2] >= lastC) break;
        heap[i * 2] = heap[l * 2];
        heap[i * 2 + 1] = heap[l * 2 + 1];
        i = l;
      }
      heap[i * 2] = lastC;
      heap[i * 2 + 1] = lastI;
      return top;
    };
    const si = HALF_FIELD;
    const sj = HALF_FIELD;
    dist[sj * FIELD + si] = 0;
    push(0, sj * FIELD + si);
    const blocked = this.blocked;
    const scost = this.structCost;
    while (hn > 0) {
      const c0 = heap[0];
      const idx = pop();
      if (c0 > dist[idx]) continue;
      const li = idx % FIELD;
      const lj = (idx / FIELD) | 0;
      for (let n = 0; n < 8; n++) {
        const di = NDI[n];
        const dj = NDJ[n];
        const ni = li + di;
        const nj = lj + dj;
        if (ni < 0 || nj < 0 || ni >= FIELD || nj >= FIELD) continue;
        const gi = ox + ni;
        const gj = oz + nj;
        if (gi < 0 || gj < 0 || gi >= SIZE || gj >= SIZE) continue;
        const gk = gj * SIZE + gi;
        if (blocked[gk]) continue;
        if (n >= 4) {
          // diagonal: disallow corner cutting
          if (blocked[(oz + lj) * SIZE + gi] || blocked[gj * SIZE + ox + li]) continue;
        }
        const nc = c0 + NCOST[n] + scost[gk] * 10;
        const nidx = nj * FIELD + ni;
        if (nc < dist[nidx]) {
          dist[nidx] = nc;
          push(nc, nidx);
        }
      }
    }
    return f;
  }

  removeField(playerId) {
    this.fields.delete(playerId);
  }

  // Direction (writes out.x,out.z normalized) following the field of playerId from (x,z).
  // Returns false if outside the field window or unreachable.
  flowDir(playerId, x, z, out) {
    const f = this.fields.get(playerId);
    if (!f) return false;
    const li = Math.floor(x + MAP_HALF) - f.ox;
    const lj = Math.floor(z + MAP_HALF) - f.oz;
    if (li < 1 || lj < 1 || li >= FIELD - 1 || lj >= FIELD - 1) return false;
    const d0 = f.dist[lj * FIELD + li];
    let best = d0;
    let bi = -1;
    for (let n = 0; n < 8; n++) {
      const k = (lj + NDJ[n]) * FIELD + li + NDI[n];
      const d = f.dist[k];
      if (d < best) {
        best = d;
        bi = n;
      }
    }
    if (bi < 0) {
      if (d0 === INF) return false;
      return false;
    }
    // aim at the center of the best neighbor cell
    const tx = f.ox + li + NDI[bi] - MAP_HALF + 0.5;
    const tz = f.oz + lj + NDJ[bi] - MAP_HALF + 0.5;
    const dx = tx - x;
    const dz = tz - z;
    const l = Math.hypot(dx, dz) || 1;
    out.x = dx / l;
    out.z = dz / l;
    out.cost = d0;
    return true;
  }
}

const NDI = [1, -1, 0, 0, 1, 1, -1, -1];
const NDJ = [0, 0, 1, -1, 1, -1, 1, -1];
const NCOST = [10, 10, 10, 10, 14, 14, 14, 14];
