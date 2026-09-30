// Terrain mesh built from the shared heightfield (exactly matches collision), splat-blended ground
// textures (meadow grass / forest floor / mud / rock) with baked ambient occlusion under trees, drainage
// wetness and slope rock. The ground layers come from groundFields(), which the grass placement shares, so
// grass cards stand on the grass layer. Roads are drawn per pixel from a road frame baked into the vertices
// (signed offset from the nearest road's centre line and distance along it): dirt roads get tyre ruts, a
// grassy crown and puddles, trails a worn footpath and Route 9 faded lane lines and gravel shoulders.
import * as THREE from 'three';
import { GRID_N, GRID_STEP, MAP_HALF, WATER_LEVEL } from '../../shared/constants.js';
import { smoothstep } from '../../shared/rng.js';
import { ROAD } from '../../shared/world.js';
import { getTexture } from './textures.js';
import { GROUND_MACRO_GLSL, groundNoiseTexture, VEG } from './materials.js';


// the road frame is kept this far (m) past a road's edge, so its fade-out stays well clear of the road
const FRAME_REACH = 12;

/**
 * Per-vertex road frame: signed lateral offset from the nearest road's centre line, distance along that
 * road, its half width, its kind and a confidence that falls to 0 wherever the frame jumps (junctions,
 * road ends, switchbacks, out of reach) so the shader never interpolates across a discontinuity.
 */
function roadFrame(world) {
  const N = GRID_N;
  const cnt = N * N;
  const lat = new Float32Array(cnt).fill(FRAME_REACH * 4);
  const along = new Float32Array(cnt);
  const hw = new Float32Array(cnt);
  const edge = new Float32Array(cnt).fill(1e9);
  const rid = new Int16Array(cnt).fill(-1);
  const bad = new Uint8Array(cnt);
  world.roads.forEach((road, ri) => {
    const p = road.pts;
    const n = p.length / 2;
    const reach = road.width + FRAME_REACH;
    let s0 = 0;
    for (let s = 0; s < n - 1; s++) {
      const ax = p[s * 2];
      const az = p[s * 2 + 1];
      const bx = p[s * 2 + 2];
      const bz = p[s * 2 + 3];
      const ex = bx - ax;
      const ez = bz - az;
      const el2 = ex * ex + ez * ez;
      if (el2 < 1e-8) continue;
      const el = Math.sqrt(el2);
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach + MAP_HALF) / GRID_STEP));
      const i1 = Math.min(N - 1, Math.ceil((Math.max(ax, bx) + reach + MAP_HALF) / GRID_STEP));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - reach + MAP_HALF) / GRID_STEP));
      const j1 = Math.min(N - 1, Math.ceil((Math.max(az, bz) + reach + MAP_HALF) / GRID_STEP));
      for (let j = j0; j <= j1; j++) {
        const z = -MAP_HALF + j * GRID_STEP;
        for (let i = i0; i <= i1; i++) {
          const x = -MAP_HALF + i * GRID_STEP;
          let t = ((x - ax) * ex + (z - az) * ez) / el2;
          const cap = (t < 0 && s === 0) || (t > 1 && s === n - 2);
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const d = Math.hypot(x - ax - ex * t, z - az - ez * t);
          const e = d - road.width;
          const k = j * N + i;
          if (e > FRAME_REACH || e >= edge[k]) continue;
          edge[k] = e;
          lat[k] = ex * (z - az) - ez * (x - ax) >= 0 ? d : -d;
          along[k] = s0 + t * el;
          hw[k] = road.width;
          rid[k] = ri;
          bad[k] = cap ? 1 : 0;
        }
      }
      s0 += el;
    }
  });
  // discontinuities: a different road (or none) next door, or a jump along the same road
  const jump = GRID_STEP * 4;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      if (rid[k] < 0) {
        bad[k] = 1;
        continue;
      }
      for (let dj = -1; dj <= 1 && !bad[k]; dj++) {
        const jj = j + dj;
        if (jj < 0 || jj >= N) continue;
        for (let di = -1; di <= 1; di++) {
          const ii = i + di;
          if (ii < 0 || ii >= N) continue;
          const kk = jj * N + ii;
          if (rid[kk] !== rid[k] || Math.abs(along[kk] - along[k]) > jump) {
            bad[k] = 1;
            break;
          }
        }
      }
    }
  }
  // confidence: 0 within 2 cells of a discontinuity (so every triangle touching one is exactly 0), then
  // two box blurs fade it back in
  let conf = new Float32Array(cnt);
  const R = 2;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      let ok = 1;
      for (let dj = -R; dj <= R && ok; dj++) {
        const jj = Math.min(N - 1, Math.max(0, j + dj));
        for (let di = -R; di <= R; di++) {
          if (bad[jj * N + Math.min(N - 1, Math.max(0, i + di))]) {
            ok = 0;
            break;
          }
        }
      }
      conf[j * N + i] = ok;
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    const src = conf;
    conf = new Float32Array(cnt);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        let s = 0;
        for (let dj = -1; dj <= 1; dj++) {
          const jj = Math.min(N - 1, Math.max(0, j + dj));
          for (let di = -1; di <= 1; di++) s += src[jj * N + Math.min(N - 1, Math.max(0, i + di))];
        }
        conf[j * N + i] = s / 9;
      }
    }
  }
  const kind = (k) => (rid[k] >= 0 ? world.roads[rid[k]].kind : 0);
  return { lat, along, hw, conf, kind };
}

