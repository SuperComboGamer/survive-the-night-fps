// Hand-built geometry accumulator for Shaft Nine parts (no three.js dependency). Everything is emitted as {p,n,u,i} raw geometry (UV in metres) that Builder.addRaw() merges into the
// stop's static batches: triangles are cheap, draws / materials are not, so parts are built from many small faces but reuse the stop's existing materials.
//   Geo.poly      flat polygon (planar UV from the dominant axis of the face normal, so texture scale is metres everywhere)
//   Geo.box       box with optional corner jitter (hand-hewn / bent parts)
//   Geo.sweep     profile swept along a 3-D path (I-beams, angles, rails, hewn timbers, ropes with twist); flat or smooth shaded, UV = (path length, perimeter)
//   Geo.lathe     revolved profile (drums, bulbs, hubs, wheels) with optional radial jitter (dents)
//   Geo.dome      hemispherical rivet / bolt head oriented along a normal
//   Geo.rock      faceted rock (icosphere + radial jitter + planar cuts) for scree, boulders, spoil
//   Geo.hex       hexagonal basalt column
//   Geo.append    copy another Geo through a 4x4 matrix (column-major array, e.g. THREE.Matrix4.elements)
const sqrt = Math.sqrt, abs = Math.abs, hypot = Math.hypot, PI = Math.PI;

/** ear-clipping triangulation of a simple polygon given as 2-D points; keeps the polygon's own winding. Returns index triples. */
function earClip(P2) {
  const n = P2.length, idx = []; for (let k = 0; k < n; k++) idx.push(k); let area = 0; for (let k = 0; k < n; k++) { const a = P2[k], b = P2[(k + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; } const sgn = area >= 0 ? 1 : -1, out = []; let guard = 0;
  while (idx.length > 3 && guard++ < 400) {
    let cut = false;
    for (let m = 0; m < idx.length; m++) {
      const i0 = idx[(m + idx.length - 1) % idx.length], i1 = idx[m], i2 = idx[(m + 1) % idx.length], a = P2[i0], b = P2[i1], c = P2[i2]; const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); if (cr * sgn <= 1e-12) continue;
      let inside = false; for (const j of idx) { if (j === i0 || j === i1 || j === i2) continue; const p = P2[j]; const d1 = (p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0]), d2 = (p[0] - b[0]) * (c[1] - b[1]) - (p[1] - b[1]) * (c[0] - b[0]), d3 = (p[0] - c[0]) * (a[1] - c[1]) - (p[1] - c[1]) * (a[0] - c[0]); if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) { inside = true; break; } }
      if (inside) continue; out.push([i0, i1, i2]); idx.splice(m, 1); cut = true; break;
    }
    if (!cut) { for (let k = 1; k < idx.length - 1; k++) out.push([idx[0], idx[k], idx[k + 1]]); return out; }
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]); return out;
}

export class Geo {
  constructor() { this.p = []; this.n = []; this.u = []; this.i = []; this.off = [0, 0]; }
  get verts() { return this.p.length / 3; }
  get tris() { return this.i.length / 3; }
  /** random UV offset for the following faces so identical parts sample different regions of a tiling texture */
  offset(u = 0, v = 0) { this.off[0] = u; this.off[1] = v; return this; }
  v(x, y, z, nx, ny, nz, u, w) { const k = this.p.length / 3; this.p.push(x, y, z); this.n.push(nx, ny, nz); this.u.push(u + this.off[0], w + this.off[1]); return k; }

