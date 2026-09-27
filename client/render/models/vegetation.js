// Procedural vegetation for instanced rendering. Every part geometry is in the variant's local space
// (origin = base of trunk, y up). Foliage materials sway with `vegetationTime` (update .value each frame).
import * as THREE from 'three';
import { MAT, MeshBuilder, makeRng, vegetationTime } from '../materials.js';

export { vegetationTime };

const V3 = THREE.Vector3;
const UP = new V3(0, 1, 0);

// ------------------------------------------------------------------ card soup helper (custom normals + colours)
class Soup {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
  }
  get n() {
    return this.pos.length / 3;
  }
  v(p, n, u, v, c) {
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    this.col.push(c[0], c[1], c[2]);
    return this.n - 1;
  }
  tri(a, b, c) {
    this.idx.push(a, b, c);
  }
  quad(a, b, c, d) {
    // a-b bottom edge, d-c top edge (ccw from front)
    this.idx.push(a, b, c, a, c, d);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

/** outward+up "volume" normal relative to a crown axis point */
function puffNormal(p, cx, cz, cy, upBias = 0.7) {
  const n = new V3(p.x - cx, (p.y - cy) * 0.35, p.z - cz);
  if (n.lengthSq() < 1e-6) n.set(0, 1, 0);
  n.normalize();
  n.y += upBias;
  return n.normalize();
}

/**
 * drooping folded branch card from trunk point `base` in horizontal direction `ang`.
 * rows along the branch (v 0->1), 3 verts across (V fold, edges hang down).
 */
function branchCard(S, base, ang, len, width, elev, droop, fold, tint, ao, rows = 4, uMax = 0.5, roll = 0) {
  const h = new V3(Math.cos(ang), 0, Math.sin(ang));
  const s0 = new V3(-Math.sin(ang), 0, Math.cos(ang));
  // roll the card around its axis so cards are never all edge-on
  const s = s0.clone().multiplyScalar(Math.cos(roll)).addScaledVector(UP, Math.sin(roll));
  const up = UP.clone().multiplyScalar(Math.cos(roll)).addScaledVector(s0, -Math.sin(roll));
  const ids = [];
  for (let r = 0; r < rows; r++) {
    const t = r / (rows - 1);
    const d = t * len;
    const c = base.clone().addScaledVector(h, d * Math.cos(elev)).addScaledVector(UP, d * Math.sin(elev) - droop * t * t * len);
    const w = (width / 2) * (0.5 + 0.5 * Math.min(1, t * 2.2));
    const f = fold * w * (0.4 + 0.6 * t);
    const row = [];
    for (let k = 0; k < 3; k++) {
      const side = k - 1;
      const p = c.clone().addScaledVector(s, side * w).addScaledVector(up, -Math.abs(side) * f);
      const n = puffNormal(p, 0, 0, base.y - 1.2, 0.55 + 0.3 * t);
      const k2 = ao(t, p.y);
      row.push(S.v(p, n, (k / 2) * uMax, t, [tint[0] * k2, tint[1] * k2, tint[2] * k2]));
    }
    ids.push(row);
  }
  for (let r = 0; r < rows - 1; r++) {
    const A = ids[r], B = ids[r + 1];
    S.quad(A[0], A[1], B[1], B[0]);
    S.quad(A[1], A[2], B[2], B[1]);
  }
}

/** vertical crossed cards (billboard-ish) of given size at position */
function crossCards(S, center, w, h, n, rot, tint, aoBottom = 0.5, normalMode = 'puff', crownCenter = null, u0 = 0, u1 = 1) {
  for (let k = 0; k < n; k++) {
    const a = rot + (k * Math.PI) / n;
    const dx = Math.cos(a) * (w / 2), dz = Math.sin(a) * (w / 2);
    const pts = [new V3(center.x - dx, center.y, center.z - dz), new V3(center.x + dx, center.y, center.z + dz), new V3(center.x + dx, center.y + h, center.z + dz), new V3(center.x - dx, center.y + h, center.z - dz)];
    const uvs = [[u0, 0], [u1, 0], [u1, 1], [u0, 1]];
    const ids = pts.map((p, i) => {
      let nn;
      if (normalMode === 'up') nn = new V3(0, 1, 0);
      else {
        const cc = crownCenter || center;
        nn = puffNormal(p, cc.x, cc.z, cc.y - h * 0.3, 0.5);
      }
      const kk = i < 2 ? aoBottom : 1;
      return S.v(p, nn, uvs[i][0], uvs[i][1], [tint[0] * kk, tint[1] * kk, tint[2] * kk]);
    });
    S.quad(ids[0], ids[1], ids[2], ids[3]);
  }
}

// ------------------------------------------------------------------ conifers
function conifer(opts) {
  const { name, seed, H, r0, crownStart, whorls, perWhorl, maxLen, minLen = 0.5, elev0, elev1, droop0, droop1, fold = 0.35, tint, bareDead = 0, lenPow = 1.0, gapChance = 0, flatTop = 0 } = opts;
  const rng = makeRng(seed);
  const b = new MeshBuilder(seed, { ao: false });
  // trunk: slightly bent tapered column with root flare
  const lean = [(rng() - 0.5) * 0.25, (rng() - 0.5) * 0.25];
  const trunkPts = [];
  const segs = 4;
  for (let k = 0; k <= segs; k++) {
    const t = k / segs;
    trunkPts.push([lean[0] * t * t + (rng() - 0.5) * 0.08 * (k && k < segs ? 1 : 0), t * H, lean[1] * t * t + (rng() - 0.5) * 0.08 * (k && k < segs ? 1 : 0)]);
  }
  const trunkR = (t) => r0 * Math.pow(1 - t, 1.25) + 0.025;
  for (let k = 0; k < segs; k++) {
    const t0 = k / segs, t1 = (k + 1) / segs;
    b.cylBetween('bark', trunkPts[k], trunkPts[k + 1], trunkR(t1), trunkR(t0), 7, { open: true });
  }
  // root flare
  b.cyl('bark', r0 * 1.02, r0 * 1.55, 0.6, 7, { p: [0, 0.22, 0], open: true });
  const axisAt = (y) => {
    const t = Math.min(1, Math.max(0, y / H));
    const f = t * segs, k = Math.min(segs - 1, Math.floor(f)), u = f - k;
    const a = trunkPts[k], c = trunkPts[k + 1];
    return new V3(a[0] + (c[0] - a[0]) * u, y, a[2] + (c[2] - a[2]) * u);
  };
  // dead lower twigs (spruce look)
  for (let k = 0; k < bareDead; k++) {
    const y = 1.0 + rng() * (crownStart * H - 0.8);
    const a = rng() * Math.PI * 2;
    const p = axisAt(y);
    const L = 0.5 + rng() * 1.1;
    b.cylBetween('bark_dead', [p.x, y, p.z], [p.x + Math.cos(a) * L, y - L * (0.1 + rng() * 0.3), p.z + Math.sin(a) * L], 0.008, 0.035, 3, { open: true });
  }
  const parts = b.build();
  // foliage
  const S = new Soup();
  const y0 = crownStart * H, y1 = H - 0.9;
  // dark silhouette core (crossed quads, right half of the pine atlas) gives the crown mass
  const coreW = maxLen * 1.25;
  crossCards(S, new V3(0, y0 - 0.4, 0), coreW, H - y0 + 0.2, 3, rng() * 3, [tint[0] * 0.55, tint[1] * 0.55, tint[2] * 0.55], 0.5, 'puff', new V3(0, (y0 + H) / 2, 0), 0.5, 1);
  for (let w = 0; w < whorls; w++) {
    const t = w / (whorls - 1);
    const y = y0 + (y1 - y0) * Math.pow(t, 0.92) + (rng() - 0.5) * 0.25;
    const tt = Math.min(1, Math.max(0, (y - y0) / (y1 - y0)));
    let L = minLen + (maxLen - minLen) * Math.pow(1 - tt, lenPow);
    if (tt < 0.08) L *= 0.85;
    const nb = perWhorl + (rng() < 0.5 ? 1 : 0) - (tt > 0.85 ? 1 : 0);
    const a0 = rng() * Math.PI * 2;
    for (let k = 0; k < nb; k++) {
      if (gapChance && rng() < gapChance) continue;
      const ang = a0 + (k / nb) * Math.PI * 2 + (rng() - 0.5) * 0.7;
      const len = L * (0.8 + rng() * 0.35);
      const p = axisAt(y);
      const rr = trunkR(y / H) * 0.6;
      const base = new V3(p.x + Math.cos(ang) * rr, y, p.z + Math.sin(ang) * rr);
      const elev = elev0 + (elev1 - elev0) * tt + (rng() - 0.5) * 0.12;
      const droop = droop0 + (droop1 - droop0) * tt;
      const vary = 0.85 + rng() * 0.3;
      const tn = [tint[0] * vary, tint[1] * vary * (0.95 + rng() * 0.1), tint[2] * vary];
      const roll = (rng() - 0.5) * 1.1;
      branchCard(S, base, ang, len, Math.max(0.8, len * 0.8), elev, droop, fold, tn, (u, py) => (0.4 + 0.6 * Math.pow(u, 0.7)) * (0.65 + 0.35 * Math.min(1, py / H + 0.2)), len > 3 ? 4 : 3, 0.5, roll);
    }
  }
  // top leader + tuft
  const top = axisAt(H - 1.1);
  const tn = [tint[0] * 1.1, tint[1] * 1.1, tint[2]];
  crossCards(S, top, 0.8, 1.6, 2, rng() * 3, tn, 0.6, 'puff', top, 0, 0.5);
  for (let k = 0; k < 3; k++) {
    const ang = rng() * Math.PI * 2;
    branchCard(S, axisAt(H - 1.4 - k * 0.3), ang, 0.9, 0.7, 0.35, 0.1, 0.3, tn, (u) => 0.6 + 0.4 * u, 3);
  }
  parts.push({ name: 'pine', material: MAT.pine, geometry: S.geometry() });
  return { name, radius: r0 * 1.05, height: H, parts };
}

// ------------------------------------------------------------------ dead / bare trees
function bareTree(opts) {
  const { name, seed, H, r0, mat = 'bark_dead', spread = 0.6, depthMax = 3, children = [2, 3], twist = 0.35, leafy = null, broken = 0.2 } = opts;
  const rng = makeRng(seed);
  const b = new MeshBuilder(seed, { ao: false });
  const tips = [];
  const grow = (p, dir, len, rad, depth) => {
    const n = depth === 0 ? 5 : depth === 1 ? 3 : 2;
    let cur = p.clone();
    let r = rad;
    const d = dir.clone();
    const bend = new V3((rng() - 0.5), 0, (rng() - 0.5)).multiplyScalar(twist * (depth ? 1.5 : 0.12));
    for (let k = 0; k < n; k++) {
      // gnarled: persistent curl + jitter, thin branches sag under gravity
      const jit = depth ? twist : twist * 0.35;
      d.x += bend.x + (rng() - 0.5) * jit;
      d.z += bend.z + (rng() - 0.5) * jit;
      d.y += depth >= 2 ? -0.16 : depth === 1 ? -0.02 : 0.05;
      d.normalize();
      const nxt = cur.clone().addScaledVector(d, len / n);
      const r2 = r * (depth === 0 ? 0.86 : 0.74);
      b.cylBetween(mat, cur.toArray(), nxt.toArray(), r2, r, depth === 0 ? 7 : depth === 1 ? 5 : 3, { open: true });
      if (k < n - 1 && depth < depthMax && rng() < (depth === 0 ? (k >= 2 ? 0.7 : 0) : 0.35)) {
        const a = rng() * Math.PI * 2;
        const sd = new V3(Math.cos(a), depth === 0 ? 0.25 + rng() * 0.5 : (rng() - 0.4) * 0.8, Math.sin(a)).normalize();
        grow(nxt.clone(), sd, len * (depth === 0 ? 0.45 + rng() * 0.3 : 0.5), r2 * 0.62, depth + 1);
      }
      cur = nxt;
      r = r2;
    }
    if (depth >= depthMax || r < 0.012 || (depth > 0 && rng() < broken * 0.5)) {
      tips.push({ p: cur, d, r });
      return;
    }
    const nc = depth >= 2 ? 2 : children[0] + Math.floor(rng() * (children[1] - children[0] + 1));
    for (let c = 0; c < nc; c++) {
      const a = (c / nc) * Math.PI * 2 + rng() * 1.5;
      const nd = d.clone().add(new V3(Math.cos(a) * spread, (rng() - 0.3) * spread * 0.6, Math.sin(a) * spread)).normalize();
      grow(cur.clone(), nd, len * (0.62 + rng() * 0.2), r * (depth === 0 ? 0.8 : 0.72), depth + 1);
    }
    if (depth >= 1) tips.push({ p: cur, d, r });
  };
  grow(new V3(0, 0, 0), new V3((rng() - 0.5) * 0.1, 1, (rng() - 0.5) * 0.1).normalize(), H * 0.55, r0, 0);
  b.cyl(mat, r0 * 0.95, r0 * 1.5, 0.5, 7, { p: [0, 0.2, 0], open: true });
  const parts = b.build();
  let top = 0;
  for (const p of parts) top = Math.max(top, p.geometry.boundingBox.max.y);
  if (leafy) {
    const S = new Soup();
    const cc = new V3(0, top * 0.72, 0);
    for (const tp of tips) {
      if (rng() < leafy.skip) continue;
      const sz = leafy.size * (0.7 + rng() * 0.6);
      crossCards(S, new V3(tp.p.x, tp.p.y - sz * 0.45, tp.p.z), sz, sz, 2, rng() * 3, leafy.tint, 0.55, 'puff', cc);
    }
    parts.push({ name: leafy.mat, material: MAT[leafy.mat], geometry: S.geometry() });
  }
  return { name, radius: r0, height: Math.round(top * 10) / 10, parts };
}

/** controlled gnarled dead tree: trunk + thick twisting limbs + secondary/tertiary branches */
function deadTree({ name, seed, trunkH, r0, limbs = 4, limbLen = [3, 5], limbUp = [0.5, 1.0], sec = 2, tert = 1, brokenTop = false, stubs = 3 }) {
  const rng = makeRng(seed);
  const b = new MeshBuilder(seed, { ao: false });
  const mat = 'bark_dead';
  const bend = (dir, amt, down = 0) => {
    dir.x += (rng() - 0.5) * amt;
    dir.z += (rng() - 0.5) * amt;
    dir.y += (rng() - 0.5) * amt * 0.6 - down;
    return dir.normalize();
  };
  const branch = (p0, dir, len, rad, segs, sides, down, onSeg) => {
    let cur = p0.clone(), r = rad;
    const d = dir.clone();
    const curl = new V3(rng() - 0.5, 0, rng() - 0.5).multiplyScalar(0.35);
    for (let k = 0; k < segs; k++) {
      d.add(curl);
      bend(d, 0.45, down);
      const nxt = cur.clone().addScaledVector(d, len / segs);
      const r2 = Math.max(0.006, r * 0.72);
      b.cylBetween(mat, cur.toArray(), nxt.toArray(), r2, r, sides, { open: true });
      if (onSeg) onSeg(nxt, d.clone(), r2, k);
      cur = nxt;
      r = r2;
    }
    return cur;
  };
  // trunk
  let cur = new V3(0, 0, 0), r = r0;
  const td = new V3((rng() - 0.5) * 0.12, 1, (rng() - 0.5) * 0.12).normalize();
  const tsegs = 4;
  for (let k = 0; k < tsegs; k++) {
    bend(td, 0.18);
    td.y = Math.max(td.y, 0.9);
    td.normalize();
    const nxt = cur.clone().addScaledVector(td, trunkH / tsegs);
    const r2 = r * 0.88;
    b.cylBetween(mat, cur.toArray(), nxt.toArray(), r2, r, 7, { open: true });
    if (k >= 1 && stubs > 0 && rng() < 0.7) {
      const a = rng() * Math.PI * 2;
      branch(nxt.clone(), new V3(Math.cos(a), 0.3, Math.sin(a)), 0.5 + rng() * 0.9, r2 * 0.35, 1, 4, 0.1);
    }
    cur = nxt;
    r = r2;
  }
  b.cyl(mat, r0 * 0.98, r0 * 1.6, 0.55, 7, { p: [0, 0.22, 0], open: true });
  if (brokenTop) {
    for (let k = 0; k < 3; k++) {
      const a = rng() * Math.PI * 2;
      b.cylBetween(mat, [cur.x + Math.cos(a) * r * 0.4, cur.y - 0.1, cur.z + Math.sin(a) * r * 0.4], [cur.x + Math.cos(a) * r * 0.5, cur.y + 0.4 + rng() * 0.7, cur.z + Math.sin(a) * r * 0.5], 0.01, r * 0.35, 3, { open: true });
    }
  }
  // limbs
  const a0 = rng() * Math.PI * 2;
  for (let l = 0; l < limbs; l++) {
    const a = a0 + (l / limbs) * Math.PI * 2 + (rng() - 0.5) * 0.8;
    const up = limbUp[0] + rng() * (limbUp[1] - limbUp[0]);
    const start = brokenTop ? cur.clone().multiplyScalar(0.55 + l * 0.1) : cur.clone().add(new V3(0, -rng() * 0.6, 0));
    const len = limbLen[0] + rng() * (limbLen[1] - limbLen[0]);
    branch(start, new V3(Math.cos(a), up, Math.sin(a)), len, r * 0.85, 3, 5, 0.02, (pt, d, rr, k) => {
      for (let q = 0; q < sec; q++) {
        if (rng() < 0.3) continue;
        const sa = Math.atan2(d.z, d.x) + (rng() < 0.5 ? -1 : 1) * (0.6 + rng() * 0.8);
        branch(pt, new V3(Math.cos(sa), (rng() - 0.3) * 0.9, Math.sin(sa)), len * (0.35 + rng() * 0.25), rr * 0.6, 2, 4, 0.12, (pt2, d2, rr2) => {
          for (let t = 0; t < tert; t++) {
            const ta = Math.atan2(d2.z, d2.x) + (rng() - 0.5) * 2.2;
            branch(pt2, new V3(Math.cos(ta), (rng() - 0.5) * 1.2, Math.sin(ta)), 0.5 + rng() * 0.8, rr2 * 0.6, 1, 3, 0.2);
          }
        });
      }
    });
  }
  const parts = b.build();
  let top = 0;
  for (const p of parts) top = Math.max(top, p.geometry.boundingBox.max.y);
  return { name, radius: r0, height: Math.round(top * 10) / 10, parts };
}

function burntSnag(seed) {
  const rng = makeRng(seed);
  const b = new MeshBuilder(seed, { ao: false });
  const H = 6.5, r0 = 0.46;
  // jagged broken trunk top
  const g = new THREE.CylinderGeometry(r0 * 0.7, r0, H, 8, 3, true);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > H / 2 - 0.01) pos.setY(i, y - rng() * 1.6);
    const x = pos.getX(i), z = pos.getZ(i);
    const k = 1 + (rng() - 0.5) * 0.12;
    pos.setX(i, x * k);
    pos.setZ(i, z * k);
  }
  g.translate(0, H / 2, 0);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * 2 * r0, uv.getY(i) * H);
  b.add('charred', g);
  // splinter shards at the top
  for (let k = 0; k < 4; k++) {
    const a = rng() * Math.PI * 2;
    const x = Math.cos(a) * r0 * 0.5, z = Math.sin(a) * r0 * 0.5;
    b.cylBetween('bark_dead', [x, H - 1.6, z], [x * 1.3, H - 0.4 + rng() * 0.9, z * 1.3], 0.02, 0.12, 3, { open: true });
  }
  // broken branch stubs
  for (let k = 0; k < 4; k++) {
    const a = rng() * Math.PI * 2, y = 2 + rng() * 3.2, L = 0.4 + rng() * 1.1;
    b.cylBetween('charred', [Math.cos(a) * 0.3, y, Math.sin(a) * 0.3], [Math.cos(a) * L, y + L * 0.5, Math.sin(a) * L], 0.02, 0.08, 4, { open: true });
  }
  b.cyl('charred', r0 * 0.98, r0 * 1.6, 0.6, 8, { p: [0, 0.22, 0], open: true });
  return { name: 'burnt_snag', radius: r0, height: H, parts: b.build() };
}

