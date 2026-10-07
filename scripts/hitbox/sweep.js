// The whole of a map, swept: does what stops a shot or a body agree with what is drawn there? (docs/hitboxes.md)
//
// What is drawn is built here under node as the client builds it - every part of every place (walls, floors, posts,
// roofs), every prop's model where it stands, the city's buildings out of its kit (client/render/citykit.js), the
// bridge, the clinic's lining - and kept as triangles. Then from every spot a body can stand on (the
// ground, and every floor, deck, roof and car roof with headroom over it), on a grid `step` metres apart wherever
// anything is near, rays go out level in eight directions at three heights (a crawler's 0.35 m, a crouching chest's
// 1.0 m, the eye's 1.55 m) and are cast twice: at the colliders (as a bullet is, shared/collision.js) and at the
// triangles. Where the two answers differ by more than `tol`:
//   air    the colliders stop the ray in the open, short of anything drawn        (an invisible wall)
//   hole   the ray goes through something drawn that no collider stops            (a shot or a look through a solid)
// and the same again for a body (rays at 0.5 and 1.2 m, against everything that stops one walking: wire and
// railings too). Faults are counted by the cubic metre they fall in, so one bad prop seen from forty spots is one
// fault per metre of it, and named by what owns them (the prop type, the wall's material, the kit).
//
// Not covered: trees, boulders and bushes (their colliders are taken as drawn); the mine's drifts (their walls are
// not colliders: shared/mine.js); the rails and sleepers (walked over by design); the fair's rides while they turn;
// what is hidden from every standing spot; rays that are not level (a shot up at a roof).
//
// usage: node scripts/hitbox/sweep.js [--seed 1337] [--world island|mainland] [--before <tree>] [--step 2] [--tol 0.35]
//                                     [--out shots/pr/hitbox-pass/sweep] [--box x0,z0,x1,z1]
//   --before  another checkout: its colliders (its shared/ code) against the same drawn world, and both in the
//             picture and the table
import { join, resolve } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { THREE, modelOf, NOT_SOLID, SEE_THROUGH, GLASS } from './lib.js';
import { Canvas } from './draw.js';
import { parseArgs, REPO } from '../clip/lib.js';
import { STEP_HEIGHT, PLAYER_HEIGHT, WATER_LEVEL } from '../../shared/constants.js';
import { PROPS } from '../../shared/props.js';

const COL = { STATIC: 1, STRUCT: 2, HUMANPASS: 4, NOBLOCK: 8, TREE: 16, NOBULLET: 32, SALVAGE: 64 };
// what a model's or a wall's material is to a ray: 0 nothing (grass cards, stains, lettering, glass - a window has
// no collider and is shot and climbed through), 1 solid, 2 solid to a body only (chain link)
const DECALS = new Set([...NOT_SOLID, ...GLASS, 'blood', 'grime', 'stain', 'soot', 'damp', 'ivy', 'roadpaint', 'cityposter', 'graffiti']);
const kindOf = (mat) => (DECALS.has(mat) ? 0 : SEE_THROUGH.has(mat) ? 2 : 1);

// ---------------------------------------------------------------- what is drawn
class Soup {
  constructor() {
    this.chunks = []; // { pos: Float32Array, owner, kind }
    this.owners = [];
    this.ownerId = new Map();
    this.n = 0;
  }
  owner(name) {
    let id = this.ownerId.get(name);
    if (id === undefined) {
      id = this.owners.length;
      this.owners.push(name);
      this.ownerId.set(name, id);
    }
    return id;
  }
  add(pos, name, kind) {
    if (!kind || !pos.length) return;
    this.chunks.push({ pos, owner: this.owner(name), kind });
    this.n += pos.length / 9;
  }
  // every mesh under an object, in the world (a render class that builds three.js meshes: the bridge, the fair)
  harvest(root, name) {
    root.updateMatrixWorld(true);
    const v = new THREE.Vector3(), m = new THREE.Matrix4();
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry?.attributes?.position || o.visible === false) return;
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      const kind = mat?.transparent && (mat.opacity ?? 1) < 0.9 ? 0 : kindOf(mat?.name || '');
      if (!kind) return;
      const P = o.geometry.attributes.position, idx = o.geometry.index;
      const n = idx ? idx.count : P.count;
      const count = o.isInstancedMesh ? o.count : 1;
      const out = new Float32Array(n * 3 * count);
      let w = 0;
      for (let i = 0; i < count; i++) {
        if (o.isInstancedMesh) {
          o.getMatrixAt(i, m);
          m.premultiply(o.matrixWorld);
        } else m.copy(o.matrixWorld);
        for (let k = 0; k < n; k++) {
          v.fromBufferAttribute(P, idx ? idx.getX(k) : k).applyMatrix4(m);
          out[w++] = v.x;
          out[w++] = v.y;
          out[w++] = v.z;
        }
      }
      this.add(out, name, kind);
    });
  }
  finish(cell = 2) {
    const pos = new Float32Array(this.n * 9);
    const owner = new Uint16Array(this.n), kind = new Uint8Array(this.n);
    let t = 0;
    for (const c of this.chunks) {
      pos.set(c.pos, t * 9);
      owner.fill(c.owner, t, t + c.pos.length / 9);
      kind.fill(c.kind, t, t + c.pos.length / 9);
      t += c.pos.length / 9;
    }
    this.chunks = null;
    return { pos, owner, kind, owners: this.owners, grid: gridOf(pos, cell) };
  }
}

