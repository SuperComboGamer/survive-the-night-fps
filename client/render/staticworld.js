// Builds the static world: building primitives (from shared world gen) and props (procedural models)
// merged per spatial chunk and per material -> a handful of draw calls, frustum + distance culled.
// Shadow maps take no notice of materials, so they are not drawn from the meshes the player sees but from
// "casters": one or two more meshes per chunk that cover all of its materials at once (same vertices, never seen).
import * as THREE from 'three';
import { getMaterial, staticSurface } from './materials.js';
import { createProp } from './models/props.js';
import { PROPS } from '../../shared/props.js';
import { buildCity, TIER } from './citykit.js';
import { MultiMesh } from './multimesh.js';

const CHUNK = 80;
const CHUNK_CITY = 128; // (the mainland's: its city is a great many materials, and every chunk draws each of them once)
const IDENTITY = new THREE.Matrix4();
// A (chunk, material) mesh whose largest piece has bounding radius r is drawn out to r * DETAIL_DIST
// (never closer than DETAIL_MIN): bottles, cans and tail lights stop costing a draw call once they are a
// few pixels wide, while anything with a building, wall or car in it keeps the full view distance.
const DETAIL_DIST = 280;
const DETAIL_MIN = 60;
// In the city (a world with world.city) that rule is not enough: a bottle shares its material with a bus, and a
// room's furniture is drawn from a mile off. There a (chunk, material) is split in tiers by how far its pieces need
// to be seen: 0 as above; the others out to TIER_DIST and no further - the small things of a street, the fine detail
// of a building's face (citykit.js: frames, sills, railings), and nearest of all what is inside a room that is
// walked into (its lining, its furniture): that is drawn from the street outside it and from the room itself, and
// from nowhere else.
export { TIER };
const TIER_DIST = [0, 150, 90, 55];
// A material that casts no shadow at all (userData.noShadow: stains and lettering laid on a wall).
const NOSHADOW = 4;

// Which faces of a material the depth pass draws into a shadow map (three's rule: the back faces of a
// one-sided material, both of a two-sided one), or CUTOUT when its texture punches holes in the shadow (chain
// link, weeds, stencilled lettering): that shadow cannot be drawn without the material, so its mesh keeps
// casting for itself.
const CUTOUT = 3;
const SHADOW_SIDE = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide };
function shadowSide(mat) {
  if (mat.userData.noShadow) return NOSHADOW;
  if ((mat.alphaTest > 0 && (mat.map || mat.alphaMap)) || mat.alphaToCoverage || mat.displacementMap) return CUTOUT;
  return mat.shadowSide ?? SHADOW_SIDE[mat.side];
}
// a caster's material, by shadow side: the depth pass only reads the faces to keep from it. It is never
// meant to reach the colour pass, and writes nothing if something (frustumCulled = false) puts it there.
const CASTER_MAT = [THREE.FrontSide, THREE.BackSide, THREE.DoubleSide].map((side) => new THREE.MeshBasicMaterial({ shadowSide: side, colorWrite: false, depthWrite: false }));

// A page of positions holds the materials put in it until it has this many vertices (48 MB of them)
const PAGE_VERTS = 4_000_000;
// once a vertex buffer is on the graphics card its copy in memory is let go of (the mainland's are 600 MB of them)
function dropArray() {
  this.array = null;
}

// the bounding sphere a geometry made of just these positions would compute for itself
function boundsOf(pos) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeBoundingSphere();
  return g.boundingSphere;
}

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

// faded paint per painted wall material (sRGB): siding is mostly white and cream, barns oxide red
const hexes = (list) => list.map((h) => new THREE.Color(h));
const PAINT = {
  clapboard: hexes([0xcfccc0, 0xcfccc0, 0xc8c1af, 0xc8c1af, 0xadb8bd, 0xb0b9a1, 0xc9bf9d, 0xabbbaf, 0xb8b5af, 0xc6b2a9, 0x93a2ab, 0xc2b287]),
  barn: hexes([0x7a3229, 0x7a3229, 0x6e2c25, 0x853a2e, 0x652823, 0x80402f, 0x76352d]),
};