let _trees = null;
export function getTreeVariants() {
  if (_trees) return _trees;
  _trees = [
    conifer({
      name: 'spruce_tall', seed: 11, H: 22, r0: 0.42, crownStart: 0.08, whorls: 11, perWhorl: 5, maxLen: 4.4, minLen: 0.6,
      elev0: -0.28, elev1: 0.3, droop0: 0.42, droop1: 0.12, fold: 0.42, tint: [0.78, 0.86, 0.8], bareDead: 5, lenPow: 1.05,
    }),
    conifer({
      name: 'spruce_droop', seed: 23, H: 17.5, r0: 0.36, crownStart: 0.06, whorls: 13, perWhorl: 4, maxLen: 3.5, minLen: 0.5,
      elev0: -0.42, elev1: 0.15, droop0: 0.55, droop1: 0.2, fold: 0.5, tint: [0.7, 0.8, 0.74], bareDead: 3, lenPow: 1.2,
    }),
    conifer({
      name: 'fir_old', seed: 37, H: 24, r0: 0.5, crownStart: 0.34, whorls: 11, perWhorl: 5, maxLen: 3.8, minLen: 1.0,
      elev0: -0.12, elev1: 0.25, droop0: 0.3, droop1: 0.1, fold: 0.35, tint: [0.82, 0.86, 0.74], bareDead: 12, lenPow: 0.7, gapChance: 0.22,
    }),
    deadTree({ name: 'dead_oak', seed: 41, trunkH: 4.6, r0: 0.5, limbs: 4, limbLen: [3.2, 5.2], limbUp: [0.2, 0.85], sec: 2, tert: 1 }),
    deadTree({ name: 'dead_tall', seed: 53, trunkH: 13, r0: 0.34, limbs: 3, limbLen: [1.6, 3.2], limbUp: [0.1, 0.7], sec: 1, tert: 1, brokenTop: true, stubs: 4 }),
    bareTree({
      name: 'birch', seed: 67, H: 14, r0: 0.2, mat: 'bark_birch', spread: 0.45, depthMax: 3, children: [2, 2], twist: 0.22, broken: 0.1,
      leafy: { mat: 'leaves', size: 3.2, skip: 0.35, tint: [1, 0.95, 0.85] },
    }),
    burntSnag(79),
  ];
  // birch radius hint slightly larger than trunk for collision
  _trees[5].radius = 0.25;
  return _trees;
}

