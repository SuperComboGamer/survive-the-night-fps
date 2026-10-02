// Navigation down in the mine (shared/mine.js). The valley's grid (nav.js) is one flat level and the workings lie
// under it, so they get a grid of their own: 1 m cells over the drifts, and a field of walking distances to
// whichever cell something is headed for (a survivor, a noise, a den), computed on demand and kept while it is
// asked for. The two levels meet at the portals: each has a spot just outside its mouth (out), which the valley's
// grid holds a flow field to, and one just inside (in), which every cell of the workings knows its distance to.
import { footprintContains, COL } from '../shared/collision.js';

const CLEAR = 0.55; // a cell is open when its centre is this far inside the rock face
const KEEP = 24; // fields kept (one per cell lately headed for)
const INF = 0xffff;
const NDI = [1, -1, 0, 0, 1, 1, -1, -1];
const NDJ = [0, 0, 1, -1, 1, -1, 1, -1];
const NCOST = [10, 10, 10, 10, 14, 14, 14, 14];

export class MineNav {
  constructor(world, nav) {
    this.world = world;
    this.nav = nav;
    const m = (this.mine = world.mine);
    const g = m.grid;
    this.ox = g.ox;
    this.oz = g.oz;
    this.nx = Math.ceil((g.nx - 1) * g.cell);
    this.nz = Math.ceil((g.nz - 1) * g.cell);
    const n = this.nx * this.nz;
    this.open = new Uint8Array(n);
    this.cells = []; // the open ones (randomSpot)
    const q = [];
    for (let j = 0; j < this.nz; j++) {
      for (let i = 0; i < this.nx; i++) {
        const x = this.ox + i + 0.5;
        const z = this.oz + j + 0.5;
        if (m.sdf(x, z) > -CLEAR) continue;
        const f = m.floorOf(x, z);
        if (m.outside(x, z, f + 0.5)) continue;
        // (what stands in a drift: a tub on the rails, a crate, the posts in a mouth)
        let solid = false;
        for (const c of world.staticGrid.query(x, z, 0.5, q)) solid ||= !(c.flags & COL.NOBLOCK) && c.y0 < f + 1.4 && c.y1 > f + 0.5 && footprintContains(c, x, z, 0.3);
        if (solid) continue;
        this.open[j * this.nx + i] = 1;
        this.cells.push(j * this.nx + i);
      }
    }
    this.fields = new Map(); // cell headed for -> Uint16Array of walking distances (x10)
    this._heap = new Int32Array(n * 8 + 8);
    this._key = new Int32Array(n * 8 + 8);
    // the portals: just outside the mouth, just inside it, and the distance of every cell to the spot inside
    this.portals = m.portals.map((p, k) => {
      const out = { x: p.x - p.dx * 3, z: p.z - p.dz * 3 };
      const inn = { x: p.x + p.dx * 2.5, z: p.z + p.dz * 2.5 };
      const cell = this.cellOf(inn.x, inn.z);
      return { p, key: -1 - k, out, in: inn, cell, dist: cell < 0 ? null : this._solve(cell) };
    });
  }

  under(e) {
    return this.mine.under(e.x, e.y + 0.3, e.z);
  }

  // the open cell at (x,z), or the nearest one within a couple of metres (a body against the rock, a noise in it): -1 if none
  cellOf(x, z) {
    const i = Math.floor(x - this.ox);
    const j = Math.floor(z - this.oz);
    let best = -1;
    let bd = 9;
    for (let dj = -2; dj <= 2; dj++) {
      for (let di = -2; di <= 2; di++) {
        const ci = i + di;
        const cj = j + dj;
        if (ci < 0 || cj < 0 || ci >= this.nx || cj >= this.nz || !this.open[cj * this.nx + ci]) continue;
        const d = (this.ox + ci + 0.5 - x) ** 2 + (this.oz + cj + 0.5 - z) ** 2;
        if (d < bd) {
          bd = d;
          best = cj * this.nx + ci;
        }
      }
    }
    return best;
  }