  /** flat polygon, points CCW seen from outside (fan triangulation: convex or star-shaped) */
  poly(pts, uvScale = 1) {
    const n = pts.length; if (n < 3) return this; let nx = 0, ny = 0, nz = 0;
    for (let k = 0; k < n; k++) { const a = pts[k], b = pts[(k + 1) % n]; nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]); }
    const l = sqrt(nx * nx + ny * ny + nz * nz); if (l < 1e-12) return this; nx /= l; ny /= l; nz /= l; const ax = abs(nx), ay = abs(ny), az = abs(nz), idx = [];
    for (const q of pts) { let u, w; if (ay >= ax && ay >= az) { u = q[0]; w = q[2]; } else if (ax >= az) { u = q[2]; w = q[1]; } else { u = q[0]; w = q[1]; } idx.push(this.v(q[0], q[1], q[2], nx, ny, nz, u * uvScale, w * uvScale)); }
    if (n <= 4) { for (let k = 1; k < n - 1; k++) this.i.push(idx[0], idx[k], idx[k + 1]); return this; }
    const P2 = pts.map((q) => (ay >= ax && ay >= az ? [q[0], q[2]] : ax >= az ? [q[2], q[1]] : [q[0], q[1]])); for (const t of earClip(P2)) this.i.push(idx[t[0]], idx[t[1]], idx[t[2]]); return this;
  }
  quad(a, b, c, d) { return this.poly([a, b, c, d]); }

  /** axis-aligned box centred at (cx,cy,cz); j = corner jitter (m) using rnd() in [0,1) */
  box(cx, cy, cz, sx, sy, sz, j = 0, rnd = Math.random) {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2, P = [];
    for (let k = 0; k < 8; k++) P.push([cx + (k & 1 ? hx : -hx) + (j ? (rnd() - 0.5) * j : 0), cy + (k & 2 ? hy : -hy) + (j ? (rnd() - 0.5) * j : 0), cz + (k & 4 ? hz : -hz) + (j ? (rnd() - 0.5) * j : 0)]);
    const f = (a, b, c, d) => this.poly([P[a], P[b], P[c], P[d]]);
    f(1, 3, 7, 5); f(0, 4, 6, 2); f(2, 6, 7, 3); f(0, 1, 5, 4); f(4, 5, 7, 6); f(0, 2, 3, 1); return this;
  }

  /**
   * Sweep a closed 2-D profile (CCW when looking along the path; profile x -> frame binormal, y -> frame normal) along a path.
   * o: up (frame hint, default +Y), scale(i,t)->s (t 0..1), twist(t)->rad, off(i,t)->[dx,dy], caps (true), smooth (average normals around the profile), uvw (perimeter UV scale, default 1)
   */
  sweep(profile, path, o = {}) {
    const np = profile.length, n = path.length; if (n < 2 || np < 3) return this; const up = o.up || [0, 1, 0], sc = o.scale, tw = o.twist, off = o.off, smooth = !!o.smooth;
    const T = [], N = [], Bn = [];
    for (let i = 0; i < n; i++) { const a = path[i ? i - 1 : 0], b = path[i < n - 1 ? i + 1 : n - 1]; let x = b[0] - a[0], y = b[1] - a[1], z = b[2] - a[2]; const l = hypot(x, y, z) || 1; T.push([x / l, y / l, z / l]); }
    { const t = T[0]; let x = up[0], y = up[1], z = up[2]; const d = x * t[0] + y * t[1] + z * t[2]; x -= d * t[0]; y -= d * t[1]; z -= d * t[2]; let l = hypot(x, y, z); if (l < 1e-6) { x = 1 - t[0] * t[0]; y = -t[0] * t[1]; z = -t[0] * t[2]; l = hypot(x, y, z) || 1; } N.push([x / l, y / l, z / l]); }
    for (let i = 1; i < n; i++) { const t = T[i], pn = N[i - 1], d = pn[0] * t[0] + pn[1] * t[1] + pn[2] * t[2]; const x = pn[0] - d * t[0], y = pn[1] - d * t[1], z = pn[2] - d * t[2], l = hypot(x, y, z) || 1; N.push([x / l, y / l, z / l]); }
    for (let i = 0; i < n; i++) { const t = T[i], m = N[i]; Bn.push([t[1] * m[2] - t[2] * m[1], t[2] * m[0] - t[0] * m[2], t[0] * m[1] - t[1] * m[0]]); }
    // perimeter arclength (metres) for the v coordinate
    const per = [0]; for (let k = 0; k < np; k++) { const a = profile[k], b = profile[(k + 1) % np]; per.push(per[k] + hypot(b[0] - a[0], b[1] - a[1])); }
    const ring = []; let s0 = 0; const dist = [0]; for (let i = 1; i < n; i++) dist.push(dist[i - 1] + hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1], path[i][2] - path[i - 1][2]));
    const uvw = o.uvw || 1;
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 0, s = sc ? sc(i, t) : 1, a = tw ? tw(t) : 0, ca = Math.cos(a), sa = Math.sin(a), d = off ? off(i, t) : [0, 0], pts = [];
      for (let k = 0; k < np; k++) { const px = profile[k][0] * s, py = profile[k][1] * s; const qx = px * ca - py * sa + d[0], qy = px * sa + py * ca + d[1]; pts.push([path[i][0] + qx * Bn[i][0] + qy * N[i][0], path[i][1] + qx * Bn[i][1] + qy * N[i][1], path[i][2] + qx * Bn[i][2] + qy * N[i][2]]); }
      ring.push(pts);
    }
    // 2-D outward edge normals of the profile (rotated by the frame at emission time)
    const en = []; for (let k = 0; k < np; k++) { const a = profile[k], b = profile[(k + 1) % np]; const ex = b[0] - a[0], ey = b[1] - a[1], l = hypot(ex, ey) || 1; en.push([ey / l, -ex / l]); }
    const nrm = (i, ex, ey, ca, sa) => { const qx = ex * ca - ey * sa, qy = ex * sa + ey * ca; return [qx * Bn[i][0] + qy * N[i][0], qx * Bn[i][1] + qy * N[i][1], qx * Bn[i][2] + qy * N[i][2]]; };
    for (let i = 0; i < n - 1; i++) {
      const t0 = n > 1 ? i / (n - 1) : 0, t1 = (i + 1) / (n - 1), a0 = tw ? tw(t0) : 0, a1 = tw ? tw(t1) : 0, c0 = Math.cos(a0), s0n = Math.sin(a0), c1 = Math.cos(a1), s1n = Math.sin(a1);
      for (let k = 0; k < np; k++) {
        const k2 = (k + 1) % np, A = ring[i][k], Bp = ring[i][k2], C = ring[i + 1][k2], D = ring[i + 1][k], u0 = dist[i], u1 = dist[i + 1], v0 = per[k] * uvw, v1 = per[k + 1] * uvw;
        if (smooth) {
          const na = en[(k + np - 1) % np], nb = en[k], nc = en[k2]; const mk = (i2, e1, e2, ca, sa) => { const x = e1[0] + e2[0], y = e1[1] + e2[1], l = hypot(x, y) || 1; return nrm(i2, x / l, y / l, ca, sa); };
          const nA = mk(i, na, nb, c0, s0n), nB = mk(i, nb, nc, c0, s0n), nC = mk(i + 1, nb, nc, c1, s1n), nD = mk(i + 1, na, nb, c1, s1n);
          const ia = this.v(A[0], A[1], A[2], nA[0], nA[1], nA[2], u0, v0), ib = this.v(Bp[0], Bp[1], Bp[2], nB[0], nB[1], nB[2], u0, v1), ic = this.v(C[0], C[1], C[2], nC[0], nC[1], nC[2], u1, v1), id = this.v(D[0], D[1], D[2], nD[0], nD[1], nD[2], u1, v0);
          this.i.push(ia, id, ic, ia, ic, ib);
        } else {
          const nn = nrm(i, en[k][0], en[k][1], (c0 + c1) / 2, (s0n + s1n) / 2); const l = hypot(nn[0], nn[1], nn[2]) || 1;
          const ia = this.v(A[0], A[1], A[2], nn[0] / l, nn[1] / l, nn[2] / l, u0, v0), ib = this.v(Bp[0], Bp[1], Bp[2], nn[0] / l, nn[1] / l, nn[2] / l, u0, v1), ic = this.v(C[0], C[1], C[2], nn[0] / l, nn[1] / l, nn[2] / l, u1, v1), id = this.v(D[0], D[1], D[2], nn[0] / l, nn[1] / l, nn[2] / l, u1, v0);
          this.i.push(ia, id, ic, ia, ic, ib);
        }
      }
    }
    if (o.caps !== false) { this.poly(ring[0]); this.poly(ring[n - 1].slice().reverse()); }
    return this;
  }

  /** revolve profile [[r,y],...] (bottom to top) around Y at (cx,cy,cz); jit(r,y,ang)->dr adds dents; smooth normals */
  lathe(profile, seg, cx = 0, cy = 0, cz = 0, o = {}) {
    const np = profile.length, jit = o.jit, rows = [];
    for (let k = 0; k < np; k++) { const row = []; for (let s = 0; s < seg; s++) { const a = s / seg * 2 * PI, r = profile[k][0] + (jit ? jit(profile[k][0], profile[k][1], a) : 0); row.push([cx + Math.cos(a) * r, cy + profile[k][1], cz + Math.sin(a) * r]); } rows.push(row); }
    const nr = []; for (let k = 0; k < np; k++) { const a = profile[Math.max(0, k - 1)], b = profile[Math.min(np - 1, k + 1)]; let dr = b[0] - a[0], dy = b[1] - a[1]; const l = hypot(dr, dy) || 1; nr.push([dy / l, -dr / l]); }
    const arc = [0]; for (let k = 1; k < np; k++) arc.push(arc[k - 1] + hypot(profile[k][0] - profile[k - 1][0], profile[k][1] - profile[k - 1][1]));
    const ids = []; for (let k = 0; k < np; k++) { const row = []; for (let s = 0; s <= seg; s++) { const a = (s % seg) / seg * 2 * PI, ca = Math.cos(a), sa = Math.sin(a), P = rows[k][s % seg]; row.push(this.v(P[0], P[1], P[2], nr[k][0] * ca, nr[k][1], nr[k][0] * sa, s / seg * 2 * PI * Math.max(0.02, profile[k][0]) * (o.uvr || 1), arc[k])); } ids.push(row); }
    for (let k = 0; k < np - 1; k++) for (let s = 0; s < seg; s++) { const a = ids[k][s], b = ids[k][s + 1], c = ids[k + 1][s + 1], d = ids[k + 1][s]; this.i.push(a, c, b, a, d, c); }
    return this;
  }

  /** hemispherical head (rivet / bolt / nut dome) centred on (cx,cy,cz), facing unit normal (nx,ny,nz), radius r; small heads use a 4-sided 2-ring cap (12 triangles) */
  dome(cx, cy, cz, nx, ny, nz, r, seg = 6) {
    let ax = abs(nx) < 0.9 ? 1 : 0, ay = ax ? 0 : 1, az = 0; let tx = ay * nz - az * ny, ty = az * nx - ax * nz, tz = ax * ny - ay * nx; const tl = hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx; const small = r < 0.013, rings = small ? [[1, 0], [0.6, 0.85], [0, 1]] : [[1, 0], [0.86, 0.5], [0.42, 0.9], [0, 1]], sg = small ? 4 : seg, idx = [];
    for (let k = 0; k < rings.length; k++) { const row = []; for (let s = 0; s < sg; s++) { const a = s / sg * 2 * PI + 0.4, ca = Math.cos(a), sa = Math.sin(a), rr = rings[k][0] * r, h = rings[k][1] * r * 0.72; const px = cx + (tx * ca + bx * sa) * rr + nx * h, py = cy + (ty * ca + by * sa) * rr + ny * h, pz = cz + (tz * ca + bz * sa) * rr + nz * h; const q = [(px - cx) / r, (py - cy) / r, (pz - cz) / r]; const l = hypot(q[0], q[1], q[2]) || 1; row.push(this.v(px, py, pz, q[0] / l * 0.7 + nx * 0.3, q[1] / l * 0.7 + ny * 0.3, q[2] / l * 0.7 + nz * 0.3, px * 4, pz * 4 + py * 4)); } idx.push(row); }
    for (let k = 0; k < rings.length - 1; k++) for (let s = 0; s < sg; s++) { const s2 = (s + 1) % sg; this.i.push(idx[k][s], idx[k + 1][s2], idx[k + 1][s], idx[k][s], idx[k][s2], idx[k + 1][s2]); }
    return this;
  }

  /** angular rock chunk: convex polyhedron = a cube clipped by random planes (o.cuts planes, o.low -> fewer), squash, random 3-D rotation; flat shaded. Looks like broken rock / coal, not a sphere. */
  rock(cx, cy, cz, r, rnd = Math.random, o = {}) {
    const sq = o.squash || [1, 0.7, 1], ncut = o.low ? Math.min(o.cuts ?? 3, 3) : Math.min(o.cuts ?? 5, 6), planes = [[1, 0, 0, 0.9 + rnd() * 0.3], [-1, 0, 0, 0.9 + rnd() * 0.3], [0, 1, 0, 0.8 + rnd() * 0.3], [0, -1, 0, 0.8 + rnd() * 0.3], [0, 0, 1, 0.9 + rnd() * 0.3], [0, 0, -1, 0.9 + rnd() * 0.3]];
    for (let c = 0; c < ncut; c++) { let nx = rnd() * 2 - 1, ny = rnd() * 2 - 1, nz = rnd() * 2 - 1; const l = hypot(nx, ny, nz) || 1; planes.push([nx / l, ny / l, nz / l, 0.55 + rnd() * (o.jit ?? 0.2) + 0.25]); }
    const n = planes.length, V = []; const inside = (x, y, z) => { for (const p of planes) if (p[0] * x + p[1] * y + p[2] * z > p[3] + 1e-6) return false; return true; };
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) { const A = planes[a], B = planes[b], C = planes[c]; const det = A[0] * (B[1] * C[2] - B[2] * C[1]) - A[1] * (B[0] * C[2] - B[2] * C[0]) + A[2] * (B[0] * C[1] - B[1] * C[0]); if (abs(det) < 1e-6) continue;
      const x = (A[3] * (B[1] * C[2] - B[2] * C[1]) - A[1] * (B[3] * C[2] - B[2] * C[3]) + A[2] * (B[3] * C[1] - B[1] * C[3])) / det, y = (A[0] * (B[3] * C[2] - B[2] * C[3]) - A[3] * (B[0] * C[2] - B[2] * C[0]) + A[2] * (B[0] * C[3] - B[3] * C[0])) / det, z = (A[0] * (B[1] * C[3] - B[3] * C[1]) - A[1] * (B[0] * C[3] - B[3] * C[0]) + A[3] * (B[0] * C[1] - B[1] * C[0])) / det; if (inside(x, y, z)) V.push([x, y, z]); }
    if (V.length < 4) return this; const U = []; for (const v of V) { if (!U.some((u) => abs(u[0] - v[0]) + abs(u[1] - v[1]) + abs(u[2] - v[2]) < 1e-4)) U.push(v); }
    const rot = rnd() * 6.283, cr = Math.cos(rot), sr = Math.sin(rot), tx = o.tilt === undefined ? 1.2 : o.tilt, ta = (rnd() - 0.5) * tx, tb = (rnd() - 0.5) * tx, cta = Math.cos(ta), sta = Math.sin(ta), ctb = Math.cos(tb), stb = Math.sin(tb), fl = 0.25 * sq[1];
    const T = (v) => { let x = v[0] * sq[0], y = Math.max(v[1] * sq[1], -fl), z = v[2] * sq[2]; const y1 = y * cta - z * sta, z1 = y * sta + z * cta; y = y1 * ctb - x * stb; x = y1 * stb + x * ctb; z = z1; return [cx + (x * cr - z * sr) * r * 0.62, cy + Math.max(y, -fl) * r * 0.62, cz + (x * sr + z * cr) * r * 0.62]; };
    const W = U.map(T); const hull = U;
    for (const p of planes) { const idx = []; for (let k = 0; k < U.length; k++) if (abs(p[0] * U[k][0] + p[1] * U[k][1] + p[2] * U[k][2] - p[3]) < 1e-4) idx.push(k); if (idx.length < 3) continue;
      let mx = 0, my = 0, mz = 0; for (const k of idx) { mx += U[k][0]; my += U[k][1]; mz += U[k][2]; } mx /= idx.length; my /= idx.length; mz /= idx.length; const ax = abs(p[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; let ux = ax[1] * p[2] - ax[2] * p[1], uy = ax[2] * p[0] - ax[0] * p[2], uz = ax[0] * p[1] - ax[1] * p[0]; const ul = hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul; const vx = p[1] * uz - p[2] * uy, vy = p[2] * ux - p[0] * uz, vz = p[0] * uy - p[1] * ux;
      const ang = new Map(); for (const k of idx) { const dx = U[k][0] - mx, dy = U[k][1] - my, dz = U[k][2] - mz; ang.set(k, Math.atan2(dx * vx + dy * vy + dz * vz, dx * ux + dy * uy + dz * uz)); } idx.sort((a, b) => ang.get(a) - ang.get(b));
      this.poly(idx.map((k) => W[k])); }
    return this;
  }

  /** hexagonal column from y0 to y1 centred at (cx,cz) with corner radius r; jitter j scales the corners, tilt tilts the top */
  hex(cx, cz, y0, y1, r, rnd = Math.random, j = 0.06, tilt = 0.03) {
    const top = [], bot = [], tx = (rnd() - 0.5) * tilt * 2, tz = (rnd() - 0.5) * tilt * 2, rot = rnd() * 0.2;
    for (let k = 0; k < 6; k++) { const a = rot + k / 6 * 2 * PI, rr = r * (1 + (rnd() - 0.5) * 2 * j), x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr; bot.push([x, y0, z]); top.push([x, y1 + (x - cx) * tx + (z - cz) * tz + (rnd() - 0.5) * 0.02, z]); }
    for (let k = 0; k < 6; k++) { const k2 = (k + 1) % 6; this.poly([top[k], top[k2], bot[k2], bot[k]]); }
    this.poly(top.slice().reverse()); this.poly(bot.slice()); return this;
  }

  /** append another Geo through a column-major 4x4 matrix (THREE.Matrix4.elements) */
  append(g, m) {
    const base = this.verts, e = m || [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    for (let k = 0; k < g.verts; k++) {
      const x = g.p[k * 3], y = g.p[k * 3 + 1], z = g.p[k * 3 + 2], nx = g.n[k * 3], ny = g.n[k * 3 + 1], nz = g.n[k * 3 + 2];
      this.p.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
      let tx = e[0] * nx + e[4] * ny + e[8] * nz, ty = e[1] * nx + e[5] * ny + e[9] * nz, tz = e[2] * nx + e[6] * ny + e[10] * nz; const l = hypot(tx, ty, tz) || 1; this.n.push(tx / l, ty / l, tz / l); this.u.push(g.u[k * 2], g.u[k * 2 + 1]);
    }
    for (let k = 0; k < g.i.length; k++) this.i.push(g.i[k] + base); return this;
  }
  /** raw geometry for Builder.addRaw */
  raw() { return { p: new Float32Array(this.p), n: new Float32Array(this.n), u: new Float32Array(this.u), i: new Uint32Array(this.i) }; }
}

// unit icosphere with one subdivision (42 vertices, 80 faces), built once
const ICO = (() => {
  const t = (1 + sqrt(5)) / 2; let v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((q) => { const l = hypot(q[0], q[1], q[2]); return [q[0] / l, q[1] / l, q[2] / l]; });
  const f0 = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const mid = new Map(), f = []; const m = (a, b) => { const k = a < b ? a + ',' + b : b + ',' + a; let i = mid.get(k); if (i === undefined) { const p = v[a], q = v[b], x = p[0] + q[0], y = p[1] + q[1], z = p[2] + q[2], l = hypot(x, y, z); v.push([x / l, y / l, z / l]); i = v.length - 1; mid.set(k, i); } return i; };
  for (const [a, b, c] of f0) { const ab = m(a, b), bc = m(b, c), ca = m(c, a); f.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
  return { v, f };
})();

const ICO0 = { v: ICO.v.slice(0, 12), f: [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]] };

// ---------------------------------------------------------------- common profiles (metres, CCW)
/** I / H section: overall depth h, flange width w, flange thickness tf, web thickness tw */
export const profI = (h, w, tf, tw) => { const a = h / 2, b = w / 2, c = tw / 2; return [[-b, -a], [b, -a], [b, -a + tf], [c, -a + tf], [c, a - tf], [b, a - tf], [b, a], [-b, a], [-b, a - tf], [-c, a - tf], [-c, -a + tf], [-b, -a + tf]]; };
/** equal angle: leg length s, thickness t */
export const profL = (s, t) => [[0, 0], [s, 0], [s, t], [t, t], [t, s], [0, s]];
/** channel: depth h, flange width w, thickness t */
export const profC = (h, w, t) => [[0, -h / 2], [w, -h / 2], [w, -h / 2 + t], [t, -h / 2 + t], [t, h / 2 - t], [w, h / 2 - t], [w, h / 2], [0, h / 2]];
/** flat bar */
export const profFlat = (w, t) => [[-w / 2, -t / 2], [w / 2, -t / 2], [w / 2, t / 2], [-w / 2, t / 2]];
/** chamfered rectangle (hewn timber): w x h with corner chamfer c and per-vertex jitter using rnd */
export const profTimber = (w, h, c, rnd = null, j = 0) => { const a = w / 2, b = h / 2, p = [[-a + c, -b], [a - c, -b], [a, -b + c], [a, b - c], [a - c, b], [-a + c, b], [-a, b - c], [-a, -b + c]]; if (rnd && j) for (const q of p) { q[0] += (rnd() - 0.5) * j; q[1] += (rnd() - 0.5) * j; } return p; };
/** light mine rail (about 20 lb/yd): head 32 x 15, web 8 x 36, foot 66 x 12 mm; origin at the foot centre */
export const profRail = () => [[-0.033, 0], [0.033, 0], [0.033, 0.012], [0.0055, 0.02], [0.004, 0.052], [0.016, 0.058], [0.016, 0.071], [-0.016, 0.071], [-0.016, 0.058], [-0.004, 0.052], [-0.0055, 0.02], [-0.033, 0.012]];
/** wire rope: n lobes of radius r; twisting this profile along a path gives visible strands */
export const profRope = (r, lobes = 6, seg = 4) => { const p = []; for (let k = 0; k < lobes * seg; k++) { const a = k / (lobes * seg) * 2 * PI, m = 1 + 0.12 * Math.cos(a * lobes); p.push([Math.cos(a) * r * m, Math.sin(a) * r * m]); } return p; };
/** regular polygon (round-ish section) */
export const profCircle = (r, seg = 8) => { const p = []; for (let k = 0; k < seg; k++) { const a = k / seg * 2 * PI; p.push([Math.cos(a) * r, Math.sin(a) * r]); } return p; };
