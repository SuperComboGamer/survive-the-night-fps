// Procedural vegetation for instanced rendering. Every part geometry is in the variant's local space
// (origin = base of trunk, y up) and carries an `aVeg` attribute (see materials.js: occlusion + wind weights).
// Trees come in two LODs: `parts` (near) and `far` (fewer cards / sides), cross-faded by Foliage.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MAT, MeshBuilder, makeRng, vegetationTime, vegFarMaterial, vegStaticMaterial } from '../materials.js';

export { vegetationTime };

const V3 = THREE.Vector3;
const UP = new V3(0, 1, 0);
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// ------------------------------------------------------------------ card soup helper (custom normals + colours)
class Soup {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.col = [];
    this.veg = [];
    this.idx = [];
  }
  get n() {
    return this.pos.length / 3;
  }
  /** g = aVeg (occlusion, branch weight / flex, phase, flutter / dryness) */
  v(p, n, u, v, c, g = [1, 0, 0, 0]) {
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    this.col.push(c[0], c[1], c[2]);
    this.veg.push(g[0], g[1], g[2], g[3]);
    return this.n - 1;
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
    g.setAttribute('aVeg', new THREE.Float32BufferAttribute(this.veg, 4));
    g.setIndex(this.idx);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

/** aVeg for builder parts (trunks / limbs): occlusion from fn(x, y, z), no branch weights */
function withVeg(parts, aoFn) {
  for (const p of parts) {
    const pos = p.geometry.attributes.position;
    const veg = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) veg[i * 4] = aoFn(pos.getX(i), pos.getY(i), pos.getZ(i));
    p.geometry.setAttribute('aVeg', new THREE.BufferAttribute(veg, 4));
  }
  return parts;
}

function farParts(parts) {
  for (const p of parts) p.material = vegFarMaterial(p.material);
  return parts;
}

/** outward+up "volume" normal relative to a crown axis point */
function puffNormal(p, cx, cz, cy, upBias = 0.7) {
  const n = new V3(p.x - cx, (p.y - cy) * 0.35, p.z - cz);
  if (n.lengthSq() < 1e-6) n.set(0, 1, 0);
  n.normalize();
  n.y += upBias;
  return n.normalize();
}

/** vertical crossed cards. g(p, i) -> [normal, aVeg, colourScale] per corner (i: 0,1 bottom, 2,3 top) */
function crossCards(S, center, w, h, n, rot, tint, g, u0 = 0, u1 = 1) {
  for (let k = 0; k < n; k++) {
    const a = rot + (k * Math.PI) / n;
    const dx = Math.cos(a) * (w / 2), dz = Math.sin(a) * (w / 2);
    const pts = [new V3(center.x - dx, center.y, center.z - dz), new V3(center.x + dx, center.y, center.z + dz), new V3(center.x + dx, center.y + h, center.z + dz), new V3(center.x - dx, center.y + h, center.z - dz)];
    const uvs = [[u0, 0], [u1, 0], [u1, 1], [u0, 1]];
    const ids = pts.map((p, i) => {
      const [nn, veg, kk] = g(p, i, k);
      return S.v(p, nn, uvs[i][0], uvs[i][1], [tint[0] * kk, tint[1] * kk, tint[2] * kk], veg);
    });
    S.quad(ids[0], ids[1], ids[2], ids[3]);
  }
}

// ------------------------------------------------------------------ conifers
/** crown envelope: max horizontal reach per 1 m band (smoothed), for crown-depth occlusion */
function crownEnvelope(samples, H) {
  const bands = Math.ceil(H) + 3;
  const env = new Float32Array(bands);
  for (const [y, r] of samples) {
    const i = Math.max(0, Math.min(bands - 1, Math.floor(y)));
    env[i] = Math.max(env[i], r);
  }
  const envS = new Float32Array(bands);
  for (let i = 0; i < bands; i++) {
    let m = 0;
    for (let k = -2; k <= 2; k++) m = Math.max(m, env[Math.max(0, Math.min(bands - 1, i + k))] * (1 - Math.abs(k) * 0.12));
    envS[i] = Math.max(m, 0.4);
  }
  return (y) => envS[Math.max(0, Math.min(bands - 1, Math.floor(y)))];
}

