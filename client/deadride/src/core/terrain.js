// Chunked heightfield terrain: mesh chunks (cull-friendly) + analytic normals; collision uses the same heightFn via Colliders.heightFn.
import * as THREE from 'three';
/** B: Builder. o: {minX,maxX,minZ,maxZ, cell (m), heightFn(x,z), mat, chunk (cells per chunk), cast, recv, skirt} */
export function buildTerrain(B, o) {
  const cell = o.cell || 2, cn = o.chunk || 32, e = cell * 0.5;
  const nx = Math.ceil((o.maxX - o.minX) / cell), nz = Math.ceil((o.maxZ - o.minZ) / cell);
  const H = o.heightFn;
  for (let cz = 0; cz < nz; cz += cn) for (let cx = 0; cx < nx; cx += cn) {
    const w = Math.min(cn, nx - cx), d = Math.min(cn, nz - cz); const x0 = o.minX + cx * cell, z0 = o.minZ + cz * cell; const ox = x0 + w * cell / 2, oz = z0 + d * cell / 2;
    const P = [], N = [], U = [], I = [];
    for (let j = 0; j <= d; j++) for (let i = 0; i <= w; i++) {
      const x = x0 + i * cell, z = z0 + j * cell, y = H(x, z); const hx = H(x - e, z) - H(x + e, z), hz = H(x, z - e) - H(x, z + e); const l = Math.hypot(hx, 2 * e, hz);
      P.push(x - ox, y, z - oz); N.push(hx / l, 2 * e / l, hz / l); U.push(x, z);
    }
    for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) { const a = j * (w + 1) + i, b = a + 1, c = a + (w + 1), dd = c + 1; I.push(a, c, b, b, c, dd); }
    B.addRaw({ p: new Float32Array(P), n: new Float32Array(N), u: new Float32Array(U), i: new Uint32Array(I) }, new THREE.Matrix4().makeTranslation(ox, 0, oz), o.mat, { cast: o.cast !== false, recv: o.recv !== false });
  }
  B.colliders.heightFn = H;
}
