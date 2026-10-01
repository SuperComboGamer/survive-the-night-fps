// Zombie navigation: a 1 m global walkability grid (static colliders + deep water) plus a
// structure cost overlay, and per-survivor local Dijkstra flow fields. Player-built structures are
// expensive-but-passable so hordes route around bases when a gap exists, or break through walls.
// Building walls are thinner than a cell, so a wall rarely covers a cell center: besides blocked cells,
// every cell-to-cell step that crosses a static collider is cut (edge mask), and near walls the first
// step from a survivor or zombie is checked against the real geometry (a cell center can sit on the
// far side of the wall from whoever is standing in that cell).
import { MAP_HALF } from '../shared/constants.js';
import { COL, BOX, CYL } from '../shared/collision.js';

const SIZE = MAP_HALF * 2; // cells per side (1 m)
const FIELD = 144; // flow field window size (cells): the horde spawns ~60-85 m out, inside the window
const HALF_FIELD = FIELD / 2;
const PW = FIELD + 2; // padded window: a 1-cell blocked border replaces per-neighbor bounds checks
const INF = 0x7fffffff;
const STRUCT_COST = 14; // extra cost to cross a structure cell (x10 units)
const EDGE_PAD = 0.03; // clearance a step keeps from a wall (small, so 1.1 m back doors stay open)
const NEAR_WALL = 1.5; // cells within this of a wall check first steps against the real geometry

export class Nav {
  constructor(world) {
    this.world = world;
    this.blocked = new Uint8Array(SIZE * SIZE);
    this.edge = new Uint8Array(SIZE * SIZE); // bit n: the step toward neighbor n crosses a static collider
    this.nearWall = new Uint8Array(SIZE * SIZE);
    this.solid = new Set(); // static colliders the grid treats as walls (for exact segment checks)
    this.structCost = new Uint16Array(SIZE * SIZE);
    this.structRef = new Map(); // cell -> count
    this._q = [];
    this._buildStatic();
    this.fields = new Map(); // playerId -> field
    this.structVer = 0; // bumped whenever structure costs change (fields computed before are stale)
    this.maxStructCost = 0; // highest structure cost any cell has had (bounds the edge cost)
    // scratch for the solver (padded window): walkability, step mask, entry cost, distance, bucket queue
    this.pBlocked = new Uint8Array(PW * PW);
    this.pEdge = new Uint8Array(PW * PW);
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
        if (c.flags & COL.TREE) continue;
        this.solid.add(c);
        this._cutEdges(c);
        this._raster(c, (k) => (this.nearWall[k] = 1), NEAR_WALL);
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

  // cut every cell-to-cell step (center to center) that passes through collider c
  _cutEdges(c) {
    const r = c.r + 1.5;
    const i0 = Math.max(0, Math.floor(c.x - r + MAP_HALF));
    const i1 = Math.min(SIZE - 1, Math.floor(c.x + r + MAP_HALF));
    const j0 = Math.max(0, Math.floor(c.z - r + MAP_HALF));
    const j1 = Math.min(SIZE - 1, Math.floor(c.z + r + MAP_HALF));
    for (let j = j0; j <= j1; j++) {
      const az = j - MAP_HALF + 0.5;
      for (let i = i0; i <= i1; i++) {
        const ax = i - MAP_HALF + 0.5;
        for (const n of HALF_DIRS) {
          const ni = i + NDI[n];
          const nj = j + NDJ[n];
          if (ni < 0 || nj < 0 || ni >= SIZE || nj >= SIZE) continue;
          if (!segHits(c, ax, az, ax + NDI[n], az + NDJ[n], EDGE_PAD)) continue;
          this.edge[j * SIZE + i] |= 1 << n;
          this.edge[nj * SIZE + ni] |= 1 << OPP[n];
        }
      }
    }
  }

  // straight 2D line (x0,z0)->(x1,z1) misses every static wall the grid knows about (player structures,
  // trees and terrain are not considered)
  segClear(x0, z0, x1, z1) {
    const q = this.world.staticGrid.query((x0 + x1) / 2, (z0 + z1) / 2, Math.hypot(x1 - x0, z1 - z0) / 2 + 0.1, this._q);
    return this._clearAmong(q, x0, z0, x1, z1);
  }
  _clearAmong(list, x0, z0, x1, z1) {
    for (let i = 0; i < list.length; i++) if (this.solid.has(list[i]) && segHits(list[i], x0, z0, x1, z1, EDGE_PAD)) return false;
    return true;
  }

  // which cells a flow field starts from for a survivor at (x,z): bit 0 their own cell, bit n+1 neighbor n.
  // Away from walls just the own cell; beside one, every nearby cell center the survivor can actually walk to.
  _sources(x, z) {
    const i = Math.floor(x + MAP_HALF);
    const j = Math.floor(z + MAP_HALF);
    if (i < 1 || j < 1 || i >= SIZE - 1 || j >= SIZE - 1 || !this.nearWall[j * SIZE + i]) return 1;
    const q = this.world.staticGrid.query(x, z, 2, this._q);
    const cx = i - MAP_HALF + 0.5;
    const cz = j - MAP_HALF + 0.5;
    let m = this._clearAmong(q, x, z, cx, cz) ? 1 : 0;
    for (let n = 0; n < 8; n++) {
      if (this.blocked[(j + NDJ[n]) * SIZE + i + NDI[n]]) continue;
      if (this._clearAmong(q, x, z, cx + NDI[n], cz + NDJ[n])) m |= 2 << n;
    }
    return m || 1;
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
      f = { dist: new Int32Array(FIELD * FIELD), ox: 0, oz: 0, cx: x, cz: z, t: 0, ver: -1, src: 0 };
      this.fields.set(playerId, f);
    }
    const ox = Math.floor(x + MAP_HALF) - HALF_FIELD; // global cell origin
    const oz = Math.floor(z + MAP_HALF) - HALF_FIELD;
    const src = this._sources(x, z);
    f.cx = x;
    f.cz = z;
    // a field only depends on the survivor's cell (and which neighbors they can step to) and the
    // walkability / structure grids: when none changed since it was computed it is still exact
    if (f.ver === this.structVer && f.ox === ox && f.oz === oz && f.src === src) return f;
    f.ox = ox;
    f.oz = oz;
    f.ver = this.structVer;
    f.src = src;
    this._solve(f.dist, ox, oz, src);
    return f;
  }