const FIELDS = new WeakMap();
// canopy contribution per tree variant (conifers shade the floor, dead trees barely)
const CANOPY_W = [1, 1, 0.95, 0.12, 0.1, 0.55, 0.05];

/**
 * Per-vertex ground layers on the heightfield grid: splat (grass, forest, road, mud), rock (steep slopes),
 * wet (drainage lines / low ground), ao (under trees), normals. sample(x, z, out) bilinearly reads them.
 * base: what the terrain draws under and beside the roads (grass, forest, mud summing to 1) + road coverage;
 * the terrain shader lays the road over it per pixel.
 */
export function groundFields(world) {
  let f = FIELDS.get(world);
  if (f) return f;
  const N = GRID_N;
  const H = world.heights;
  const count = N * N;
  const nrm = new Float32Array(count * 3);
  const splat = new Float32Array(count * 4);
  const base = new Float32Array(count * 4);
  const rock = new Float32Array(count);
  const wet = new Float32Array(count);
  const ao = new Float32Array(count).fill(1);
  const canopy = new Float32Array(count);
  const at = (i, j) => H[Math.max(0, Math.min(N - 1, j)) * N + Math.max(0, Math.min(N - 1, i))];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      const nx = at(i - 1, j) - at(i + 1, j);
      const ny = 2 * GRID_STEP;
      const nz = at(i, j - 1) - at(i, j + 1);
      const l = Math.hypot(nx, ny, nz);
      nrm[k * 3] = nx / l;
      nrm[k * 3 + 1] = ny / l;
      nrm[k * 3 + 2] = nz / l;
    }
  }
  // canopy density and trunk occlusion from the trees
  const trees = world.trees;
  for (let t = 0; t < trees.length; t += 6) {
    const tx = trees[t], tz = trees[t + 2], sc = trees[t + 3], v = trees[t + 5] | 0;
    const R = 6.5 * sc;
    const cw = CANOPY_W[v] ?? 0.5;
    const i0 = Math.max(0, Math.floor((tx - R + MAP_HALF) / GRID_STEP));
    const i1 = Math.min(N - 1, Math.ceil((tx + R + MAP_HALF) / GRID_STEP));
    const j0 = Math.max(0, Math.floor((tz - R + MAP_HALF) / GRID_STEP));
    const j1 = Math.min(N - 1, Math.ceil((tz + R + MAP_HALF) / GRID_STEP));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * N + i;
        const d = Math.hypot(-MAP_HALF + i * GRID_STEP - tx, -MAP_HALF + j * GRID_STEP - tz);
        if (d >= R) continue;
        const q = 1 - (d / R) ** 2;
        canopy[k] += cw * q * q;
        const r = 3.2 * sc;
        if (d < r) ao[k] = Math.max(0.45, ao[k] - 0.28 * (1 - d / r));
      }
    }
  }
  // contact shade under bushes / ferns
  const bushes = world.bushes;
  for (let b = 0; b < bushes.length; b += 6) {
    const bx = bushes[b], bz = bushes[b + 2], r = 1.6 * bushes[b + 3];
    const i0 = Math.max(0, Math.floor((bx - r + MAP_HALF) / GRID_STEP)), i1 = Math.min(N - 1, Math.ceil((bx + r + MAP_HALF) / GRID_STEP));
    const j0 = Math.max(0, Math.floor((bz - r + MAP_HALF) / GRID_STEP)), j1 = Math.min(N - 1, Math.ceil((bz + r + MAP_HALF) / GRID_STEP));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(-MAP_HALF + i * GRID_STEP - bx, -MAP_HALF + j * GRID_STEP - bz);
        if (d < r) ao[j * N + i] = Math.max(0.45, ao[j * N + i] - 0.16 * (1 - d / r));
      }
    }
  }
  const zones = world.zones;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      const x = -MAP_HALF + i * GRID_STEP;
      const z = -MAP_HALF + j * GRID_STEP;
      const h = H[k];
      let open = 0;
      let yard = 0;
      for (const zn of zones) {
        const d = Math.hypot(x - zn.x, z - zn.z);
        open = Math.max(open, 1 - smoothstep(zn.flat * 0.8, zn.flat + 18, d));
        if (zn.dirt) yard = Math.max(yard, zn.dirt * (1 - smoothstep(zn.flat * 0.35, zn.flat * 0.85, d)));
      }
      const n = Math.sin(x * 0.043 + Math.sin(z * 0.031) * 2.1) * Math.cos(z * 0.037 - x * 0.012);
      // forest floor under the canopy, meadow grass in the gaps (and in the open around the sites)
      const forest = smoothstep(0.2, 0.75, canopy[k] + n * 0.18) * (1 - 0.8 * open);
      const rd = world.roadDist[k];
      const road = 1 - smoothstep(1.9, 3.3, rd);
      const slope = 1 - nrm[k * 3 + 1];
      // concavity at two scales: drainage lines and hollows collect water
      let lap = 0;
      for (const s of [2, 5]) lap += ((at(i - s, j) + at(i + s, j) + at(i, j - s) + at(i, j + s)) * 0.25 - h) / (s * GRID_STEP);
      wet[k] = Math.max(smoothstep(0.02, 0.16, lap), smoothstep(WATER_LEVEL + 2.5, WATER_LEVEL + 0.4, h)) * (1 - road);
      rock[k] = smoothstep(0.16, 0.27, slope + n * 0.03) * (1 - road);
      let mud = smoothstep(WATER_LEVEL + 1.3, WATER_LEVEL + 0.2, h);
      // trampled dirt yards in the busier places
      const yn = 0.5 + 0.5 * Math.sin(x * 0.21 + Math.cos(z * 0.17) * 2.3);
      mud = Math.max(mud, yard * (0.55 + 0.45 * yn));
      const rest = (1 - road) * (1 - mud);
      const wg = (1 - forest) * rest;
      const wf = forest * rest;
      const wm = mud * (1 - road);
      const sum = wg + wf + road + wm || 1;
      splat[k * 4] = wg / sum;
      splat[k * 4 + 1] = wf / sum;
      splat[k * 4 + 2] = road / sum;
      splat[k * 4 + 3] = wm / sum;
      base[k * 4] = (1 - forest) * (1 - mud);
      base[k * 4 + 1] = forest * (1 - mud);
      base[k * 4 + 2] = mud;
      base[k * 4 + 3] = road;
    }
  }
  const sample = (x, z, out = {}) => {
    const fx = Math.max(0, Math.min(N - 1.001, (x + MAP_HALF) / GRID_STEP));
    const fz = Math.max(0, Math.min(N - 1.001, (z + MAP_HALF) / GRID_STEP));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const k00 = j * N + i, k10 = k00 + 1, k01 = k00 + N, k11 = k01 + 1;
    const bl = (a, s = 1, o = 0) => (a[k00 * s + o] * (1 - u) + a[k10 * s + o] * u) * (1 - v) + (a[k01 * s + o] * (1 - u) + a[k11 * s + o] * u) * v;
    out.grass = bl(splat, 4, 0);
    out.forest = bl(splat, 4, 1);
    out.road = bl(splat, 4, 2);
    out.mud = bl(splat, 4, 3);
    out.rock = bl(rock);
    out.wet = bl(wet);
    out.canopy = bl(canopy);
    return out;
  };
  f = { nrm, splat, base, rock, wet, ao, canopy, sample };
  FIELDS.set(world, f);
  return f;
}