// triangles by the 2D cells their bounds touch: { cell, x0, z0, nx, nz, start: Int32Array, list: Int32Array }
function gridOf(pos, cell) {
  const n = pos.length / 9;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    if (pos[i] < x0) x0 = pos[i];
    if (pos[i] > x1) x1 = pos[i];
    if (pos[i + 2] < z0) z0 = pos[i + 2];
    if (pos[i + 2] > z1) z1 = pos[i + 2];
  }
  if (!n) return { cell, x0: 0, z0: 0, nx: 1, nz: 1, start: new Int32Array(2), list: new Int32Array(0), stamp: new Uint32Array(0) };
  const nx = Math.floor((x1 - x0) / cell) + 1, nz = Math.floor((z1 - z0) / cell) + 1;
  const count = new Int32Array(nx * nz + 1);
  const span = (t) => {
    const o = t * 9;
    const a = Math.floor((Math.min(pos[o], pos[o + 3], pos[o + 6]) - x0) / cell), b = Math.floor((Math.max(pos[o], pos[o + 3], pos[o + 6]) - x0) / cell);
    const c = Math.floor((Math.min(pos[o + 2], pos[o + 5], pos[o + 8]) - z0) / cell), d = Math.floor((Math.max(pos[o + 2], pos[o + 5], pos[o + 8]) - z0) / cell);
    return [a, b, c, d];
  };
  for (let t = 0; t < n; t++) {
    const [a, b, c, d] = span(t);
    for (let k = c; k <= d; k++) for (let i = a; i <= b; i++) count[k * nx + i + 1]++;
  }
  for (let i = 0; i < nx * nz; i++) count[i + 1] += count[i];
  const start = count.slice();
  const fill = count.slice(0, nx * nz);
  const list = new Int32Array(start[nx * nz]);
  for (let t = 0; t < n; t++) {
    const [a, b, c, d] = span(t);
    for (let k = c; k <= d; k++) for (let i = a; i <= b; i++) list[fill[k * nx + i]++] = t;
  }
  return { cell, x0, z0, nx, nz, start, list, stamp: new Uint32Array(n) };
}