// ------------------------------------------------------------------ bushes
let _bushes = null;
export function getBushVariants() {
  if (_bushes) return _bushes;
  const rng = makeRng(101);
  // 1) leafy shrub: crossed vertical cards + outward-leaning cards
  const shrub = new Soup();
  const tint = [0.9, 0.95, 0.85];
  crossCards(shrub, new V3(0, 0, 0), 1.6, 1.25, 3, 0.2, tint, 0.45, 'puff', new V3(0, 0.3, 0));
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + rng();
    const c = new V3(Math.cos(a) * 0.35, 0, Math.sin(a) * 0.35);
    const w = 1.1, h = 0.9;
    const dx = -Math.sin(a) * (w / 2), dz = Math.cos(a) * (w / 2);
    const lean = 0.35;
    const pts = [new V3(c.x - dx, 0, c.z - dz), new V3(c.x + dx, 0, c.z + dz), new V3(c.x + dx + Math.cos(a) * lean, h, c.z + dz + Math.sin(a) * lean), new V3(c.x - dx + Math.cos(a) * lean, h, c.z - dz + Math.sin(a) * lean)];
    const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const ids = pts.map((p, i) => shrub.v(p, puffNormal(p, 0, 0, 0, 0.6), uv[i][0], uv[i][1], i < 2 ? [0.4, 0.42, 0.38] : [0.85, 0.9, 0.8]));
    shrub.quad(ids[0], ids[1], ids[2], ids[3]);
  }
  // 2) fern clump: arching fronds
  const fern = new Soup();
  const nf = 9;
  for (let k = 0; k < nf; k++) {
    const a = (k / nf) * Math.PI * 2 + (rng() - 0.5) * 0.5;
    const L = 0.85 + rng() * 0.45;
    const W = 0.3;
    const h = new V3(Math.cos(a), 0, Math.sin(a)), s = new V3(-Math.sin(a), 0, Math.cos(a));
    const rows = 4, ids = [];
    const rise = 0.9 + rng() * 0.5;
    for (let r = 0; r < rows; r++) {
      const t = r / (rows - 1);
      const c = new V3(0, 0.02, 0).addScaledVector(h, t * L * 0.85).addScaledVector(UP, Math.sin(t * Math.PI * 0.85) * rise * L * 0.55 - t * t * 0.2);
      const row = [];
      for (let q = 0; q < 3; q++) {
        const sd = q - 1;
        const p = c.clone().addScaledVector(s, (sd * W) / 2).addScaledVector(UP, -Math.abs(sd) * W * 0.18);
        const kk = 0.45 + 0.55 * t;
        row.push(fern.v(p, puffNormal(p, 0, 0, -0.3, 0.8), q / 2, t, [0.9 * kk, 0.95 * kk, 0.85 * kk]));
      }
      ids.push(row);
    }
    for (let r = 0; r < rows - 1; r++) {
      fern.quad(ids[r][0], ids[r][1], ids[r + 1][1], ids[r + 1][0]);
      fern.quad(ids[r][1], ids[r][2], ids[r + 1][2], ids[r + 1][1]);
    }
  }
  // 3) dry thicket: dead brown shrub cards + a few bare twigs
  const dry = new Soup();
  crossCards(dry, new V3(0, 0, 0), 1.9, 1.0, 3, 1.1, [0.95, 0.72, 0.52], 0.45, 'puff', new V3(0, 0.2, 0));
  crossCards(dry, new V3(0.4, 0, 0.3), 1.0, 0.7, 2, 0.4, [0.85, 0.7, 0.5], 0.45, 'puff', new V3(0, 0.2, 0));
  const tw = new MeshBuilder(7, { ao: false });
  for (let k = 0; k < 6; k++) {
    const a = rng() * Math.PI * 2;
    tw.cylBetween('bark_dead', [0, 0, 0], [Math.cos(a) * 0.7, 0.9 + rng() * 0.5, Math.sin(a) * 0.7], 0.006, 0.025, 3, { open: true });
  }
  _bushes = [
    { name: 'shrub', parts: [{ name: 'bush', material: MAT.bush, geometry: shrub.geometry() }] },
    { name: 'fern', parts: [{ name: 'fern', material: MAT.fern, geometry: fern.geometry() }] },
    { name: 'thicket', parts: [{ name: 'bush', material: MAT.bush, geometry: dry.geometry() }, ...tw.build()] },
  ];
  return _bushes;
}