// one paint colour per building: painted parts that touch (walls, gable ends, towers) form a building
function paintByBuilding(parts) {
  const idx = [];
  parts.forEach((p, i) => PAINT[p.mat] && idx.push(i));
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
    const pal = PAINT[parts[i].mat];
    tint.set(i, pal[Math.floor(h * pal.length)]);
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
    this.multi = []; // the MultiMeshes: one per material, and the shadow casters
    this.single = []; // { mesh, chunk, maxDist }: the few runs that are still meshes of their own
    // Geometry is written straight into one vertex buffer per (chunk, material): every source geometry is
    // prepared (non-indexed, trimmed attributes) once and cached, then each instance is transformed while
    // copying - no per-instance BufferGeometry clones or merges.
    const buckets = new Map(); // chunkKey -> Map(material -> {entries: [{tpl, m}], verts})
    // wuv: [ax, az], the part's local x axis in the world - its UVs are then laid out in world space, so
    // courses of brick, boards and logs run unbroken across the pieces a wall is built from.
    // uvo: [du, dv] shifts the UVs (so every window pane shows a different part of the glass)
    // tier: how far it is seen (TIER; 0: by its size, as everything on the island)
    const tierKeys = new Map(); // material -> [the keys of its tiers]
    const tierKey = (mat, tier) => {
      if (!tier) return mat;
      let keys = tierKeys.get(mat);
      if (!keys) tierKeys.set(mat, (keys = []));
      return (keys[tier] ||= { mat, tier });
    };
    // In the city every material that is one plain colour (the dark of a window, rubber, a tail light, a bottle) is
    // drawn as one, the colour written into the vertices: a draw call a chunk, not one for each of them.
    const size = (this.chunkSize = world.city ? CHUNK_CITY : CHUNK);
    const FLAT = world.city ? getMaterial('flat') : null;
    const plain = (mat) => FLAT && mat.isMeshLambertMaterial && !mat.map && !mat.vertexColors && !mat.transparent && !mat.alphaTest && !mat.userData.staticGrime;
    const add = (x, z, mat, tpl, m, tint = null, wuv = null, uvo = null, tier = 0) => {
      let flat = null;
      if (plain(mat)) {
        flat = mat.color;
        mat = FLAT;
      }
      const key = `${Math.floor(x / size)},${Math.floor(z / size)}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = new Map()));
      const lk = tierKey(mat, tier);
      let list = b.get(lk);
      if (!list) b.set(lk, (list = { entries: [], verts: 0, radius: 0, mat, tier }));
      list.entries.push({ tpl, m, tint, wuv, uvo, flat });
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
      if (part.hidden) return; // (a solid the city's kit draws in its own way: citykit.js)
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
      const upright = part.shape === 'box' && !glass && !part.rx && !part.rz;
      const h = Math.abs(Math.sin(part.x * 12.9898 + part.z * 78.233 + part.y * 37.719) * 43758.5453);
      add(part.x, part.z, mat, makeTpl(g, !!mat.vertexColors), m, paint.get(pi), upright ? [Math.cos(part.ry || 0), -Math.sin(part.ry || 0)] : null, glass ? [(h % 1) * 2, ((h * 7.13) % 1) * 2] : null);
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
    // (the city: what is small is seen from near only - a room's furniture nearer still)
    // (...and what stands under a roof - a room's furniture, whatever its size - as near as the room's own lining)
    const indoors = (pr) => {
      for (const r of world.roofs) {
        if (pr.y > r.y) continue;
        const dx = pr.x - r.x, dz = pr.z - r.z;
        if (Math.abs(dx) > r.hx + r.hz || Math.abs(dz) > r.hx + r.hz) continue;
        if (Math.abs(dx * r.c - dz * r.s) < r.hx - 0.3 && Math.abs(dx * r.s + dz * r.c) < r.hz - 0.3) return true;
      }
      return false;
    };
    const propTier = (pr) => {
      if (!world.city) return 0;
      const sz = PROPS[pr.type]?.size;
      if (!sz) return 0;
      const r = Math.hypot(sz[0], sz[1], sz[2]) / 2;
      if (r < 4.6 && indoors(pr)) return TIER.ROOM;
      return r < 1.25 ? TIER.DETAIL : r < 4.6 ? TIER.STREET : 0; // (a car, a van, a truck are things of the street: a bus, a hangar's plane are seen from across the city)
    };
    for (const pr of world.props) {
      if (pr.live) continue; // (drawn by the game itself: the car the team came in, the plane - they change, and a cutscene moves them)
      const tier = propTier(pr);
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
            add(pr.x, pr.z, mat, cachedTpl(o.geometry, !!mat.vertexColors, gi), m, null, null, null, tier);
          });
          return;
        }
        add(pr.x, pr.z, mats[0], cachedTpl(o.geometry, !!mats[0].vertexColors), m, null, null, null, tier);
      });
    }
    // the city's buildings, built from what the world says of each (world.city.buildings)
    if (world.city) buildCity(world, (x, z, matName, tpl, tier = 0) => add(x, z, staticSurface(getMaterial(matName)), tpl, IDENTITY, null, null, null, tier));
    // ---- the buffers. Every vertex of a material, whatever chunk it is in, is in one run of one vertex buffer, and
    // the material is ONE mesh: each frame it draws the runs of the chunks that are near enough and in the view,
    // all of them in a single draw call (multimesh.js). A valley's static world is then some
    // fifty draw calls, not one for every material of every chunk in sight (four to seven hundred).
    // The positions of every material are in a few large buffers ("pages") that the materials' meshes and the
    // shadow casters all read: a caster is one more mesh per page and shadow side, never seen, that draws the
    // positions of every material of that side at once (a shadow map takes no notice of materials).
    this.casters = new THREE.Group();
    this.casters.name = 'static-shadow-casters';
    const nm = new THREE.Matrix3();
    // the chunks, and of each material the lists of it (one per chunk and tier), in the chunks' order
    const byMat = new Map();
    for (const [key, b] of buckets) {
      const [cx, cz] = key.split(',').map(Number);
      const chunk = { cx: (cx + 0.5) * size, cz: (cz + 0.5) * size, on: false, near: 0 };
      this.chunks.push(chunk);
      for (const list of b.values()) {
        // (the fine detail of a face and what is small enough to stand in a room cast no shadow: they are near the
        // wall or the floor they would cast it on, and there are a great many of them)
        list.side = list.tier >= TIER.DETAIL ? NOSHADOW : shadowSide(list.mat);
        list.maxDist = list.tier ? TIER_DIST[list.tier] : Math.max(DETAIL_MIN, list.radius * DETAIL_DIST);
        list.chunk = chunk;
        let m = byMat.get(list.mat);
        if (!m) byMat.set(list.mat, (m = { mat: list.mat, lists: [], verts: 0 }));
        m.lists.push(list);
        m.verts += list.verts;
      }
    }
    // pages of positions: materials are put in one until it holds PAGE_VERTS
    const pages = [];
    let page = null;
    for (const m of byMat.values()) {
      // a see-through material is sorted by three among everything else that is see-through (smoke, water, the
      // other panes), each mesh by where it is: its lists stay meshes of their own, one per chunk, as before
      // (glass, chain link, blood and grime laid on a surface; there are few)
      m.legacy = m.mat.transparent === true;
      if (m.legacy) continue;
      if (!page || (page.verts > 0 && page.verts + m.verts > PAGE_VERTS)) pages.push((page = { verts: 0, mats: [] }));
      m.base = page.verts;
      m.page = page;
      page.verts += m.verts;
      page.mats.push(m);
    }
    for (const pg of pages) {
      pg.pos = new Float32Array(pg.verts * 3);
      pg.buffer = new THREE.InterleavedBuffer(pg.pos, 3);
      pg.buffer.onUpload(dropArray);
    }
    const fill = (list, pos, nrm, uv, col, ground, tints, o0) => {
      let o = o0;
      for (const { tpl, m, tint, wuv, uvo, flat } of list.entries) {
        const me = m.elements;
        nm.getNormalMatrix(m);
        const ne = nm.elements;
        const sp = tpl.pos;
        const sn = tpl.nrm;
        uv.set(tpl.uv, o * 2);
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
          if (wuv) {
            const j = (o + i) * 2;
            if (Math.abs(ty) > 0.7 * l) {
              uv[j] = pos[k] * wuv[0] + pos[k + 2] * wuv[1];
              uv[j + 1] = pos[k + 2] * wuv[0] - pos[k] * wuv[1];
            } else {
              // along the wall (to the right, seen from outside) and up it
              uv[j] = (pos[k] * tz - pos[k + 2] * tx) / Math.hypot(tx, tz);
              uv[j + 1] = pos[k + 1];
            }
          } else if (uvo) {
            uv[(o + i) * 2] += uvo[0];
            uv[(o + i) * 2 + 1] += uvo[1];
          }
          // (height above the ground it stands on: down in the mine that is the floor of the drift)
          if (ground) ground[o + i] = pos[k + 1] - (world.floorAt ? world.floorAt(pos[k], pos[k + 2], pos[k + 1] + 0.3) : world.heightAt(pos[k], pos[k + 2]));
          if (tints && tint) {
            tints[k] = tint.r;
            tints[k + 1] = tint.g;
            tints[k + 2] = tint.b;
          }
        }
        if (col && flat) for (let i = 0; i < tpl.count; i++) col.set([flat.r, flat.g, flat.b], (o + i) * 3);
        else if (col && tpl.col) col.set(tpl.col, o * 3);
        else if (col) col.fill(1, o * 3, (o + tpl.count) * 3);
        o += tpl.count;
      }
      list.entries = null;
    };
    const attr = (arr, n) => new THREE.BufferAttribute(arr, n).onUpload(dropArray);
    for (const m of byMat.values()) {
      const mat = m.mat;
      const n = m.verts;
      const own = m.legacy ? new Float32Array(n * 3) : null;
      const pos = own || m.page.pos.subarray(m.base * 3, (m.base + n) * 3);
      const nrm = new Float32Array(n * 3);
      const uv = new Float32Array(n * 2);
      const col = mat.vertexColors ? new Float32Array(n * 3) : null;
      const ground = mat.userData.staticGrime ? new Float32Array(n) : null;
      const tints = mat.userData.staticPaint ? new Float32Array(n * 3).fill(1) : null;
      let o = 0;
      m.runs = [];
      for (const list of m.lists) {
        fill(list, pos, nrm, uv, col, ground, tints, o);
        const sp = boundsOf(pos.subarray(o * 3, (o + list.verts) * 3));
        m.runs.push({ chunk: list.chunk, first: o, count: list.verts, maxDist: list.maxDist, side: list.side, x: sp.center.x, y: sp.center.y, z: sp.center.z, r: sp.radius });
        o += list.verts;
      }
      m.lists = null;
      if (m.legacy) {
        for (const run of m.runs) {
          const [a0, a1] = [run.first, run.first + run.count];
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', attr(pos.slice(a0 * 3, a1 * 3), 3));
          g.setAttribute('normal', attr(nrm.slice(a0 * 3, a1 * 3), 3));
          g.setAttribute('uv', attr(uv.slice(a0 * 2, a1 * 2), 2));
          if (col) g.setAttribute('color', attr(col.slice(a0 * 3, a1 * 3), 3));
          if (ground) g.setAttribute('aGround', attr(ground.slice(a0, a1), 1));
          if (tints) g.setAttribute('aTint', attr(tints.slice(a0 * 3, a1 * 3), 3));
          g.boundingSphere = new THREE.Sphere(new THREE.Vector3(run.x, run.y, run.z), run.r);
          const mesh = new THREE.Mesh(g, mat);
          mesh.castShadow = run.side === CUTOUT;
          mesh.receiveShadow = true;
          mesh.matrixAutoUpdate = false;
          mesh.updateMatrix();
          this.group.add(mesh);
          this.single.push({ mesh, chunk: run.chunk, maxDist: run.maxDist });
        }
        continue;
      }
      const g = new THREE.BufferGeometry();
      // this material's part of its page: a view that starts at its first vertex (the other attributes are the
      // mesh's own and start at 0, so the runs' firsts do too)
      g.setAttribute('position', new THREE.InterleavedBufferAttribute(m.page.buffer, 3, m.base * 3));
      g.setAttribute('normal', attr(nrm, 3));
      g.setAttribute('uv', attr(uv, 2));
      if (col) g.setAttribute('color', attr(col, 3));
      if (ground) g.setAttribute('aGround', attr(ground, 1));
      if (tints) g.setAttribute('aTint', attr(tints, 3));
      // (what casts from this mesh itself: only a run whose texture cuts holes in its shadow - everything else is
      // in its page's caster)
      const mesh = new MultiMesh(g, mat, m.runs, { casts: (run) => run.side === CUTOUT });
      mesh.castShadow = m.runs.some((run) => run.side === CUTOUT);
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.multi.push(mesh);
    }
    // one caster per page and shadow side
    for (const pg of pages) {
      for (const side of [THREE.FrontSide, THREE.BackSide, THREE.DoubleSide]) {
        const runs = [];
        for (const m of pg.mats) for (const run of m.runs) if (run.side === side) runs.push({ ...run, first: run.first + m.base });
        if (!runs.length) continue;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.InterleavedBufferAttribute(pg.buffer, 3, 0));
        const caster = new MultiMesh(g, CASTER_MAT[side], runs, { shadowOnly: true });
        caster.name = 'static-shadow-caster';
        caster.castShadow = true;
        this.casters.add(caster);
        this.multi.push(caster);
      }
    }
    this.casters.matrixAutoUpdate = false;
    this.group.add(this.casters);
    this.group.matrixAutoUpdate = false;
    scene.add(this.group);
    // (nothing in it ever moves: once its matrices are made, the scene's matrix pass does not walk it)
    this.group.updateMatrixWorld(true);
    this.group.matrixWorldAutoUpdate = false;
  }

  // with shadows off in the quality settings the casters are not even walked
  setShadows(on) {
    this.casters.visible = on;
  }

  update(camPos, maxDist) {
    const lim = (maxDist + this.chunkSize * 0.75) ** 2;
    const half = this.chunkSize / 2;
    for (const c of this.chunks) {
      const dx = c.cx - camPos.x;
      const dz = c.cz - camPos.z;
      c.on = dx * dx + dz * dz < lim;
      // distance to the nearest point of the chunk: every piece in it is at least this far away
      const ex = Math.max(0, Math.abs(dx) - half);
      const ez = Math.max(0, Math.abs(dz) - half);
      c.near = Math.sqrt(ex * ex + ez * ez);
    }
    // (a MultiMesh picks its runs when the renderer asks whether it is in a frustum: its chunks say which may be)
    for (const m of this.multi) m.visible = true;
    for (const s of this.single) s.mesh.visible = s.chunk.on && s.chunk.near < s.maxDist;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => o.isMesh && o.geometry.dispose());
  }
}
