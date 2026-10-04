// The grip fitter's engine (fit-grip.js; docs/object-clipping.md, "Fitting a hand pose"). Under node, with the DOM
// stubbed: builds the real ViewModel of a tree (client/render/models/weapons.js), poses it the way the models sandbox
// does, turns the held item (or the prop being used) into a signed distance field in the hand's own frame, and closes
// a hand pose round it: the palm seated on the surface, each finger closed until it touches, the thumb laid along it.
//
// The hand is the one getHandGeo builds: finger knuckles, phalanx lengths and radii (FINGERS, PHALANX_R) and the thumb
// joint (THUMB_MCP) come from weapons.js itself; the palm surface below repeats getHandGeo's glove palm numbers. A pose's
// geometry is right-hand space: the wrist at the origin, fingers along -Y, the palm facing -X; a left hand is the right
// one mirrored in X, so its item is mirrored into right-hand space here.
import './dom-stub.js';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { REPO } from './lib.js';

const ROOT = resolve(process.env.STN_ROOT || REPO);
const W = await import(pathToFileURL(join(ROOT, 'client', 'render', 'models', 'weapons.js')).href);
const THREE = await import(pathToFileURL(join(ROOT, 'node_modules', 'three', 'build', 'three.module.js')).href);
const DEFS = await import(pathToFileURL(join(ROOT, 'shared', 'defs.js')).href);
export { W, THREE, DEFS };
const { HAND_POSES, FINGERS, PHALANX_R, THUMB_MCP } = W.VM_DEBUG;
const hyp = Math.hypot;

/** A ViewModel holding itemId, posed as models-vm.js poses it: act (walk, sprint, ads, fire, reload, melee, heavy, throw,
 *  use, talk) started after the 0.6 s draw and the clock run t s past it; use: the consumable for act=use. */
export function posedVM(itemId, { act = '', t = 1, use = 0, state = {} } = {}) {
  const vm = new W.ViewModel();
  vm.setItem(itemId);
  const st = { speed: 0, sprint: false, onGround: true, crouch: false, aiming: false, time: 0, ...state };
  if (act === 'walk') st.speed = 4.3;
  if (act === 'sprint') Object.assign(st, { speed: 7, sprint: true });
  if (act === 'ads') st.aiming = true;
  if (act === 'talk') st.talk = true;
  const DT = 1 / 60, PRE = 0.6;
  const n = Math.round((PRE + t) / DT);
  let fired = false, sim = 0;
  const w = DEFS.WEAPONS[itemId];
  for (let i = 0; i < n; i++) {
    sim += DT;
    st.time = sim;
    if (!fired && sim - PRE >= 0) {
      fired = true;
      if (act === 'fire') vm.fire();
      else if (act === 'reload') vm.reload(w ? w.reload : 2, !!(w && w.reloadEach));
      else if (act === 'melee') vm.melee(false);
      else if (act === 'heavy') vm.melee(true);
      else if (act === 'throw') vm.throwItem();
      else if (act === 'use') vm.useItem(2.0, use);
    }
    vm.update(DT, st);
  }
  vm.group.updateMatrixWorld(true);
  return vm;
}

const shown = (o) => {
  for (; o; o = o.parent) if (!o.visible) return false;
  return true;
};

/**
 * Signed distance grid of the visible item meshes in the hand frame of arm `side` ('R' | 'L'), mirrored for the left
 * hand into the right hand's frame (the hand geometry is the right one mirrored in X). res in m.
 */
