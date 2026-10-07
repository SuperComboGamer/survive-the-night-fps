// The hitbox instrument (docs/hitboxes.md): for a prop, how far its collision volume (shared/props.js: boxes and
// cylinders) is from the model that is drawn (client/render/models: built here under node, no browser).
//
// The model is turned into a solid on a grid of small cubes: a cube is solid when, along each of the three axes, it
// lies between the first and the last surface of the model on that line (so a car's cabin is solid, the air over
// its bonnet is not, nor the room under a table or inside a bus shelter). The colliders are put on the same grid.
// What is in one and not the other is the fault:
//   solid air   collider where there is no model: a shot stops in the open, a body walks into nothing
//   hole        model with no collider: a shot or a body goes through what looks solid
// each as a volume (or, for walking, an area seen from above) and as the worst distance: how far the worst cube of
// solid air is from the nearest model, how deep the worst cube of a hole is from the nearest collider.
// Split by what it matters to:
//   shot    bullets, melee swings on the world and the line of sight of the dead (raycastWorld: the same colliders)
//   sight   the same, between crouching and standing eye height only (what hides a survivor, what a zombie sees past)
//   move    walking: seen from above, what stops a body (a collider that reaches over a step and under the head)
//           against where the model stands in that band
//   stand   where both are: how far the collider's top (what feet stand on) is from the model's top
//   reach   interaction and survivors' melee go over anything no higher than the eye (canReach): the solid air of
//           the colliders that are higher than that
import '../clip/dom-stub.js';
import { PROPS, collidersOf as collidersFor } from '../../shared/props.js';
import { STEP_HEIGHT, PLAYER_HEIGHT, EYE_HEIGHT, EYE_HEIGHT_CROUCH } from '../../shared/constants.js';

const THREE = await import('three');
const { createProp } = await import('../../client/render/models/props.js');

// materials that are no solid at all: cards of grass round a wreck, stains, lettering
export const NOT_SOLID = new Set(['weeds', 'grass', 'bush', 'fern', 'leaves', 'pine', 'blood_decal', 'citygrime', 'citysign', 'acid_glow']);
// ...and what is solid to a body and open to a bullet's eye: the mesh of a chain-link fence
export const SEE_THROUGH = new Set(['chainlink']);
export const GLASS = new Set(['glass', 'carglass', 'canopy']);
// (pictures only: materials whose colour is in a texture this has not got)
const TINT = { tire: [0.03, 0.03, 0.035], rubber: [0.04, 0.04, 0.04], carglass: [0.08, 0.13, 0.16], glass: [0.3, 0.42, 0.46], canopy: [0.06, 0.1, 0.13], dark: [0.01, 0.01, 0.012], chrome: [0.6, 0.62, 0.65], weeds: [0.12, 0.22, 0.07], cabin: [0.05, 0.05, 0.05], cabin_fine: [0.09, 0.08, 0.07], rust: [0.22, 0.1, 0.05], charred: [0.03, 0.03, 0.03], chainlink: [0.3, 0.32, 0.34] };

/**
 * A prop's model as triangles in its own frame: { pos: Float32Array (9 a triangle), mat: [name per triangle],
 * rgb: Float32Array (3 a triangle, for pictures), box: [x0, y0, z0, x1, y1, z1] }.
 */
export function modelOf(type, seed = 0, make = createProp) {
  const root = make(type, seed);
  root.updateMatrixWorld(true);
  const pos = [];
  const mat = [];
  const rgb = [];
  const v = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry || o.visible === false) return;
    const g = o.geometry;
    const P = g.attributes.position;
    const C = g.attributes.color;
    const idx = g.index;
    const n = idx ? idx.count : P.count;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const groups = mats.length > 1 && g.groups.length ? g.groups : [{ start: 0, count: n, materialIndex: 0 }];
    for (const grp of groups) {
      const m = mats[grp.materialIndex] || mats[0];
      const name = m?.name || '';
      const base = m?.color || { r: 0.6, g: 0.6, b: 0.6 };
      const end = Math.min(n, grp.start + grp.count);
      for (let i = grp.start; i + 2 < end; i += 3) {
        let r = 0, gg = 0, b = 0;
        for (let k = 0; k < 3; k++) {
          const vi = idx ? idx.getX(i + k) : i + k;
          v.fromBufferAttribute(P, vi).applyMatrix4(o.matrixWorld);
          pos.push(v.x, v.y, v.z);
          if (C && m.vertexColors) {
            r += C.getX(vi) / 3;
            gg += C.getY(vi) / 3;
            b += C.getZ(vi) / 3;
          }
        }
        // (a vertex-coloured material multiplies its colour by the vertex's; panes carry [dirt, tint, blood] there)
        const fixed = TINT[name];
        if (fixed) rgb.push(...fixed);
        else if (C && m.vertexColors && !GLASS.has(name)) rgb.push(base.r * r, base.g * gg, base.b * b);
        else rgb.push(base.r, base.g, base.b);
        mat.push(name);
      }
    }
  });
  const P = new Float32Array(pos);
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) {
    if (NOT_SOLID.has(mat[(i / 9) | 0])) continue;
    for (let a = 0; a < 3; a++) {
      if (P[i + a] < box[a]) box[a] = P[i + a];
      if (P[i + a] > box[3 + a]) box[3 + a] = P[i + a];
    }
  }
  return { type, seed, pos: P, mat, rgb: new Float32Array(rgb), box };
}

