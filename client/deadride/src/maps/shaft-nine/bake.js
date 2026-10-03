// Baked vertex lighting for tessellated static geometry (rock shells, terrain, rocks): ambient occlusion from the cavity field plus
// coloured point/emitter light with optional field-marched shadows. Replaces Builder's StaticBatch (same add()/finish() contract) and adds
// two vertex attributes: aVis (x = baked AO for IBL, y = 1) and aBake (linear RGB radiance factor: material adds albedo * aBake to emission).
// Light values use the same units as scene lights (candela): E = I / (d^2 + s^2).
import * as THREE from 'three';
import { SHADOW_LAYER, StaticBatch } from '../../core/build.js';
import { visVariant } from '../../core/mats.js';

const PI = Math.PI;
// shadow proxies (same scheme as core StaticBatch): opaque casters are merged into depth-only meshes on the shadow layer, so the shadow pass costs a few draws
const proxySafe = (mat) => !mat.transparent && !mat.alphaTest && !mat.alphaMap && !(mat.userData.patchOpts && (mat.userData.patchOpts.wind || mat.userData.patchOpts.vertex)) && mat.side !== THREE.BackSide;
let _proxyMat = null; const proxyMaterial = () => _proxyMat || (_proxyMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));

export class BakedBatch {
  constructor(parent, { cell = 20, cellY = 40, shift = [0, 0, 0] } = {}) {
    this.parent = parent; this.cell = cell; this.cellY = cellY; this.shift = shift; /* moves the chunk-grid origin so a whole stop can sit in ONE cell (a cell boundary at x = 0 doubled every draw) */ this.map = new Map(); this.meshes = []; this.lights = []; this.air = null;
    this.aoK = 1.0; this.wrap = 0.3; this.gain = 1.0; this.maxK = 2.5; this.minVerts = 100; this.stats = { verts: 0, tris: 0, chunks: 0 }; this.proxy = true; this.proxies = new Map();
  }
  /** register a baked emitter. p:[x,y,z] (stop-local), c:[r,g,b] linear colour, I candela, R cut-off radius, s source radius (softens 1/d^2), shadow: march the cavity field */
  light({ p, c = [1, 1, 1], I = 20, R = 14, s = 0.4, shadow = false, k = 1 }) { this.lights.push({ p, c: [c[0] * k, c[1] * k, c[2] * k], I, R, R2: R * R, s2: s * s, shadow }); return this; }
  _proxyAdd(raw, e, ne, cx, cy, cz, dbl) {
    const key = `${cx},${cy},${cz}|${dbl ? 2 : 1}`; let a = this.proxies.get(key); if (!a) { a = { P: [], I: [], nv: 0 }; this.proxies.set(key, a); }
    const n = raw.p.length / 3, base = a.nv;
    for (let k = 0; k < n; k++) { const x = raw.p[k * 3], y = raw.p[k * 3 + 1], z = raw.p[k * 3 + 2]; a.P.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]); }
    for (let k = 0; k < raw.i.length; k++) a.I.push(raw.i[k] + base); a.nv += n;
  }
  _proxyFinish() {
    for (const a of this.proxies.values()) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(a.P, 3)); g.setIndex(a.nv > 65535 ? new THREE.Uint32BufferAttribute(a.I, 1) : new THREE.Uint16BufferAttribute(a.I, 1)); g.computeBoundingSphere();
      const m = new THREE.Mesh(g, proxyMaterial()); m.castShadow = true; m.receiveShadow = false; m.layers.set(SHADOW_LAYER); m.matrixAutoUpdate = false; m.name = 'shadowProxy'; m.userData.shadowProxy = true; this.parent.add(m); this.meshes.push(m);
    }
    this.proxies.clear();
  }
  add(raw, matrix, mat, opt = {}) {
    const nrm = new THREE.Matrix3().getNormalMatrix(matrix), e = matrix.elements, ne = nrm.elements;
    const n = raw.p.length / 3, bake = opt.bake ?? n >= this.minVerts;
    let cast = opt.cast ?? true; const recv = opt.recv ?? true;
    if (cast && this.proxy && proxySafe(mat)) { this._proxyAdd(raw, e, ne, Math.floor((e[12] + this.shift[0]) / this.cell), Math.floor((e[13] + this.shift[1]) / this.cellY), Math.floor((e[14] + this.shift[2]) / this.cell), mat.side === THREE.DoubleSide); cast = false; }
    const split = n > 3000; // large meshes are spatially chunked per triangle so frustum culling works
    const sh = this.shift, cellOf = (x, y, z) => `${Math.floor((x + sh[0]) / this.cell)},${Math.floor((y + sh[1]) / this.cellY)},${Math.floor((z + sh[2]) / this.cell)}`;
    const key0 = (cx) => `${mat.uuid}|${cast ? 1 : 0}${recv ? 1 : 0}|${cx}`;
    const px = new Float32Array(n), py = new Float32Array(n), pz = new Float32Array(n), tx = new Float32Array(n), ty = new Float32Array(n), tz = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const x = raw.p[k * 3], y = raw.p[k * 3 + 1], z = raw.p[k * 3 + 2]; px[k] = e[0] * x + e[4] * y + e[8] * z + e[12]; py[k] = e[1] * x + e[5] * y + e[9] * z + e[13]; pz[k] = e[2] * x + e[6] * y + e[10] * z + e[14];
      const nx = raw.n[k * 3], ny = raw.n[k * 3 + 1], nz = raw.n[k * 3 + 2]; let ax = ne[0] * nx + ne[3] * ny + ne[6] * nz, ay = ne[1] * nx + ne[4] * ny + ne[7] * nz, az = ne[2] * nx + ne[5] * ny + ne[8] * nz; const l = Math.hypot(ax, ay, az) || 1; tx[k] = ax / l; ty[k] = ay / l; tz[k] = az / l;
    }
    const chunkOf = (cx) => { const key = key0(cx); let a = this.map.get(key); if (!a) { a = { mat, cast, recv, P: [], N: [], U: [], I: [], F: [], nv: 0 }; this.map.set(key, a); } return a; };
    const push = (a, k) => { a.P.push(px[k], py[k], pz[k]); a.N.push(tx[k], ty[k], tz[k]); a.U.push(raw.u[k * 2], raw.u[k * 2 + 1]); a.F.push(bake ? (opt.noShadow ? 2 : 1) : 0); return a.nv++; };
    if (!split) {
      const a = chunkOf(cellOf(e[12], e[13], e[14])), base = a.nv; for (let k = 0; k < n; k++) push(a, k); for (let k = 0; k < raw.i.length; k++) a.I.push(raw.i[k] + base);
    } else {
      const remap = new Map(); // per chunk: source vertex -> chunk vertex
      for (let t = 0; t < raw.i.length; t += 3) {
        const i0 = raw.i[t], i1 = raw.i[t + 1], i2 = raw.i[t + 2]; const a = chunkOf(cellOf((px[i0] + px[i1] + px[i2]) / 3, (py[i0] + py[i1] + py[i2]) / 3, (pz[i0] + pz[i1] + pz[i2]) / 3));
        let m = remap.get(a); if (!m) { m = new Map(); remap.set(a, m); }
        for (const v of [i0, i1, i2]) { let q = m.get(v); if (q === undefined) { q = push(a, v); m.set(v, q); } a.I.push(q); }
      }
    }
  }
  _bake(a, bk, vis) {
    const P = a.P, N = a.N, F = a.F, air = this.air, L = this.lights, nv = a.nv, wrap = this.wrap, ik = 1 / PI;
    for (let v = 0; v < nv; v++) {
      if (!F[v]) continue; const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2], nx = N[v * 3], ny = N[v * 3 + 1], nz = N[v * 3 + 2];
      if (air) { // SDF ambient occlusion: how much closer the nearby field is than a free-air step would be
        let occ = 0, sca = 1; for (let s = 1; s <= 5; s++) { const d = 0.06 + 0.22 * s * s * 0.5; const q = air(x + nx * d, y + ny * d, z + nz * d); occ += mx0(d - q) * sca; sca *= 0.7; }
        vis[v * 2] = clamp01(1 - occ * 1.35 * this.aoK);
      }
      let r = 0, g = 0, b = 0;
      for (let li = 0; li < L.length; li++) {
        const l = L[li]; const dx = l.p[0] - x, dy = l.p[1] - y, dz = l.p[2] - z; const d2 = dx * dx + dy * dy + dz * dz; if (d2 > l.R2) continue;
        const d = Math.sqrt(d2) + 1e-4; const ndl = (nx * dx + ny * dy + nz * dz) / d; const w = (ndl + wrap) / (1 + wrap); if (w <= 0) continue;
        let att = l.I / (d2 + l.s2); const q = 1 - d2 / l.R2; att *= q * q * w;
        if (l.shadow && air && F[v] !== 2) { const steps = Math.min(28, Math.ceil(d / 0.6)); let vis2 = 1; const ox = x + nx * 0.12, oy = y + ny * 0.12, oz = z + nz * 0.12; for (let s = 1; s < steps; s++) { const t = s / steps; const sd = air(ox + (l.p[0] - ox) * t, oy + (l.p[1] - oy) * t, oz + (l.p[2] - oz) * t); if (sd < 0.02) { vis2 = 0; break; } vis2 = Math.min(vis2, clamp01(sd * 6)); } att *= vis2; }
        r += l.c[0] * att; g += l.c[1] * att; b += l.c[2] * att;
      }
      { let kr = r * ik * this.gain, kg = g * ik * this.gain, kb = b * ik * this.gain; const m = Math.max(kr, kg, kb); if (m > this.maxK) { const q = this.maxK / m; kr *= q; kg *= q; kb *= q; } bk[v * 3] = kr; bk[v * 3 + 1] = kg; bk[v * 3 + 2] = kb; }
    }
  }
  finish() {
    const tf = performance.now();
    for (const a of this.map.values()) {
      const nv = a.nv, bk = new Float32Array(nv * 3), vis = new Float32Array(nv * 2).fill(1);
      if (a.F.some((f) => f) && (this.lights.length || this.air)) this._bake(a, bk, vis);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(a.P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(a.N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(a.U, 2));
      g.setAttribute('aVis', new THREE.BufferAttribute(vis, 2)); g.setAttribute('aBake', new THREE.BufferAttribute(bk, 3));
      g.setIndex(nv > 65535 ? new THREE.Uint32BufferAttribute(a.I, 1) : new THREE.Uint16BufferAttribute(a.I, 1));
      g.computeBoundingSphere(); g.computeBoundingBox();
      const m = new THREE.Mesh(g, a.mat); m.castShadow = a.cast; m.receiveShadow = a.recv; m.matrixAutoUpdate = false; m.updateMatrix();
      this.parent.add(m); this.meshes.push(m); this.stats.verts += nv; this.stats.tris += a.I.length / 3; this.stats.chunks++;
    }
    this._proxyFinish(); console.log(`[bake] finish ${(performance.now() - tf).toFixed(0)} ms, ${this.stats.chunks} chunks, ${this.stats.verts} verts, ${this.lights.length} lights`); this.map.clear(); return this.meshes;
  }
}
const mx0 = (x) => (x > 0 ? x : 0), clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Replace a Builder's static batch with a BakedBatch (call before adding geometry). Returns the batch. */
export function installBake(B, opts = {}) { const bb = new BakedBatch(B.group, opts); B.batch = bb; B.bake = bb; return bb; }

