// Builds the static world: building primitives (from shared world gen) and props (procedural models)
// merged per spatial chunk and per material -> a handful of draw calls, frustum + distance culled.
import * as THREE from 'three';
import { getMaterial, staticSurface } from './materials.js';
import { createProp } from './models/props.js';

const CHUNK = 80;
const IDENTITY = new THREE.Matrix4();
// A (chunk, material) mesh whose largest piece has bounding radius r is drawn out to r * DETAIL_DIST
// (never closer than DETAIL_MIN): bottles, cans and tail lights stop costing a draw call once they are a
// few pixels wide, while anything with a building, wall or car in it keeps the full view distance.
const DETAIL_DIST = 280;
const DETAIL_MIN = 60;

function templateRadius(pos) {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    x0 = Math.min(x0, pos[i]);
    x1 = Math.max(x1, pos[i]);
    y0 = Math.min(y0, pos[i + 1]);
    y1 = Math.max(y1, pos[i + 1]);
    z0 = Math.min(z0, pos[i + 2]);
    z1 = Math.max(z1, pos[i + 2]);
  }
  return 0.5 * Math.hypot(x1 - x0, y1 - y0, z1 - z0);
}

// transform of a mesh relative to the prop root (props are usually flat: identity)
function localMatrix(o, root) {
  const m = new THREE.Matrix4();
  const chain = [];
  for (let n = o; n && n !== root; n = n.parent) chain.push(n);
  for (let i = chain.length - 1; i >= 0; i--) {
    chain[i].updateMatrix();
    m.multiply(chain[i].matrix);
  }
  return m;
}

// faded paint for clapboard buildings (sRGB; white and cream turn up most often)
const PAINT = [0xffffff, 0xffffff, 0xf0eadf, 0xf0eadf, 0xd9e0e4, 0xdbe0d0, 0xf0e8cf, 0xd8e3db, 0xdedcd8, 0xeedfda].map((h) => new THREE.Color(h));

// one paint colour per building: painted parts that touch (walls, gable ends, towers) form a building
function paintByBuilding(parts) {
  const idx = [];
  parts.forEach((p, i) => p.mat === 'clapboard' && idx.push(i));
  const parent = idx.map((_, k) => k);
  const find = (k) => (parent[k] === k ? k : (parent[k] = find(parent[k])));
  const box = idx.map((i) => {
    const p = parts[i];
    const r = Math.max(p.sx, p.sz) / 2 + 0.3;
    return [p.x - r, p.x + r, p.z - r, p.z + r, p.y - p.sy / 2 - 0.3, p.y + p.sy / 2 + 0.3];
  });
  for (let a = 0; a < idx.length; a++) {
    for (let b = a + 1; b < idx.length; b++) {
      const A = box[a];
      const B = box[b];
      if (A[0] < B[1] && B[0] < A[1] && A[2] < B[3] && B[2] < A[3] && A[4] < B[5] && B[4] < A[5]) parent[find(a)] = find(b);
    }
  }
  const tint = new Map();
  idx.forEach((i, k) => {
    const root = parts[idx[find(k)]];
    const h = Math.abs(Math.sin(Math.round(root.x) * 12.9898 + Math.round(root.z) * 78.233) * 43758.5453) % 1;
    tint.set(i, PAINT[Math.floor(h * PAINT.length)]);
  });
  return tint;
}

// Window joinery around a glass part, as boxes [x, y, z, sx, sy, sz] in its frame (x along the wall, y up,
// z through it): casing and sill proud of both wall faces, a sash around the pane and muntins across it.
function windowTrim(sx, sy, t) {
  const d = t + 0.06;
  const out = [
    [-(sx / 2 + 0.045), 0.015, 0, 0.09, sy + 0.17, d],
    [sx / 2 + 0.045, 0.015, 0, 0.09, sy + 0.17, d],
    [0, sy / 2 + 0.05, 0, sx + 0.34, 0.1, d + 0.01],
    [0, -sy / 2 - 0.035, 0, sx + 0.3, 0.07, t + 0.16],
    [-(sx / 2 - 0.025), 0, 0, 0.05, sy, 0.07],
    [sx / 2 - 0.025, 0, 0, 0.05, sy, 0.07],
    [0, sy / 2 - 0.025, 0, sx - 0.1, 0.05, 0.07],
    [0, -sy / 2 + 0.025, 0, sx - 0.1, 0.05, 0.07],
  ];
  const nx = Math.min(3, Math.max(1, Math.round(sx / 0.6)));
  const ny = Math.min(2, Math.max(1, Math.round(sy / 0.6)));
  for (let k = 1; k < nx; k++) out.push([-sx / 2 + (k * sx) / nx, 0, 0, 0.035, sy - 0.1, 0.05]);
  for (let k = 1; k < ny; k++) out.push([0, -sy / 2 + (k * sy) / ny, 0, sx - 0.1, 0.035, 0.05]);
  return out;
}