  // Dijkstra from the window center over 8-connected cells (10 straight, 14 diagonal, plus the entered
  // cell's structure cost; no corner cutting, no step through a wall). Edge costs are small integers, so
  // the priority queue is a circular bucket queue (Dial's algorithm): O(1) push/pop, same distances as a heap.
  _solve(out, ox, oz, srcMask) {
    const blocked = this.blocked;
    const edge = this.edge;
    const scost = this.structCost;
    const pb = this.pBlocked;
    const pe = this.pEdge;
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
          pe[p] = edge[gk];
          pc[p] = scost[gk] * 10;
        } else {
          pb[p] = 1;
          pe[p] = 0;
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
    const center = (HALF_FIELD + 1) * PW + HALF_FIELD + 1;
    let en = 0;
    let pending = 0;
    // seed: the survivor's own cell at 0 and any extra source neighbors at their step cost
    for (let n = -1; n < 8; n++) {
      if (!(srcMask & (1 << (n + 1)))) continue;
      const q = n < 0 ? center : center + NOFF[n];
      const c = n < 0 ? 0 : NCOST[n];
      if (pb[q] && n >= 0) continue;
      dist[q] = c;
      eIdx[en] = q;
      eNext[en] = head[c];
      head[c] = en++;
      pending++;
    }
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
        const cut = pe[p];
        for (let n = 0; n < 8; n++) {
          const q = p + NOFF[n];
          if (pb[q] || cut & (1 << n)) continue;
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
  // Returns false if outside the field window, unreachable, or already in the survivor's cell.
  flowDir(playerId, x, z, out) {
    const f = this.fields.get(playerId);
    if (!f) return false;
    const gi = Math.floor(x + MAP_HALF);
    const gj = Math.floor(z + MAP_HALF);
    const li = gi - f.ox;
    const lj = gj - f.oz;
    if (li < 1 || lj < 1 || li >= FIELD - 1 || lj >= FIELD - 1) return false;
    const gk = gj * SIZE + gi;
    // beside a wall the cell center may be on the other side of it: test the actual steps from (x,z)
    const q = this.nearWall[gk] ? this.world.staticGrid.query(x, z, 2, this._q) : null;
    const cx = gi - MAP_HALF + 0.5;
    const cz = gj - MAP_HALF + 0.5;
    const d0 = f.dist[lj * FIELD + li];
    let best = INF;
    let bi = -2;
    if (d0 < INF && (!q || this._clearAmong(q, x, z, cx, cz))) {
      best = d0;
      bi = -1;
    }
    for (let n = 0; n < 8; n++) {
      const d = f.dist[(lj + NDJ[n]) * FIELD + li + NDI[n]];
      if (d >= best) continue;
      if (q) {
        if (!this._clearAmong(q, x, z, cx + NDI[n], cz + NDJ[n])) continue;
      } else if (this.edge[gk] & (1 << n) || (n >= 4 && (this.blocked[gk + NDI[n]] || this.blocked[gk + NDJ[n] * SIZE]))) continue;
      best = d;
      bi = n;
    }
    // -1: the own cell is already the lowest (at the survivor); -2: nothing reachable from here
    if (bi < 0) return false;
    // aim at the center of the best neighbor cell
    const tx = cx + NDI[bi];
    const tz = cz + NDJ[bi];
    const dx = tx - x;
    const dz = tz - z;
    const l = Math.hypot(dx, dz) || 1;
    out.x = dx / l;
    out.z = dz / l;
    out.cost = d0;
    return true;
  }
}

// does segment (x0,z0)->(x1,z1) pass through collider c's footprint expanded by e
function segHits(c, x0, z0, x1, z1, e) {
  let dx = x0 - c.x;
  let dz = z0 - c.z;
  if (c.type === CYL) {
    const ux = x1 - x0;
    const uz = z1 - z0;
    const ll = ux * ux + uz * uz;
    const t = ll > 0 ? Math.max(0, Math.min(1, -(dx * ux + dz * uz) / ll)) : 0;
    const px = dx + ux * t;
    const pz = dz + uz * t;
    const rr = c.r + e;
    return px * px + pz * pz <= rr * rr;
  }
  // box: clip the segment against the slabs of the local frame
  const ax = c.c * dx - c.s * dz;
  const az = c.s * dx + c.c * dz;
  dx = x1 - c.x;
  dz = z1 - c.z;
  const ux = c.c * dx - c.s * dz - ax;
  const uz = c.s * dx + c.c * dz - az;
  let t0 = 0;
  let t1 = 1;
  const hx = c.hx + e;
  const hz = c.hz + e;
  if (Math.abs(ux) < 1e-9) {
    if (Math.abs(ax) > hx) return false;
  } else {
    let ta = (-hx - ax) / ux;
    let tb = (hx - ax) / ux;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  if (Math.abs(uz) < 1e-9) return Math.abs(az) <= hz;
  let ta = (-hz - az) / uz;
  let tb = (hz - az) / uz;
  if (ta > tb) [ta, tb] = [tb, ta];
  return Math.max(t0, ta) <= Math.min(t1, tb);
}

const NDI = [1, -1, 0, 0, 1, 1, -1, -1];
const NDJ = [0, 0, 1, -1, 1, -1, 1, -1];
const NCOST = [10, 10, 10, 10, 14, 14, 14, 14];
const OPP = [1, 0, 3, 2, 7, 6, 5, 4]; // index of the reverse step
const HALF_DIRS = [0, 2, 4, 5]; // one of each step pair (+x, +z, +x+z, +x-z)
const NOFF = NDI.map((di, n) => NDJ[n] * PW + di); // neighbor offsets in the padded window