/**
 * Make a (patched, vis:true) material bake-aware: reads aBake and adds albedo*aBake to the emission.
 * The material must have been created with the `vis: true` patch option so that aVis is declared/used by the core patch.
 */
export function bakeable(mat, tag = 'bk') {
  const base = mat.onBeforeCompile, key = (mat.customProgramCacheKey ? mat.customProgramCacheKey() : '') + '|' + tag;
  mat.onBeforeCompile = (shader, renderer) => {
    if (base) base(shader, renderer);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aBake; varying vec3 vBake;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vBake = aBake;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vBake;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * vBake;');
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

/** Give an instanced/plain geometry the attributes bake-aware materials expect (aVis = 1, aBake = 0). */
export function prepGeo(geo) {
  const n = geo.attributes.position.count;
  if (!geo.attributes.aVis) geo.setAttribute('aVis', new THREE.BufferAttribute(new Float32Array(n * 2).fill(1), 2));
  if (!geo.attributes.aBake) geo.setAttribute('aBake', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  return geo;
}

/**
 * Core StaticBatch with a shifted chunk-grid origin (same add()/finish() contract, keeps the per-vertex sky-visibility bake): the yard sits in ONE chunk per material instead of four
 * (a cell boundary at x = 0 / z = 0 quartered every draw). opts: {cell, cellY, shift:[x,y,z]}
 */
export class ShiftedStaticBatch extends StaticBatch {
  constructor(parent, opts = {}) { super(parent, opts); this.shift = opts.shift || [0, 0, 0]; }
  /** shadow-only quad (both windings): cheap stand-in for a detailed thin caster such as corrugated sheet */
  proxyQuad(pts) { const sh = this.shift, p = pts[0]; this._proxyAdd({ p: new Float32Array(pts.flat()), i: [0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2] }, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], null, Math.floor((p[0] + sh[0]) / this.cell), Math.floor((p[1] + sh[1]) / this.cellY), Math.floor((p[2] + sh[2]) / this.cell), false); }
  add(raw, matrix, mat, { cast = true, recv = true } = {}) {
    const nrm = new THREE.Matrix3().getNormalMatrix(matrix), e = matrix.elements, ne = nrm.elements, sh = this.shift;
    const cx = Math.floor((e[12] + sh[0]) / this.cell), cy = Math.floor((e[13] + sh[1]) / this.cellY), cz = Math.floor((e[14] + sh[2]) / this.cell);
    if (cast && this.proxy && proxySafe(mat)) { this._proxyAdd(raw, e, ne, cx, cy, cz, mat.side === THREE.DoubleSide); cast = false; }
    const key = `${mat.uuid}|${cast ? 1 : 0}${recv ? 1 : 0}|${cx},${cy},${cz}`;
    let a = this.map.get(key); if (!a) { a = { mat, cast, recv, P: [], N: [], U: [], I: [], nv: 0 }; this.map.set(key, a); }
    const n = raw.p.length / 3, base = a.nv;
    for (let k = 0; k < n; k++) {
      const x = raw.p[k * 3], y = raw.p[k * 3 + 1], z = raw.p[k * 3 + 2];
      a.P.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
      const nx = raw.n[k * 3], ny = raw.n[k * 3 + 1], nz = raw.n[k * 3 + 2];
      const tx = ne[0] * nx + ne[3] * ny + ne[6] * nz, ty = ne[1] * nx + ne[4] * ny + ne[7] * nz, tz = ne[2] * nx + ne[5] * ny + ne[8] * nz; const l = Math.hypot(tx, ty, tz) || 1;
      a.N.push(tx / l, ty / l, tz / l); a.U.push(raw.u[k * 2], raw.u[k * 2 + 1]);
    }
    for (let k = 0; k < raw.i.length; k++) a.I.push(raw.i[k] + base);
    a.nv += n;
  }
  /** core finish() with a cheaper sky-visibility bake: ground vertices of the material named `flatName` outside the yard (|x| > fx or |z| > fz) get visibility 1 without the 64-sample horizon
   *  scan (the far terrain rings are ~40k vertices whose scan re-evaluates the hill height function 64 times each: ~8 s of the build) */
  finish(visFn = null) {
    const flatName = 'dirt', fx = 62, fz = 52, vc = new Map();   // sky visibility is cached per 0.6 m cell and normal octant: dense hand-built geometry shares the samples
    for (const a of this.map.values()) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(a.P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(a.N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(a.U, 2));
      g.setIndex(a.nv > 65535 ? new THREE.Uint32BufferAttribute(a.I, 1) : new THREE.Uint16BufferAttribute(a.I, 1));
      if (visFn) { const nv = a.nv, va = new Uint8Array(nv * 2), flat = a.mat.name === flatName; for (let i = 0; i < nv; i++) { const x = a.P[i * 3], z = a.P[i * 3 + 2]; va[i * 2] = 255; if (flat && (x > fx || x < -fx || z > fz || z < -fz)) { va[i * 2 + 1] = 255; continue; } const y = a.P[i * 3 + 1], nx = a.N[i * 3], ny = a.N[i * 3 + 1], nz = a.N[i * 3 + 2]; const ix = Math.floor(x / 0.6) + 2048, iy = Math.floor(y / 0.6) + 2048, iz = Math.floor(z / 0.6) + 2048, nk = (nx > 0.5 ? 1 : nx < -0.5 ? 2 : 0) + 3 * (ny > 0.5 ? 1 : ny < -0.5 ? 2 : 0) + 9 * (nz > 0.5 ? 1 : nz < -0.5 ? 2 : 0), key = ((ix * 4096 + iy) * 4096 + iz) * 32 + nk; let q = vc.get(key); if (q === undefined) { q = Math.round(visFn(x, y, z, nx, ny, nz) * 255); vc.set(key, q); } va[i * 2 + 1] = q; } g.setAttribute('aVis', new THREE.BufferAttribute(va, 2, true)); }
      g.computeBoundingSphere(); g.computeBoundingBox();
      const m = new THREE.Mesh(g, visFn ? visVariant(a.mat) : a.mat); m.castShadow = a.cast; m.receiveShadow = a.recv; m.matrixAutoUpdate = false; m.updateMatrix();
      this.parent.add(m); this.meshes.push(m);
    }
    this._proxyFinish(); this.map.clear(); return this.meshes;
  }
}