function conifer(opts) {
  const { name, seed, H, r0, crownStart, whorls, perWhorl, maxLen, minLen = 0.5, elev0, elev1, droop0, droop1, fold = 0.35, tint, bareDead = 0, lenPow = 1.0, gapChance = 0 } = opts;
  const rng = makeRng(seed);
  // trunk: slightly bent tapered column with root flare
  const lean = [(rng() - 0.5) * 0.25, (rng() - 0.5) * 0.25];
  const trunkPts = [];
  const segs = 4;
  for (let k = 0; k <= segs; k++) {
    const t = k / segs;
    trunkPts.push([lean[0] * t * t + (rng() - 0.5) * 0.08 * (k && k < segs ? 1 : 0), t * H, lean[1] * t * t + (rng() - 0.5) * 0.08 * (k && k < segs ? 1 : 0)]);
  }
  const trunkR = (t) => r0 * Math.pow(1 - t, 1.25) + 0.025;
  const axisAt = (y) => {
    const t = Math.min(1, Math.max(0, y / H));
    const f = t * segs, k = Math.min(segs - 1, Math.floor(f)), u = f - k;
    const a = trunkPts[k], c = trunkPts[k + 1];
    return new V3(a[0] + (c[0] - a[0]) * u, y, a[2] + (c[2] - a[2]) * u);
  };
  // dead lower twigs (spruce look)
  const twigs = [];
  for (let k = 0; k < bareDead; k++) {
    const y = 1.0 + rng() * (crownStart * H - 0.8);
    const a = rng() * Math.PI * 2;
    const p = axisAt(y);
    const L = 0.5 + rng() * 1.1;
    twigs.push([[p.x, y, p.z], [p.x + Math.cos(a) * L, y - L * (0.1 + rng() * 0.3), p.z + Math.sin(a) * L]]);
  }
  // crown skeleton: whorls of drooping branch sprays
  const y0 = crownStart * H, y1 = H - 0.9;
  const coreRot = rng() * 3;
  const branches = [];
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
      const vary = 0.85 + rng() * 0.3;
      branches.push({
        base: new V3(p.x + Math.cos(ang) * rr, y, p.z + Math.sin(ang) * rr),
        ang,
        len,
        width: Math.max(0.8, len * 0.8),
        elev: elev0 + (elev1 - elev0) * tt + (rng() - 0.5) * 0.12,
        droop: droop0 + (droop1 - droop0) * tt,
        fold,
        tint: [tint[0] * vary, tint[1] * vary * (0.95 + rng() * 0.1), tint[2] * vary],
        roll: (rng() - 0.5) * 1.1,
        rows: len > 3 ? 5 : len > 1.6 ? 4 : 3,
        phase: rng(),
        keep: (k + w) % 2 === 0 || nb <= 2,
      });
    }
  }
  const topRot = rng() * 3;
  const topTint = [tint[0] * 1.1, tint[1] * 1.1, tint[2]];
  for (let k = 0; k < 3; k++) {
    const ang = rng() * Math.PI * 2;
    branches.push({ base: axisAt(H - 1.4 - k * 0.3), ang, len: 0.9, width: 0.7, elev: 0.35, droop: 0.1, fold: 0.3, tint: topTint, roll: 0, rows: 3, phase: rng(), keep: k < 2 });
  }
  // crown envelope from the branch centre lines
  const samples = [];
  for (const b of branches) {
    for (let s = 0; s <= 6; s++) {
      const t = s / 6, d = t * b.len;
      const y = b.base.y + d * Math.sin(b.elev) - b.droop * t * t * b.len;
      samples.push([y, Math.hypot(b.base.x + Math.cos(b.ang) * d * Math.cos(b.elev) - axisAt(y).x, b.base.z + Math.sin(b.ang) * d * Math.cos(b.elev) - axisAt(y).z) + b.width * 0.3]);
    }
  }
  samples.push([H, 0.5]);
  const env = crownEnvelope(samples, H);
  const tCrown = (y) => clamp01((y - y0) / Math.max(1, H - y0));
  // crown occlusion: deep inside the crown and low in it -> darker (Deadfall's crown-depth AO)
  const crownAO = (p) => {
    const a = axisAt(p.y);
    const depth = clamp01(1 - Math.hypot(p.x - a.x, p.z - a.z) / env(p.y));
    return lerp(1, 0.42, smooth(0.15, 0.95, depth)) * lerp(0.68, 1, tCrown(p.y));
  };
  // crown-shell normal: radial from the trunk axis, bent up towards the apex
  const crownN = (p) => {
    const a = axisAt(p.y);
    const r = new V3(p.x - a.x, 0, p.z - a.z);
    if (r.lengthSq() > 1e-6) r.normalize();
    return r.addScaledVector(UP, 0.35 + 0.6 * tCrown(p.y)).normalize();
  };
  const trunkAO = (x, y) => (y > y0 ? lerp(0.8, 0.45, smooth(y0, y0 + (H - y0) * 0.35, y)) : 1) * lerp(0.72, 1, smooth(-0.2, 1.5, y));

  const build = (lod) => {
    const S = new Soup();
    let parts = [];
    if (!lod) {
      const b = new MeshBuilder(seed, { ao: false });
      for (let k = 0; k < segs; k++) {
        const t0 = k / segs, t1 = (k + 1) / segs;
        b.cylBetween('tree_bark', trunkPts[k], trunkPts[k + 1], trunkR(t1), trunkR(t0), 7, { open: true });
      }
      b.cyl('tree_bark', r0 * 1.02, r0 * 1.55, 0.6, 7, { p: [0, 0.22, 0], open: true });
      for (const [p0, p1] of twigs) b.cylBetween('tree_bark', p0, p1, 0.008, 0.035, 3, { open: true });
      parts = withVeg(b.build(), trunkAO);
    } else {
      // far LOD: one mesh - the trunk is solid bark colour in the card material (aVeg.w = -1)
      const pts = [[0, -0.2, 0], ...trunkPts.slice(1)];
      const rad = [r0 * 1.4, ...trunkPts.slice(1).map((_, k) => trunkR((k + 1) / segs))];
      const sides = 5;
      const rows = pts.map((c, k) => {
        const row = [];
        for (let q = 0; q <= sides; q++) {
          const a = (q / sides) * Math.PI * 2;
          const n = new V3(Math.cos(a), 0, Math.sin(a));
          const p = new V3(c[0], c[1], c[2]).addScaledVector(n, rad[k]);
          row.push(S.v(p, n, 0.75, 0.12, [0.06, 0.045, 0.035], [trunkAO(p.x, p.y), 0, 0, -1]));
        }
        return row;
      });
      for (let k = 0; k < rows.length - 1; k++) for (let q = 0; q < sides; q++) S.quad(rows[k][q], rows[k][q + 1], rows[k + 1][q + 1], rows[k + 1][q]);
    }
    // dark silhouette core (crossed quads, right half of the pine atlas) gives the crown mass
    const coreTint = [tint[0] * 0.8, tint[1] * 0.8, tint[2] * 0.8];
    crossCards(S, new V3(0, y0 - 0.4, 0), maxLen * (lod ? 1.45 : 1.25), H - y0 + 0.2, lod ? 2 : 3, coreRot, coreTint, (p, i) => [crownN(p), [i < 2 ? 0.3 : 0.45, 0.2, 0, 0], 1], 0.5, 1);
    for (const br of branches) if (!lod || br.keep) branchCard(S, br, lod, crownN, crownAO);
    const top = axisAt(H - 1.1);
    crossCards(S, top, 0.8, 1.6, 2, topRot, topTint, (p, i) => [crownN(p), [i < 2 ? 0.75 : 1, i < 2 ? 0.6 : 1, 0.5, 0.3], 1], 0, 0.5);
    parts.push({ name: 'pine', material: MAT.pine, geometry: S.geometry() });
    return lod ? farParts(parts) : parts;
  };
  return { name, radius: r0 * 1.05, height: H, parts: build(0), far: build(1) };
}

