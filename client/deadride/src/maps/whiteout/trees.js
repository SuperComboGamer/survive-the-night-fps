// Real conifers (Norway spruce / silver fir / Swiss stone pine / snags) built branch by branch.
// Reference: Picea abies at 1500-2200 m: 8-22 m tall, straight monopodial trunk with a buttressed root flare (DBH 0.25-0.6 m), branches in whorls of 4-7 that leave the trunk
// almost horizontally, arch out and then DROOP with upturned tips, branchlets hanging in vertical "curtains" below every bough; lower whorls die and stay as grey stubs;
// crowns are conical with snow lying on top of every bough and bending them down. Each near tree is ~2.5-3 k triangles (trunk 8 sides x 9 rings, ~55 boughs of mat +
// curtain + side sprigs); mid LOD ~0.7 k (boughs as mat + curtain only), far LOD is the old 3-tier cone. All vertex-coloured (needle green / snow / shade / bark), one material.
import * as THREE from 'three';
import { makeRng } from '../../core/util.js';
import { pineGeometry } from './common.js';

const C = (h) => new THREE.Color(h);
const NEEDLE = [C(0x0d1f16), C(0x143024), C(0x1c4030), C(0x28563a)], DEAD = C(0x3a332c), SNOW = C(0xeaf1fb), SNOW2 = C(0xc6d5ea), BARK = [C(0x2b2018), C(0x3a2e24), C(0x1a140f)], SHADE = C(0x08120d);
const _cache = new Map();