export function itemGrid(vm, side, { res = 0.0015, box = [[-0.13, 0.07], [-0.2, 0.05], [-0.1, 0.1]], extra = [] } = {}) {
  const arm = side === 'L' ? vm.armL : vm.armR;
  const inv = new THREE.Matrix4().copy(arm.wrist.matrixWorld).invert();
  if (side === 'L') inv.premultiply(new THREE.Matrix4().makeScale(-1, 1, 1));
  const meshes = [];
  if (vm.cur) for (const m of vm.cur.root.children) if (m.isMesh && shown(m)) meshes.push(m);
  if (shown(vm.kit)) meshes.push(vm.kit);
  meshes.push(...extra);
  // triangles in hand space, with outward normals
  const tris = [];
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  for (const m of meshes) {
    const M = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
    const flip = M.determinant() < 0;
    const g = m.geometry, p = g.attributes.position, idx = g.index;
    const n = idx ? idx.count : p.count;
    for (let i = 0; i < n; i += 3) {
      const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
      A.fromBufferAttribute(p, a).applyMatrix4(M);
      B.fromBufferAttribute(p, flip ? c : b).applyMatrix4(M);
      C.fromBufferAttribute(p, flip ? b : c).applyMatrix4(M);
      tris.push([A.x, A.y, A.z, B.x, B.y, B.z, C.x, C.y, C.z]);
    }
  }
  const nx = Math.round((box[0][1] - box[0][0]) / res), ny = Math.round((box[1][1] - box[1][0]) / res), nz = Math.round((box[2][1] - box[2][0]) / res);
  const occ = new Uint8Array(nx * ny * nz);
  // bin triangles by their y/z extent for the column rays (along +X)
  const bins = new Map();
  const key = (j, k) => j * 100000 + k;
  for (const t of tris) {
    const y0 = Math.min(t[1], t[4], t[7]), y1 = Math.max(t[1], t[4], t[7]);
    const z0 = Math.min(t[2], t[5], t[8]), z1 = Math.max(t[2], t[5], t[8]);
    const j0 = Math.max(0, Math.floor((y0 - box[1][0]) / res - 0.5)), j1 = Math.min(ny - 1, Math.ceil((y1 - box[1][0]) / res - 0.5));
    const k0 = Math.max(0, Math.floor((z0 - box[2][0]) / res - 0.5)), k1 = Math.min(nz - 1, Math.ceil((z1 - box[2][0]) / res - 0.5));
    for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) {
      const kk = key(j, k);
      let l = bins.get(kk);
      if (!l) bins.set(kk, (l = []));
      l.push(t);
    }
  }
  for (let j = 0; j < ny; j++) {
    for (let k = 0; k < nz; k++) {
      const l = bins.get(key(j, k));
      if (!l) continue;
      const y = box[1][0] + (j + 0.5) * res + 1.3e-7, z = box[2][0] + (k + 0.5) * res + 0.7e-7;
      const hits = [];
      for (const t of l) {
        // ray (x, y, z) + s (1, 0, 0): 2D point-in-triangle in (y, z), then the x of the plane there
        const e1y = t[4] - t[1], e1z = t[5] - t[2], e2y = t[7] - t[1], e2z = t[8] - t[2];
        const det = e1y * e2z - e1z * e2y;
        if (Math.abs(det) < 1e-14) continue;
        const py = y - t[1], pz = z - t[2];
        const u = (py * e2z - pz * e2y) / det, v = (e1y * pz - e1z * py) / det;
        if (u < 0 || v < 0 || u + v > 1) continue;
        const x = t[0] + u * (t[3] - t[0]) + v * (t[6] - t[0]);
        // normal x sign: (B - A) x (C - A), x component = e1y * e2z - e1z * e2y = det
        hits.push([x, det > 0 ? 1 : -1]); // det > 0: normal along +X = leaving the solid going +X
      }
      if (!hits.length) continue;
      hits.sort((a, b) => a[0] - b[0]);
      // inside = more entries than exits behind the point, counted from both ends (a stray open face can't then
      // fill the rest of the column)
      const fw = new Uint8Array(nx);
      let depth = 0, h = 0;
      for (let i = 0; i < nx; i++) {
        const x = box[0][0] + (i + 0.5) * res;
        while (h < hits.length && hits[h][0] < x) {
          depth = Math.max(0, depth + (hits[h][1] > 0 ? -1 : 1)); // a face whose normal faces -X is an entry going +X
          h++;
        }
        fw[i] = depth > 0 ? 1 : 0;
      }
      depth = 0;
      h = hits.length - 1;
      for (let i = nx - 1; i >= 0; i--) {
        const x = box[0][0] + (i + 0.5) * res;
        while (h >= 0 && hits[h][0] > x) {
          depth = Math.max(0, depth + (hits[h][1] > 0 ? 1 : -1));
          h--;
        }
        if (depth > 0 && fw[i]) occ[(i * ny + j) * nz + k] = 1;
      }
    }
  }
  // exact Euclidean distance transforms of the solid and of the empty space (Felzenszwalb), in voxels
  const edt = (target) => {
    const INF = 1e20, N = nx * ny * nz;
    const f = new Float64Array(N);
    for (let i = 0; i < N; i++) f[i] = occ[i] === target ? 0 : INF;
    const pass = (len, stride, starts) => {
      const d = new Float64Array(len), v = new Int32Array(len), zb = new Float64Array(len + 1), ff = new Float64Array(len);
      for (const s0 of starts) {
        for (let q = 0; q < len; q++) ff[q] = f[s0 + q * stride];
        let kk = 0;
        v[0] = 0;
        zb[0] = -INF;
        zb[1] = INF;
        for (let q = 1; q < len; q++) {
          let s;
          for (;;) {
            const r = v[kk];
            s = (ff[q] + q * q - (ff[r] + r * r)) / (2 * q - 2 * r);
            if (s <= zb[kk]) kk--;
            else break;
          }
          kk++;
          v[kk] = q;
          zb[kk] = s;
          zb[kk + 1] = INF;
        }
        kk = 0;
        for (let q = 0; q < len; q++) {
          while (zb[kk + 1] < q) kk++;
          const r = v[kk];
          d[q] = (q - r) * (q - r) + ff[r];
        }
        for (let q = 0; q < len; q++) f[s0 + q * stride] = d[q];
      }
    };
    const sz = [];
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) sz.push((i * ny + j) * nz);
    pass(nz, 1, sz);
    const sy = [];
    for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) sy.push(i * ny * nz + k);
    pass(ny, nz, sy);
    const sx = [];
    for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) sx.push(j * nz + k);
    pass(nx, ny * nz, sx);
    return f;
  };
  const dOut = edt(1), dIn = edt(0);
  const sd = new Float32Array(nx * ny * nz);
  for (let i = 0; i < sd.length; i++) sd[i] = occ[i] ? -(Math.sqrt(dIn[i]) - 0.5) * res : (Math.sqrt(dOut[i]) - 0.5) * res;
  const sample = (x, y, z) => {
    const fx = (x - box[0][0]) / res - 0.5, fy = (y - box[1][0]) / res - 0.5, fz = (z - box[2][0]) / res - 0.5;
    if (fx < 0 || fy < 0 || fz < 0 || fx >= nx - 1 || fy >= ny - 1 || fz >= nz - 1) return 0.05;
    const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz), u = fx - i, v = fy - j, w = fz - k;
    const at = (a, b, c) => sd[((i + a) * ny + (j + b)) * nz + (k + c)];
    const l = (a, b, t) => a + (b - a) * t;
    return l(l(l(at(0, 0, 0), at(0, 0, 1), w), l(at(0, 1, 0), at(0, 1, 1), w), v), l(l(at(1, 0, 0), at(1, 0, 1), w), l(at(1, 1, 0), at(1, 1, 1), w), v), u);
  };
  return { sample, tris: tris.length, occ: occ.reduce((a, b) => a + b, 0) };
}

