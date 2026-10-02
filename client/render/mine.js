// The workings under the mine (shared/mine.js), drawn: rough rock built from the same baked fields that movement
// and rays use. The floor and the roof are the field's own grid; the walls are its zero contour (marching squares),
// pushed back into the rock by a noise so no two metres of drift look alike. Nothing is ever drawn inside the line
// a body is kept to. The timber sets and the track (world.mine.frames) are drawn with it.
// Daylight does not get down a mine. Each vertex carries how much of it reaches there (aSky: 1 at a mouth, 0 a
// dozen and a half metres in) and the materials let that much of the sky's light, of the sun and of the haze's glow through;
// flashlights, fires and muzzle flashes light the rock as they light everything else. So the mouth of the adit
// shows black from the yard at noon, and what a survivor sees down there is what their own light falls on.
import * as THREE from 'three';
import { MINE_H, MINE_R, PORTAL } from '../../shared/mine.js';
import { smoothstep } from '../../shared/rng.js';
import { getTexture, TEXTURE_WORLD_SIZE } from './textures.js';

const REACH = 0.8; // the floor and the roof run this far into the rock, behind the walls
// what is left to see by with no light at all (irradiance): about what Environment leaves of the sky's light for
// everything else down there (UNDER.hemi), so the rock is no darker than what stands in front of it
const DARK = [0.085, 0.09, 0.11];
// tint of the timbering by kind (world.mine.frames): timber, rail, sleeper
const FRAME_TINT = [[0.5, 0.42, 0.34], [0.4, 0.2, 0.13], [0.62, 0.54, 0.44]];

// smooth value noise on a lattice, 0..1
function hash3(x, y, z) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise3(x, y, z) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const u = x - xi;
  const v = y - yi;
  const w = z - zi;
  const su = u * u * (3 - 2 * u);
  const sv = v * v * (3 - 2 * v);
  const sw = w * w * (3 - 2 * w);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), su), l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), su), sv),
    l(l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), su), l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), su), sv),
    sw,
  );
}