// ------------------------------------------------------------------ rocks
let _rocks = null;
export function getRockVariants() {
  if (_rocks) return _rocks;
  const mk = (name, fn) => {
    const b = new MeshBuilder(1, { ao: false });
    fn(b);
    const parts = b.build();
    let rad = 0;
    for (const p of parts) {
      const pos = p.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) if (pos.getY(i) < 1.0) rad = Math.max(rad, Math.hypot(pos.getX(i), pos.getZ(i)));
    }
    return { name, radius: Math.round(rad * 0.85 * 100) / 100, parts };
  };
  _rocks = [
    mk('boulder', (b) => b.rock('rock', 1.25, { detail: 2, seed: 3, scale: [1.2, 0.85, 1.0], sink: 0.3, p: [0, 0.3, 0] })),
    mk('slab', (b) => b.rock('rock', 1.4, { detail: 1, seed: 9, scale: [1.5, 0.42, 1.05], jag: 0.35, sink: 0.25, p: [0, 0.12, 0] })),
    mk('cluster', (b) => {
      b.rock('rock', 0.75, { detail: 1, seed: 21, scale: [1.1, 0.9, 1], p: [0, 0.2, 0] });
      b.rock('rock', 0.5, { detail: 1, seed: 22, scale: [1, 0.8, 1.2], p: [0.85, 0.1, 0.35] });
      b.rock('rock', 0.36, { detail: 1, seed: 23, scale: [1.2, 0.7, 1], p: [-0.55, 0.05, 0.6] });
    }),
  ];
  return _rocks;
}