/**
 * drooping folded branch card from trunk point `base` in horizontal direction `ang`. Rows along the branch
 * (v 0->1), 3 verts across (V fold, edges hang down); far LOD: 2 across, wider, no fold.
 */
function branchCard(S, br, lod, crownN, crownAO) {
  const { base, ang, len, elev, droop, tint, roll, phase } = br;
  const fold = lod ? 0 : br.fold;
  const width = br.width * (lod ? 1.4 : 1);
  const rows = lod ? 3 : br.rows;
  const across = lod ? [-1, 1] : [-1, 0, 1];
  const h = new V3(Math.cos(ang), 0, Math.sin(ang));
  const s0 = new V3(-Math.sin(ang), 0, Math.cos(ang));
  // roll the card around its axis so cards are never all edge-on
  const s = s0.clone().multiplyScalar(Math.cos(roll)).addScaledVector(UP, Math.sin(roll));
  const up = UP.clone().multiplyScalar(Math.cos(roll)).addScaledVector(s0, -Math.sin(roll));
  const ids = [];
  const n = new V3();
  for (let r = 0; r < rows; r++) {
    const t = r / (rows - 1);
    const d = t * len;
    const c = base.clone().addScaledVector(h, d * Math.cos(elev)).addScaledVector(UP, d * Math.sin(elev) - droop * t * t * len);
    const w = (width / 2) * (0.5 + 0.5 * Math.min(1, t * 2.2));
    const f = fold * w * (0.4 + 0.6 * t);
    // slope of the drooping branch tilts the card normal outwards
    const slope = Math.sin(elev) - 2 * droop * t;
    const row = [];
    for (const side of across) {
      const p = c.clone().addScaledVector(s, side * w).addScaledVector(up, -Math.abs(side) * f);
      n.copy(up).addScaledVector(h, -slope * 0.5).addScaledVector(s, side * fold * 1.4).normalize();
      // blend towards the crown shell: the crown shades as one volume, each spray keeps a little of its own tilt
      n.lerp(crownN(p), 0.6).normalize();
      const ao = crownAO(p);
      const k = 0.9 + 0.14 * t;
      row.push(S.v(p, n, ((side + 1) / 2) * 0.5, t, [tint[0] * k, tint[1] * k, tint[2] * k], [ao, t, phase, t * (0.6 + Math.abs(side) * 0.8)]));
    }
    ids.push(row);
  }
  for (let r = 0; r < rows - 1; r++) {
    const A = ids[r], B = ids[r + 1];
    for (let q = 0; q < across.length - 1; q++) S.quad(A[q], A[q + 1], B[q + 1], B[q]);
  }
}