// every variant a prop is drawn as: seeds 0.. until the models repeat (createProp takes seed % its count)
export function variantsOf(type, make = createProp, max = 12) {
  const out = [];
  const seen = new Set();
  for (let s = 0; s < max; s++) {
    let m;
    try {
      m = modelOf(type, s, make);
    } catch (e) {
      break;
    }
    let h = m.pos.length;
    for (let i = 0; i < m.pos.length; i += 97) h = (Math.imul(h, 31) + Math.round(m.pos[i] * 1000)) | 0;
    if (seen.has(h)) break;
    seen.add(h);
    out.push(m);
  }
  return out;
}

// a def's colliders in its own frame: [{ box: true, x0, x1, y0, y1, z0, z1 } | { cx, cz, r, y0, y1 }], with flags
export function collidersOf(def) {
  const out = [];
  for (const b of def?.boxes || []) out.push({ box: true, x0: b[0] - b[3] / 2, x1: b[0] + b[3] / 2, y0: b[1] - b[4] / 2, y1: b[1] + b[4] / 2, z0: b[2] - b[5] / 2, z1: b[2] + b[5] / 2, flags: b[6] || 0 });
  for (const c of def?.cyls || []) out.push({ box: false, cx: c[0], cz: c[1], r: c[2], y0: c[4] || 0, y1: (c[4] || 0) + c[3], flags: c[5] || 0 });
  return out;
}

// ---------------------------------------------------------------- the grid
const BIG = 1e9;
/**
 * The model's solid on a grid: Uint8Array [nx * ny * nz], 1 where solid. include(name): which materials count.
 * grid: { x0, y0, z0, v, nx, ny, nz }.
 */