export function buildTerrain(world) {
  const N = GRID_N;
  const H = world.heights;
  const count = N * N;
  const F = groundFields(world);
  const frame = roadFrame(world);
  const pos = new Float32Array(count * 3);
  const extra = new Float32Array(count * 4);
  const roadAttr = new Float32Array(count * 4);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      pos[k * 3] = -MAP_HALF + i * GRID_STEP;
      pos[k * 3 + 1] = H[k];
      pos[k * 3 + 2] = -MAP_HALF + j * GRID_STEP;
      // road kind: +1 asphalt, -1 trail, 0 dirt road
      const kd = frame.kind(k);
      extra[k * 4] = kd === ROAD.ASPHALT ? 1 : kd === ROAD.TRAIL ? -1 : 0;
      extra[k * 4 + 1] = F.ao[k];
      extra[k * 4 + 2] = F.wet[k];
      extra[k * 4 + 3] = F.rock[k];
      roadAttr[k * 4] = frame.lat[k];
      roadAttr[k * 4 + 1] = frame.along[k];
      roadAttr[k * 4 + 2] = frame.hw[k];
      roadAttr[k * 4 + 3] = frame.conf[k];
    }
  }
  const idx = new Uint32Array((N - 1) * (N - 1) * 6);
  let o = 0;
  for (let j = 0; j < N - 1; j++) {
    for (let i = 0; i < N - 1; i++) {
      const k00 = j * N + i;
      const k10 = k00 + 1;
      const k01 = k00 + N;
      const k11 = k01 + 1;
      idx[o++] = k00;
      idx[o++] = k01;
      idx[o++] = k10;
      idx[o++] = k10;
      idx[o++] = k01;
      idx[o++] = k11;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(F.nrm, 3));
  geo.setAttribute('aSplat', new THREE.BufferAttribute(F.base, 4));
  geo.setAttribute('aExtra', new THREE.BufferAttribute(extra, 4));
  geo.setAttribute('aRoad', new THREE.BufferAttribute(roadAttr, 4));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();

  const tex = (name) => {
    const t = getTexture(name);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  };
  groundNoiseTexture();
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const uniforms = {
    tGrass: { value: tex('ground_grass') },
    tForest: { value: tex('ground_forest') },
    tRoad: { value: tex('ground_road') },
    tAsph: { value: tex('ground_asphalt') },
    tMud: { value: tex('ground_mud') },
    tRock: { value: tex('rock') },
    tNoise: { value: tex('ground_noise') },
    tGroundNoise: VEG.tGroundNoise,
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec4 aSplat;\nattribute vec4 aExtra;\nattribute vec4 aRoad;\nvarying vec4 vSplat;\nvarying vec4 vExtra;\nvarying vec4 vRoad;\nvarying vec3 vWPos;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = aSplat;\nvExtra = aExtra;\nvRoad = aRoad;\nvWPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D tGrass;
        uniform sampler2D tForest;
        uniform sampler2D tRoad;
        uniform sampler2D tAsph;
        uniform sampler2D tMud;
        uniform sampler2D tRock;
        uniform sampler2D tNoise;
        varying vec4 vSplat;
        varying vec4 vExtra;
        varying vec4 vRoad;
        varying vec3 vWPos;
        ${GROUND_MACRO_GLSL}
        // anti-tiling: a second, rotated + rescaled sample of the same layer takes over in noise patches; the seam
        // follows the texture's luminance (its "height"), so it reads as relief instead of a cross-fade.
        // Explicit gradients: layers are only sampled where they have weight (non-uniform control flow).
        vec4 terrLayer(sampler2D t, vec2 uv, vec2 dx, vec2 dy, float n, float ang, float sc, vec2 off) {
          vec3 a = textureGrad(t, uv, dx, dy).rgb;
          mat2 R = mat2(cos(ang), sin(ang), -sin(ang), cos(ang)) * sc;
          vec3 b = textureGrad(t, R * uv + off, R * dx, R * dy).rgb;
          float la = dot(a, vec3(0.333)), lb = dot(b, vec3(0.333));
          float k = smoothstep(0.4, 0.6, n + (lb - la) * 1.5);
          return vec4(mix(a, b, k), mix(la, lb, k));
        }`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        vec2 wp = vWPos.xz;
        vec2 tuv = wp * 0.22;
        // gradients taken here, in uniform control flow, so branch-local samples get the right mip level
        vec2 gx = dFdx(tuv), gy = dFdy(tuv);
        vec2 wx = dFdx(wp), wy = dFdy(wp);
        const mat2 ROT = mat2(0.8, -0.6, 0.6, 0.8);
        vec2 rwx = ROT * wx, rwy = ROT * wy;
        vec4 nz = texture2D(tGroundNoise, wp * (1.0 / 29.0));
        float n1 = nz.r * 0.6 + nz.g * 0.4;
        float n2 = nz.g * 0.5 + nz.b * 0.5;
        // tNoise holds independent tileable noise fields in r / g / b (linear data): road edges, ruts, puddles
        vec3 nMid = texture2D(tNoise, wp * 0.041 + 0.31).rgb;
        vec3 nFine = texture2D(tNoise, wp * 0.23 + 0.67).rgb;
        float wet = vExtra.z;

        // ---- road coverage: per pixel from the road frame, per vertex where the frame is not trustworthy
        // (junctions, road ends). Ragged dirt edges that grass creeps over, clean asphalt edges with a gravel shoulder.
        float conf = vRoad.w;
        float lat = vRoad.x;
        float aLat = abs(lat);
        float hw = vRoad.z;
        float asph = max(vExtra.x, 0.0);
        float trail = max(-vExtra.x, 0.0);
        float edgeN = (nFine.g - 0.5) * mix(1.3, 0.3, asph) + (nMid.b - 0.5) * mix(0.8, 0.0, asph);
        float soft = mix(0.55, 0.12, asph);
        float pixRoad = 1.0 - smoothstep(hw + asph * 0.7 - soft, hw + asph * 0.7 + soft * 0.3, aLat + edgeN);
        float road = mix(vSplat.w, pixRoad, conf);
        vec2 ruv = vec2(lat * 0.7, vRoad.y * 0.06);
        vec2 rux = dFdx(ruv), ruy = dFdy(ruv);

        // ---- ground under and beside the roads
        vec3 w = vSplat.xyz;
        // ragged meadow / forest-floor border
        float nb = (n2 - 0.5) * 0.9;
        w.x = max(0.0, w.x + nb * w.y);
        w.y = max(0.0, w.y - nb * w.y);
        vec4 cG = vec4(0.0), cF = vec4(0.0), cM = vec4(0.0);
        // (grass is also sampled on the road: the crown between the ruts and the verges grow it)
        if (w.x > 0.002 || road > 0.002) {
          cG = terrLayer(tGrass, tuv, gx, gy, n1, 1.3, 0.83, vec2(0.31, 0.17));
          cG.rgb = mix(cG.rgb, cG.w * vec3(1.45, 1.2, 0.66), groundDry(wp) * 0.3);
        }
        if (w.y > 0.002 && road < 0.998) {
          cF = terrLayer(tForest, tuv * 0.9 + 0.37, gx * 0.9, gy * 0.9, n2, 2.2, 1.17, vec2(0.13, 0.71));
          // moss mats on the damp forest floor
          cF.rgb = mix(cF.rgb, cF.rgb * vec3(0.72, 1.02, 0.58) + vec3(0.0, 0.006, 0.0), smoothstep(0.5, 0.78, nz.a * 0.7 + nz.r * 0.3 + wet * 0.35) * 0.75);
        }
        if (w.z > 0.002 && road < 0.998) cM = terrLayer(tMud, tuv * 1.1, gx * 1.1, gy * 1.1, n1, 0.9, 0.79, vec2(0.57, 0.23));
        // height-aware blend: where two layers meet, the higher texel (blade, leaf, pebble) wins
        vec3 b = (w + vec3(cG.w, cF.w, cM.w * 0.7) * 0.9) * step(0.002, w);
        float ma = max(max(b.x, b.y), b.z) - 0.14;
        w = max(b - ma, 0.0);
        w /= max(w.x + w.y + w.z, 1e-4);
        vec3 ground = cG.rgb * w.x + cF.rgb * w.y + cM.rgb * w.z;
        // steep slopes: rock breaks through (height-aware too)
        float rk = 0.0;
        if (vExtra.w > 0.01) {
          vec4 cK = terrLayer(tRock, tuv * (0.21 / 0.22), gx * (0.21 / 0.22), gy * (0.21 / 0.22), n2, 1.7, 0.71, vec2(0.41, 0.05));
          rk = smoothstep(0.3, 0.7, vExtra.w + (cK.w - 0.35) * 0.9);
          ground = mix(ground, cK.rgb * vec3(0.95, 0.97, 1.0), rk);
        }
        // drainage lines and hollows: darker, greener
        ground *= mix(vec3(1.0), vec3(0.74, 0.84, 0.7), wet * 0.75 * (1.0 - rk));

        // ---- roads
        if (road > 0.002) {
          float tb = smoothstep(0.3, 0.7, nMid.r);
          vec3 dirt = textureGrad(tRoad, ROT * wp * 0.2, rwx * 0.2, rwy * 0.2).rgb;
          if (tb > 0.002) dirt = mix(dirt, textureGrad(tRoad, wp * 0.083 + 0.5, wx * 0.083, wy * 0.083).rgb, tb * 0.5);
          // tyre ruts (dirt roads) or one worn footpath (trails), wandering a little
          float wob = (nMid.r - 0.5) * 0.55 + (nFine.b - 0.5) * 0.12;
          float la = abs(lat + wob);
          float rutC = 0.82 * (1.0 - trail);
          float rw = mix(0.3, 0.42, trail);
          float dr = abs(la - rutC);
          float rut = (1.0 - smoothstep(rw * 0.55, rw * 0.9, dr)) * conf;
          float berm = smoothstep(rw * 0.9, rw * 1.3, dr) * (1.0 - smoothstep(rw * 1.3, rw * 2.2, dr)) * conf * (1.0 - trail);
          // tyre streaks: the dirt texture stretched along the road
          vec3 streak = textureGrad(tRoad, ruv, rux, ruy).rgb;
          vec3 rutCol = mix(dirt, streak, 0.55) * vec3(0.7, 0.67, 0.64);
          // faint tread imprint across the tyre tracks
          rutCol *= 1.0 - 0.1 * step(0.55, fract(vRoad.y * 3.3 + la * 1.5)) * (1.0 - trail);
          dirt = mix(dirt, rutCol, rut * mix(0.85, 0.6, trail));
          dirt *= 1.0 + berm * 0.1;
          // standing water in the ruts
          float pud = rut * smoothstep(0.62, 0.7, nMid.g) * smoothstep(0.35, 0.6, nFine.r) * (1.0 - trail);
          dirt = mix(dirt, vec3(0.018, 0.02, 0.022) + dirt * 0.25, pud * 0.85);
          // grassy crown between the ruts and grass creeping in from the verge
          float crown = (1.0 - smoothstep(0.16, 0.4, la)) * smoothstep(0.38, 0.62, nMid.g + nFine.r * 0.25) * (1.0 - trail) * conf;
          float verge = smoothstep(hw - 1.3, hw - 0.2, aLat + edgeN * 0.5) * smoothstep(0.45, 0.7, nFine.g) * conf * (1.0 - asph);
          dirt = mix(dirt, cG.rgb * 0.92, max(crown * 0.85, verge * 0.7));
          if (asph > 0.002) {
            vec3 a = textureGrad(tAsph, ROT * wp * 0.16, rwx * 0.16, rwy * 0.16).rgb;
            if (tb > 0.002) a = mix(a, textureGrad(tAsph, wp * 0.061 + 0.2, wx * 0.061, wy * 0.061).rgb, tb * 0.5);
            // faded lane markings: dashed yellow centre line, white edge lines, worn through in places
            float grit = textureGrad(tNoise, wp * 1.9, wx * 1.9, wy * 1.9).g;
            float wear = smoothstep(0.25, 0.6, nFine.b) * smoothstep(0.2, 0.5, nMid.r) * smoothstep(0.3, 0.55, grit);
            float cl = (1.0 - smoothstep(0.055, 0.085, aLat)) * step(fract(vRoad.y / 12.0), 0.3);
            float el = 1.0 - smoothstep(0.05, 0.08, abs(aLat - (hw - 0.45)));
            a = mix(a, vec3(0.22, 0.16, 0.05), cl * conf * wear * 0.75);
            a = mix(a, vec3(0.27, 0.27, 0.25), el * conf * wear * 0.6);
            // crumbling edge and a gravel shoulder
            float sh = smoothstep(hw - 0.2, hw + 0.05, aLat + (nFine.g - 0.5) * 0.35);
            a = mix(a, dirt * vec3(1.02, 1.0, 0.97), sh * conf);
            dirt = mix(dirt, a, asph);
          }
          ground = mix(ground, dirt, road);
        }
        ground *= groundMacro(wp);
        diffuseColor.rgb *= ground * vExtra.y;
        `,
      );
  };
  mat.customProgramCacheKey = () => 'terrain-splat-3';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.name = 'terrain';
  return mesh;
}

