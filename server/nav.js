// Zombie navigation: a 1 m global walkability grid (static colliders + deep water) plus a
// structure cost overlay, and per-survivor local Dijkstra flow fields. Player-built structures are
// expensive-but-passable so hordes route around bases when a gap exists, or break through walls.
import { MAP_HALF } from '../shared/constants.js';
import { COL, BOX, CYL } from '../shared/collision.js';

const SIZE = MAP_HALF * 2; // cells per side (1 m)
const FIELD = 144; // flow field window size (cells): the horde spawns ~60-85 m out, inside the window
const HALF_FIELD = FIELD / 2;
const PW = FIELD + 2; // padded window: a 1-cell blocked border replaces per-neighbor bounds checks
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
    this.structVer = 0; // bumped whenever structure costs change (fields computed before are stale)
    this.maxStructCost = 0; // highest structure cost any cell has had (bounds the edge cost)
    // scratch for the solver (padded window): walkability, entry cost, distance, bucket queue
    this.pBlocked = new Uint8Array(PW * PW);
    this.pCost = new Int32Array(PW * PW);
    this.pDist = new Int32Array(PW * PW);
    this.bucketHead = new Int32Array(0);
    this.entryIdx = new Int32Array(FIELD * FIELD * 8 + 1); // a cell is queued once per improvement: <= 8 per cell
    this.entryNext = new Int32Array(FIELD * FIELD * 8 + 1);
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
    this._raster(c, (k) => {
      const v = (this.structCost[k] += STRUCT_COST);
      if (v > this.maxStructCost) this.maxStructCost = v;
    }, 0.35);
    this.structVer++;
  }
  removeStructure(c) {
    if (c.flags & COL.NOBLOCK) return;
    this._raster(c, (k) => (this.structCost[k] = Math.max(0, this.structCost[k] - STRUCT_COST)), 0.35);
    this.structVer++;
  }

  isBlocked(x, z) {
    const k = this._cellIndex(x, z);
    return k < 0 || this.blocked[k] === 1;
  }

  // (re)compute a flow field centered on (x,z) for playerId
  computeField(playerId, x, z) {
    let f = this.fields.get(playerId);
    if (!f) {
      f = { dist: new Int32Array(FIELD * FIELD), ox: 0, oz: 0, cx: x, cz: z, t: 0, ver: -1 };
      this.fields.set(playerId, f);
    }
    const ox = Math.floor(x + MAP_HALF) - HALF_FIELD; // global cell origin
    const oz = Math.floor(z + MAP_HALF) - HALF_FIELD;
    f.cx = x;
    f.cz = z;
    // a field only depends on the survivor's cell and the walkability / structure grids: when neither
    // changed since it was computed (standing still, holding a position) it is still exact
    if (f.ver === this.structVer && f.ox === ox && f.oz === oz) return f;
    f.ox = ox;
    f.oz = oz;
    f.ver = this.structVer;
    this._solve(f.dist, ox, oz);
    return f;
  }

  // Dijkstra from the window center over 8-connected cells (10 straight, 14 diagonal, plus the entered
  // cell's structure cost; no corner cutting). Edge costs are small integers, so the priority queue is a
  // circular bucket queue (Dial's algorithm): O(1) push/pop, same distances as a heap.
  _solve(out, ox, oz) {
    const blocked = this.blocked;
    const scost = this.structCost;
    const pb = this.pBlocked;
    const pc = this.pCost;
    const dist = this.pDist;
    // padded window: border cells and cells outside the map are blocked
    for (let pj = 0; pj < PW; pj++) {
      const gj = oz + pj - 1;
      const rowIn = pj > 0 && pj < PW - 1 && gj >= 0 && gj < SIZE;
      for (let pi = 0; pi < PW; pi++) {
        const p = pj * PW + pi;
        const gi = ox + pi - 1;
        if (rowIn && pi > 0 && pi < PW - 1 && gi >= 0 && gi < SIZE) {
          const gk = gj * SIZE + gi;
          pb[p] = blocked[gk];
          pc[p] = scost[gk] * 10;
        } else {
          pb[p] = 1;
          pc[p] = 0;
        }
      }
    }
    dist.fill(INF);
    let nb = 16;
    while (nb <= 14 + this.maxStructCost * 10) nb *= 2; // every pending cost fits in [cur, cur + nb)
    if (this.bucketHead.length < nb) this.bucketHead = new Int32Array(nb);
    const head = this.bucketHead;
    head.fill(-1, 0, nb);
    const mask = nb - 1;
    const eIdx = this.entryIdx;
    const eNext = this.entryNext;
    const src = (HALF_FIELD + 1) * PW + HALF_FIELD + 1;
    dist[src] = 0;
    eIdx[0] = src;
    eNext[0] = -1;
    head[0] = 0;
    let en = 1;
    let pending = 1;
    for (let cur = 0; pending > 0; cur++) {
      const b = cur & mask;
      let e = head[b];
      if (e < 0) continue;
      head[b] = -1; // anything pushed while draining costs at least cur + 10: other buckets
      while (e >= 0) {
        const p = eIdx[e];
        e = eNext[e];
        pending--;
        if (dist[p] !== cur) continue; // superseded by a cheaper entry
        for (let n = 0; n < 8; n++) {
          const q = p + NOFF[n];
          if (pb[q]) continue;
          // diagonal: disallow corner cutting
          if (n >= 4 && (pb[p + NDI[n]] || pb[p + NDJ[n] * PW])) continue;
          const nc = cur + NCOST[n] + pc[q];
          if (nc < dist[q]) {
            dist[q] = nc;
            const nbk = nc & mask;
            eIdx[en] = q;
            eNext[en] = head[nbk];
            head[nbk] = en++;
            pending++;
          }
        }
      }
    }
    for (let lj = 0; lj < FIELD; lj++) out.set(dist.subarray((lj + 1) * PW + 1, (lj + 1) * PW + 1 + FIELD), lj * FIELD);
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
const NOFF = NDI.map((di, n) => NDJ[n] * PW + di); // neighbor offsets in the padded window
