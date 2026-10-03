// Angular, flat-shaded rock: basalt crags, blade-like gendarmes and fused outcrops. Each is a stack of strongly jittered elliptical rings (a "blade" in plan, with
// ledges where the radius steps out again) closed by a ragged crown with several apexes, built as raw flat-normal triangles so the silhouette is faceted like
// fractured columnar rock instead of a smooth cone. Textured by the world-space triplanar rock material (which also lays snow on the ledges).
import * as THREE from 'three';
import { makeRng } from '../../core/util.js';

/** o: {h, r, sides, rings, lean [dx,dz per metre], twist, seed, tips, crown, squash (blade thinness 0.4..1), taper, jitter, ledges, sink, col} ; (x,y,z) = base centre */
export function angularSpire(B, mat, x, y, z, o = {}) {
  const { h = 8, r = 2, sides = 12, rings = 9, lean = [0.05, 0.03], twist = 0.35, seed = 1, tips = 3, crown = 0.22, squash = 0.6, taper = 0.55, jitter = 0.5, ledges = 0.16, sink = 0.8, col = 'rock' } = o;
  const rng = makeRng(seed * 131 + 17); const yaw = rng() * 6.283, cy = Math.cos(yaw), sy = Math.sin(yaw); const R = [];
  const at = (u, v, cx, cz) => [cx + u * cy - v * sy, cz + u * sy + v * cy];                 // rotate a plan offset by the blade's yaw
  for (let k = 0; k <= rings; k++) {
    const t = k / rings, base = 1 - taper * Math.pow(t, 1.25), ledge = (k % 2 === 1 && k < rings ? 1 + ledges * (1 - t) : 1), rr = r * base * ledge;
    const cyy = y - sink + (h + sink) * t * (0.96 + 0.08 * rng()), cx = x + lean[0] * h * t + (rng() - 0.5) * r * 0.1, cz = z + lean[1] * h * t + (rng() - 0.5) * r * 0.1; const ring = [];
    for (let i = 0; i < sides; i++) { const a = twist * t + (i + (rng() - 0.5) * 0.7) / sides * 6.2832, rj = rr * (1 - jitter * 0.5 + jitter * rng()); const [px, pz] = at(Math.cos(a) * rj, Math.sin(a) * rj * squash, cx, cz); ring.push([px, cyy + (rng() - 0.5) * h * 0.045, pz]); }
    R.push(ring);
  }
  // fracture planes: each clamps the vertices of a vertical band to a random tilted plane -> flat facets, sharp arrises, stepped ledges
  const nPl = 7 + ((rng() * 5) | 0); for (let q = 0; q < nPl; q++) { const a = rng() * 6.2832, e = (rng() - 0.4) * 0.8, nx = Math.cos(a) * Math.cos(e), ny = Math.sin(e), nz = Math.sin(a) * Math.cos(e), t0 = rng() * 0.85, t1 = Math.min(1, t0 + 0.25 + rng() * 0.5), dd = r * (0.42 + 0.4 * rng());
    for (let k = 0; k <= rings; k++) { const tt = k / rings; if (tt < t0 || tt > t1) continue; for (const v of R[k]) { const rx = v[0] - x, ry = v[1] - y, rz = v[2] - z, dist = rx * nx + ry * ny + rz * nz - dd * (1 - 0.45 * tt); if (dist > 0) { v[0] -= dist * nx; v[1] -= dist * ny; v[2] -= dist * nz; } } } }
  const P = [], N = [], U = [], I = []; let n = 0;
  const tri = (a, b, c) => { const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]; let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const cxm = (a[0] + b[0] + c[0]) / 3, cym = (a[1] + b[1] + c[1]) / 3, czm = (a[2] + b[2] + c[2]) / 3; const ax = x + lean[0] * (cym - y), az = z + lean[1] * (cym - y);
    if (nx * (cxm - ax) + nz * (czm - az) + ny * 0.3 < 0) { const t2 = b; b = c; c = t2; nx = -nx; ny = -ny; nz = -nz; }              // outward-facing, CCW seen from outside
    for (const p of [a, b, c]) { P.push(p[0], p[1], p[2]); N.push(nx, ny, nz); U.push(p[0], p[2]); I.push(n++); } };
  for (let k = 0; k < rings; k++) for (let i = 0; i < sides; i++) { const j = (i + 1) % sides, a = R[k][i], b = R[k][j], c = R[k + 1][j], d = R[k + 1][i]; if ((i + k) % 2) { tri(a, b, c); tri(a, c, d); } else { tri(a, b, d); tri(b, c, d); } }
  // ragged crown: each sector of the top ring fans to one of several apexes of different heights
  const top = R[rings], mx = top.reduce((s, p) => s + p[0], 0) / sides, mz = top.reduce((s, p) => s + p[2], 0) / sides, my = top.reduce((s, p) => s + p[1], 0) / sides;
  const apex = []; for (let q = 0; q < tips; q++) { const [ax, az] = at((rng() - 0.5) * r * 0.9, (rng() - 0.5) * r * 0.5 * squash, mx, mz); apex.push([ax, my + h * crown * (0.25 + 0.75 * rng()), az]); }
  for (let i = 0; i < sides; i++) { const j = (i + 1) % sides; const ap = apex[Math.min(tips - 1, Math.floor(i / sides * tips))]; tri(top[i], top[j], ap); }
  B.addRaw({ p: new Float32Array(P), n: new Float32Array(N), u: new Float32Array(U), i: new Uint32Array(I) }, new THREE.Matrix4(), mat, { cast: true, recv: true });
  if (col) B.colliders.addCyl({ x, z, r: r * 0.8, y0: y - 0.5, y1: y + h * 0.85, surface: 'rock', walk: false });
}

/** a jagged outcrop: 2-4 fat low crags fused together */
export function outcrop(B, mat, x, y, z, { r = 3, h = 3, seed = 1, n = 3, col = 'rock' } = {}) {
  const rng = makeRng(seed * 7 + 3);
  for (let i = 0; i < n; i++) { const a = rng() * 6.283, d = i === 0 ? 0 : r * (0.5 + 0.5 * rng()); angularSpire(B, mat, x + Math.cos(a) * d, y, z + Math.sin(a) * d, { h: h * (i === 0 ? 1 : 0.5 + 0.5 * rng()), r: r * (i === 0 ? 0.9 : 0.5 + 0.3 * rng()), sides: 8, rings: 4, lean: [0.1 * (rng() - 0.5), 0.1 * (rng() - 0.5)], twist: 0.5, ledges: 0.25, taper: 0.4, squash: 0.8, jitter: 0.55, tips: 3, crown: 0.3, seed: seed * 10 + i, col: i === 0 ? col : false }); }
}