export function solidOf(model, grid, include) {
  const { x0, y0, z0, v, nx, ny, nz } = grid;
  const org = [x0, y0, z0];
  const dim = [nx, ny, nz];
  // per axis a: the first and last surface along a for each cell of the other two (u, w)
  const lo = [], hi = [];
  const UW = [[1, 2], [0, 2], [0, 1]];
  for (let a = 0; a < 3; a++) {
    const n = dim[UW[a][0]] * dim[UW[a][1]];
    lo.push(new Float32Array(n).fill(BIG));
    hi.push(new Float32Array(n).fill(-BIG));
  }
  const P = model.pos;
  const half = v / 2;
  for (let t = 0; t < P.length; t += 9) {
    if (!include(model.mat[t / 9])) continue;
    for (let a = 0; a < 3; a++) {
      const [u, w] = UW[a];
      const nu = dim[u], nw = dim[w];
      const L = lo[a], H = hi[a];
      const au = (P[t + u] - org[u]) / v, aw = (P[t + w] - org[w]) / v, ad = P[t + a];
      const bu = (P[t + 3 + u] - org[u]) / v, bw = (P[t + 3 + w] - org[w]) / v, bd = P[t + 3 + a];
      const cu = (P[t + 6 + u] - org[u]) / v, cw = (P[t + 6 + w] - org[w]) / v, cd = P[t + 6 + a];
      const put = (fu, fw, d) => {
        const iu = Math.floor(fu), iw = Math.floor(fw);
        if (iu < 0 || iw < 0 || iu >= nu || iw >= nw) return;
        const k = iw * nu + iu;
        if (d < L[k]) L[k] = d;
        if (d > H[k]) H[k] = d;
      };
      // its edges, sampled finer than the cells (a panel seen edge on is a line here)
      const edge = (pu, pw, pd, qu, qw, qd) => {
        const n = Math.max(1, Math.ceil(Math.max(Math.abs(qu - pu), Math.abs(qw - pw)) * 2));
        for (let i = 0; i <= n; i++) {
          const f = i / n;
          put(pu + (qu - pu) * f, pw + (qw - pw) * f, pd + (qd - pd) * f);
        }
      };
      edge(au, aw, ad, bu, bw, bd);
      edge(bu, bw, bd, cu, cw, cd);
      edge(cu, cw, cd, au, aw, ad);
      // its inside: the cell centres it covers
      const det = (bu - au) * (cw - aw) - (cu - au) * (bw - aw);
      if (Math.abs(det) < 1e-9) continue;
      const u0 = Math.max(0, Math.floor(Math.min(au, bu, cu))), u1 = Math.min(nu - 1, Math.floor(Math.max(au, bu, cu)));
      const w0 = Math.max(0, Math.floor(Math.min(aw, bw, cw))), w1 = Math.min(nw - 1, Math.floor(Math.max(aw, bw, cw)));
      for (let iw = w0; iw <= w1; iw++) {
        for (let iu = u0; iu <= u1; iu++) {
          const pu = iu + 0.5 - au, pw = iw + 0.5 - aw;
          const s = (pu * (cw - aw) - (cu - au) * pw) / det;
          const r = ((bu - au) * pw - pu * (bw - aw)) / det;
          if (s < 0 || r < 0 || s + r > 1) continue;
          const d = ad + (bd - ad) * s + (cd - ad) * r;
          const k = iw * nu + iu;
          if (d < L[k]) L[k] = d;
          if (d > H[k]) H[k] = d;
        }
      }
    }
  }
  // A heap, a tent, a mound is drawn as a skin with nothing under it (it stands on the ground): where a line down
  // meets one surface only, what is under it is solid down to the prop's base. (The two other axes still have to
  // agree, so the air under a sheet that hangs - an awning, a wing - stays air.)
  for (let k = 0; k < lo[1].length; k++) if (hi[1][k] >= lo[1][k] && hi[1][k] - lo[1][k] < 1.5 * v && lo[1][k] > 0) lo[1][k] = 0;
  const S = new Uint8Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) {
    const z = z0 + (k + 0.5) * v;
    for (let j = 0; j < ny; j++) {
      const y = y0 + (j + 0.5) * v;
      const kx = k * ny + j; // axis x: (u, w) = (y, z)
      if (lo[0][kx] > hi[0][kx]) continue;
      for (let i = 0; i < nx; i++) {
        const x = x0 + (i + 0.5) * v;
        if (x < lo[0][kx] - half || x > hi[0][kx] + half) continue;
        const ky = k * nx + i; // axis y: (x, z)
        if (y < lo[1][ky] - half || y > hi[1][ky] + half) continue;
        const kz = j * nx + i; // axis z: (x, y)
        if (z < lo[2][kz] - half || z > hi[2][kz] + half) continue;
        S[(k * ny + j) * nx + i] = 1;
      }
    }
  }
  return S;
}

export function collidersOn(cols, grid, keep = () => true) {
  const { x0, y0, z0, v, nx, ny, nz } = grid;
  const S = new Uint8Array(nx * ny * nz);
  for (const c of cols) {
    if (!keep(c)) continue;
    const j0 = Math.max(0, Math.round((c.y0 - y0) / v)), j1 = Math.min(ny, Math.round((c.y1 - y0) / v));
    const bx0 = c.box ? c.x0 : c.cx - c.r, bx1 = c.box ? c.x1 : c.cx + c.r, bz0 = c.box ? c.z0 : c.cz - c.r, bz1 = c.box ? c.z1 : c.cz + c.r;
    const i0 = Math.max(0, Math.floor((bx0 - x0) / v)), i1 = Math.min(nx - 1, Math.floor((bx1 - x0) / v));
    const k0 = Math.max(0, Math.floor((bz0 - z0) / v)), k1 = Math.min(nz - 1, Math.floor((bz1 - z0) / v));
    for (let k = k0; k <= k1; k++) {
      const z = z0 + (k + 0.5) * v;
      for (let i = i0; i <= i1; i++) {
        const x = x0 + (i + 0.5) * v;
        if (c.box ? x < c.x0 || x > c.x1 || z < c.z0 || z > c.z1 : (x - c.cx) ** 2 + (z - c.cz) ** 2 > c.r * c.r) continue;
        for (let j = j0; j < j1; j++) S[(k * ny + j) * nx + i] = 1;
      }
    }
  }
  return S;
}

