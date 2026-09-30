// Terrain mesh built from the shared heightfield (exactly matches collision), splat-blended ground
// textures (meadow grass / forest floor / dirt road / asphalt / mud / rock) with baked ambient occlusion
// under trees, drainage wetness and slope rock. The ground layers come from groundFields(), which the
// grass placement shares, so grass cards stand on the grass layer.
import * as THREE from 'three';
import { GRID_N, GRID_STEP, MAP_HALF, WATER_LEVEL } from '../../shared/constants.js';
import { smoothstep } from '../../shared/rng.js';
import { getTexture } from './textures.js';
import { GROUND_MACRO_GLSL, groundNoiseTexture, VEG } from './materials.js';

const FIELDS = new WeakMap();
// canopy contribution per tree variant (conifers shade the floor, dead trees barely)
const CANOPY_W = [1, 1, 0.95, 0.12, 0.1, 0.55, 0.05];

/**
 * Per-vertex ground layers on the heightfield grid: splat (grass, forest, road, mud), rock (steep slopes),
 * wet (drainage lines / low ground), ao (under trees), normals. sample(x, z, out) bilinearly reads them.
 */
export function groundFields(world) {
  let f = FIELDS.get(world);
  if (f) return f;
  const N = GRID_N;
  const H = world.heights;
  const count = N * N;
  const nrm = new Float32Array(count * 3);
  const splat = new Float32Array(count * 4);
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
  f = { nrm, splat, rock, wet, ao, canopy, sample };
  FIELDS.set(world, f);
  return f;
}