  // walking distances (x10: 10 straight, 14 diagonal, no corner cutting) from every open cell to `target`
  _solve(target) {
    const nx = this.nx;
    const open = this.open;
    const dist = new Uint16Array(open.length).fill(INF);
    const heap = this._heap;
    const key = this._key;
    let hn = 0;
    const push = (c, d) => {
      let i = hn++;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (key[p] <= d) break;
        key[i] = key[p];
        heap[i] = heap[p];
        i = p;
      }
      key[i] = d;
      heap[i] = c;
    };
    const pop = () => {
      const top = heap[0];
      const lc = heap[--hn];
      const lk = key[hn];
      let i = 0;
      for (;;) {
        let l = i * 2 + 1;
        if (l >= hn) break;
        if (l + 1 < hn && key[l + 1] < key[l]) l++;
        if (key[l] >= lk) break;
        key[i] = key[l];
        heap[i] = heap[l];
        i = l;
      }
      key[i] = lk;
      heap[i] = lc;
      return top;
    };
    dist[target] = 0;
    push(target, 0);
    while (hn > 0) {
      const d = key[0];
      const c = pop();
      if (d > dist[c]) continue;
      const ci = c % nx;
      const cj = (c - ci) / nx;
      for (let k = 0; k < 8; k++) {
        const ni = ci + NDI[k];
        const nj = cj + NDJ[k];
        if (ni < 0 || nj < 0 || ni >= nx || nj >= this.nz) continue;
        const nc = nj * nx + ni;
        if (!open[nc] || (k >= 4 && (!open[cj * nx + ni] || !open[nj * nx + ci]))) continue;
        const nd = d + NCOST[k];
        if (nd < dist[nc] && nd < INF) {
          dist[nc] = nd;
          push(nc, nd);
        }
      }
    }
    return dist;
  }

  _field(target) {
    let f = this.fields.get(target);
    if (f) return f;
    if (this.fields.size >= KEEP) this.fields.delete(this.fields.keys().next().value);
    f = this._solve(target);
    this.fields.set(target, f);
    return f;
  }

  // Unit vector (out.x, out.z) along the way from (x,z) to (tx,tz), both down in the workings. false when there is
  // no way, or they are in the same cell (a straight line will do).
  dir(x, z, tx, tz, out) {
    const a = this.cellOf(x, z);
    const b = this.cellOf(tx, tz);
    if (a < 0 || b < 0 || a === b) return false;
    const f = b === this.portals[0].cell ? this.portals[0].dist : b === this.portals[1].cell ? this.portals[1].dist : this._field(b);
    const nx = this.nx;
    const ai = a % nx;
    const aj = (a - ai) / nx;
    let best = f[a];
    let bk = -1;
    for (let k = 0; k < 8; k++) {
      const ni = ai + NDI[k];
      const nj = aj + NDJ[k];
      if (ni < 0 || nj < 0 || ni >= nx || nj >= this.nz) continue;
      const nc = nj * nx + ni;
      if (f[nc] >= best || (k >= 4 && (!this.open[aj * nx + ni] || !this.open[nj * nx + ai]))) continue;
      best = f[nc];
      bk = k;
    }
    if (bk < 0) return false;
    const dx = this.ox + ai + NDI[bk] + 0.5 - x;
    const dz = this.oz + aj + NDJ[bk] + 0.5 - z;
    const l = Math.hypot(dx, dz) || 1;
    out.x = dx / l;
    out.z = dz / l;
    return true;
  }

  // metres of drift from portal k's inside spot to (x,z); Infinity when there is no way
  fromPortal(k, x, z) {
    const c = this.cellOf(x, z);
    const d = c < 0 || !this.portals[k].dist ? INF : this.portals[k].dist[c];
    return d === INF ? Infinity : d / 10;
  }

  // metres on foot between two points down there
  dist(x, z, tx, tz) {
    const a = this.cellOf(x, z);
    const b = this.cellOf(tx, tz);
    if (a < 0 || b < 0) return Infinity;
    const d = this._field(b)[a];
    return d === INF ? Infinity : d / 10;
  }

  // The portal between a point down in the workings (ux,uz) and one on the surface (sx,sz) that makes the shortest
  // trip, and how long that is: { portal, d }. The surface leg is taken as the crow flies.
  between(ux, uz, sx, sz) {
    let best = null;
    let bd = Infinity;
    for (let k = 0; k < 2; k++) {
      const p = this.portals[k];
      const d = this.fromPortal(k, ux, uz) + Math.hypot(p.out.x - sx, p.out.z - sz) + 5.5;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return { portal: best || this.portals[0], d: bd };
  }

  // a straight walk between two points down there that stays clear of the rock and of what stands in the drift
  segClear(x0, z0, x1, z1) {
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.5);
    for (let k = 0; k <= n; k++) {
      const x = x0 + ((x1 - x0) * k) / (n || 1);
      const z = z0 + ((z1 - z0) * k) / (n || 1);
      const i = Math.floor(x - this.ox);
      const j = Math.floor(z - this.oz);
      if (i < 0 || j < 0 || i >= this.nx || j >= this.nz || !this.open[j * this.nx + i]) return false;
    }
    return true;
  }

  // somewhere to stand in the workings within r metres of (x,z) as the crow flies: { x, y, z }, or null
  randomSpot(x, z, r, rng) {
    for (let tries = 0; tries < 16; tries++) {
      const c = this.cells[Math.floor(rng() * this.cells.length)];
      const cx = this.ox + (c % this.nx) + 0.5;
      const cz = this.oz + Math.floor(c / this.nx) + 0.5;
      if (Math.hypot(cx - x, cz - z) < r) return { x: cx, y: this.mine.floorOf(cx, cz), z: cz };
    }
    return null;
  }

  // the flow fields of the valley's grid to the spot outside each mouth (kept up as structures come and go)
  refresh() {
    for (const p of this.portals) this.nav.computeField(p.key, p.out.x, p.out.z);
  }
}