// ---------------------------------------------------------------- hand model (right hand frame), as getHandGeo
function capsuleClear(sdf, a, b, r0, r1, off) {
  let m = Infinity;
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    m = Math.min(m, sdf(a[0] + (b[0] - a[0]) * t + off[0], a[1] + (b[1] - a[1]) * t + off[1], a[2] + (b[2] - a[2]) * t + off[2]) - (r0 + (r1 - r0) * t));
  }
  return m;
}
export function fingerChain(i, angs, spread) {
  const F = FINGERS[i];
  let p = [0, F.y, F.z], ang = 0;
  const segs = [];
  const sp = (i - 1.5) * spread;
  const dl = Math.sqrt(1 + sp * sp);
  for (let j = 0; j < 3; j++) {
    ang += angs[j];
    const d = [-Math.sin(ang) / dl, -Math.cos(ang) / dl, sp / dl];
    const q = [p[0] + d[0] * F.L[j], p[1] + d[1] * F.L[j], p[2] + d[2] * F.L[j]];
    const r0 = F.r * PHALANX_R[j] * 1.06;
    segs.push({ a: p, b: q, r0, r1: r0 * (j === 2 ? 0.88 : 0.93) });
    p = q;
  }
  return segs;
}
let PALM = null;
function palmPts() {
  if (PALM) return PALM;
  const S = { y0: 0.004, y1: -0.097, d0: 0.12, d1: 0.16, cx: -0.002, cz: -0.001, hz0: 0.026, hz1: 0.0405, xd0: 0.0135, xd1: 0.0105, xp0: 0.016, xp1: 0.0135, thenar: 0.006, hypo: 0.0035 };
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const out = [];
  for (let iv = 0; iv <= 12; iv++) for (let iu = 0; iu < 20; iu++) {
    const v = iv / 12, u = iu / 20;
    let e = 1;
    if (v < S.d0) e = Math.sqrt(Math.max(0, 1 - ((S.d0 - v) / S.d0) ** 2));
    else if (v > 1 - S.d1) e = Math.sqrt(Math.max(0, 1 - ((v - 1 + S.d1) / S.d1) ** 2));
    const hz = S.hz0 + (S.hz1 - S.hz0) * ss(0, 0.75, v);
    const th = u * 2 * Math.PI, c = Math.cos(th), s = Math.sin(th);
    const back = c >= 0;
    const k = back ? 2 / 2.3 : 2 / 3.4;
    const ux = Math.sign(c) * Math.abs(c) ** k, uz = Math.sign(s) * Math.abs(s) ** k;
    const depth = back ? S.xd0 + (S.xd1 - S.xd0) * v : S.xp0 + (S.xp1 - S.xp0) * v + (Math.max(0, -uz) * S.thenar + Math.max(0, uz) * S.hypo) * (1 - v) ** 0.7;
    out.push([S.cx + ux * depth * e, S.y0 + (S.y1 - S.y0) * v, S.cz + uz * hz * e]);
  }
  for (let a = 0; a < 12; a++) for (let b = 1; b < 6; b++) {
    const th = (a / 12) * 2 * Math.PI, ph = (b / 6) * Math.PI;
    let x = 0.0095 * Math.sin(ph) * Math.cos(th), y = 0.021 * Math.cos(ph), z = 0.0125 * Math.sin(ph) * Math.sin(th);
    const cy = Math.cos(0.52), sy = Math.sin(0.52);
    [y, z] = [y * cy - z * sy, y * sy + z * cy];
    out.push([-0.0145 + x, -0.029 + y, -0.017 + z]);
  }
  // knuckles and the wrist mass
  for (const F of FINGERS) for (let a = 0; a < 8; a++) out.push([0.003 + 0.0098 * Math.cos(a * 0.785), F.y + 0.001 + 0.0092 * Math.sin(a * 0.785), F.z]);
  return (PALM = out);
}

