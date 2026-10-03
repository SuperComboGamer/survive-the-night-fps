// Analytic collision world for one stop: oriented boxes (yaw), vertical cylinders, optional heightfield, ground plane, water plane.
// Used for bullets (raycast + surface type), player/zombie movement (circle push-out + ground height) and the nav grid.
// Surfaces: concrete brick rock metal wood snow ice water dirt gravel glass fabric crystal lava plastic tile grass flesh
export const SURFACES = ['concrete', 'brick', 'rock', 'metal', 'wood', 'snow', 'ice', 'water', 'dirt', 'gravel', 'glass', 'fabric', 'crystal', 'lava', 'plastic', 'tile', 'grass', 'flesh'];

export class Colliders {
  constructor() {
    this.boxes = []; this.cyls = []; this.heightFn = null; this.groundY = -1e9; this.groundSurface = 'concrete'; this.waterY = null; this.waterSurface = 'water';
    this.cell = 8; this.grid = new Map(); this.built = false; this.bounds = { minX: 1e9, maxX: -1e9, minZ: 1e9, maxZ: -1e9 };
    this.surfaceAt = null; // optional fn(x,z) -> surface name for terrain
  }
  /** Oriented box: centre (x,y,z), half extents (hx,hy,hz), yaw radians. walk: top is standable. solid: blocks movement. */
  addBox({ x, y, z, hx, hy, hz, yaw = 0, surface = 'concrete', walk = true, solid = true, tag = null, shootable = true }) {
    const c = Math.cos(yaw), s = Math.sin(-yaw); // world->local uses R(-yaw): matches THREE's rotation about Y used by Builder meshes (local +x -> (cos yaw, 0, -sin yaw))
    const ex = Math.abs(c) * hx + Math.abs(s) * hz, ez = Math.abs(s) * hx + Math.abs(c) * hz;
    const b = { type: 0, x, y, z, hx, hy, hz, yaw, c, s, surface, walk, solid, tag, shootable, y0: y - hy, y1: y + hy, minX: x - ex, maxX: x + ex, minZ: z - ez, maxZ: z + ez, id: this.boxes.length };
    this.boxes.push(b); this._grow(b); this.built = false; return b;
  }
  addCyl({ x, z, r, y0, y1, surface = 'concrete', walk = true, solid = true, tag = null, shootable = true }) {
    const b = { type: 1, x, z, r, y0, y1, surface, walk, solid, tag, shootable, minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, id: this.cyls.length + 100000 };
    this.cyls.push(b); this._grow(b); this.built = false; return b;
  }
  remove(b) { const arr = b.type === 0 ? this.boxes : this.cyls; const i = arr.indexOf(b); if (i >= 0) { arr.splice(i, 1); this.built = false; } }
  _grow(b) { const B = this.bounds; B.minX = Math.min(B.minX, b.minX); B.maxX = Math.max(B.maxX, b.maxX); B.minZ = Math.min(B.minZ, b.minZ); B.maxZ = Math.max(B.maxZ, b.maxZ); }
  build() {
    this.grid.clear(); const C = this.cell;
    const put = (b) => { for (let i = Math.floor(b.minX / C); i <= Math.floor(b.maxX / C); i++) for (let j = Math.floor(b.minZ / C); j <= Math.floor(b.maxZ / C); j++) { const k = i * 73856093 ^ j * 19349663; let a = this.grid.get(k); if (!a) this.grid.set(k, (a = [])); a.push(b); } };
    this.boxes.forEach(put); this.cyls.forEach(put); this.built = true;
  }
  _cellList(minX, maxX, minZ, maxZ, out) {
    if (!this.built) this.build();
    out.length = 0; const C = this.cell; const seen = this._seen || (this._seen = new Set()); seen.clear();
    for (let i = Math.floor(minX / C); i <= Math.floor(maxX / C); i++) for (let j = Math.floor(minZ / C); j <= Math.floor(maxZ / C); j++) { const a = this.grid.get(i * 73856093 ^ j * 19349663); if (a) for (const b of a) if (!seen.has(b)) { seen.add(b); out.push(b); } }
    return out;
  }

