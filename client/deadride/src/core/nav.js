// Navigation grid + flow field for one stop (local coordinates). Zombies descend the distance field toward the player.
export class NavGrid {
  /** colliders: Colliders; bounds {minX,maxX,minZ,maxZ}; cell size (m); radius = actor radius. opts.blockedFn(x,z)->true to forbid (water, void) */
  constructor(colliders, bounds, cell = 0.6, radius = 0.38, opts = {}) {
    this.c = colliders; this.cell = cell; this.minX = bounds.minX; this.minZ = bounds.minZ;
    this.w = Math.ceil((bounds.maxX - bounds.minX) / cell); this.h = Math.ceil((bounds.maxZ - bounds.minZ) / cell);
    this.blocked = new Uint8Array(this.w * this.h); this.dist = new Float32Array(this.w * this.h).fill(1e9); this.queue = new Int32Array(this.w * this.h * 4);
    const p = { x: 0, z: 0 }, g = { y: 0 };
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) {
      const x = this.minX + (i + 0.5) * cell, z = this.minZ + (j + 0.5) * cell; p.x = x; p.z = z;
      colliders.ground(x, z, 1e6, 0.0, g); const gy = g.y;
      let b = 0; if (opts.blockedFn && opts.blockedFn(x, z, gy)) b = 1;
      else if (colliders.blocked(x, z, radius, gy, 1.7)) b = 1;
      else { // slope test
        const gx = colliders.terrainHeight(x + 0.5, z) - colliders.terrainHeight(x - 0.5, z), gz = colliders.terrainHeight(x, z + 0.5) - colliders.terrainHeight(x, z - 0.5);
        if (Math.hypot(gx, gz) > 1.25) b = 1;
      }
      this.blocked[j * this.w + i] = b;
    }
    this.tx = -1; this.tz = -1; this.age = 1e9;
  }
  idx(x, z) { const i = Math.floor((x - this.minX) / this.cell), j = Math.floor((z - this.minZ) / this.cell); if (i < 0 || j < 0 || i >= this.w || j >= this.h) return -1; return j * this.w + i; }
  isFree(x, z) { const k = this.idx(x, z); return k >= 0 && !this.blocked[k]; }
  /** nearest free cell centre to (x,z) */
  snap(x, z, out) {
    let k = this.idx(x, z); if (k >= 0 && !this.blocked[k]) { out.x = x; out.z = z; return true; }
    for (let r = 1; r < 12; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue; const xx = x + di * this.cell, zz = z + dj * this.cell; k = this.idx(xx, zz); if (k >= 0 && !this.blocked[k]) { out.x = xx; out.z = zz; return true; } }
    return false;
  }
  /** Dijkstra-ish BFS (8-neighbour) from the target. */
  compute(tx, tz) {
    const W = this.w, H = this.h, d = this.dist, q = this.queue, bl = this.blocked; d.fill(1e9);
    const s = this._s || (this._s = { x: 0, z: 0 }); if (!this.snap(tx, tz, s)) return; const start = this.idx(s.x, s.z); if (start < 0) return;
    let qh = 0, qt = 0; q[qt++] = start; d[start] = 0;
    // two-queue trick for weights 1 and 1.414 => use simple relaxation with re-queue (small grids)
    const N = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [-1, 1, 1.414], [1, -1, 1.414], [-1, -1, 1.414]];
    let guard = 0; const cap = q.length;
    while (qh !== qt && guard++ < W * H * 6) {
      const k = q[qh]; qh = (qh + 1) % cap; const i = k % W, j = (k / W) | 0, dk = d[k];
      for (let n = 0; n < 8; n++) {
        const ni = i + N[n][0], nj = j + N[n][1]; if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue; const nk = nj * W + ni; if (bl[nk]) continue;
        if (n >= 4 && (bl[j * W + ni] || bl[nj * W + i])) continue; // no corner cutting
        const nd = dk + N[n][2]; if (nd < d[nk]) { d[nk] = nd; q[qt] = nk; qt = (qt + 1) % cap; }
      }
    }
    this.tx = tx; this.tz = tz;
  }
  /** the same field from several targets at once (co-op: every player): each cell's distance is to the nearest of them */
  computeMany(points) {
    const W = this.w, H = this.h, d = this.dist, q = this.queue, bl = this.blocked; d.fill(1e9);
    const s = this._s || (this._s = { x: 0, z: 0 }); let qh = 0, qt = 0; const cap = q.length;
    for (const p of points) { if (!this.snap(p.x, p.z, s)) continue; const k = this.idx(s.x, s.z); if (k < 0 || d[k] === 0) continue; d[k] = 0; q[qt] = k; qt = (qt + 1) % cap; }
    if (qt === 0) return;
    const N = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [-1, 1, 1.414], [1, -1, 1.414], [-1, -1, 1.414]];
    let guard = 0;
    while (qh !== qt && guard++ < W * H * 6) {
      const k = q[qh]; qh = (qh + 1) % cap; const i = k % W, j = (k / W) | 0, dk = d[k];
      for (let n = 0; n < 8; n++) {
        const ni = i + N[n][0], nj = j + N[n][1]; if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue; const nk = nj * W + ni; if (bl[nk]) continue;
        if (n >= 4 && (bl[j * W + ni] || bl[nj * W + i])) continue;
        const nd = dk + N[n][2]; if (nd < d[nk]) { d[nk] = nd; q[qt] = nk; qt = (qt + 1) % cap; }
      }
    }
  }
  /** Flow direction at (x,z): unit vector toward the target following the field; returns distance-to-target (cells*size) or -1 if unreachable */
  flow(x, z, out) {
    const k = this.idx(x, z), W = this.w; if (k < 0) { out.x = out.z = 0; return -1; }
    const i = k % W, j = (k / W) | 0; let best = this.dist[k], bx = 0, bz = 0; if (best >= 1e8) { // inside a blocked cell: head to nearest free neighbour
      best = 1e9; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= W || nj >= this.h) continue; const dv = this.dist[nj * W + ni]; if (dv < best) { best = dv; bx = di; bz = dj; } }
      if (best >= 1e8) { out.x = out.z = 0; return -1; } const l = Math.hypot(bx, bz) || 1; out.x = bx / l; out.z = bz / l; return best * this.cell;
    }
    // weighted gradient over the 8 neighbours (smooth)
    let gx = 0, gz = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { if (!di && !dj) continue; const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= W || nj >= this.h) continue; const dv = this.dist[nj * W + ni]; if (dv >= 1e8) continue; const dd = this.dist[k] - dv; if (dd > 0) { const l = Math.hypot(di, dj); gx += di / l * dd; gz += dj / l * dd; } }
    const l = Math.hypot(gx, gz); if (l < 1e-6) { out.x = out.z = 0; } else { out.x = gx / l; out.z = gz / l; }
    return this.dist[k] * this.cell;
  }
}