/** Clearance (m, negative = inside) of every part of a pose against the field: palm, each finger's three phalanges, the
 *  thumb's metacarpal and two phalanges. off: how far the item is moved in hand space (minus a grip-center shift). */
export function poseReport(sdf, pose, off = [0, 0, 0]) {
  const fingers = FINGERS.map((_, i) => {
    const segs = fingerChain(i, pose.curl[i], pose.spread || 0);
    return segs.map((s) => capsuleClear(sdf, s.a, s.b, s.r0, s.r1, off));
  });
  let palm = Infinity;
  for (const h of palmPts()) palm = Math.min(palm, sdf(h[0] + off[0], h[1] + off[1], h[2] + off[2]));
  const L = [0.036, 0.03], R = [[0.0124, 0.0113], [0.0118, 0.0101]];
  let p = THUMB_MCP;
  const thumb = [capsuleClear(sdf, [-0.004, -0.004, -0.019], THUMB_MCP, 0.0145, 0.0124, off)];
  for (let j = 0; j < 2; j++) {
    const d = pose.thumb[j], l = hyp(...d);
    const q = p.map((v, k) => v + (d[k] / l) * L[j]);
    thumb.push(capsuleClear(sdf, p, q, R[j][0], R[j][1], off));
    p = q;
  }
  return { fingers, palm, thumb };
}