let stampN = 1;
// the nearest triangle of a set (pos, grid) a ray meets within maxT; mask: which kinds count (bit 1 solid, 2 mesh)
const _hit = { t: -1, tri: -1 };
function raySet(set, ox, oy, oz, dx, dy, dz, maxT, mask, out = _hit) {
  const { pos, grid: g, kind } = set;
  out.t = -1;
  out.tri = -1;
  let best = maxT;
  const stamp = ++stampN;
  const ex = ox + dx * maxT, ez = oz + dz * maxT;
  const i0 = Math.max(0, Math.floor((Math.min(ox, ex) - g.x0) / g.cell)), i1 = Math.min(g.nx - 1, Math.floor((Math.max(ox, ex) - g.x0) / g.cell));
  const k0 = Math.max(0, Math.floor((Math.min(oz, ez) - g.z0) / g.cell)), k1 = Math.min(g.nz - 1, Math.floor((Math.max(oz, ez) - g.z0) / g.cell));
  const hl = Math.hypot(dx, dz) || 1;
  const reach = g.cell * 0.71;
  for (let k = k0; k <= k1; k++) {
    for (let i = i0; i <= i1; i++) {
      // (a cell the ray does not come near: its middle is further from the ray's line than half its diagonal)
      const cx = g.x0 + (i + 0.5) * g.cell - ox, cz = g.z0 + (k + 0.5) * g.cell - oz;
      if (Math.abs(cx * dz - cz * dx) / hl > reach) continue;
      const c = k * g.nx + i;
      for (let q = g.start[c], end = g.start[c + 1]; q < end; q++) {
        const t = g.list[q];
        if (g.stamp[t] === stamp) continue;
        g.stamp[t] = stamp;
        if (kind && !(kind[t] & mask)) continue;
        const o = t * 9;
        const ax = pos[o], ay = pos[o + 1], az = pos[o + 2];
        const e1x = pos[o + 3] - ax, e1y = pos[o + 4] - ay, e1z = pos[o + 5] - az;
        const e2x = pos[o + 6] - ax, e2y = pos[o + 7] - ay, e2z = pos[o + 8] - az;
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (det > -1e-10 && det < 1e-10) continue;
        const inv = 1 / det;
        const tx = ox - ax, ty = oy - ay, tz = oz - az;
        const u = (tx * px + ty * py + tz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
        const w = (dx * qx + dy * qy + dz * qz) * inv;
        if (w < 0 || u + w > 1) continue;
        const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (tt < 0 || tt >= best) continue;
        best = tt;
        out.t = tt;
        out.tri = t;
      }
    }
  }
  return out;
}

function partTris(part) {
  let g;
  if (part.shape === 'box') g = new THREE.BoxGeometry(part.sx, part.sy, part.sz);
  else if (part.shape === 'cyl') g = new THREE.CylinderGeometry(part.sx / 2, part.sx / 2, part.sy, part.sides || 12, 1);
  else if (part.shape === 'cone') g = new THREE.ConeGeometry(part.sx / 2, part.sy, part.sides || 4, 1);
  else {
    const hx = part.sx / 2, hy = part.sy / 2, hz = part.sz / 2;
    const A = [-hx, -hy], Bq = [hx, -hy], T = [0, hy];
    const p = [A[0], A[1], hz, Bq[0], Bq[1], hz, T[0], T[1], hz, Bq[0], Bq[1], -hz, A[0], A[1], -hz, T[0], T[1], -hz];
    const quad = (p0, p1, p2, p3) => p.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3);
    quad([A[0], A[1], -hz], [A[0], A[1], hz], [T[0], T[1], hz], [T[0], T[1], -hz]);
    quad([Bq[0], Bq[1], hz], [Bq[0], Bq[1], -hz], [T[0], T[1], -hz], [T[0], T[1], hz]);
    // (a gable's underside is the room's ceiling line)
    quad([A[0], A[1], hz], [A[0], A[1], -hz], [Bq[0], Bq[1], -hz], [Bq[0], Bq[1], hz]);
    g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  }
  const m = new THREE.Matrix4().compose(new THREE.Vector3(part.x, part.y, part.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(part.rx || 0, part.ry || 0, part.rz || 0, 'XYZ')), new THREE.Vector3(1, 1, 1));
  const ng = g.index ? g.toNonIndexed() : g;
  const P = ng.attributes.position;
  const out = new Float32Array(P.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) {
    v.fromBufferAttribute(P, i).applyMatrix4(m);
    out[i * 3] = v.x;
    out[i * 3 + 1] = v.y;
    out[i * 3 + 2] = v.z;
  }
  return out;
}

export async function drawnWorld(world, log = () => {}) {
  const soup = new Soup();
  for (const part of world.parts) {
    if (part.hidden) continue; // (the city's kit draws it its own way)
    soup.add(partTris(part), 'wall:' + part.mat, part.mat === 'glass' ? 0 : kindOf(part.mat));
  }
  log(`  parts: ${soup.n} triangles`);
  if (world.city) {
    const { buildCity } = await import('../../client/render/citykit.js');
    buildCity(world, (x, z, mat, tpl) => soup.add(tpl.pos instanceof Float32Array ? tpl.pos : new Float32Array(tpl.pos), 'city:' + mat, kindOf(mat)));
    log(`  + the city's kit: ${soup.n}`);
  }
  const scene = new THREE.Scene();
  const tryView = async (name, make) => {
    try {
      const before = scene.children.length;
      const got = await make();
      const root = got && got.isObject3D ? got : got?.group || got?.root || null;
      if (root) soup.harvest(root, name);
      for (const o of scene.children.slice(before)) soup.harvest(o, name);
    } catch (e) {
      log(`  (${name}: not built here - ${String(e.message).slice(0, 80)})`);
    }
  };
  if (world.bridge) await tryView('bridge', async () => new (await import('../../client/render/bridge.js')).BridgeView(scene, world));
  await tryView('clinic', async () => (await import('../../client/render/clinic.js')).buildClinic(world));
  log(`  + the bridge, the clinic: ${soup.n}`);
  const fixed = soup.finish(2);
  // the props: one set of triangles a model, a place and a turn each
  const models = new Map();
  const props = [];
  const names = [];
  for (const pr of world.props) {
    const key = pr.type + ':' + pr.seed;
    let m = models.get(key);
    if (m === undefined) {
      try {
        const mo = modelOf(pr.type, pr.seed);
        const kind = new Uint8Array(mo.mat.length);
        let r = 0;
        // (a pane of a prop - a bus shelter's, a car's - is in its colliders and stops a shot; a building's window is not)
        for (let t = 0; t < kind.length; t++) kind[t] = GLASS.has(mo.mat[t]) ? 1 : kindOf(mo.mat[t]);
        for (let i = 0; i < mo.pos.length; i += 3) r = Math.max(r, Math.hypot(mo.pos[i], mo.pos[i + 2]));
        m = { pos: mo.pos, kind, grid: gridOf(mo.pos, 0.6), r };
      } catch (e) {
        m = null;
      }
      models.set(key, m);
    }
    if (!m) continue;
    let name = names.indexOf(pr.type);
    if (name < 0) name = names.push(pr.type) - 1;
    props.push({ x: pr.x, y: pr.y, z: pr.z, c: Math.cos(pr.ry), s: Math.sin(pr.ry), m, name });
  }
  const pcell = 8;
  const pgrid = new Map();
  for (const p of props) {
    for (let k = Math.floor((p.z - p.m.r) / pcell); k <= Math.floor((p.z + p.m.r) / pcell); k++) for (let i = Math.floor((p.x - p.m.r) / pcell); i <= Math.floor((p.x + p.m.r) / pcell); i++) {
      const key = i * 65536 + k;
      if (!pgrid.has(key)) pgrid.set(key, []);
      pgrid.get(key).push(p);
    }
  }
  log(`  + ${props.length} props of ${models.size} models`);
  // trees and boulders stand as their colliders (not covered: see the top of the file)
  return { fixed, props, pgrid, pcell, names };
}