// Water surface (lake + ponds): dark murky water with animated ripples, fresnel sky reflection and
// moon/sun glints. One plane over the whole valley at the water line - terrain hides it everywhere else.
export function buildWater(world) {
  const size = MAP_HALF * 2 + 40;
  const geo = new THREE.PlaneGeometry(size, size, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uSky: { value: new THREE.Color(0x445566) },
        uDeep: { value: new THREE.Color(0x05090a) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunCol: { value: new THREE.Color(0xffffff) },
        uCam: { value: new THREE.Vector3() },
      },
    ]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec3 vW;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform float uTime; uniform vec3 uSky; uniform vec3 uDeep; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uCam;
      varying vec3 vW;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      void main() {
        vec2 p = vW.xz;
        float e = 0.08;
        float t = uTime;
        float a = n(p * 0.35 + vec2(t * 0.12, t * 0.07)) + 0.5 * n(p * 0.9 - vec2(t * 0.2, -t * 0.11));
        float bx = n((p + vec2(e, 0.0)) * 0.35 + vec2(t * 0.12, t * 0.07)) + 0.5 * n((p + vec2(e, 0.0)) * 0.9 - vec2(t * 0.2, -t * 0.11));
        float bz = n((p + vec2(0.0, e)) * 0.35 + vec2(t * 0.12, t * 0.07)) + 0.5 * n((p + vec2(0.0, e)) * 0.9 - vec2(t * 0.2, -t * 0.11));
        vec3 N = normalize(vec3((a - bx) * 1.6, 1.0, (a - bz) * 1.6));
        vec3 V = normalize(uCam - vW);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
        vec3 col = mix(uDeep, uSky * 0.8, 0.15 + fres * 0.75);
        vec3 R = reflect(-V, N);
        col += uSunCol * pow(max(dot(R, normalize(uSunDir)), 0.0), 120.0) * 0.9;
        gl_FragColor = vec4(col, 0.9);
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, WATER_LEVEL, 0);
  mesh.renderOrder = 2;
  mesh.name = 'water';
  return mesh;
}
