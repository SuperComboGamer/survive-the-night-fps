// Builds the static world: building primitives (from shared world gen) and props (procedural models)
// merged per spatial chunk and per material -> a handful of draw calls, frustum + distance culled.
import * as THREE from 'three';
import { getMaterial } from './materials.js';
import { createProp } from './models/props.js';

const CHUNK = 80;
const IDENTITY = new THREE.Matrix4();

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
    const add = (x, z, mat, tpl, m) => {
      const key = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = new Map()));
      let list = b.get(mat);
      if (!list) b.set(mat, (list = { entries: [], verts: 0 }));
      list.entries.push({ tpl, m });
      list.verts += tpl.count;
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
    for (const part of world.parts) {
      let g;
      if (part.shape === 'box') g = boxGeo(part.sx, part.sy, part.sz);
      else if (part.shape === 'cyl') g = cylGeo(part.sx / 2, part.sy, part.sides || 12);
      else if (part.shape === 'cone') g = coneGeo(part.sx / 2, part.sy, part.sides || 4);
      else g = prismGeo(part.sx, part.sy, part.sz);
      e.set(part.rx || 0, part.ry || 0, part.rz || 0, 'XYZ');
      q.setFromEuler(e);
      p.set(part.x, part.y, part.z);
      const m = new THREE.Matrix4().compose(p, q, one);
      const mat = getMaterial(part.mat) || getMaterial('planks');
      add(part.x, part.z, mat, makeTpl(g, !!mat.vertexColors), m);
      g.dispose();
    }
    const up = new THREE.Vector3(0, 1, 0);
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
        const mats = Array.isArray(o.material) ? o.material : [o.material];
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
        let o = 0;
        for (const { tpl, m } of list.entries) {
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
        merged.computeBoundingSphere();
        const mesh = new THREE.Mesh(merged, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
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
    for (const c of this.chunks) {
      const dx = c.cx - camPos.x;
      const dz = c.cz - camPos.z;
      const vis = dx * dx + dz * dz < lim;
      for (const m of c.meshes) m.visible = vis;
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => o.isMesh && o.geometry.dispose());
  }
}