/** o: {h, seed, whorls, per (boughs per whorl), snow 0..1, droop, lean, kind 'spruce'|'fir'|'pine'|'snag'|'broken', lod 0|1} */
export function conifer({ h = 11, seed = 1, snow = 0.7, droop = 0.34, lean = 0.05, kind = 'spruce', lod = 0 } = {}) {
  const key = `${h}|${seed}|${snow}|${droop}|${lean}|${kind}|${lod}`; if (_cache.has(key)) return _cache.get(key);
  const rng = makeRng(seed * 977 + 11), P = [], N = [], Cc = [], U = [], I = []; let nv = 0;
  const tri = (a, b, c, ca, cb, cc, n) => {              // one triangle, per-vertex colours; n = optional shared normal (else face normal)
    let nx, ny, nz; if (n) { nx = n[0]; ny = n[1]; nz = n[2]; } else { const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]; nx = uy * vz - uz * vy; ny = uz * vx - ux * vz; nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l; }
    P.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); for (let i = 0; i < 3; i++) N.push(nx, ny, nz); Cc.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b, cc.r, cc.g, cc.b); U.push(a[0], a[2], b[0], b[2], c[0], c[2]); I.push(nv, nv + 1, nv + 2); nv += 3;
  };
  const quad = (a, b, c, d, ca, cb, cc, cd, n) => { tri(a, b, c, ca, cb, cc, n); tri(a, c, d, ca, cc, cd, n); };
  const mix = (a, b, t) => a.clone().lerp(b, t);
  const trunkR0 = kind === 'pine' ? 0.2 + 0.024 * h : 0.14 + 0.018 * h; const bend = (y) => [lean * h * Math.pow(y / h, 2) + Math.sin(y * 0.9 + seed) * 0.03, Math.cos(y * 0.7 + seed * 2) * 0.03];
  // ---- trunk: 10 sides x 14 rings, radial smooth normals, buttressed flare, vertical bark furrows in the vertex colours
  const rings = lod === 0 ? 14 : 6, sides = lod === 0 ? 10 : 6; const ringsPts = [];
  for (let r = 0; r <= rings; r++) {
    const y = h * 0.965 * Math.pow(r / rings, 1.35), tt = y / h; const rad = trunkR0 * Math.pow(1 - tt * 0.9, 1.1) * (1 + 1.5 * Math.exp(-y * 2.4)); const [bx, bz] = bend(y); const ring = [];
    for (let s = 0; s < sides; s++) { const a = s / sides * 6.2832; const wob = 1 + (0.10 * Math.sin(a * 3 + y * 1.7 + seed) + 0.05 * Math.sin(a * 7 + y * 3.1)) * Math.exp(-y * 0.55); ring.push({ p: [bx + Math.cos(a) * rad * wob, y, bz + Math.sin(a) * rad * wob], n: [Math.cos(a), 0.12, Math.sin(a)], a, y }); }
    ringsPts.push(ring);
  }
  const barkAt = (v) => { const fur = 0.5 + 0.5 * Math.sin(v.a * 9 + Math.sin(v.y * 2.3 + v.a * 2) * 1.3); const base = mix(BARK[2], BARK[0], fur * fur); return mix(base, BARK[1], 0.12 + 0.35 * (0.5 + 0.5 * Math.sin(v.y * 5 + v.a * 3))); };
  for (let r = 0; r < rings; r++) for (let s = 0; s < sides; s++) {
    const s1 = (s + 1) % sides, a = ringsPts[r][s], b = ringsPts[r][s1], c = ringsPts[r + 1][s1], d = ringsPts[r + 1][s];
    const sh = (v) => mix(barkAt(v), SHADE, 0.15 * Math.max(0, 1 - v.y / 2.5)); const vt = (v) => [v.p, v.n];
    const tv = (p, q, w, ca, cb, cc) => { P.push(...p.p, ...q.p, ...w.p); N.push(...p.n, ...q.n, ...w.n); Cc.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b, cc.r, cc.g, cc.b); U.push(p.p[0], p.p[2], q.p[0], q.p[2], w.p[0], w.p[2]); I.push(nv, nv + 1, nv + 2); nv += 3; };
    void vt; tv(a, b, c, sh(a), sh(b), sh(c)); tv(a, c, d, sh(a), sh(c), sh(d));
  }
  if (lod === 0) for (let s = 0; s < 5; s++) { const a = s / 5 * 6.2832 + rng(), rr = trunkR0 * 1.1, L = 0.5 + rng() * 0.5;                          // surface roots: flat wedges running out into the snow
    const ax = Math.cos(a), az = Math.sin(a); tri([ax * rr * 0.6, 0.35, az * rr * 0.6], [ax * (rr + L) - az * 0.09, -0.02, az * (rr + L) + ax * 0.09], [ax * (rr + L) + az * 0.09, -0.02, az * (rr + L) - ax * 0.09], BARK[1], BARK[2], BARK[2]); }
  // ---- crown
  const crownTop = kind === 'snag' ? 0 : h * 0.97, y0 = kind === 'pine' ? h * 0.42 : h * 0.09, whorlCount = kind === 'snag' ? 4 : Math.max(5, Math.round((crownTop - y0) / (kind === 'fir' ? 0.62 : 0.78) * (lod ? 0.55 : 1)));
  const boughsPer = kind === 'fir' ? 7 : kind === 'pine' ? 5 : 6;
  const bough = (ox, oy, oz, ang, L, dr, tt, dead, snowK) => {
    const ca = Math.cos(ang), sa = Math.sin(ang), nseg = lod ? 3 : 4; const pts = [];
    for (let i = 0; i <= nseg; i++) { const t = i / nseg; const out = L * t, drop = -dr * L * (t * t * (0.9 + 0.5 * t) - 0.55 * Math.pow(t, 5) * (kind === 'pine' ? 0.1 : 1)); pts.push([ox + ca * out, oy + drop + 0.25 * L * t * (1 - t) * 0.4, oz + sa * out]); }   // arch, droop, upturned tip
    const sx = -sa, sz = ca; const col = dead ? DEAD : NEEDLE[(rng() * NEEDLE.length) | 0]; const sn = mix(SNOW, SNOW2, rng() * 0.6); const stem = dead ? DEAD : BARK[1];
    // the bough's spine: a thin ribbon (dark) with a snow cap lying along it
    for (let i = 0; i < nseg; i++) { const p0 = pts[i], p1 = pts[i + 1], w0 = 0.025 + 0.02 * (1 - i / nseg), w1 = 0.02 + 0.02 * (1 - (i + 1) / nseg);
      quad([p0[0] - sx * w0, p0[1], p0[2] - sz * w0], [p0[0] + sx * w0, p0[1], p0[2] + sz * w0], [p1[0] + sx * w1, p1[1], p1[2] + sz * w1], [p1[0] - sx * w1, p1[1], p1[2] - sz * w1], stem, stem, stem, stem, [0, 1, 0]);
      if (!dead && snowK > 0.25) { const wc = w0 * (1.8 + 2.5 * snowK), cc = mix(sn, col, 0.1); quad([p0[0] - sx * wc, p0[1] + 0.03, p0[2] - sz * wc], [p0[0] + sx * wc, p0[1] + 0.03, p0[2] + sz * wc], [p1[0] + sx * wc * 0.8, p1[1] + 0.03, p1[2] + sz * wc * 0.8], [p1[0] - sx * wc * 0.8, p1[1] + 0.03, p1[2] - sz * wc * 0.8], cc, cc, cc, cc, [0, 1, 0]); } }
    if (dead) return;
    // feathery sprigs: kite-shaped needle sprays leaving the spine to both sides, drooping; each with a dark hanging curtain below it
    const per = lod ? 1 : 2;
    for (let i = 0; i < nseg; i++) for (let m = 0; m < per; m++) for (const side of [-1, 1]) {
      const t = (i + (m + 0.5 + (rng() - 0.5) * 0.4) / per) / nseg, f0 = Math.floor(t * nseg), fr = t * nseg - f0, pa = pts[Math.min(nseg, f0)], pb = pts[Math.min(nseg, f0 + 1)]; const bx = pa[0] + (pb[0] - pa[0]) * fr, by = pa[1] + (pb[1] - pa[1]) * fr, bz = pa[2] + (pb[2] - pa[2]) * fr;
      const len = L * (0.11 + 0.2 * Math.sin(Math.PI * Math.min(1, t * 0.95 + 0.06))) * (0.75 + 0.5 * rng()) * (1 - 0.25 * tt), wid = len * (0.17 + 0.06 * rng()), yaw = (rng() - 0.5) * 0.7, dx = Math.cos(yaw) * side, dz = Math.sin(yaw);
      const ox2 = sx * dx + ca * dz * 0.7, oz2 = sz * dx + sa * dz * 0.7, ol = Math.hypot(ox2, oz2) || 1, ux = ox2 / ol, uz = oz2 / ol, tipY = by - len * (0.22 + 0.25 * rng()) + len * 0.05;
      const tip = [bx + ux * len, tipY, bz + uz * len], b1 = [bx + ca * wid, by + 0.015, bz + sa * wid], b2 = [bx - ca * wid, by + 0.015, bz - sa * wid], mid = [bx + ux * len * 0.5, by + 0.05 * len, bz + uz * len * 0.5];
      const cb = mix(col, sn, snowK * (0.8 - 0.3 * t)), ct = mix(col, sn, snowK * 0.12), cm = mix(col, sn, snowK * 0.45);
      tri(b1, mid, b2, cb, cm, cb, [ux * 0.2, 0.95, uz * 0.2]); tri(b1, tip, mid, cb, ct, cm, [ux * 0.3, 0.9, uz * 0.3]); tri(mid, tip, b2, cm, ct, cb, [ux * 0.3, 0.9, uz * 0.3]);
      if (!lod && m === 0) { const hg = len * (0.35 + 0.3 * rng()), dk = mix(col, SHADE, 0.5), dk2 = mix(col, SHADE, 0.15); tri([bx, by - 0.02, bz], [bx + ux * len * 0.8, by - 0.02 - hg, bz + uz * len * 0.8], [bx + ca * wid * 1.6 + ux * len * 0.45, by - 0.02 - hg * 0.55, bz + sa * wid * 1.6 + uz * len * 0.45], dk2, dk, dk); }
    }
  };
  for (let w = 0; w < whorlCount; w++) {
    const f = whorlCount === 1 ? 0 : w / (whorlCount - 1), y = y0 + (crownTop - y0) * Math.pow(f, 0.94); const [bx, bz] = bend(y);
    const Lmax = (kind === 'fir' ? 0.26 : kind === 'pine' ? 0.3 : 0.23) * h, L0 = Lmax * Math.pow(1 - f * 0.96, 0.85) * (kind === 'pine' ? 1 : 1) + 0.25; const n = Math.max(3, Math.round(boughsPer * (1 - f * 0.35))); const rot = rng() * 6.2832;
    for (let k = 0; k < n; k++) {
      const ang = rot + (k + (rng() - 0.5) * 0.5) / n * 6.2832, L = L0 * (0.78 + 0.4 * rng()), dead = (kind === 'snag' || (f < 0.12 && rng() < 0.7) || (f < 0.28 && rng() < 0.18)); const dr = droop * (1.0 - 0.35 * f) * (0.8 + 0.4 * rng()) * (dead ? 0.4 : 1);
      const snowK = snow * (0.5 + 0.5 * rng()) * (1 - 0.25 * f); const yy = y + (rng() - 0.5) * 0.3;
      bough(bx + Math.cos(ang) * trunkR0 * 0.5, yy, bz + Math.sin(ang) * trunkR0 * 0.5, ang, dead && kind === 'snag' ? L * 0.4 : L, dr, f, dead, snowK);
    }
  }
  // leader (top spike) with a needle tuft; broken tops are jagged snapped stems
  { const [tx, tz] = bend(crownTop); const topY = kind === 'snag' ? h * 0.8 : crownTop; const r = 0.04; if (kind === 'broken' || kind === 'snag') { for (let s = 0; s < 3; s++) { const a = s / 3 * 6.2832; tri([tx + Math.cos(a) * r * 2, topY - 0.6, tz + Math.sin(a) * r * 2], [tx + Math.cos(a + 2.1) * r * 2, topY - 0.6, tz + Math.sin(a + 2.1) * r * 2], [tx + 0.05, topY + 0.4 + rng() * 0.7, tz], BARK[0], BARK[1], SNOW); } }
    else for (let s = 0; s < 5; s++) { const a = s / 5 * 6.2832 + rng(); tri([tx + Math.cos(a) * 0.14, topY - 0.7, tz + Math.sin(a) * 0.14], [tx + Math.cos(a + 1.3) * 0.14, topY - 0.7, tz + Math.sin(a + 1.3) * 0.14], [tx + Math.cos(a) * 0.02, topY + 0.55, tz + Math.sin(a) * 0.02], NEEDLE[1], NEEDLE[2], mix(NEEDLE[3], SNOW, 0.5)); } }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setIndex(nv > 65535 ? new THREE.Uint32BufferAttribute(I, 1) : new THREE.Uint16BufferAttribute(I, 1)); g.computeBoundingSphere(); g.userData.tris = nv / 3; _cache.set(key, g); return g;
}
/** the four near species + the shared mid / far LOD used by the route forest */
export function forestSet() {
  return {
    near: [conifer({ h: 11, seed: 3, kind: 'spruce', snow: 0.75 }), conifer({ h: 9, seed: 11, kind: 'fir', snow: 0.65, droop: 0.3 }), conifer({ h: 13, seed: 21, kind: 'spruce', snow: 0.8, lean: 0.09, droop: 0.4 }), conifer({ h: 16, seed: 33, kind: 'pine', snow: 0.5, lean: 0.03, droop: 0.26 })],
    mid: conifer({ h: 11, seed: 3, kind: 'spruce', snow: 0.75, lod: 1 }), far: pineGeometry({ h: 11, tiers: 3, snow: 0.7, fans: 4, seed: 3 }), heights: { near: [11, 9, 13, 16], mid: 11 },
    snags: [conifer({ h: 9, seed: 41, kind: 'snag', snow: 0.5 }), conifer({ h: 11, seed: 45, kind: 'broken', snow: 0.6 })],
  };
}