  // ---------- ground
  terrainHeight(x, z) { return this.heightFn ? this.heightFn(x, z) : this.groundY; }
  /** Highest standable surface at (x,z) not above yRef+step. Returns {y, surface, col} in `out`. */
  ground(x, z, yRef, step, out = { y: 0, surface: 'concrete', col: null }) {
    let y = Math.max(this.terrainHeight(x, z), this.groundY); let surf = this.surfaceAt ? this.surfaceAt(x, z) : this.groundSurface; let col = null;
    if (this.waterY !== null && this.waterY > y && y < this.waterY) { /* submerged terrain; keep terrain height (wading) */ }
    const list = this._tmp || (this._tmp = []); this._cellList(x - 0.01, x + 0.01, z - 0.01, z + 0.01, list);
    const lim = yRef + step;
    for (const b of list) {
      if (!b.walk || b.y1 > lim || b.y1 <= y) continue;
      if (b.type === 0) { const dx = x - b.x, dz = z - b.z, lx = dx * b.c + dz * b.s, lz = -dx * b.s + dz * b.c; if (Math.abs(lx) > b.hx || Math.abs(lz) > b.hz) continue; }
      else { const dx = x - b.x, dz = z - b.z; if (dx * dx + dz * dz > b.r * b.r) continue; }
      y = b.y1; surf = b.surface; col = b;
    }
    out.y = y; out.surface = surf; out.col = col; return out;
  }
  /** Push a vertical cylinder (pos.x,pos.z, radius r, occupying [y, y+h]) out of solid colliders. Returns true if pushed. */
  push(pos, r, y, h, step = 0.45) {
    const list = this._tmp2 || (this._tmp2 = []); this._cellList(pos.x - r, pos.x + r, pos.z - r, pos.z + r, list);
    let hit = false;
    for (const b of list) {
      if (!b.solid) continue;
      if (b.y1 <= y + step || b.y0 >= y + h) continue; // below step height (walkable) or above head
      if (b.type === 0) {
        const dx = pos.x - b.x, dz = pos.z - b.z; const lx = dx * b.c + dz * b.s, lz = -dx * b.s + dz * b.c;
        const cx = Math.max(-b.hx, Math.min(b.hx, lx)), cz = Math.max(-b.hz, Math.min(b.hz, lz));
        let ox = lx - cx, oz = lz - cz; const d2 = ox * ox + oz * oz;
        if (d2 >= r * r) continue;
        let px, pz;
        if (d2 > 1e-9) { const d = Math.sqrt(d2), k = (r - d) / d; px = ox * k; pz = oz * k; }
        else { // centre inside: push along min-penetration axis
          const pxp = b.hx - Math.abs(lx), pzp = b.hz - Math.abs(lz);
          if (pxp < pzp) { px = (lx < 0 ? -1 : 1) * (pxp + r); pz = 0; } else { px = 0; pz = (lz < 0 ? -1 : 1) * (pzp + r); }
        }
        pos.x += px * b.c - pz * b.s; pos.z += px * b.s + pz * b.c; hit = true;
      } else {
        const dx = pos.x - b.x, dz = pos.z - b.z, d2 = dx * dx + dz * dz, rr = r + b.r;
        if (d2 >= rr * rr) continue; const d = Math.sqrt(d2) || 1e-4, k = (rr - d) / d; pos.x += dx * k; pos.z += dz * k; hit = true;
      }
    }
    return hit;
  }
  /** true if a point/cylinder overlaps any solid collider (used for spawn checks) */
  blocked(x, z, r, y, h) { const p = { x, z }; const ox = x, oz = z; this.push(p, r, y, h, 0.45); return Math.abs(p.x - ox) + Math.abs(p.z - oz) > 1e-4; }