const _h2 = { t: -1, tri: -1 };
// what a ray meets of the drawn world: { t, owner (a name) }. mask as raySet's
function rayDrawn(D, ox, oy, oz, dx, dy, dz, maxT, mask, out) {
  let best = maxT, who = null;
  const h = raySet(D.fixed, ox, oy, oz, dx, dy, dz, best, mask, _h2);
  if (h.t >= 0) {
    best = h.t;
    who = D.fixed.owners[D.fixed.owner[h.tri]];
  }
  const ex = ox + dx * maxT, ez = oz + dz * maxT;
  const pc = D.pcell;
  const seen = (rayDrawn.seen ||= new Set());
  seen.clear();
  for (let k = Math.floor(Math.min(oz, ez) / pc); k <= Math.floor(Math.max(oz, ez) / pc); k++) for (let i = Math.floor(Math.min(ox, ex) / pc); i <= Math.floor(Math.max(ox, ex) / pc); i++) {
    const list = D.pgrid.get(i * 65536 + k);
    if (!list) continue;
    for (const p of list) {
      if (seen.has(p)) continue;
      seen.add(p);
      // (the ray's nearest approach to it, seen from above)
      const rx = p.x - ox, rz = p.z - oz;
      const hl = Math.hypot(dx, dz) || 1;
      const along = (rx * dx + rz * dz) / hl;
      if (along < -p.m.r || along > best * hl + p.m.r || Math.abs(rx * dz - rz * dx) / hl > p.m.r) continue;
      const qx = ox - p.x, qz = oz - p.z;
      const lox = p.c * qx - p.s * qz, loz = p.s * qx + p.c * qz;
      const ldx = p.c * dx - p.s * dz, ldz = p.s * dx + p.c * dz;
      const r = raySet(p.m, lox, oy - p.y, loz, ldx, dy, ldz, best, mask, _h2);
      if (r.t >= 0 && r.t < best) {
        best = r.t;
        who = D.names[p.name];
      }
    }
  }
  out.t = who === null ? -1 : best;
  out.owner = who;
  return out;
}

// how far a point is from the nearest triangle of a set, if nearer than maxD (else maxD)
function nearSet(set, px, py, pz, maxD, mask) {
  const { pos, grid: g, kind } = set;
  let best = maxD * maxD;
  const i0 = Math.max(0, Math.floor((px - maxD - g.x0) / g.cell)), i1 = Math.min(g.nx - 1, Math.floor((px + maxD - g.x0) / g.cell));
  const k0 = Math.max(0, Math.floor((pz - maxD - g.z0) / g.cell)), k1 = Math.min(g.nz - 1, Math.floor((pz + maxD - g.z0) / g.cell));
  const stamp = ++stampN;
  for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
    const c = k * g.nx + i;
    for (let q = g.start[c], end = g.start[c + 1]; q < end; q++) {
      const t = g.list[q];
      if (g.stamp[t] === stamp) continue;
      g.stamp[t] = stamp;
      if (kind && !(kind[t] & mask)) continue;
      const o = t * 9;
      const d2 = pointTri2(px, py, pz, pos[o], pos[o + 1], pos[o + 2], pos[o + 3], pos[o + 4], pos[o + 5], pos[o + 6], pos[o + 7], pos[o + 8]);
      if (d2 < best) best = d2;
    }
  }
  return Math.sqrt(best);
}
// the square of the distance from a point to a triangle (Ericson, Real-Time Collision Detection 5.1.5)
function pointTri2(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let qx, qy, qz;
  if (d1 <= 0 && d2 <= 0) [qx, qy, qz] = [ax, ay, az];
  else {
    const bpx = px - bx, bpy = py - by, bpz = pz - bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) [qx, qy, qz] = [bx, by, bz];
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3 || 1);
        [qx, qy, qz] = [ax + abx * v, ay + aby * v, az + abz * v];
      } else {
        const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
        const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) [qx, qy, qz] = [cx, cy, cz];
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) {
            const w = d2 / (d2 - d6 || 1);
            [qx, qy, qz] = [ax + acx * w, ay + acy * w, az + acz * w];
          } else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
              const w = (d4 - d3) / (d4 - d3 + (d5 - d6) || 1);
              [qx, qy, qz] = [bx + (cx - bx) * w, by + (cy - by) * w, bz + (cz - bz) * w];
            } else {
              const den = 1 / (va + vb + vc || 1);
              const v = vb * den, w = vc * den;
              [qx, qy, qz] = [ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w];
            }
          }
        }
      }
    }
  }
  return (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2;
}
// ...from anything drawn
function nearDrawn(D, px, py, pz, maxD, mask) {
  let best = nearSet(D.fixed, px, py, pz, maxD, mask);
  const pc = D.pcell;
  for (let k = Math.floor((pz - maxD) / pc); k <= Math.floor((pz + maxD) / pc); k++) for (let i = Math.floor((px - maxD) / pc); i <= Math.floor((px + maxD) / pc); i++) {
    for (const p of D.pgrid.get(i * 65536 + k) || []) {
      const qx = px - p.x, qz = pz - p.z;
      if (Math.hypot(qx, qz) > p.m.r + best) continue;
      best = Math.min(best, nearSet(p.m, p.c * qx - p.s * qz, py - p.y, p.s * qx + p.c * qz, best, mask));
    }
  }
  return best;
}