/** Close every finger round the field from fully open: all three joints together (weights w), each joint stopping
 *  when it or one past it touches; the free outer joints go on closing. */
export function solveFingers(sdf, spread, off, gap = 0.0006, w = [1, 1.15, 0.8], maxA = [1.6, 1.75, 1.2], minA = [0, 0, 0]) {
  return FINGERS.map((_, i) => {
    const angs = minA.slice();
    const frozen = [false, false, false];
    for (let it = 0; it < 2000 && frozen.includes(false); it++) {
      const prev = angs.slice();
      for (let j = 0; j < 3; j++) if (!frozen[j]) angs[j] = Math.min(maxA[j], angs[j] + 0.005 * w[j]);
      const segs = fingerChain(i, angs, spread);
      let hit = -1;
      for (let k = 0; k < 3; k++) if (capsuleClear(sdf, segs[k].a, segs[k].b, segs[k].r0, segs[k].r1, off) < gap) hit = Math.max(hit, k);
      if (hit >= 0) {
        for (let j = 0; j <= hit; j++) if (!frozen[j]) angs[j] = prev[j];
        for (let j = 0; j <= hit; j++) frozen[j] = true;
      }
      for (let j = 0; j < 3; j++) if (angs[j] >= maxA[j]) frozen[j] = true;
    }
    return angs.map((a) => +a.toFixed(2));
  });
}

/** The thumb: both segment directions searched over a sphere, near ref, clear of the item and as close to it as they go. */
export function searchThumb(sdf, off, ref, gap = 0.0006, minDot = [0.6, 0.4]) {
  const L = [0.036, 0.03], R = [[0.0124, 0.0113], [0.0118, 0.0101]];
  const nrm = (d) => { const l = hyp(...d); return d.map((v) => v / l); };
  const r0 = nrm(ref[0]), r1 = nrm(ref[1]);
  const dirs = [];
  for (let a = 0; a < 48; a++) for (let b = 1; b < 24; b++) {
    const th = (a / 48) * 2 * Math.PI, ph = (b / 24) * Math.PI;
    dirs.push([Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)]);
  }
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  let best = null;
  for (const d0 of dirs) {
    if (dot(d0, r0) < minDot[0]) continue;
    const q0 = THUMB_MCP.map((v, k) => v + d0[k] * L[0]);
    const c0 = capsuleClear(sdf, THUMB_MCP, q0, R[0][0], R[0][1], off);
    if (c0 < gap) continue;
    for (const d1 of dirs) {
      const bend = Math.acos(Math.min(1, dot(d0, d1)));
      if (bend > 1.1 || dot(d1, r1) < minDot[1]) continue;
      const q1 = q0.map((v, k) => v + d1[k] * L[1]);
      const c1 = capsuleClear(sdf, q0, q1, R[1][0], R[1][1], off);
      if (c1 < gap) continue;
      const score = Math.min(c0, 0.02) + 2 * Math.min(c1, 0.02) + 0.01 * (2 - dot(d0, r0) - dot(d1, r1));
      if (!best || score < best.score) best = { score, d: [d0.map((v) => +v.toFixed(2)), d1.map((v) => +v.toFixed(2))], c: [+(c0 * 1000).toFixed(1), +(c1 * 1000).toFixed(1)] };
    }
  }
  return best;
}

export const mm = (x) => +(x * 1000).toFixed(1);
export function fmtReport(r) {
  return `palm ${mm(r.palm)} | fingers ${r.fingers.map((f) => f.map(mm).join('/')).join('  ')} | thumb ${r.thumb.map(mm).join('/')}`;
}
export { HAND_POSES };

/**
 * Fit a pose: seat base's palm on the item (moving the grip center along the palm normal, X, until the palm and the
 * thumb's metacarpal are opt.seat off it), close its fingers (solveFingers; or opt.search / opt.open), lay its thumb
 * (searchThumb, near base's own unless opt.keepThumb). opt.dy / opt.dz slide the grip along the fingers / the tunnel;
 * opt.keep: finger indices (0 index .. 3 little) to leave as base has them (a trigger finger). Returns
 * { pose, before, after (poseReport of each), shift, thumbFound }.
 */