// wall material -> door casing material
const DOOR_TRIM = { clapboard: 'sash', logwall: 'trim', planks: 'trim', brick: 'trim', concrete: 'trim' };

function boxGeo(sx, sy, sz) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  const uv = g.attributes.uv;
  // faces: +x, -x, +y, -y, +z, -z (4 verts each) -> meters
  const dims = [
    [sz, sy],
    [sz, sy],
    [sx, sz],
    [sx, sz],
    [sx, sy],
    [sx, sy],
  ];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]);
    }
  }
  return g;
}

function cylGeo(r, h, sides) {
  const g = new THREE.CylinderGeometry(r, r, h, sides, 1);
  const uv = g.attributes.uv;
  const circ = Math.PI * 2 * r;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ, uv.getY(i) * h);
  return g;
}

function coneGeo(r, h, sides) {
  const g = new THREE.ConeGeometry(r, h, sides, 1);
  const uv = g.attributes.uv;
  const slant = Math.hypot(r, h);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * 2 * r, uv.getY(i) * slant);
  return g;
}

function prismGeo(sx, sy, sz) {
  const hx = sx / 2;
  const hy = sy / 2;
  const hz = sz / 2;
  const A = [-hx, -hy];
  const B = [hx, -hy];
  const T = [0, hy];
  const pos = [];
  const uvs = [];
  const tri = (p, u) => {
    pos.push(...p);
    uvs.push(...u);
  };
  // front (z+) and back (z-) triangles
  tri([A[0], A[1], hz], [0, 0]);
  tri([B[0], B[1], hz], [sx, 0]);
  tri([T[0], T[1], hz], [hx, sy]);
  tri([B[0], B[1], -hz], [0, 0]);
  tri([A[0], A[1], -hz], [sx, 0]);
  tri([T[0], T[1], -hz], [hx, sy]);
  const slope = Math.hypot(hx, sy);
  // left slope A->T
  const quad = (p0, p1, p2, p3) => {
    tri(p0, [0, 0]);
    tri(p1, [sz, 0]);
    tri(p2, [sz, slope]);
    tri(p0, [0, 0]);
    tri(p2, [sz, slope]);
    tri(p3, [0, slope]);
  };
  quad([A[0], A[1], -hz], [A[0], A[1], hz], [T[0], T[1], hz], [T[0], T[1], -hz]);
  quad([B[0], B[1], hz], [B[0], B[1], -hz], [T[0], T[1], -hz], [T[0], T[1], hz]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

// normalize a geometry for merging: non-indexed, position/normal/uv (+color if the material needs it)
function prep(geo, needColor) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv' && !(needColor && name === 'color')) g.deleteAttribute(name);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (needColor && !g.attributes.color) {
    const c = new Float32Array(g.attributes.position.count * 3).fill(1);
    g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  }
  if (needColor && g.attributes.color.itemSize === 4) {
    const src = g.attributes.color;
    const c = new Float32Array(src.count * 3);
    for (let i = 0; i < src.count; i++) {
      c[i * 3] = src.getX(i);
      c[i * 3 + 1] = src.getY(i);
      c[i * 3 + 2] = src.getZ(i);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  }
  g.morphAttributes = {};
  return g;
}

export class StaticWorld {
  constructor(scene, world) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'static-world';
    this.chunks = [];
    // Geometry is written straight into one vertex buffer per (chunk, material): every source geometry is
    // prepared (non-indexed, trimmed attributes) once and cached, then each instance is transformed while
    // copying - no per-instance BufferGeometry clones or merges.
    const buckets = new Map(); // chunkKey -> Map(material -> {entries: [{tpl, m}], verts})
    const add = (x, z, mat, tpl, m, tint = null) => {
      const key = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = new Map()));
      let list = b.get(mat);
      if (!list) b.set(mat, (list = { entries: [], verts: 0, radius: 0 }));
      list.entries.push({ tpl, m, tint });
      list.verts += tpl.count;
      list.radius = Math.max(list.radius, tpl.radius * m.getMaxScaleOnAxis());
    };
    const templates = new Map();
    const makeTpl = (geo, needColor) => {
      const g = prep(geo, needColor);
      const tpl = {
        count: g.attributes.position.count,
        pos: g.attributes.position.array,
        nrm: g.attributes.normal.array,
        uv: g.attributes.uv.array,
        col: needColor ? g.attributes.color.array : null,
      };
      tpl.radius = templateRadius(tpl.pos);
      g.dispose();
      return tpl;
    };
    const cachedTpl = (geo, needColor, groupIndex = -1) => {
      const key = geo.uuid + (needColor ? ':c' : '') + ':' + groupIndex;
      let tpl = templates.get(key);
      if (!tpl) {
        let src = geo;
        if (groupIndex >= 0) {
          const grp = geo.groups[groupIndex];
          src = geo.clone();
          src.clearGroups();
          if (src.index) src.setIndex(Array.from(src.index.array.slice(grp.start, grp.start + grp.count)));
        }
        tpl = makeTpl(src, needColor);
        if (src !== geo) src.dispose();
        templates.set(key, tpl);
      }
      return tpl;
    };
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const one = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    const paint = paintByBuilding(world.parts);
    const up = new THREE.Vector3(0, 1, 0);
    // window and door joinery: boxes [x, y, z, sx, sy, sz] in the frame m (most openings share their sizes)
    const trimTpls = new Map();
    const addTrim = (x, z, mat, m, [lx, ly, lz, sx, sy, sz]) => {
      const key = `${sx.toFixed(3)},${sy.toFixed(3)},${sz.toFixed(3)}`;
      let tpl = trimTpls.get(key);
      if (!tpl) {
        const tg = boxGeo(sx, sy, sz);
        trimTpls.set(key, (tpl = makeTpl(tg, false)));
        tg.dispose();
      }
      add(x, z, mat, tpl, new THREE.Matrix4().makeTranslation(lx, ly, lz).premultiply(m));
    };
    world.parts.forEach((part, pi) => {
      let g;
      // glass: a thin pane set back in the opening, framed by casings (the wall below it came just before)
      const glass = part.shape === 'box' && part.mat === 'glass';
      if (glass) g = boxGeo(part.sx, part.sy, 0.04);
      else if (part.shape === 'box') g = boxGeo(part.sx, part.sy, part.sz);
      else if (part.shape === 'cyl') g = cylGeo(part.sx / 2, part.sy, part.sides || 12);
      else if (part.shape === 'cone') g = coneGeo(part.sx / 2, part.sy, part.sides || 4);
      else g = prismGeo(part.sx, part.sy, part.sz);
      e.set(part.rx || 0, part.ry || 0, part.rz || 0, 'XYZ');
      q.setFromEuler(e);
      p.set(part.x, part.y, part.z);
      const m = new THREE.Matrix4().compose(p, q, one);
      const mat = staticSurface(getMaterial(part.mat) || getMaterial('planks'));
      add(part.x, part.z, mat, makeTpl(g, !!mat.vertexColors), m, paint.get(pi));
      g.dispose();
      if (glass) {
        const trimMat = getMaterial(world.parts[pi - 1]?.mat === 'clapboard' ? 'sash' : 'trim');
        for (const b of windowTrim(part.sx, part.sy, part.sz)) addTrim(part.x, part.z, trimMat, m, b);
      }
    });
    // door casings on house walls: jambs and a head around each doorway that has a lintel over it (the
    // lintel sits exactly above the doorway centre and tells the wall's material and thickness)
    const lintels = new Map();
    for (const part of world.parts) {
      if (part.shape !== 'box' || !DOOR_TRIM[part.mat]) continue;
      const key = `${part.x.toFixed(2)},${part.z.toFixed(2)}`;
      if (!lintels.has(key)) lintels.set(key, []);
      lintels.get(key).push(part);
    }
    for (const o of world.openings) {
      const lintel = (lintels.get(`${o.x.toFixed(2)},${o.z.toFixed(2)}`) || []).find((pt) => pt.y > o.y + o.h && Math.abs(Math.sin(pt.ry - o.ry)) < 0.01);
      if (!lintel) continue;
      const mat = getMaterial(DOOR_TRIM[lintel.mat]);
      const t = lintel.sz;
      q.setFromAxisAngle(up, o.ry);
      p.set(o.x, o.y, o.z);
      const m = new THREE.Matrix4().compose(p, q, one);
      addTrim(o.x, o.z, mat, m, [-(o.w / 2 + 0.05), o.h / 2 + 0.03, 0, 0.1, o.h + 0.06, t + 0.05]);
      addTrim(o.x, o.z, mat, m, [o.w / 2 + 0.05, o.h / 2 + 0.03, 0, 0.1, o.h + 0.06, t + 0.05]);
      addTrim(o.x, o.z, mat, m, [0, o.h + 0.07, 0, o.w + 0.32, 0.14, t + 0.06]);
    }
    for (const pr of world.props) {
      let obj;
      try {
        obj = createProp(pr.type, pr.seed);
      } catch (err) {
        console.warn('prop failed', pr.type, err);
        continue;
      }
      if (!obj) continue;
      q.setFromAxisAngle(up, pr.ry);
      p.set(pr.x, pr.y, pr.z);
      const base = new THREE.Matrix4().compose(p, q, one);
      obj.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        o.updateMatrix();
        const m = o.matrix.equals(IDENTITY) && o.parent === obj ? base : new THREE.Matrix4().multiplyMatrices(base, localMatrix(o, obj));
        const mats = (Array.isArray(o.material) ? o.material : [o.material]).map(staticSurface);
        if (mats.length !== 1) {
          // multi-material mesh: split by groups
          o.geometry.groups.forEach((grp, gi) => {
            const mat = mats[grp.materialIndex];
            add(pr.x, pr.z, mat, cachedTpl(o.geometry, !!mat.vertexColors, gi), m);
          });
          return;
        }
        add(pr.x, pr.z, mats[0], cachedTpl(o.geometry, !!mats[0].vertexColors), m);
      });
    }
    const nm = new THREE.Matrix3();
    for (const [key, b] of buckets) {
      const [cx, cz] = key.split(',').map(Number);
      const chunk = { cx: (cx + 0.5) * CHUNK, cz: (cz + 0.5) * CHUNK, meshes: [] };
      for (const [mat, list] of b) {
        const n = list.verts;
        const pos = new Float32Array(n * 3);
        const nrm = new Float32Array(n * 3);
        const uv = new Float32Array(n * 2);
        const col = mat.vertexColors ? new Float32Array(n * 3) : null;
        const ground = mat.userData.staticGrime ? new Float32Array(n) : null;
        const tints = mat.userData.staticPaint ? new Float32Array(n * 3).fill(1) : null;
        let o = 0;
        for (const { tpl, m, tint } of list.entries) {
          const me = m.elements;
          nm.getNormalMatrix(m);
          const ne = nm.elements;
          const sp = tpl.pos;
          const sn = tpl.nrm;
          for (let i = 0; i < tpl.count; i++) {
            const x = sp[i * 3];
            const y = sp[i * 3 + 1];
            const z = sp[i * 3 + 2];
            const k = (o + i) * 3;
            pos[k] = me[0] * x + me[4] * y + me[8] * z + me[12];
            pos[k + 1] = me[1] * x + me[5] * y + me[9] * z + me[13];
            pos[k + 2] = me[2] * x + me[6] * y + me[10] * z + me[14];
            const nx = sn[i * 3];
            const ny = sn[i * 3 + 1];
            const nz = sn[i * 3 + 2];
            let tx = ne[0] * nx + ne[3] * ny + ne[6] * nz;
            let ty = ne[1] * nx + ne[4] * ny + ne[7] * nz;
            let tz = ne[2] * nx + ne[5] * ny + ne[8] * nz;
            const l = Math.hypot(tx, ty, tz) || 1;
            nrm[k] = tx / l;
            nrm[k + 1] = ty / l;
            nrm[k + 2] = tz / l;
            if (ground) ground[o + i] = pos[k + 1] - world.heightAt(pos[k], pos[k + 2]);
            if (tints && tint) {
              tints[k] = tint.r;
              tints[k + 1] = tint.g;
              tints[k + 2] = tint.b;
            }
          }
          uv.set(tpl.uv, o * 2);
          if (col) col.set(tpl.col, o * 3);
          o += tpl.count;
        }
        const merged = new THREE.BufferGeometry();
        merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        merged.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
        merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        if (col) merged.setAttribute('color', new THREE.BufferAttribute(col, 3));
        if (ground) merged.setAttribute('aGround', new THREE.BufferAttribute(ground, 1));
        if (tints) merged.setAttribute('aTint', new THREE.BufferAttribute(tints, 3));
        merged.computeBoundingSphere();
        const mesh = new THREE.Mesh(merged, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        mesh.userData.maxDist = Math.max(DETAIL_MIN, list.radius * DETAIL_DIST);
        this.group.add(mesh);
        chunk.meshes.push(mesh);
      }
      this.chunks.push(chunk);
    }
    this.group.matrixAutoUpdate = false;
    scene.add(this.group);
  }

  update(camPos, maxDist) {
    const lim = (maxDist + CHUNK * 0.75) ** 2;
    const half = CHUNK / 2;
    for (const c of this.chunks) {
      const dx = c.cx - camPos.x;
      const dz = c.cz - camPos.z;
      if (dx * dx + dz * dz >= lim) {
        for (const m of c.meshes) m.visible = false;
        continue;
      }
      // distance to the nearest point of the chunk: every piece in it is at least this far away
      const ex = Math.max(0, Math.abs(dx) - half);
      const ez = Math.max(0, Math.abs(dz) - half);
      const near = Math.sqrt(ex * ex + ez * ez);
      for (const m of c.meshes) m.visible = near < m.userData.maxDist;
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => o.isMesh && o.geometry.dispose());
  }
}