// ---------------------------------------------------------------- the colliders
// how far a point is from the nearest collider (0: inside one), if nearer than maxD
function nearCol(world, px, py, pz, maxD, skip, feet) {
  let best = maxD;
  for (const c of world.staticGrid.query(px, pz, maxD, _q)) {
    if (c.flags & skip || c.y1 <= feet) continue;
    const dy = Math.max(c.y0 - py, py - c.y1, 0);
    const rx = px - c.x, rz = pz - c.z;
    let dh;
    if (c.type === 1) dh = Math.max(0, Math.hypot(rx, rz) - c.r);
    else dh = Math.hypot(Math.max(0, Math.abs(c.c * rx - c.s * rz) - c.hx), Math.max(0, Math.abs(c.s * rx + c.c * rz) - c.hz));
    const d = Math.hypot(dh, dy);
    if (d < best) best = d;
  }
  return best;
}
function rayCol(c, ox, oy, oz, dx, dy, dz, maxT) {
  let tmin = 0, tmax = maxT;
  if (Math.abs(dy) < 1e-9) {
    if (oy < c.y0 || oy > c.y1) return -1;
  } else {
    let t1 = (c.y0 - oy) / dy, t2 = (c.y1 - oy) / dy;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  const rx = ox - c.x, rz = oz - c.z;
  if (c.type === 1) {
    const a = dx * dx + dz * dz;
    if (a < 1e-12) return rx * rx + rz * rz <= c.r * c.r ? tmin : -1;
    const b = 2 * (rx * dx + rz * dz), cc = rx * rx + rz * rz - c.r * c.r;
    const disc = b * b - 4 * a * cc;
    if (disc < 0) return -1;
    const sq = Math.sqrt(disc);
    const t1 = (-b - sq) / (2 * a), t2 = (-b + sq) / (2 * a);
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    return tmin > tmax ? -1 : tmin;
  }
  const lox = c.c * rx - c.s * rz, loz = c.s * rx + c.c * rz, ldx = c.c * dx - c.s * dz, ldz = c.s * dx + c.c * dz;
  for (const [o, d, h] of [[lox, ldx, c.hx], [loz, ldz, c.hz]]) {
    if (Math.abs(d) < 1e-9) {
      if (o < -h || o > h) return -1;
    } else {
      let t1 = (-h - o) / d, t2 = (h - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}
const inFoot = (c, x, z, r = 0) => {
  const dx = x - c.x, dz = z - c.z;
  if (c.type === 1) return dx * dx + dz * dz <= (c.r + r) * (c.r + r);
  return Math.abs(c.c * dx - c.s * dz) <= c.hx + r && Math.abs(c.s * dx + c.c * dz) <= c.hz + r;
};
// trees and boulders are not swept (a boulder is a cylinder nothing owns)
const veg = (c) => !!(c.flags & COL.TREE) || (c.type === 1 && c.tag === null);
const _q = [];
function rayWorld(world, ox, oy, oz, dx, dy, dz, maxT, skip, out, feet = -Infinity) {
  let best = maxT, col = null;
  const mx = ox + (dx * maxT) / 2, mz = oz + (dz * maxT) / 2;
  for (const c of world.staticGrid.query(mx, mz, maxT / 2 + 0.1, _q)) {
    if (c.flags & skip || c.y1 <= feet) continue;
    const t = rayCol(c, ox, oy, oz, dx, dy, dz, best);
    if (t >= 0 && t < best) {
      best = t;
      col = c;
    }
  }
  out.t = col ? best : -1;
  out.col = col;
  return out;
}
const nameOf = (c) => (!c ? 'ground' : typeof c.tag === 'string' ? 'wall:' + c.tag : c.tag?.type || (c.flags & COL.TREE ? 'tree' : 'world'));

// ---------------------------------------------------------------- the sweep
const DIRS = [...Array(8).keys()].map((i) => [Math.cos((i * Math.PI) / 4 + 0.1), Math.sin((i * Math.PI) / 4 + 0.1)]);
const SHOT_H = [0.35, 1.0, 1.55], WALK_H = [0.5, 1.2];

/**
 * Sweep `world`'s colliders (and, with `before`, those of the same world as another build makes it) against what is
 * drawn. Returns { spots, rays, runs: [{ name, faults: Map(key -> { kind, mode, x, y, z, owner, d, rays }) }] }.
 */
export function sweep(world, D, o = {}) {
  const step = o.step || 2, tol = o.tol || 0.35, L = o.len || 5;
  const worlds = [['after', world]];
  if (o.before) worlds.unshift(['before', o.before]);
  const runs = worlds.map(([name, w]) => ({ name, w, faults: new Map(), bad: 0 }));
  const box = o.box || [-world.half, -world.half, world.half, world.half];
  const cq = [];
  const rd = { t: -1, owner: null }, rc = { t: -1, col: null };
  let spots = 0, rays = 0;
  const near = (x, z) => world.staticGrid.query(x, z, 4, cq).some((c) => !veg(c)) || (o.before && o.before.staticGrid.query(x, z, 4, cq).some((c) => !veg(c)));
  const note = (run, kind, mode, x, y, z, owner, d) => {
    const key = `${kind}|${mode}|${Math.floor(x)}|${Math.floor(y)}|${Math.floor(z)}`;
    let f = run.faults.get(key);
    if (!f) run.faults.set(key, (f = { kind, mode, x, y, z, owner, d: 0, rays: 0 }));
    f.rays++;
    if (d > f.d) {
      f.d = d;
      f.owner = owner;
    }
    run.bad++;
  };
  // ---- every spot a body could stand on: the ground, and every top with headroom over it (in either build)
  const cols = Math.ceil((box[2] - box[0]) / step), rows = Math.ceil((box[3] - box[1]) / step);
  const at = new Map(); // cell -> [{ x, z, y, ok }]
  const all = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = box[0] + (i + 0.5) * step, z = box[1] + (j + 0.5) * step;
      if (!near(x, z)) continue;
      const ground = world.heightAt(x, z);
      const wet = world.isDeepWater(x, z);
      const levels = wet ? [] : [ground];
      for (const [, w] of worlds) for (const c of w.staticGrid.query(x, z, 0.1, cq)) if (!(c.flags & (COL.NOBLOCK | COL.TREE)) && c.y1 > ground + 0.05 && c.y1 < ground + 60 && inFoot(c, x, z) && !levels.some((y) => Math.abs(y - c.y1) < 0.2)) levels.push(c.y1);
      const list = [];
      for (const y of levels) {
        // (a spot inside something, in either build, is no spot)
        let free = true;
        for (const [, w] of worlds) for (const c of w.staticGrid.query(x, z, 0.3, cq)) if (!(c.flags & COL.NOBLOCK) && c.y0 < y + PLAYER_HEIGHT - 0.1 && c.y1 > y + 0.05 && inFoot(c, x, z, 0.25)) free = false;
        if (free) list.push({ x, z, y, i, j, ok: !wet && y < ground + 0.06 });
      }
      if (!list.length) continue;
      at.set(j * cols + i, list);
      all.push(...list);
    }
  }
  // ...of which the ones a body can get to: from the open ground, spot to neighbouring spot by a walk, a stair, a
  // jump up or a drop down. (Generous on purpose - a rise of `climb` between neighbours passes for a stair: the
  // sweep would rather look at a ledge nobody reaches than miss a landing. What it leaves out is the roofs of the
  // towers and whatever else has no way up.)
  const climb = o.climb ?? Math.max(1.4, step * 1.15);
  const queue = all.filter((s) => s.ok);
  for (let n = 0; n < queue.length; n++) {
    const s = queue[n];
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      for (const t of at.get((s.j + dj) * cols + s.i + di) || []) {
        if (t.ok || t.y - s.y > climb) continue;
        t.ok = true;
        queue.push(t);
      }
    }
  }
  const unreached = all.length - queue.length;
  for (const { x, z, y } of queue) {
        spots++;
        for (const [hs, mode] of [[SHOT_H, 'shot'], [WALK_H, 'walk']]) {
          for (const h of hs) {
            const oy = y + h;
            for (const [dx, dz] of DIRS) {
              rays++;
              const mask = mode === 'walk' ? 3 : 1;
              let tv = rayDrawn(D, x, oy, z, dx, 0, dz, L + tol, mask, rd).t;
              const vOwner = rd.owner;
              const tt = world.rayTerrain(x, oy, z, dx, 0, dz, L + tol);
              if (tv < 0) tv = Infinity;
              const terr = tt >= 0 ? tt : Infinity;
              for (const run of runs) {
                // a bullet: everything but wire, railings and traps. a body: everything but traps and what a survivor
                // walks through, and nothing it steps over
                const skip = mode === 'shot' ? COL.NOBULLET | COL.NOBLOCK : COL.NOBLOCK | COL.HUMANPASS;
                rayWorld(run.w, x, oy, z, dx, 0, dz, L + tol, skip, rc, mode === 'walk' ? y + STEP_HEIGHT : -Infinity);
                let tc = rc.t < 0 ? Infinity : rc.t;
                let v = tv;
                if (rc.col && veg(rc.col)) v = Math.min(v, tc); // (a tree is drawn where its collider is)
                const stopC = Math.min(tc, terr), stopV = Math.min(v, terr);
                if (stopC < 0.05 || stopV < 0.05) continue;
                if (stopV - stopC > tol && stopC < L) {
                  // (a ray that clips the corner of a box an inch proud of its model is no invisible wall: the fault
                  // is how far the spot it stopped at is from anything drawn, whichever way)
                  const px = x + dx * stopC, pz = z + dz * stopC;
                  let d = Math.min(stopV, L + tol) - stopC;
                  d = Math.min(d, Math.max(0, oy - world.heightAt(px, pz)));
                  if (d > tol) d = Math.min(d, nearDrawn(D, px, oy, pz, Math.min(d, 1.5), mask));
                  if (d > tol) note(run, 'air', mode, px, oy, pz, nameOf(rc.col), d);
                } else if (stopC - stopV > tol && stopV < L) {
                  // (...and a ray through the edge of a model that pokes an inch out of its box is no hole)
                  const px = x + dx * stopV, pz = z + dz * stopV;
                  let d = Math.min(stopC, L + tol) - stopV;
                  d = Math.min(d, nearCol(run.w, px, oy, pz, Math.min(d, 1.5), skip, mode === 'walk' ? y + STEP_HEIGHT : -Infinity));
                  // (railings and wire are made to be shot through: a collider that stops bodies only stands there)
                  if (d > tol && mode === 'shot' && nearCol(run.w, px, oy, pz, tol, COL.NOBLOCK, -Infinity) < tol) d = 0;
                  if (d > tol) note(run, 'hole', mode, px, oy, pz, vOwner || 'ground', d);
                }
              }
            }
          }
        }
  }
  return { spots, rays, runs, unreached };

}

// What is meant to be as it is, and why: a fault of one of these kinds is counted apart ("by design").
export function designOf(kind, mode, owner) {
  const def = PROPS[owner];
  if (kind === 'air' && mode === 'shot' && owner === 'fence_chain') return 'chain link stops a shot (left as it was: docs/hitboxes.md)';
  if (kind === 'hole' && def && !def.boxes && !def.cyls) return 'a prop with no collider: walked through on purpose';
  if (kind === 'hole' && owner === 'car_open') return 'the open doors of a car stop nobody';
  if (kind === 'hole' && owner === 'boom_gate') return 'the arm of a boom gate stops nobody';
  if (kind === 'hole' && /^(wall|city):/.test(owner)) return 'drawn without a collider: a roof slope, a tilted slab, a fire escape, a cornice';
  if (kind === 'hole' && owner === 'bridge') return 'the bridge is stood on by its own floor (shared/bridge.js), its trusses are not colliders';
  return null;
}
export function summary(run) {
  const by = new Map();
  const tot = { air: { shot: 0, walk: 0 }, hole: { shot: 0, walk: 0 } };
  const open = { air: { shot: 0, walk: 0 }, hole: { shot: 0, walk: 0 } }; // (what is not by design)
  for (const f of run.faults.values()) {
    tot[f.kind][f.mode]++;
    if (!designOf(f.kind, f.mode, f.owner)) open[f.kind][f.mode]++;
    const k = `${f.kind} ${f.mode} ${f.owner}`;
    const e = by.get(k) || { kind: f.kind, mode: f.mode, owner: f.owner, n: 0, d: 0, at: null };
    e.n++;
    if (f.d > e.d) {
      e.d = f.d;
      e.at = [f.x, f.y, f.z];
    }
    by.set(k, e);
  }
  return { tot, open, by: [...by.values()].sort((a, b) => b.n - a.n) };
}

// the map from above with every fault on it: red where the colliders stop a ray in the open, blue where a ray goes
// through what is drawn (bright: a shot; dim: a body)
export function mapOf(world, run, title, size = 1000, box = null) {
  const cv = new Canvas(size, size + 40, [12, 14, 16]);
  const b = box || [-world.half, -world.half, world.half, world.half];
  const k = size / Math.max(b[2] - b[0], b[3] - b[1]);
  const sx = (x) => (x - b[0]) * k, sy = (z) => 40 + (z - b[1]) * k;
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const x = b[0] + (px + 0.5) / k, z = b[1] + (py + 0.5) / k;
    const h = world.heightAt(x, z);
    const road = world.roadDistAt ? world.roadDistAt(x, z) < 3 : false;
    const c = h < WATER_LEVEL ? [28, 46, 66] : road ? [78, 76, 70] : [38 + Math.min(40, h * 1.2), 52 + Math.min(40, h * 1.2), 40 + Math.min(30, h)];
    cv.px(px, py + 40, c);
  }
  const seen = new Set();
  for (const cell of run.w.staticGrid.cells) for (const c of cell) {
    if (seen.has(c) || veg(c)) continue;
    seen.add(c);
    const r = Math.max(1, Math.round(Math.max(c.hx, c.hz) * k * 0.7));
    cv.rect(Math.round(sx(c.x)) - r, Math.round(sy(c.z)) - r, r * 2, r * 2, [150, 150, 150], 0.25);
  }
  const dot = Math.max(1, Math.round(k * 0.9));
  for (const f of run.faults.values()) {
    if (designOf(f.kind, f.mode, f.owner)) continue; // (what is meant to be as it is is not on the picture)
    const col = f.kind === 'air' ? (f.mode === 'shot' ? [255, 60, 50] : [255, 150, 60]) : f.mode === 'shot' ? [70, 150, 255] : [90, 230, 230];
    cv.disc(Math.round(sx(f.x)), Math.round(sy(f.z)), dot, col, 0.9);
  }
  cv.rect(0, 0, size, 40, [0, 0, 0]);
  const s = summary(run).open;
  cv.text(title, 8, 4, [255, 255, 255], 2);
  cv.text(`faults not by design, by the cubic metre.  stops in the open: shot ${s.air.shot} (red)  body ${s.air.walk} (orange)   goes through: shot ${s.hole.shot} (blue)  body ${s.hole.walk} (cyan)`, 8, 24, [220, 220, 220], 1);
  return cv;
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/hitbox/sweep.js')) {
  const args = parseArgs(process.argv.slice(2), { seed: '1337', world: 'island', out: join(REPO, 'shots', 'pr', 'hitbox-pass', 'sweep'), step: '2', tol: '0.35' });
  const act = args.world === 'mainland' ? 2 : 1;
  const t0 = Date.now();
  const { worldFor } = await import('../../shared/worlds.js');
  const world = worldFor(+args.seed, act);
  let before = null;
  if (args.before) before = (await import(pathToFileURL(join(resolve(String(args.before)), 'shared', 'worlds.js')).href)).worldFor(+args.seed, act);
  console.log(`${args.world} seed ${args.seed}: building what is drawn...`);
  const D = await drawnWorld(world, console.log);
  const box = args.box ? String(args.box).split(',').map(Number) : null;
  const res = sweep(world, D, { before, step: +args.step, tol: +args.tol, box });
  console.log(`${res.spots} standing spots (and ${res.unreached} more with no way up to them, not swept), ${res.rays} rays, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  const out = resolve(String(args.out));
  mkdirSync(out, { recursive: true });
  const report = {};
  for (const run of res.runs) {
    const s = summary(run);
    report[run.name] = { rays: res.rays, spots: res.spots, unreached: res.unreached, badRays: run.bad, totals: s.tot, notByDesign: s.open, by: s.by.slice(0, 60) };
    console.log(`\n${run.name}: ${run.bad} of ${res.rays} rays disagree (${((run.bad / res.rays) * 100).toFixed(2)}%).  faults by the cubic metre - stops in the open: shot ${s.tot.air.shot}, body ${s.tot.air.walk}; goes through: shot ${s.tot.hole.shot}, body ${s.tot.hole.walk}`);
    console.log(`  ...of which not by design - stops in the open: shot ${s.open.air.shot}, body ${s.open.air.walk}; goes through: shot ${s.open.hole.shot}, body ${s.open.hole.walk}`);
    for (const e of s.by.slice(0, +(args.top || 25))) console.log(`  ${String(e.n).padStart(5)}  ${e.kind.padEnd(4)} ${e.mode.padEnd(4)} ${String(e.owner).padEnd(26)} worst ${e.d.toFixed(2)} m at /tp ${e.at[0].toFixed(1)} ${e.at[2].toFixed(1)} (y ${e.at[1].toFixed(1)})${designOf(e.kind, e.mode, e.owner) ? '   [by design]' : ''}`);
    mapOf(world, run, `${args.world} seed ${args.seed}: ${run.name.toUpperCase()}`, 1000, box).save(join(out, `${args.world}-${args.seed}-${run.name}.png`));
  }
  writeFileSync(join(out, `${args.world}-${args.seed}.json`), JSON.stringify(report, null, 1));
}