// a Lambert material that takes the sun, the sky's light and the glow of the haze by aSky, every other light as it comes
// (exported with mesh() below for the other place it is dark at noon: the wards of the clinic, render/clinic.js)
export function material(texture, key) {
  const map = getTexture(texture);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  const mat = new THREE.MeshLambertMaterial({ map, vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float aSky;\nvarying float vSky;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvSky = aSky;');
    const SUN = 'getSunLightInfo( sunLight, directLight );';
    const HAZE = 'stnFogColor(fogColor, fogDir)';
    const lights = THREE.ShaderChunk.lights_fragment_begin;
    const fog = THREE.ShaderChunk.fog_fragment;
    if (!lights.includes(SUN) || !fog.includes(HAZE)) console.warn('[mine] the light or fog chunk changed: daylight is not shut out of the mine');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vSky;')
      .replace('#include <lights_fragment_begin>', lights.replace(SUN, `${SUN}\n\t\tdirectLight.color *= vSky;`))
      .replace('#include <lights_fragment_maps>', `irradiance = irradiance * vSky + vec3(${DARK.join(', ')});\n#include <lights_fragment_maps>`)
      .replace('#include <fog_fragment>', fog.replace(HAZE, `(${HAZE} * vSky)`));
  };
  mat.customProgramCacheKey = () => `mine-${key}-2`;
  return mat;
}

// vertex soup -> a mesh with flat normals, the texture laid along whichever way each face mostly is
export function mesh(name, soup, texture) {
  const n = soup.pos.length / 3;
  const P = new Float32Array(soup.pos);
  const N = new Float32Array(n * 3);
  const UV = new Float32Array(n * 2);
  const tile = 1 / (TEXTURE_WORLD_SIZE[texture] || 2);
  for (let t = 0; t < n; t += 3) {
    const a = t * 3;
    const ux = P[a + 3] - P[a];
    const uy = P[a + 4] - P[a + 1];
    const uz = P[a + 5] - P[a + 2];
    const vx = P[a + 6] - P[a];
    const vy = P[a + 7] - P[a + 1];
    const vz = P[a + 8] - P[a + 2];
    let fx = uy * vz - uz * vy;
    let fy = uz * vx - ux * vz;
    let fz = ux * vy - uy * vx;
    const l = Math.hypot(fx, fy, fz) || 1;
    fx /= l;
    fy /= l;
    fz /= l;
    for (let c = 0; c < 3; c++) {
      const v = t + c;
      N[v * 3] = fx;
      N[v * 3 + 1] = fy;
      N[v * 3 + 2] = fz;
      const flat = Math.abs(fy) > 0.7;
      UV[v * 2] = (flat ? P[v * 3] : Math.abs(fx) > Math.abs(fz) ? P[v * 3 + 2] : P[v * 3]) * tile;
      UV[v * 2 + 1] = (flat ? P[v * 3 + 2] : P[v * 3 + 1]) * tile;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(soup.col), 3));
  geo.setAttribute('aSky', new THREE.BufferAttribute(new Float32Array(soup.sky), 1));
  geo.computeBoundingSphere();
  const m = new THREE.Mesh(geo, material(texture, name));
  m.name = `mine-${name}`;
  m.receiveShadow = true;
  m.matrixAutoUpdate = false;
  return m;
}

// -> THREE.Group (the rock, the floor, the timbering), or null on a map with no workings
export function buildMine(world) {
  const mine = world.mine;
  if (!mine) return null;
  const { ox, oz, nx, nz, cell, sd, fl } = mine.grid;
  const soup = () => ({ pos: [], col: [], sky: [] });
  const rock = soup();
  const floor = soup();
  const wood = soup();
  // how much daylight reaches (x,z): all of it in a mouth, none a dozen metres down the drift (or as far below a
  // mouth, where the drift doubles back under its own yard)
  const skyAt = (x, z) => {
    const f = mine.floorOf(x, z);
    let d = Infinity;
    for (const p of mine.portals) d = Math.min(d, Math.hypot(x - p.x, z - p.z, p.y - f));
    return 1 - smoothstep(2, 16, d);
  };
  const vert = (to, p, r, g, b) => {
    to.pos.push(p[0], p[1], p[2]);
    to.col.push(r, g, b);
    to.sky.push(skyAt(p[0], p[2]));
  };
  // blotchy rock: darker seams, a little rust in it
  const stone = (to, p, shade) => {
    const n = noise3(p[0] * 0.35, p[1] * 0.5, p[2] * 0.35);
    const k = shade * (0.72 + 0.4 * n);
    vert(to, p, k * (1 + 0.1 * n), k, k * (0.96 - 0.06 * n));
  };
  // a convex polygon as a fan
  const poly = (to, pts, shade) => {
    for (let i = 1; i < pts.length - 1; i++) {
      stone(to, pts[0], shade);
      stone(to, pts[i], shade);
      stone(to, pts[i + 1], shade);
    }
  };
  // what lies on the daylight side of a mouth is cut away: the drift ends flush with its portal
  const near = (x, z) => mine.portals.filter((p) => Math.hypot(x - p.x, z - p.z) < MINE_R + 6);
  const clip = (pts, p) => {
    const out = [];
    const side = (q) => (q[0] - p.x) * p.dx + (q[2] - p.z) * p.dz;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const sa = side(a);
      const sb = side(b);
      if (sa >= 0) out.push(a);
      if (sa >= 0 !== sb >= 0) {
        const t = sa / (sa - sb);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
      }
    }
    return out;
  };
  const emit = (to, pts, shade) => {
    for (const p of near(pts[0][0], pts[0][2])) pts = clip(pts, p);
    if (pts.length >= 3) poly(to, pts, shade);
  };
  const roofAt = (x, z, f) => f + MINE_H + 0.42 * noise3(x * 0.55, 3.7, z * 0.55);

  // a strip of wall over the contour from a to b, three rows high
  const wall = (a, b) => {
    for (const p of near(a[0], a[1])) {
      const sa = (a[0] - p.x) * p.dx + (a[1] - p.z) * p.dz;
      const sb = (b[0] - p.x) * p.dx + (b[1] - p.z) * p.dz;
      if (sa < 0 && sb < 0) return;
      if (sa < 0 !== sb < 0) {
        const t = sa / (sa - sb);
        const c = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        if (sa < 0) a = c;
        else b = c;
      }
    }
    const column = (q) => {
      // out of the drift: up the distance field
      let gx = mine.sdf(q[0] + 0.25, q[1]) - mine.sdf(q[0] - 0.25, q[1]);
      let gz = mine.sdf(q[0], q[1] + 0.25) - mine.sdf(q[0], q[1] - 0.25);
      const gl = Math.hypot(gx, gz) || 1;
      gx /= gl;
      gz /= gl;
      const f = mine.floorOf(q[0], q[1]);
      // (in a mouth the rock stays inside the portal's stone: no more than its liner is thick)
      const deep = Math.min(1, mine.depth(q[0], q[1]) / (PORTAL.LEN + 2));
      return [-0.15, 1.5, MINE_H + 0.5].map((h) => {
        const y = f + h;
        const out = 0.04 + (0.08 + 0.2 * deep) * noise3(q[0] * 0.8, y * 0.8, q[1] * 0.8);
        return [q[0] + gx * out, y, q[1] + gz * out];
      });
    };
    const ca = column(a);
    const cb = column(b);
    // which way round faces the drift? the side the distance field falls away to: (-ez, ex) is the normal of a→b
    const mx = (a[0] + b[0]) / 2;
    const mz = (a[1] + b[1]) / 2;
    const ex = b[0] - a[0];
    const ez = b[1] - a[1];
    const inward = mine.sdf(mx - ez * 0.5, mz + ex * 0.5) < mine.sdf(mx + ez * 0.5, mz - ex * 0.5);
    for (let r = 0; r < 2; r++) poly(rock, inward ? [ca[r], cb[r], cb[r + 1], ca[r + 1]] : [cb[r], ca[r], ca[r + 1], cb[r + 1]], 0.9);
  };

  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const k = j * nx + i;
      const s00 = sd[k];
      const s10 = sd[k + 1];
      const s01 = sd[k + nx];
      const s11 = sd[k + nx + 1];
      if (Math.min(s00, s10, s01, s11) >= REACH) continue;
      const x0 = ox + i * cell;
      const z0 = oz + j * cell;
      const x1 = x0 + cell;
      const z1 = z0 + cell;
      // ---- floor and roof
      const f00 = fl[k];
      const f10 = fl[k + 1];
      const f01 = fl[k + nx];
      const f11 = fl[k + nx + 1];
      emit(floor, [[x0, f00, z0], [x0, f01, z1], [x1, f11, z1], [x1, f10, z0]], 0.85);
      emit(rock, [[x0, roofAt(x0, z0, f00), z0], [x1, roofAt(x1, z0, f10), z0], [x1, roofAt(x1, z1, f11), z1], [x0, roofAt(x0, z1, f01), z1]], 0.62);
      // ---- walls: the zero contour through this cell
      const code = (s00 < 0 ? 1 : 0) | (s10 < 0 ? 2 : 0) | (s11 < 0 ? 4 : 0) | (s01 < 0 ? 8 : 0);
      if (code === 0 || code === 15) continue;
      // where the contour crosses each edge (always measured from the same end, so neighbours agree to the bit)
      const cross = (e) => {
        if (e === 0) return [x0 + (cell * s00) / (s00 - s10), z0];
        if (e === 1) return [x1, z0 + (cell * s10) / (s10 - s11)];
        if (e === 2) return [x0 + (cell * s01) / (s01 - s11), z1];
        return [x0, z0 + (cell * s00) / (s00 - s01)];
      };
      const mid = (s00 + s10 + s01 + s11) / 4 < 0;
      const segs = code === 5 ? (mid ? [[0, 1], [2, 3]] : [[3, 0], [1, 2]]) : code === 10 ? (mid ? [[3, 0], [1, 2]] : [[0, 1], [2, 3]]) : [SEGS[code]];
      for (const [ea, eb] of segs) wall(cross(ea), cross(eb));
    }
  }

  // ---- timber sets, rails and sleepers: boxes turned about their own Z, then about Y
  for (const [x, y, z, sx, sy, sz, ry, rz, kind] of mine.frames || []) {
    const cy = Math.cos(ry);
    const sny = Math.sin(ry);
    const cz = Math.cos(rz);
    const snz = Math.sin(rz);
    const at = (lx, ly, lz) => {
      const ax = lx * cz - ly * snz;
      const ay = lx * snz + ly * cz;
      return [x + ax * cy + lz * sny, y + ay, z - ax * sny + lz * cy];
    };
    const [r, g, b] = FRAME_TINT[kind];
    const hx = sx / 2;
    const hy = sy / 2;
    const hz = sz / 2;
    // the six faces, each wound to face outwards
    for (const [c0, c1, c2, c3] of [
      [[hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz]],
      [[-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], [-hx, -hy, -hz]],
      [[-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz]],
      [[-hx, -hy, hz], [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz]],
      [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]],
      [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]],
    ]) {
      const q = [at(...c0), at(...c1), at(...c2), at(...c3)];
      for (const v of [q[0], q[1], q[2], q[0], q[2], q[3]]) vert(wood, v, r, g, b);
    }
  }

  const group = new THREE.Group();
  group.name = 'mine';
  group.add(mesh('rock', rock, 'rock'), mesh('floor', floor, 'ground_dirt'), mesh('timber', wood, 'wood'));
  group.matrixAutoUpdate = false;
  return group;
}

// marching squares: the edges the contour joins, by which corners are inside (bit 0: x0 z0, 1: x1 z0, 2: x1 z1,
// 3: x0 z1; edges 0: z0, 1: x1, 2: z1, 3: x0). 5 and 10 (two opposite corners) are settled by the cell's middle.
const SEGS = { 1: [3, 0], 2: [0, 1], 3: [3, 1], 4: [1, 2], 6: [0, 2], 7: [3, 2], 8: [2, 3], 9: [0, 2], 11: [1, 2], 12: [3, 1], 13: [0, 1], 14: [3, 0] };