export function fitPose(vm, side, base, opt = {}) {
  const g = opt.grid || itemGrid(vm, side);
  const P = typeof base === 'string' ? HAND_POSES[base] : base;
  const C0 = P.center;
  const dy = opt.dy || 0, dz = opt.dz || 0, seat = opt.seat ?? 0.0006;
  const palmAt = (x) => {
    const r = poseReport(g.sample, { ...P, curl: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]] }, [-x, -dy, -dz]);
    return opt.noMeta ? r.palm : Math.min(r.palm, r.thumb[0]); // (the thumb's metacarpal is part of the palm)
  };
  let dx;
  if (opt.dx !== undefined) dx = opt.dx;
  else {
    let lo = -0.06, hi = 0.09;
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2;
      if (palmAt(m) > seat) lo = m;
      else hi = m;
    }
    dx = lo;
  }
  const off = [-dx, -dy, -dz];
  const spread = opt.spread ?? (P.spread || 0);
  const curl = (opt.search ? searchFingers(g.sample, spread, off, opt.gap ?? 0.0006) : opt.open ? openFingers(g.sample, P.curl, spread, off, opt.gap ?? 0.0006) : solveFingers(g.sample, spread, off, opt.gap ?? 0.0006, opt.w, opt.maxA)).map((c, i) => (opt.keep && opt.keep.includes(i) ? P.curl[i] : c));
  const th = opt.keepThumb ? null : searchThumb(g.sample, off, opt.thumbRef || P.thumb, 0.0006, opt.loose ? [0.2, 0.0] : [0.6, 0.4]);
  const r4 = (v) => +v.toFixed(4);
  const pose = { curl, spread, thumb: th ? th.d : P.thumb, center: [r4(C0[0] + dx), r4(C0[1] + dy), r4(C0[2] + dz)] };
  return { pose, before: poseReport(g.sample, P), after: poseReport(g.sample, { ...pose, center: C0 }, off), shift: [dx, dy, dz], thumbFound: !!th };
}
export const poseStr = (p) => JSON.stringify(p).replace(/"(\w+)":/g, '$1: ').replace(/,/g, ', ');

/** open each finger of `curl` (all joints together) until it is clear of the grid, then close its free distal joints */
export function openFingers(sdf, curl, spread, off, gap = 0.0006) {
  return curl.map((c, i) => {
    const clear = (a) => fingerChain(i, a, spread).every((s) => capsuleClear(sdf, s.a, s.b, s.r0, s.r1, off) >= gap);
    let s = 1;
    while (s > 0 && !clear(c.map((v) => v * s))) s -= 0.01;
    const a = c.map((v) => Math.max(0, v * s));
    // then close the middle and last joints (proximal held) until they touch
    for (const j of [1, 2]) {
      for (let k = 0; k < 300; k++) {
        const b = a.slice();
        b[j] += 0.005;
        if (b[j] > [1.6, 1.75, 1.2][j] || !clear(b)) break;
        a[j] = b[j];
      }
    }
    return a.map((v) => +v.toFixed(2));
  });
}

/** every finger by search: the most closed (a0 + a1 + a2, a2 tied to a1 like a real finger) that is clear of the grid */
export function searchFingers(sdf, spread, off, gap = 0.0006, keep = []) {
  return FINGERS.map((_, i) => {
    if (keep[i]) return keep[i];
    let best = null;
    for (let a0 = 0; a0 <= 1.6001; a0 += 0.04) for (let a1 = 0; a1 <= 1.7501; a1 += 0.04) {
      const a2 = Math.min(1.2, a1 * 0.7);
      const segs = fingerChain(i, [a0, a1, a2], spread);
      const cl = segs.map((s) => capsuleClear(sdf, s.a, s.b, s.r0, s.r1, off));
      if (Math.min(...cl) < gap) continue;
      // hug: the least room between the finger and the item along its length (a little credit for closing)
      const sc = -(Math.min(cl[0], 0.02) + Math.min(cl[1], 0.02) + 2 * Math.min(cl[2], 0.02)) + 0.002 * (a0 + a1 + a2);
      if (!best || sc > best.sc) best = { sc, a: [a0, a1, a2] };
    }
    return (best ? best.a : [0, 0, 0]).map((v) => +v.toFixed(2));
  });
}