// ------------------------------------------------------------------ dead / bare trees
function bareTree(opts, lod) {
  const { name, seed, H, r0, mat = 'tree_bark_dead', spread = 0.6, depthMax = 3, children = [2, 3], twist = 0.35, leafy = null, broken = 0.2 } = opts;
  const rng = makeRng(seed);
  const b = new MeshBuilder(seed, { ao: false });
  const tips = [];
  // far LOD: same skeleton (tree rng untouched), fewer sides, the finest twigs dropped
  const cyl = (a, c, rt, rb, sides) => {
    if (lod && rb < 0.03) return;
    b.cylBetween(mat, a, c, rt, rb, lod ? Math.max(3, sides - 2) : sides, { open: true });
  };
  const grow = (p, dir, len, rad, depth) => {
    const n = depth === 0 ? 5 : depth === 1 ? 3 : 2;
    let cur = p.clone();
    let r = rad;
    const d = dir.clone();
    const bend = new V3(rng() - 0.5, 0, rng() - 0.5).multiplyScalar(twist * (depth ? 1.5 : 0.12));
    for (let k = 0; k < n; k++) {
      // gnarled: persistent curl + jitter, thin branches sag under gravity
      const jit = depth ? twist : twist * 0.35;
      d.x += bend.x + (rng() - 0.5) * jit;
      d.z += bend.z + (rng() - 0.5) * jit;
      d.y += depth >= 2 ? -0.16 : depth === 1 ? -0.02 : 0.05;
      d.normalize();
      const nxt = cur.clone().addScaledVector(d, len / n);
      const r2 = r * (depth === 0 ? 0.86 : 0.74);
      cyl(cur.toArray(), nxt.toArray(), r2, r, depth === 0 ? 7 : depth === 1 ? 5 : 3);
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
  b.cyl(mat, r0 * 0.95, r0 * 1.5, 0.5, lod ? 5 : 7, { p: [0, 0.2, 0], open: true });
  let top = 0;
  for (const t of tips) top = Math.max(top, t.p.y);
  const crownY = top * 0.72;
  const parts = withVeg(b.build(), (x, y) => (y > H * 0.35 ? lerp(0.9, 0.62, smooth(H * 0.35, top, y) * (leafy ? 1 : 0)) : 1) * lerp(0.72, 1, smooth(-0.2, 1.5, y)));
  for (const p of parts) top = Math.max(top, p.geometry.boundingBox.max.y);
  if (leafy) {
    const S = new Soup();
    let R = 0.5;
    for (const tp of tips) R = Math.max(R, Math.hypot(tp.p.x, tp.p.z) + leafy.size * 0.5);
    const cc = new V3(0, crownY, 0);
    const n = new V3();
    for (const tp of tips) {
      if (rng() < leafy.skip) continue;
      const sz = leafy.size * (0.7 + rng() * 0.6);
      const ph = rng();
      crossCards(S, new V3(tp.p.x, tp.p.y - sz * 0.45, tp.p.z), sz, sz, lod ? 1 : 2, rng() * 3, leafy.tint, (p, i) => {
        const depth = clamp01(1 - Math.hypot(p.x, p.z) / R);
        const ao = lerp(1, 0.4, smooth(0.2, 0.95, depth)) * lerp(0.6, 1, clamp01((p.y - H * 0.3) / Math.max(1, top - H * 0.3)));
        n.copy(puffNormal(p, cc.x, cc.z, cc.y - sz * 0.3, 0.5));
        return [n.clone(), [ao, i < 2 ? 0.5 : 1, ph, 0.8], 1];
      });
    }
    let geo = S.geometry();
    if (lod) {
      // far LOD: one mesh - limbs are solid bark colour in the leaf material (aVeg.w = -1)
      const limbs = parts.splice(0).map((p) => {
        const g = p.geometry;
        const n = g.attributes.position.count;
        g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2).fill(0.5), 2));
        const col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) col.set([0.33, 0.31, 0.28], i * 3);
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        const veg = g.attributes.aVeg;
        for (let i = 0; i < n; i++) veg.setW(i, -1);
        return g;
      });
      geo = mergeGeometries([geo, ...limbs], false);
    }
    parts.push({ name: leafy.mat, material: MAT[leafy.mat], geometry: geo });
  }
  return { name, radius: r0, height: Math.round(top * 10) / 10, parts: lod ? farParts(parts) : parts };
}