export function buildTerrain(world) {
  const N = GRID_N;
  const H = world.heights;
  const count = N * N;
  const F = groundFields(world);
  const pos = new Float32Array(count * 3);
  const extra = new Float32Array(count * 4);
  const rdir = new Float32Array(count * 2);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      pos[k * 3] = -MAP_HALF + i * GRID_STEP;
      pos[k * 3 + 1] = H[k];
      pos[k * 3 + 2] = -MAP_HALF + j * GRID_STEP;
      extra[k * 4] = world.roadKind[k] === 2 ? 1 : 0;
      extra[k * 4 + 1] = F.ao[k];
      extra[k * 4 + 2] = F.wet[k];
      extra[k * 4 + 3] = F.rock[k];
      // road tangent as a double angle (cos 2a, sin 2a): direction-agnostic, so it interpolates cleanly
      const dx = world.roadDir[k * 2];
      const dz = world.roadDir[k * 2 + 1];
      rdir[k * 2] = dx * dx - dz * dz;
      rdir[k * 2 + 1] = 2 * dx * dz;
    }
  }
  // road direction coherence: where neighbouring directions disagree (junctions, tight bends) the along-road
  // mapping zig-zags -> shrink the vector there, the shader blends to plain dirt
  const coh = new Float32Array(count);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      let m = 1;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
        const q = jj * N + ii;
        m = Math.min(m, rdir[k * 2] * rdir[q * 2] + rdir[k * 2 + 1] * rdir[q * 2 + 1]);
      }
      coh[k] = smoothstep(0.55, 0.95, m);
    }
  }
  for (let k = 0; k < count; k++) {
    rdir[k * 2] *= coh[k];
    rdir[k * 2 + 1] *= coh[k];
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
  geo.setAttribute('aSplat', new THREE.BufferAttribute(F.splat, 4));
  geo.setAttribute('aExtra', new THREE.BufferAttribute(extra, 4));
  geo.setAttribute('aRoadDir', new THREE.BufferAttribute(rdir, 2));
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
    tDirt: { value: tex('ground_dirt') },
    tGroundNoise: VEG.tGroundNoise,
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aSplat;\nattribute vec4 aExtra;\nattribute vec2 aRoadDir;\nvarying vec4 vSplat;\nvarying vec4 vExtra;\nvarying vec2 vRoadDir;\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = aSplat;\nvExtra = aExtra;\nvRoadDir = aRoadDir;\nvWPos = position;');
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
        uniform sampler2D tDirt;
        varying vec4 vSplat;
        varying vec4 vExtra;
        varying vec2 vRoadDir;
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
        vec2 gx = dFdx(tuv), gy = dFdy(tuv);
        vec4 nz = texture2D(tGroundNoise, wp * (1.0 / 29.0));
        float n1 = nz.r * 0.6 + nz.g * 0.4;
        float n2 = nz.g * 0.5 + nz.b * 0.5;
        float wet = vExtra.z;
        vec4 w = vSplat;
        // ragged meadow / forest-floor border
        float nb = (n2 - 0.5) * 0.9;
        w.x = max(0.0, w.x + nb * w.y);
        w.y = max(0.0, w.y - nb * w.y);
        vec4 cG = vec4(0.0), cF = vec4(0.0), cM = vec4(0.0), cR = vec4(0.0);
        if (w.x > 0.002) {
          cG = terrLayer(tGrass, tuv, gx, gy, n1, 1.3, 0.83, vec2(0.31, 0.17));
          cG.rgb = mix(cG.rgb, cG.w * vec3(1.45, 1.2, 0.66), groundDry(wp) * 0.3);
        }
        if (w.y > 0.002) {
          cF = terrLayer(tForest, tuv * 0.9 + 0.37, gx * 0.9, gy * 0.9, n2, 2.2, 1.17, vec2(0.13, 0.71));
          // moss mats on the damp forest floor
          cF.rgb = mix(cF.rgb, cF.rgb * vec3(0.72, 1.02, 0.58) + vec3(0.0, 0.006, 0.0), smoothstep(0.5, 0.78, nz.a * 0.7 + nz.r * 0.3 + wet * 0.35) * 0.75);
        }
        if (w.w > 0.002) cM = terrLayer(tMud, tuv * 1.1, gx * 1.1, gy * 1.1, n1, 0.9, 0.79, vec2(0.57, 0.23));
        // road textures run along the road (ruts and wear follow its direction)
        float ra = atan(vRoadDir.y, vRoadDir.x + 1e-5) * 0.5;
        vec2 rd = vec2(cos(ra), sin(ra));
        vec2 ruv = vec2(dot(wp, vec2(rd.y, -rd.x)), dot(wp, rd)) * 0.22;
        vec2 rgx = dFdx(ruv), rgy = dFdy(ruv);
        if (w.z > 0.002) {
          vec3 cRd = textureGrad(tRoad, ruv * 0.7, rgx * 0.7, rgy * 0.7).rgb;
          vec3 cA = textureGrad(tAsph, ruv * 0.5, rgx * 0.5, rgy * 0.5).rgb;
          // junctions / road ends: the interpolated direction field collapses (and swirls) - plain dirt there
          float rdl = length(vRoadDir);
          if (rdl < 0.97) {
            vec3 cD = textureGrad(tDirt, tuv * 0.8 + 0.19, gx * 0.8, gy * 0.8).rgb;
            float k = smoothstep(0.45, 0.97, rdl);
            cRd = mix(cD, cRd, k);
            cA = mix(cD * vec3(0.72, 0.74, 0.78), cA, k);
          }
          cR.rgb = mix(cRd, cA, vExtra.x);
          cR.w = dot(cR.rgb, vec3(0.333));
        }
        // height-aware blend: where two layers meet, the higher texel (blade, leaf, pebble) wins
        vec4 b = (w + vec4(cG.w, cF.w, cR.w, cM.w * 0.7) * 0.9) * step(0.002, w);
        float ma = max(max(b.x, b.y), max(b.z, b.w)) - 0.14;
        w = max(b - ma, 0.0);
        w /= max(w.x + w.y + w.z + w.w, 1e-4);
        vec3 ground = cG.rgb * w.x + cF.rgb * w.y + cR.rgb * w.z + cM.rgb * w.w;
        // steep slopes: rock breaks through (height-aware too)
        float rk = 0.0;
        if (vExtra.w > 0.01) {
          vec4 cK = terrLayer(tRock, tuv * (0.21 / 0.22), gx * (0.21 / 0.22), gy * (0.21 / 0.22), n2, 1.7, 0.71, vec2(0.41, 0.05));
          rk = smoothstep(0.3, 0.7, vExtra.w + (cK.w - 0.35) * 0.9);
          ground = mix(ground, cK.rgb * vec3(0.95, 0.97, 1.0), rk);
        }
        // drainage lines and hollows: darker, greener
        ground *= mix(vec3(1.0), vec3(0.74, 0.84, 0.7), wet * 0.75 * (1.0 - rk));
        ground *= groundMacro(wp);
        diffuseColor.rgb *= ground * vExtra.y;
        `,
      );
  };
  mat.customProgramCacheKey = () => 'terrain-splat';
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