// distance (in cells, chamfer 3-4-5 / 3) from every cell to the nearest set cell of S
function distTo(S, nx, ny, nz) {
  const D = new Uint16Array(S.length);
  const FAR = 60000;
  for (let i = 0; i < S.length; i++) D[i] = S[i] ? 0 : FAR;
  const nb = [];
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const o = (dz * ny + dy) * nx + dx;
    if (o >= 0) continue;
    nb.push([dx, dy, dz, [0, 3, 4, 5][Math.abs(dx) + Math.abs(dy) + Math.abs(dz)]]);
  }
  for (let pass = 0; pass < 2; pass++) {
    const s = pass ? -1 : 1;
    for (let kk = 0; kk < nz; kk++) {
      const k = pass ? nz - 1 - kk : kk;
      for (let jj = 0; jj < ny; jj++) {
        const j = pass ? ny - 1 - jj : jj;
        for (let ii = 0; ii < nx; ii++) {
          const i = pass ? nx - 1 - ii : ii;
          const at = (k * ny + j) * nx + i;
          let d = D[at];
          if (!d) continue;
          for (let n = 0; n < nb.length; n++) {
            const x = i + nb[n][0] * s, y = j + nb[n][1] * s, z = k + nb[n][2] * s;
            if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) continue;
            const e = D[(z * ny + y) * nx + x] + nb[n][3];
            if (e < d) d = e;
          }
          D[at] = d;
        }
      }
    }
  }
  return D;
}

/**
 * Measure a model against colliders. Returns the numbers (metres, m2, m3) and, with o.keep, the grids.
 * o.cells: about how many cubes the grid may have (the cube is never smaller than o.min).
 */