  // ---------- raycast (world geometry only). out: {t, nx, ny, nz, surface, col, kind}
  raycast(ox, oy, oz, dx, dy, dz, maxT, out) {
    let best = maxT, hit = null; let bnx = 0, bny = 1, bnz = 0, bs = null, bcol = null;
    const list = this._tmp3 || (this._tmp3 = []);
    // broad phase: AABB of the ray segment
    const ex = ox + dx * maxT, ez = oz + dz * maxT;
    this._cellList(Math.min(ox, ex) - 0.1, Math.max(ox, ex) + 0.1, Math.min(oz, ez) - 0.1, Math.max(oz, ez) + 0.1, list);
    for (const b of list) {
      if (!b.shootable) continue;
      if (b.type === 0) {
        const rx = ox - b.x, rz = oz - b.z; const lox = rx * b.c + rz * b.s, loz = -rx * b.s + rz * b.c, loy = oy - b.y;
        const ldx = dx * b.c + dz * b.s, ldz = -dx * b.s + dz * b.c, ldy = dy;
        let t0 = 0, t1 = best, nax = 0, nay = 0, naz = 0;
        // slabs
        const sl = (o, d, h, ax) => {
          if (Math.abs(d) < 1e-9) return (o < -h || o > h) ? false : true;
          let ta = (-h - o) / d, tb = (h - o) / d, n = -1; if (ta > tb) { const t = ta; ta = tb; tb = t; n = 1; }
          if (ta > t0) { t0 = ta; nax = ax === 0 ? n : 0; nay = ax === 1 ? n : 0; naz = ax === 2 ? n : 0; }
          if (tb < t1) t1 = tb; return t0 <= t1;
        };
        if (!sl(lox, ldx, b.hx, 0) || !sl(loy, ldy, b.hy, 1) || !sl(loz, ldz, b.hz, 2)) continue;
        if (t0 > 1e-4 && t0 < best) { best = t0; hit = b; bnx = nax * b.c - naz * b.s; bny = nay; bnz = nax * b.s + naz * b.c; bs = b.surface; bcol = b; }
      } else {
        // vertical cylinder: 2D circle + y slab
        const rx = ox - b.x, rz = oz - b.z; const a = dx * dx + dz * dz; let t0 = 0, t1 = best, n = null;
        if (a > 1e-12) { const bb = rx * dx + rz * dz, cc = rx * rx + rz * rz - b.r * b.r; const disc = bb * bb - a * cc; if (disc < 0) continue; const sq = Math.sqrt(disc); const ta = (-bb - sq) / a, tb = (-bb + sq) / a; t0 = ta; t1 = Math.min(t1, tb); if (ta > 0) { const px = rx + dx * ta, pz = rz + dz * ta; n = [px / b.r, 0, pz / b.r]; } }
        else if (rx * rx + rz * rz > b.r * b.r) continue;
        if (Math.abs(dy) > 1e-9) { let ya = (b.y0 - oy) / dy, yb = (b.y1 - oy) / dy, nn = -1; if (ya > yb) { const t = ya; ya = yb; yb = t; nn = 1; } if (ya > t0) { t0 = ya; n = [0, nn, 0]; } t1 = Math.min(t1, yb); } else if (oy < b.y0 || oy > b.y1) continue;
        if (t0 <= t1 && t0 > 1e-4 && t0 < best && n) { best = t0; hit = b; bnx = n[0]; bny = n[1]; bnz = n[2]; bs = b.surface; bcol = b; }
      }
    }
    // terrain / ground plane / water plane
    let kind = hit ? 'box' : null;
    if (this.heightFn) {
      const step = 0.6; let t = 0, prevAbove = oy - this.heightFn(ox, oz) > 0;
      if (prevAbove) { for (t = step; t <= best + step; t += step) { const tt = Math.min(t, best); const y = oy + dy * tt - this.heightFn(ox + dx * tt, oz + dz * tt); if (y <= 0) { let a = tt - step, b2 = tt; for (let i = 0; i < 7; i++) { const m = (a + b2) * 0.5; if (oy + dy * m - this.heightFn(ox + dx * m, oz + dz * m) > 0) a = m; else b2 = m; } const th = b2; if (th < best) { best = th; const px = ox + dx * th, pz = oz + dz * th, e = 0.3; const hx = this.heightFn(px - e, pz) - this.heightFn(px + e, pz), hz = this.heightFn(px, pz - e) - this.heightFn(px, pz + e); const l = Math.hypot(hx, 2 * e, hz); bnx = hx / l; bny = 2 * e / l; bnz = hz / l; bs = this.surfaceAt ? this.surfaceAt(px, pz) : this.groundSurface; hit = { type: 9 }; bcol = null; kind = 'terrain'; } break; } if (tt >= best) break; } }
    }
    if (this.groundY > -1e8 && dy < -1e-9) { const t = (this.groundY - oy) / dy; if (t > 1e-4 && t < best) { best = t; bnx = 0; bny = 1; bnz = 0; bs = this.groundSurface; hit = { type: 8 }; bcol = null; kind = 'ground'; } }
    if (this.waterY !== null && Math.abs(dy) > 1e-9) { const t = (this.waterY - oy) / dy; if (t > 1e-4 && t < best) { best = t; bnx = 0; bny = dy < 0 ? 1 : -1; bnz = 0; bs = this.waterSurface; hit = { type: 7 }; bcol = null; kind = 'water'; } }
    if (!hit) return false;
    out.t = best; out.nx = bnx; out.ny = bny; out.nz = bnz; out.surface = bs; out.col = bcol; out.kind = kind; return true;
  }
  /** line-of-sight test (true if clear) */
  clear(ax, ay, az, bx, by, bz) { const dx = bx - ax, dy = by - ay, dz = bz - az, d = Math.hypot(dx, dy, dz); if (d < 1e-4) return true; const o = this._o || (this._o = {}); return !this.raycast(ax, ay, az, dx / d, dy / d, dz / d, d, o); }
}
