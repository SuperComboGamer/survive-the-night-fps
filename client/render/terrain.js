// Terrain mesh built from the shared heightfield (exactly matches collision), splat-blended ground
// textures (grass / forest floor / mud) with baked ambient occlusion under trees. Roads are drawn per
// pixel from a road frame baked into the vertices (signed offset from the nearest road's centre line and
// distance along it): dirt roads get tyre ruts, a grassy crown and puddles, trails a worn footpath and
// Route 9 faded lane lines and gravel shoulders.
import * as THREE from 'three';
import { GRID_N, GRID_STEP, MAP_HALF, WATER_LEVEL } from '../../shared/constants.js';
import { smoothstep } from '../../shared/rng.js';
import { ROAD } from '../../shared/world.js';
import { getTexture } from './textures.js';

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

export function buildTerrain(world) {
  const N = GRID_N;
  const H = world.heights;
  const count = N * N;
  const pos = new Float32Array(count * 3);
  const nrm = new Float32Array(count * 3);
  const splat = new Float32Array(count * 4);
  const extra = new Float32Array(count * 3);
  const roadAttr = new Float32Array(count * 4);
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
  const frame = roadFrame(world);
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
      const slope = 1 - nrm[k * 3 + 1];
      let mud = Math.max(smoothstep(WATER_LEVEL + 1.3, WATER_LEVEL + 0.2, h), smoothstep(0.22, 0.4, slope) * 0.8);
      // trampled dirt yards in the busier places
      const yn = 0.5 + 0.5 * Math.sin(x * 0.21 + Math.cos(z * 0.17) * 2.3);
      mud = Math.max(mud, yard * (0.55 + 0.45 * yn));
      // ground under (and beside) the road: grass / forest floor / mud, always summing to 1
      const wg = (1 - forest) * (1 - mud);
      const wf = forest * (1 - mud);
      const sum = wg + wf + mud || 1;
      splat[k * 4] = wg / sum;
      splat[k * 4 + 1] = wf / sum;
      splat[k * 4 + 2] = mud / sum;
      // per-vertex road coverage: used where the road frame is not trustworthy (junctions, road ends)
      splat[k * 4 + 3] = 1 - smoothstep(1.9, 3.3, world.roadDist[k]);
      const kd = frame.kind(k);
      extra[k * 3] = kd === ROAD.ASPHALT ? 1 : 0;
      extra[k * 3 + 1] = kd === ROAD.TRAIL ? 1 : 0;
      extra[k * 3 + 2] = 1;
      roadAttr[k * 4] = frame.lat[k];
      roadAttr[k * 4 + 1] = frame.along[k];
      roadAttr[k * 4 + 2] = frame.hw[k];
      roadAttr[k * 4 + 3] = frame.conf[k];
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
        if (d < r) extra[k * 3 + 2] = Math.max(0.45, extra[k * 3 + 2] - 0.28 * (1 - d / r));
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
  geo.setAttribute('aExtra', new THREE.BufferAttribute(extra, 3));
  geo.setAttribute('aRoad', new THREE.BufferAttribute(roadAttr, 4));
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
    tNoise: { value: tex('ground_noise') },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec4 aSplat;\nattribute vec3 aExtra;\nattribute vec4 aRoad;\nvarying vec4 vSplat;\nvarying vec3 vExtra;\nvarying vec4 vRoad;\nvarying vec3 vWPos;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = aSplat;\nvExtra = aExtra;\nvRoad = aRoad;\nvWPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform sampler2D tGrass;\nuniform sampler2D tForest;\nuniform sampler2D tRoad;\nuniform sampler2D tAsph;\nuniform sampler2D tMud;\nuniform sampler2D tNoise;\nvarying vec4 vSplat;\nvarying vec3 vExtra;\nvarying vec4 vRoad;\nvarying vec3 vWPos;',
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        vec2 wp = vWPos.xz;
        // Layers are only sampled where they contribute. Samples inside branches use gradients taken here,
        // in uniform control flow, so their mip level is right at the branch edges.
        vec2 wx = dFdx(wp);
        vec2 wy = dFdy(wp);
        const mat2 ROT = mat2(0.8, -0.6, 0.6, 0.8);
        vec2 rwx = ROT * wx;
        vec2 rwy = ROT * wy;
        // tNoise holds independent tileable noise fields in r / g / b (linear data)
        vec3 nBig = texture2D(tNoise, wp * 0.0067).rgb;
        vec3 nMid = texture2D(tNoise, wp * 0.041 + 0.31).rgb;
        vec3 nFine = texture2D(tNoise, wp * 0.23 + 0.67).rgb;
        // every ground texture is sampled at two scales / rotations blended by noise, which hides the tiling
        float tb = smoothstep(0.3, 0.7, nMid.r);
        vec3 w = vSplat.xyz;
        float nb = (nMid.g - 0.45) * 0.9;
        w.x = max(0.0, w.x + nb * w.y);
        w.y = max(0.0, w.y - nb * w.y);
        w.z = smoothstep(0.05, 0.75, w.z + (nFine.r - 0.5) * 0.5 * w.z);
        w /= max(0.0001, w.x + w.y + w.z);

        // ---- road coverage: ragged dirt edges that grass creeps over, clean asphalt edges with a gravel shoulder
        float conf = vRoad.w;
        float lat = vRoad.x;
        float aLat = abs(lat);
        float hw = vRoad.z;
        float asph = vExtra.x;
        float trail = vExtra.y;
        float edgeN = (nFine.g - 0.5) * mix(1.3, 0.3, asph) + (nMid.b - 0.5) * mix(0.8, 0.0, asph);
        float soft = mix(0.55, 0.12, asph);
        float pixRoad = 1.0 - smoothstep(hw + asph * 0.7 - soft, hw + asph * 0.7 + soft * 0.3, aLat + edgeN);
        float road = mix(vSplat.w, pixRoad, conf);
        vec2 ruv = vec2(lat * 0.7, vRoad.y * 0.06);
        vec2 rux = dFdx(ruv);
        vec2 ruy = dFdy(ruv);

        vec3 cG = vec3(0.0);
        vec3 cF = vec3(0.0);
        vec3 cM = vec3(0.0);
        if (w.x > 0.001 || road > 0.002) {
          if (tb < 0.998) cG = textureGrad(tGrass, wp * 0.22, wx * 0.22, wy * 0.22).rgb * (1.0 - tb);
          if (tb > 0.002) cG += textureGrad(tGrass, ROT * wp * 0.1386 + 0.41, rwx * 0.1386, rwy * 0.1386).rgb * tb;
          // meadow colour drifts between lush, dry straw and dark damp patches
          cG *= mix(vec3(1.0), vec3(1.22, 1.1, 0.72), smoothstep(0.52, 0.78, nBig.g) * 0.85);
          cG *= mix(vec3(1.0), vec3(0.8, 0.94, 0.82), smoothstep(0.55, 0.8, nMid.b) * 0.7);
        }
        if (w.y > 0.001 && road < 0.998) {
          if (tb < 0.998) cF = textureGrad(tForest, wp * 0.198 + 0.37, wx * 0.198, wy * 0.198).rgb * (1.0 - tb);
          if (tb > 0.002) cF += textureGrad(tForest, ROT * wp * 0.15246 + 0.451, rwx * 0.15246, rwy * 0.15246).rgb * tb;
        }
        if (w.z > 0.001 && road < 0.998) cM = textureGrad(tMud, wp * 0.242, wx * 0.242, wy * 0.242).rgb;
        vec3 ground = cG * w.x + cF * w.y + cM * w.z;

        // ---- roads
        if (road > 0.002) {
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
          dirt = mix(dirt, cG * 0.92, max(crown * 0.85, verge * 0.7));
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
        ground *= 0.7 + nBig.b * 0.24;
        diffuseColor.rgb *= ground * vExtra.z;
        `,
      );
  };
  mat.customProgramCacheKey = () => 'terrain-splat-2';
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