export function measure(model, cols, o = {}) {
  const maxCells = o.cells || 1_500_000;
  const b = model.box.slice();
  if (!(b[0] <= b[3])) b.fill(0);
  for (const c of cols) {
    b[0] = Math.min(b[0], c.box ? c.x0 : c.cx - c.r);
    b[3] = Math.max(b[3], c.box ? c.x1 : c.cx + c.r);
    b[1] = Math.min(b[1], c.y0);
    b[4] = Math.max(b[4], c.y1);
    b[2] = Math.min(b[2], c.box ? c.z0 : c.cz - c.r);
    b[5] = Math.max(b[5], c.box ? c.z1 : c.cz + c.r);
  }
  const vol = Math.max(1e-6, (b[3] - b[0] + 0.4) * (b[4] - b[1] + 0.4) * (b[5] - b[2] + 0.4));
  const v = Math.max(o.min || 0.04, Math.cbrt(vol / maxCells));
  const pad = 2 * v;
  // (the grid's floor is the prop's base: y = 0 is a cell boundary, so a band of heights means the same everywhere)
  const y0 = Math.floor((b[1] - pad) / v) * v;
  const grid = { x0: b[0] - pad, y0, z0: b[2] - pad, v, nx: Math.ceil((b[3] - b[0] + 2 * pad) / v), ny: Math.ceil((b[4] + pad - y0) / v), nz: Math.ceil((b[5] - b[2] + 2 * pad) / v) };
  const { nx, ny, nz } = grid;
  const Mmove = solidOf(model, grid, (m) => !NOT_SOLID.has(m));
  const seeThrough = model.mat.some((m) => SEE_THROUGH.has(m));
  const Mshot = seeThrough ? solidOf(model, grid, (m) => !NOT_SOLID.has(m) && !SEE_THROUGH.has(m)) : Mmove;
  const NOBULLET = 32, NOBLOCK = 8;
  const Cshot = collidersOn(cols, grid, (c) => !(c.flags & (NOBULLET | NOBLOCK)));
  const Cmove = collidersOn(cols, grid, (c) => !(c.flags & NOBLOCK));
  const Ctall = collidersOn(cols, grid, (c) => !(c.flags & (NOBULLET | NOBLOCK)) && c.y1 > EYE_HEIGHT);
  const v3 = v * v * v, v2 = v * v;
  const x0 = grid.x0, z0g = grid.z0;
  const dM = distTo(Mshot, nx, ny, nz), dC = distTo(Cshot, nx, ny, nz);
  // how thick the worst hole is: twice as far as its deepest cube is from the edge of the hole (from a collider or
  // from the open air), so a thin arm that sticks a long way out of its collider is not a deep hole
  const notHole = new Uint8Array(Mshot.length);
  for (let i = 0; i < notHole.length; i++) notHole[i] = Mshot[i] && !Cshot[i] ? 0 : 1;
  const dH = distTo(notHole, nx, ny, nz);
  const out = { v, cells: nx * ny * nz, modelVol: 0, colVol: 0, shotAir: 0, shotAirMax: 0, shotHole: 0, shotHoleMax: 0, shotHoleThick: 0, sightAir: 0, sightHole: 0, sightAirMax: 0, sightHoleMax: 0, reachAir: 0, reachAirMax: 0, moveAir: 0, moveAirMax: 0, moveHole: 0, moveHoleMax: 0, standMax: 0, standMean: 0, height: Math.max(0, model.box[4]) };
  const jLo = Math.round((EYE_HEIGHT_CROUCH - 0.5 - y0) / v), jHi = Math.round((EYE_HEIGHT + 0.15 - y0) / v);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const at = (k * ny + j) * nx + i;
    const m = Mshot[at], c = Cshot[at];
    if (m) out.modelVol += v3;
    if (c) out.colVol += v3;
    if (c && !m) {
      const d = (dM[at] / 3) * v;
      out.shotAir += v3;
      if (d > out.shotAirMax) {
        out.shotAirMax = d;
        out.airAt = [x0 + (i + 0.5) * v, y0 + (j + 0.5) * v, z0g + (k + 0.5) * v];
      }
      if (j >= jLo && j < jHi) {
        out.sightAir += v3;
        if (d > out.sightAirMax) out.sightAirMax = d;
      }
      if (Ctall[at]) {
        out.reachAir += v3;
        if (d > out.reachAirMax) out.reachAirMax = d;
      }
    } else if (m && !c) {
      const d = (dC[at] / 3) * v;
      out.shotHole += v3;
      if (d > out.shotHoleMax) out.shotHoleMax = d;
      const th = ((dH[at] / 3) * 2 - 1) * v;
      if (th > out.shotHoleThick) {
        out.shotHoleThick = th;
        out.holeAt = [x0 + (i + 0.5) * v, y0 + (j + 0.5) * v, z0g + (k + 0.5) * v];
      }
      if (j >= jLo && j < jHi) {
        out.sightHole += v3;
        if (d > out.sightHoleMax) out.sightHoleMax = d;
      }
    }
  }
  // walking: seen from above, between a step and the head
  const jS = Math.round((STEP_HEIGHT - y0) / v), jH = Math.min(ny, Math.round((PLAYER_HEIGHT - y0) / v));
  const cm = new Uint8Array(nx * nz), mm = new Uint8Array(nx * nz);
  const ctop = new Float32Array(nx * nz).fill(-1), mtop = new Float32Array(nx * nz).fill(-1);
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    const a = k * nx + i;
    for (let j = ny - 1; j >= 0; j--) {
      const at = (k * ny + j) * nx + i;
      if (Cmove[at]) {
        if (ctop[a] < 0) ctop[a] = y0 + (j + 1) * v;
        if (j >= jS && j < jH) cm[a] = 1;
      }
      if (Mmove[at]) {
        if (mtop[a] < 0) mtop[a] = y0 + (j + 1) * v;
        if (j >= jS && j < jH) mm[a] = 1;
      }
    }
  }
  // (a collider's top is what it is: the cells rounded it)
  const d2 = (S) => {
    const D = distTo(S, nx, 1, nz);
    return D;
  };
  // air: a body is stopped where nothing stands that high (a collider well over anything drawn under it).
  // hole: the model stands in a body's way with no collider there at all (one that can be stepped onto - a bench's
  // seat, under its back - is the way it was meant: that is not a hole)
  const air2 = new Uint8Array(nx * nz), hole2 = new Uint8Array(nx * nz), any = new Uint8Array(nx * nz), seen2 = new Uint8Array(nx * nz);
  for (let a = 0; a < nx * nz; a++) {
    air2[a] = cm[a] && !mm[a] && mtop[a] < ctop[a] - 0.3 ? 1 : 0;
    hole2[a] = mm[a] && ctop[a] < 0 ? 1 : 0;
    any[a] = ctop[a] >= 0 ? 1 : 0;
    seen2[a] = mtop[a] >= 0 ? 1 : 0;
  }
  const notHole2 = hole2.map((h) => (h ? 0 : 1));
  const dm2 = d2(seen2), dh2 = d2(notHole2);
  let standN = 0;
  for (let a = 0; a < nx * nz; a++) {
    if (air2[a]) {
      out.moveAir += v2;
      out.moveAirMax = Math.max(out.moveAirMax, (dm2[a] / 3) * v);
    } else if (hole2[a]) {
      out.moveHole += v2;
      out.moveHoleMax = Math.max(out.moveHoleMax, ((dh2[a] / 3) * 2 - 1) * v); // (how wide the widest of it is)
    }
    if (ctop[a] >= 0 && mtop[a] >= 0 && ctop[a] > 0.1) {
      const e = Math.abs(ctop[a] - mtop[a]);
      standN++;
      out.standMean += e;
      if (e > out.standMax) out.standMax = e;
    }
  }
  if (standN) out.standMean /= standN;
  // nothing to be this far from: the model's own reach says how bad
  const cap = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]);
  for (const k of Object.keys(out)) if (/Max$|Thick$/.test(k)) out[k] = Math.min(out[k], cap);
  if (o.keep) Object.assign(out, { grid, Mshot, Mmove, Cshot, Cmove });
  return out;
}