/** controlled gnarled dead tree: trunk + thick twisting limbs + secondary/tertiary branches */
function deadTree({ name, seed, trunkH, r0, limbs = 4, limbLen = [3, 5], limbUp = [0.5, 1.0], sec = 2, tert = 1, brokenTop = false, stubs = 3 }, lod) {
  const rng = makeRng(seed);
  const b = new MeshBuilder(seed, { ao: false });
  const mat = 'tree_bark_dead';
  const cyl = (a, c, rt, rb, sides) => {
    if (lod && rb < 0.035) return;
    b.cylBetween(mat, a, c, rt, rb, lod ? Math.max(3, sides - 2) : sides, { open: true });
  };
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
      cyl(cur.toArray(), nxt.toArray(), r2, r, sides);
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
    cyl(cur.toArray(), nxt.toArray(), r2, r, 7);
    if (k >= 1 && stubs > 0 && rng() < 0.7) {
      const a = rng() * Math.PI * 2;
      branch(nxt.clone(), new V3(Math.cos(a), 0.3, Math.sin(a)), 0.5 + rng() * 0.9, r2 * 0.35, 1, 4, 0.1);
    }
    cur = nxt;
    r = r2;
  }
  b.cyl(mat, r0 * 0.98, r0 * 1.6, 0.55, lod ? 5 : 7, { p: [0, 0.22, 0], open: true });
  if (brokenTop) {
    for (let k = 0; k < 3; k++) {
      const a = rng() * Math.PI * 2;
      const p0 = [cur.x + Math.cos(a) * r * 0.4, cur.y - 0.1, cur.z + Math.sin(a) * r * 0.4];
      const p1 = [cur.x + Math.cos(a) * r * 0.5, cur.y + 0.4 + rng() * 0.7, cur.z + Math.sin(a) * r * 0.5];
      if (!lod) b.cylBetween(mat, p0, p1, 0.01, r * 0.35, 3, { open: true });
    }
  }
  // limbs
  const a0 = rng() * Math.PI * 2;
  for (let l = 0; l < limbs; l++) {
    const a = a0 + (l / limbs) * Math.PI * 2 + (rng() - 0.5) * 0.8;
    const up = limbUp[0] + rng() * (limbUp[1] - limbUp[0]);
    const start = brokenTop ? cur.clone().multiplyScalar(0.55 + l * 0.1) : cur.clone().add(new V3(0, -rng() * 0.6, 0));
    const len = limbLen[0] + rng() * (limbLen[1] - limbLen[0]);
    branch(start, new V3(Math.cos(a), up, Math.sin(a)), len, r * 0.85, 3, 5, 0.02, (pt, d, rr) => {
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
  const parts = withVeg(b.build(), (x, y) => lerp(0.72, 1, smooth(-0.2, 1.5, y)));
  let top = 0;
  for (const p of parts) top = Math.max(top, p.geometry.boundingBox.max.y);
  return { name, radius: r0, height: Math.round(top * 10) / 10, parts: lod ? farParts(parts) : parts };
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
  b.add('tree_charred', g);
  // splinter shards at the top
  for (let k = 0; k < 4; k++) {
    const a = rng() * Math.PI * 2;
    const x = Math.cos(a) * r0 * 0.5, z = Math.sin(a) * r0 * 0.5;
    b.cylBetween('tree_charred', [x, H - 1.6, z], [x * 1.3, H - 0.4 + rng() * 0.9, z * 1.3], 0.02, 0.12, 3, { open: true });
  }
  // broken branch stubs
  for (let k = 0; k < 4; k++) {
    const a = rng() * Math.PI * 2, y = 2 + rng() * 3.2, L = 0.4 + rng() * 1.1;
    b.cylBetween('tree_charred', [Math.cos(a) * 0.3, y, Math.sin(a) * 0.3], [Math.cos(a) * L, y + L * 0.5, Math.sin(a) * L], 0.02, 0.08, 4, { open: true });
  }
  b.cyl('tree_charred', r0 * 0.98, r0 * 1.6, 0.6, 8, { p: [0, 0.22, 0], open: true });
  // (no far LOD: nothing to simplify, so it keeps one mesh at every distance)
  const parts = withVeg(b.build(), (x, y) => lerp(0.72, 1, smooth(-0.2, 1.5, y)));
  for (const p of parts) p.material = vegStaticMaterial(p.material);
  return { name: 'burnt_snag', radius: r0, height: H, parts };
}

function withFar(near, far) {
  near.far = far.parts;
  return near;
}

let _trees = null;
export function getTreeVariants() {
  if (_trees) return _trees;
  const dead = (o) => withFar(deadTree(o, 0), deadTree(o, 1));
  const bare = (o) => withFar(bareTree(o, 0), bareTree(o, 1));
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
    dead({ name: 'dead_oak', seed: 41, trunkH: 4.6, r0: 0.5, limbs: 4, limbLen: [3.2, 5.2], limbUp: [0.2, 0.85], sec: 2, tert: 1 }),
    dead({ name: 'dead_tall', seed: 53, trunkH: 13, r0: 0.34, limbs: 3, limbLen: [1.6, 3.2], limbUp: [0.1, 0.7], sec: 1, tert: 1, brokenTop: true, stubs: 4 }),
    bare({
      name: 'birch', seed: 67, H: 14, r0: 0.2, mat: 'tree_bark_birch', spread: 0.45, depthMax: 3, children: [2, 2], twist: 0.22, broken: 0.1,
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
  const n = new V3();
  // 1) leafy shrub: crossed vertical cards inside a ring of outward-leaning cards; dark, occluded core
  const shrub = new Soup();
  const tint = [0.9, 0.95, 0.85];
  const shrubVeg = (p, h) => {
    const r = Math.hypot(p.x, p.z);
    const ao = lerp(0.3, 1, smooth(-0.05, h, p.y)) * lerp(0.55, 1, smooth(0.1, 0.8, r));
    return [ao, clamp01(p.y / h), rng(), 0];
  };
  crossCards(shrub, new V3(0, 0, 0), 1.6, 1.25, 3, 0.2, tint, (p) => [puffNormal(p, 0, 0, 0.1, 0.6), shrubVeg(p, 1.25), 1]);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + rng() * 0.6;
    const c = new V3(Math.cos(a) * 0.32, 0, Math.sin(a) * 0.32);
    const w = 1.0 + rng() * 0.3, h = 0.8 + rng() * 0.3;
    const dx = -Math.sin(a) * (w / 2), dz = Math.cos(a) * (w / 2);
    const lean = 0.35 + rng() * 0.15;
    const pts = [new V3(c.x - dx, 0, c.z - dz), new V3(c.x + dx, 0, c.z + dz), new V3(c.x + dx + Math.cos(a) * lean, h, c.z + dz + Math.sin(a) * lean), new V3(c.x - dx + Math.cos(a) * lean, h, c.z - dz + Math.sin(a) * lean)];
    const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const ph = rng();
    const ids = pts.map((p, i) => {
      const g = shrubVeg(p, 1.1);
      g[2] = ph;
      return shrub.v(p, puffNormal(p, 0, 0, 0.1, 0.6), uv[i][0], uv[i][1], [0.88, 0.93, 0.83], g);
    });
    shrub.quad(ids[0], ids[1], ids[2], ids[3]);
  }
  // 2) fern clump: arching V-folded fronds (rachis ridge up), occluded towards the crown, a few dead fronds
  const fern = new Soup();
  const nf = 12;
  for (let k = 0; k < nf; k++) {
    const a = (k / nf) * Math.PI * 2 + (rng() - 0.5) * 0.5;
    const deadF = rng() < 0.18;
    const L = (0.85 + rng() * 0.5) * (deadF ? 0.9 : 1);
    const W = 0.34 + rng() * 0.06;
    const h = new V3(Math.cos(a), 0, Math.sin(a)), s = new V3(-Math.sin(a), 0, Math.cos(a));
    const rows = 5, ids = [];
    const rise = deadF ? 0.25 : 0.8 + rng() * 0.55;
    const ph = rng();
    const dry = deadF ? 0.75 : rng() < 0.3 ? 0.25 : 0;
    const foldK = 0.22;
    for (let r = 0; r < rows; r++) {
      const t = r / (rows - 1);
      const c = new V3(0, 0.02, 0).addScaledVector(h, t * L * 0.85).addScaledVector(UP, Math.sin(t * Math.PI * 0.85) * rise * L * 0.55 - t * t * 0.22);
      // frond surface normal: up, tilted outward past the arch apex
      const tilt = Math.cos(t * Math.PI * 0.85) * rise * 0.9 - t * 0.4;
      const row = [];
      for (let q = 0; q < 3; q++) {
        const sd = q - 1;
        const w = W * (1 - 0.45 * t * t);
        const p = c.clone().addScaledVector(s, (sd * w) / 2).addScaledVector(UP, -Math.abs(sd) * w * foldK);
        n.copy(UP).addScaledVector(h, -tilt * 0.6).addScaledVector(s, sd * foldK * 1.6).normalize();
        n.lerp(new V3(h.x, 0.9, h.z).normalize(), 0.35).normalize();
        const ao = lerp(0.3, 1, smooth(0, 0.75, t)) * (Math.abs(sd) ? 1 : 0.9);
        row.push(fern.v(p, n.clone(), q / 2, t, [0.9, 0.95, 0.85], [ao, t, ph, dry * smooth(0.2, 0.9, t)]));
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
  const dryG = (p) => [puffNormal(p, 0, 0, 0.1, 0.6), [lerp(0.35, 1, smooth(0, 0.9, p.y)), clamp01(p.y), rng(), 0.35], 1];
  crossCards(dry, new V3(0, 0, 0), 1.9, 1.0, 3, 1.1, [0.95, 0.72, 0.52], dryG);
  crossCards(dry, new V3(0.4, 0, 0.3), 1.0, 0.7, 2, 0.4, [0.85, 0.7, 0.5], dryG);
  // bare twigs: solid (untextured) geometry in the same mesh (aVeg.w = -1)
  for (let k = 0; k < 6; k++) {
    const a = rng() * Math.PI * 2;
    const tip = new V3(Math.cos(a) * 0.7, 0.9 + rng() * 0.5, Math.sin(a) * 0.7);
    const side = new V3(-Math.sin(a), 0, Math.cos(a));
    const ids = [];
    for (let q = 0; q < 3; q++) {
      const o = new V3().addScaledVector(side, Math.cos((q / 3) * Math.PI * 2)).addScaledVector(UP, Math.sin((q / 3) * Math.PI * 2) * 0.5).normalize();
      // (linear albedo, like the bark textures)
      ids.push(dry.v(o.clone().multiplyScalar(0.025), o, 0.5, 0.5, [0.05, 0.045, 0.04], [0.6, 0, 0, -1]));
      ids.push(dry.v(tip.clone().addScaledVector(o, 0.006), o, 0.5, 0.5, [0.075, 0.068, 0.06], [1, 1, 0, -1]));
    }
    for (let q = 0; q < 3; q++) {
      const q1 = (q + 1) % 3;
      dry.quad(ids[q * 2], ids[q1 * 2], ids[q1 * 2 + 1], ids[q * 2 + 1]);
    }
  }
  _bushes = [
    { name: 'shrub', parts: [{ name: 'bush', material: MAT.bush, geometry: shrub.geometry() }] },
    { name: 'fern', parts: [{ name: 'fern', material: MAT.fern, geometry: fern.geometry() }] },
    { name: 'thicket', parts: [{ name: 'bush', material: MAT.bush, geometry: dry.geometry() }] },
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
/**
 * One grass clump (~1 m across): curved blade cards around the centre plus two low "thatch" cards of
 * bent-over blades that close the ground between clumps. Soft up-bent normals, base->tip occlusion,
 * straw tips on some cards.
 */
let _grass = null;
export function getGrassPatch() {
  if (_grass) return _grass;
  const rng = makeRng(131);
  const S = new Soup();
  const n = new V3();
  const nb = 6;
  for (let k = 0; k < nb; k++) {
    const a = (k / nb) * Math.PI + rng() * 0.5;
    const c = new V3((rng() - 0.5) * 0.5, 0, (rng() - 0.5) * 0.5);
    const w = 0.45 + rng() * 0.25;
    const h = (0.36 + rng() * 0.34) * (1 - Math.hypot(c.x, c.z) * 0.5);
    const dx = Math.cos(a) * (w / 2), dz = Math.sin(a) * (w / 2);
    // blades lean away from the clump centre and curve over
    const out = new V3(c.x, 0, c.z);
    if (out.lengthSq() < 1e-4) out.set(-Math.sin(a), 0, Math.cos(a));
    out.normalize();
    const lean = 0.08 + rng() * 0.14;
    const dry = rng() < 0.45 ? 0.3 + rng() * 0.45 : rng() * 0.15;
    const ph = rng();
    const rows = [];
    for (let r = 0; r < 3; r++) {
      const t = r / 2;
      const off = out.clone().multiplyScalar(lean * t * t);
      const row = [];
      for (const sd of [-1, 1]) {
        const p = new V3(c.x + sd * dx * (1 - 0.15 * t) + off.x, h * t * (1 - 0.1 * t), c.z + sd * dz * (1 - 0.15 * t) + off.z);
        n.copy(out).multiplyScalar(0.45).add(UP).normalize();
        row.push(S.v(p, n, (sd + 1) / 2, t, [1, 1, 1], [lerp(0.4, 1, smooth(0, 0.85, t)), t, ph, dry * smooth(0.35, 1, t)]));
      }
      rows.push(row);
    }
    for (let r = 0; r < 2; r++) S.quad(rows[r][0], rows[r][1], rows[r + 1][1], rows[r + 1][0]);
  }
  for (let k = 0; k < 2; k++) {
    const a = rng() * Math.PI * 2;
    const h = new V3(Math.cos(a), 0, Math.sin(a)), s = new V3(-Math.sin(a), 0, Math.cos(a));
    const L = 0.45 + rng() * 0.15, W = 0.45 + rng() * 0.12;
    const lift = 0.14 + rng() * 0.1;
    const ph = rng();
    const ids = [];
    for (let r = 0; r < 2; r++) {
      for (const sd of [-1, 1]) {
        const p = new V3().addScaledVector(h, 0.05 + r * L).addScaledVector(s, (sd * W) / 2);
        p.y = 0.03 + r * lift;
        n.copy(UP).addScaledVector(h, -0.2).normalize();
        ids.push(S.v(p, n, (sd + 1) / 2, 0.15 + r * 0.7, [0.9, 0.9, 0.85], [lerp(0.5, 0.85, r), r * 0.5, ph, 0.2 + r * 0.25]));
      }
    }
    S.quad(ids[0], ids[1], ids[3], ids[2]);
  }
  _grass = { geometry: S.geometry(), material: MAT.grass, nearMaterial: MAT.grass_near };
  return _grass;
}