// ------------------------------------------------------------------ grass
let _grass = null;
export function getGrassPatch() {
  if (_grass) return _grass;
  const rng = makeRng(131);
  const S = new Soup();
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI + rng() * 0.4;
    const w = 0.5 + rng() * 0.25, h = 0.42 + rng() * 0.22;
    const c = new V3((rng() - 0.5) * 0.2, 0, (rng() - 0.5) * 0.2);
    const dx = Math.cos(a) * (w / 2), dz = Math.sin(a) * (w / 2);
    const lean = new V3((rng() - 0.5) * 0.12, 0, (rng() - 0.5) * 0.12);
    const pts = [new V3(c.x - dx, 0, c.z - dz), new V3(c.x + dx, 0, c.z + dz), new V3(c.x + dx + lean.x, h, c.z + dz + lean.z), new V3(c.x - dx + lean.x, h, c.z - dz + lean.z)];
    const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const ids = pts.map((p, i) => S.v(p, new V3(0, 1, 0), uv[i][0], uv[i][1], i < 2 ? [0.45, 0.45, 0.4] : [0.95, 0.95, 0.9]));
    S.quad(ids[0], ids[1], ids[2], ids[3]);
  }
  const material = MAT.grass;
  _grass = { geometry: S.geometry(), material };
  return _grass;
}