const FIELDS = ['shotAir', 'shotAirMax', 'shotHole', 'shotHoleMax', 'shotHoleThick', 'sightAir', 'sightAirMax', 'sightHole', 'sightHoleMax', 'reachAir', 'reachAirMax', 'moveAir', 'moveAirMax', 'moveHole', 'moveHoleMax', 'standMax', 'standMean', 'modelVol', 'colVol', 'height'];
/** A prop type measured over all its variants: the worst of each number, and which variant gave the worst. */
export function measureType(type, o = {}) {
  const models = o.models || variantsOf(type);
  // (each variant against its own colliders, where it has them: props.js `vary`)
  const colsOf = (i) => collidersOf(o.defs ? o.defs[type] : collidersFor(type, i));
  const worst = { type, variants: models.length, colliders: Math.max(...models.map((m, i) => colsOf(i).length), 0) };
  for (const f of FIELDS) worst[f] = 0;
  const per = [];
  for (let i = 0; i < models.length; i++) {
    const m = models[i];
    const r = measure(m, colsOf(i), o);
    per.push(r);
    if (r.shotAirMax >= worst.shotAirMax) worst.airAt = r.airAt && [i, ...r.airAt.map((x) => Math.round(x * 100) / 100)];
    if (r.shotHoleThick >= worst.shotHoleThick) worst.holeAt = r.holeAt && [i, ...r.holeAt.map((x) => Math.round(x * 100) / 100)];
    for (const f of FIELDS) if (r[f] > worst[f]) worst[f] = r[f];
    worst.v = r.v;
  }
  worst.per = per;
  return worst;
}

// one number to rank by: the worst distance of any kind that matters (metres)
export const score = (r) => Math.max(r.shotAirMax, r.shotHoleThick, r.moveAirMax, r.moveHoleMax);

/**
 * The outline of a model for fitting boxes by hand: slices along `axis` (0 x, 2 z) of `step` metres, each with the
 * extent of the solid across and its lowest and highest point. Printed by measure.js --profile.
 */
export function profile(model, axis = 2, step = 0.2) {
  const cols = [];
  const r = measure(model, cols, { keep: true, cells: 1_200_000 });
  const { grid, Mmove } = r;
  const { nx, ny, nz, v } = grid;
  const n = axis === 2 ? nz : nx;
  const org = axis === 2 ? grid.z0 : grid.x0;
  const out = [];
  const per = Math.max(1, Math.round(step / v));
  for (let s0 = 0; s0 < n; s0 += per) {
    let a0 = Infinity, a1 = -Infinity, yl = Infinity, yh = -Infinity, cnt = 0;
    // per height band: the width (for a cabin narrower than the body under it)
    for (let s = s0; s < Math.min(n, s0 + per); s++) {
      for (let j = 0; j < ny; j++) for (let t = 0; t < (axis === 2 ? nx : nz); t++) {
        const i = axis === 2 ? t : s, k = axis === 2 ? s : t;
        if (!Mmove[(k * ny + j) * nx + i]) continue;
        cnt++;
        const across = (axis === 2 ? grid.x0 : grid.z0) + (t + 0.5) * v;
        const y = grid.y0 + (j + 0.5) * v;
        if (across < a0) a0 = across;
        if (across > a1) a1 = across;
        if (y < yl) yl = y;
        if (y > yh) yh = y;
      }
    }
    if (cnt) out.push({ at: org + (s0 + per / 2) * v, a0: a0 - v / 2, a1: a1 + v / 2, y0: yl - v / 2, y1: yh + v / 2 });
  }
  return out;
}

export { PROPS, THREE, createProp };
