// Terrain mesh built from the shared heightfield (exactly matches collision), splat-blended ground
// textures (grass / forest floor / dirt road / asphalt / mud) with baked ambient occlusion under trees.
import * as THREE from 'three';
import { GRID_N, GRID_STEP, MAP_HALF, WATER_LEVEL } from '../../shared/constants.js';
import { smoothstep } from '../../shared/rng.js';
import { getTexture } from './textures.js';

export function buildTerrain(world) {
  const N = GRID_N;
  const H = world.heights;
  const count = N * N;
  const pos = new Float32Array(count * 3);
  const nrm = new Float32Array(count * 3);
  const splat = new Float32Array(count * 4);
  const extra = new Float32Array(count * 2);
  const rdir = new Float32Array(count * 2);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      pos[k * 3] = -MAP_HALF + i * GRID_STEP;
      pos[k * 3 + 1] = H[k];
      pos[k * 3 + 2] = -MAP_HALF + j * GRID_STEP;
      const hl = H[j * N + Math.max(0, i - 1)];
      const hr = H[j * N + Math.min(N - 1, i + 1)];
      const hd = H[Math.max(0, j - 1) * N + i];
      const hu = H[Math.min(N - 1, j + 1) * N + i];
      let nx = hl - hr;
      let ny = 2 * GRID_STEP;
      let nz = hd - hu;
      const l = Math.hypot(nx, ny, nz);
      nrm[k * 3] = nx / l;
      nrm[k * 3 + 1] = ny / l;
      nrm[k * 3 + 2] = nz / l;
    }
  }
  // zone / forest masks
  const zones = world.zones;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      const x = pos[k * 3];
      const z = pos[k * 3 + 2];
      const h = H[k];
      let open = 0;
      let yard = 0;
      for (const zn of zones) {
        const d = Math.hypot(x - zn.x, z - zn.z);
        open = Math.max(open, 1 - smoothstep(zn.flat * 0.8, zn.flat + 18, d));
        if (zn.dirt) yard = Math.max(yard, zn.dirt * (1 - smoothstep(zn.flat * 0.35, zn.flat * 0.85, d)));
      }
      const n = Math.sin(x * 0.043 + Math.sin(z * 0.031) * 2.1) * Math.cos(z * 0.037 - x * 0.012);
      const patch = smoothstep(0.1, 0.7, n);
      const forest = Math.max(0, (1 - open) * (0.75 + 0.25 * patch));
      const rd = world.roadDist[k];
      const road = 1 - smoothstep(1.9, 3.3, rd);
      const slope = 1 - nrm[k * 3 + 1];
      let mud = Math.max(smoothstep(WATER_LEVEL + 1.3, WATER_LEVEL + 0.2, h), smoothstep(0.22, 0.4, slope) * 0.8);
      // trampled dirt yards in the busier places
      const yn = 0.5 + 0.5 * Math.sin(x * 0.21 + Math.cos(z * 0.17) * 2.3);
      mud = Math.max(mud, yard * (0.55 + 0.45 * yn));
      const rest = (1 - road) * (1 - mud);
      let wg = (1 - forest) * rest;
      let wf = forest * rest;
      let wr = road;
      let wm = mud * (1 - road);
      const sum = wg + wf + wr + wm || 1;
      splat[k * 4] = wg / sum;
      splat[k * 4 + 1] = wf / sum;
      splat[k * 4 + 2] = wr / sum;
      splat[k * 4 + 3] = wm / sum;
      extra[k * 2] = world.roadKind[k] === 2 ? 1 : 0;
      extra[k * 2 + 1] = 1;
      // road tangent as a double angle (cos 2a, sin 2a): direction-agnostic, so it interpolates cleanly
      const dx = world.roadDir[k * 2];
      const dz = world.roadDir[k * 2 + 1];
      rdir[k * 2] = dx * dx - dz * dz;
      rdir[k * 2 + 1] = 2 * dx * dz;
    }
  }
  // baked occlusion around tree trunks
  const trees = world.trees;
  for (let t = 0; t < trees.length; t += 6) {
    const tx = trees[t];
    const tz = trees[t + 2];
    const sc = trees[t + 3];
    const r = 3.2 * sc;
    const i0 = Math.max(0, Math.floor((tx - r + MAP_HALF) / GRID_STEP));
    const i1 = Math.min(N - 1, Math.ceil((tx + r + MAP_HALF) / GRID_STEP));
    const j0 = Math.max(0, Math.floor((tz - r + MAP_HALF) / GRID_STEP));
    const j1 = Math.min(N - 1, Math.ceil((tz + r + MAP_HALF) / GRID_STEP));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * N + i;
        const d = Math.hypot(pos[k * 3] - tx, pos[k * 3 + 2] - tz);
        if (d < r) extra[k * 2 + 1] = Math.max(0.45, extra[k * 2 + 1] - 0.28 * (1 - d / r));
      }
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
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('aSplat', new THREE.BufferAttribute(splat, 4));
  geo.setAttribute('aExtra', new THREE.BufferAttribute(extra, 2));
  geo.setAttribute('aRoadDir', new THREE.BufferAttribute(rdir, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();

  const tex = (name) => {
    const t = getTexture(name);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  };
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const uniforms = {
    tGrass: { value: tex('ground_grass') },
    tForest: { value: tex('ground_forest') },
    tRoad: { value: tex('ground_road') },
    tAsph: { value: tex('ground_asphalt') },
    tMud: { value: tex('ground_mud') },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aSplat;\nattribute vec2 aExtra;\nattribute vec2 aRoadDir;\nvarying vec4 vSplat;\nvarying vec2 vExtra;\nvarying vec2 vRoadDir;\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = aSplat;\nvExtra = aExtra;\nvRoadDir = aRoadDir;\nvWPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform sampler2D tGrass;\nuniform sampler2D tForest;\nuniform sampler2D tRoad;\nuniform sampler2D tAsph;\nuniform sampler2D tMud;\nvarying vec4 vSplat;\nvarying vec2 vExtra;\nvarying vec2 vRoadDir;\nvarying vec3 vWPos;',
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        vec2 tuv = vWPos.xz * 0.22;
        vec3 cG = texture2D(tGrass, tuv).rgb;
        vec3 cF = texture2D(tForest, tuv * 0.9 + 0.37).rgb;
        // road textures run along the road (ruts and wear follow its direction)
        float ra = atan(vRoadDir.y, vRoadDir.x + 1e-5) * 0.5;
        vec2 rd = vec2(cos(ra), sin(ra));
        vec2 ruv = vec2(dot(vWPos.xz, vec2(rd.y, -rd.x)), dot(vWPos.xz, rd)) * 0.22;
        vec3 cR = texture2D(tRoad, ruv * 0.7).rgb;
        vec3 cA = texture2D(tAsph, ruv * 0.5).rgb;
        vec3 cM = texture2D(tMud, tuv * 1.1).rgb;
        float macro = texture2D(tForest, vWPos.xz * 0.013).g;
        vec4 w = vSplat;
        // noisy transitions
        float nb = (texture2D(tGrass, vWPos.xz * 0.05).g - 0.4) * 0.6;
        w.x = max(0.0, w.x + nb * w.y);
        w.y = max(0.0, w.y - nb * w.y);
        w /= max(0.0001, w.x + w.y + w.z + w.w);
        vec3 road = mix(cR, cA, vExtra.x);
        vec3 ground = cG * w.x + cF * w.y + road * w.z + cM * w.w;
        ground *= 0.8 + macro * 0.45;
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
