// Shared building helpers for the WHITEOUT map: rotated build Frame, terrain patches with skirts, pine forests, window-light spill,
// far-light glows that punch through blizzard fog, icicles, snow drifts.
import * as THREE from 'three';
import { std, patch, G, FOG_GLSL } from '../../core/mats.js';
import { makeRng, clamp, lerp, smoothstep } from '../../core/util.js';

// ------------------------------------------------------------------ Frame: author a structure in its own axes (u = right, v = back, forward = -v)
export class Frame {
  constructor(B, x, z, yaw = 0, y0 = 0) { this.B = B; this.x = x; this.z = z; this.yaw = yaw; this.y0 = y0; this.c = Math.cos(yaw); this.s = Math.sin(yaw); }
  /** frame (u,y,v) -> stop-local [x,y,z] */
  p(u, y, v) { return [this.x + u * this.c + v * this.s, this.y0 + y, this.z - u * this.s + v * this.c]; }
  /** frame yaw + extra */ ang(a = 0) { return this.yaw + a; }
  box(o) { return this.B.box({ ...o, walk: o.walk ?? (o.s[1] <= 0.75), p: this.p(...o.p), yaw: this.yaw + (o.yaw || 0) }); }     // tall solids (walls, counters, posts) are never floor: nav must not path on their tops
  beam(a, b, w, h, o = {}) { return this.B.beam(this.p(...a), this.p(...b), w, h, o); }
  cyl(o) { return this.B.cyl({ ...o, walk: o.walk ?? (o.h <= 0.75), p: this.p(...o.p), yaw: this.yaw + (o.yaw || 0) }); }
  sphere(o) { return this.B.sphere({ ...o, p: this.p(...o.p), yaw: this.yaw + (o.yaw || 0) }); }
  prism(o) { return this.B.prism({ ...o, p: this.p(...o.p), yaw: this.yaw + (o.yaw || 0) }); }
  plane(o) { return this.B.plane({ ...o, p: this.p(...o.p), yaw: this.yaw + (o.yaw || 0) }); }
  rock(o) { return this.B.rock({ ...o, p: this.p(...o.p), yaw: this.yaw + (o.yaw || 0) }); }
  lathe(o) { return this.B.lathe({ ...o, p: this.p(...o.p), yaw: this.yaw + (o.yaw || 0) }); }
  extrude(o) { return this.B.extrude({ ...o, p: this.p(...o.p), yaw: this.yaw + (o.yaw || 0) }); }
  /** matrix for instances / raw geometry placed in the frame */
  m(p, yaw = 0, sc = 1, pitch = 0, roll = 0) { return this.B.matrix(this.p(...p), this.yaw + yaw, sc, pitch, roll); }
}

// ------------------------------------------------------------------ terrain patches
/** Heightfield mesh in chunks. o: {minX,maxX,minZ,maxZ,cell,chunk,H(x,z),mat,skip(x,z)->bool,skirt (m),cast,recv} */
export function terrainPatch(B, o) {
  const cell = o.cell, cn = o.chunk || 32, e = cell * 0.5, H = o.H; const nx = Math.ceil((o.maxX - o.minX) / cell), nz = Math.ceil((o.maxZ - o.minZ) / cell);
  const skirt = o.skirt ?? 0; let tris = 0;
  for (let cz = 0; cz < nz; cz += cn) for (let cx = 0; cx < nx; cx += cn) {
    const w = Math.min(cn, nx - cx), d = Math.min(cn, nz - cz), x0 = o.minX + cx * cell, z0 = o.minZ + cz * cell, ox = x0 + w * cell / 2, oz = z0 + d * cell / 2;
    const P = [], N = [], U = [], I = []; const idx = new Int32Array((w + 1) * (d + 1)).fill(-1);
    const vert = (i, j) => {
      const k = j * (w + 1) + i; if (idx[k] >= 0) return idx[k]; const x = x0 + i * cell, z = z0 + j * cell, y = H(x, z); const hx = H(x - e, z) - H(x + e, z), hz = H(x, z - e) - H(x, z + e), l = Math.hypot(hx, 2 * e, hz);
      P.push(x - ox, y, z - oz); N.push(hx / l, 2 * e / l, hz / l); U.push(x, z); return (idx[k] = P.length / 3 - 1);
    };
    const skirtV = (a, b) => { // vertical curtain under edge a->b (indices of top vertices)
      const ia = P.length / 3; for (const t of [a, b]) { P.push(P[t * 3], P[t * 3 + 1] - skirt, P[t * 3 + 2]); N.push(N[t * 3], N[t * 3 + 1], N[t * 3 + 2]); U.push(U[t * 2], U[t * 2 + 1]); }
      I.push(a, b, ia + 1, a, ia + 1, ia); I.push(a, ia + 1, b, a, ia, ia + 1);
    };
    for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) {
      const xc = x0 + (i + 0.5) * cell, zc = z0 + (j + 0.5) * cell; if (o.skip && o.skip(xc, zc)) continue;
      const a = vert(i, j), b = vert(i + 1, j), c = vert(i, j + 1), dd = vert(i + 1, j + 1); I.push(a, c, b, b, c, dd); tris += 2;
      if (skirt) { const s0 = (i === 0 && cx === 0), s1 = (i === w - 1 && cx + w >= nx), s2 = (j === 0 && cz === 0), s3 = (j === d - 1 && cz + d >= nz);
        if (s0) skirtV(c, a); if (s1) skirtV(b, dd); if (s2) skirtV(a, b); if (s3) skirtV(dd, c); }
    }
    if (!I.length) continue;
    B.addRaw({ p: new Float32Array(P), n: new Float32Array(N), u: new Float32Array(U), i: new Uint32Array(I) }, new THREE.Matrix4().makeTranslation(ox, 0, oz), o.mat, { cast: o.cast !== false, recv: o.recv !== false });
  }
  return tris;
}

// ------------------------------------------------------------------ terrain material fragment: rock on steep faces, altitude tint, wind-scoured patches
export function terrainFrag({ rock = [0.16, 0.17, 0.2], rock2 = [0.3, 0.3, 0.32], tint = [0.94, 0.98, 1.05], rockStart = 0.36, ice = 0.0, strata = 1.0, snowFx = {} } = {}) {
  const v = (a) => `vec3(${a.map((x) => x.toFixed(3)).join(',')})`;
  return `{
    vec3 wN = normalize(vWN); float slope = 1.0 - clamp(wN.y, 0.0, 1.0);
    float nz = zfbm3(vWPos * 0.07); float nz2 = zfbm3(vWPos * 0.6); float nz3 = zvn3(vWPos * 3.1); float nz4 = zfbm3(vWPos * vec3(0.9, 0.16, 0.9));
    float rockAmt = smoothstep(${rockStart.toFixed(2)} + 0.16 * nz, ${(rockStart + 0.2).toFixed(2)} + 0.16 * nz, slope + (nz2 - 0.5) * 0.14);
    // rock: horizontal strata bands + cracks + scree tone changes
    float band = 0.5 + 0.5 * sin(vWPos.y * 1.45 + nz * 9.0 + nz4 * 3.0); float band2 = 0.5 + 0.5 * sin(vWPos.y * 5.3 + nz2 * 5.0);
    vec3 rc = mix(${v(rock)}, ${v(rock2)}, smoothstep(0.3, 0.8, nz2 * 0.6 + band * 0.5 * ${strata.toFixed(2)}));
    rc *= (0.55 + 0.75 * nz3) * (0.78 + 0.32 * band2 * ${strata.toFixed(2)}) * (0.85 + 0.3 * nz4);
    float crack = smoothstep(0.62, 0.7, zvn3(vWPos * vec3(2.4, 0.6, 2.4)) * 0.6 + nz2 * 0.4); rc *= 1.0 - 0.45 * crack;
    // snow clings in ledges/gullies on the rock (where the surface is only mildly steep)
    float ledge = smoothstep(0.55, 0.3, slope + (nz3 - 0.5) * 0.25) * smoothstep(0.35, 0.6, nz4); rockAmt *= 1.0 - 0.55 * ledge;
    ${snowFragGLSL({ ...snowFx, mask: '(1.0 - rockAmt)' })}
    { vec2 wq2 = normalize(vec2(-uWind.z, uWind.x) + 1e-4); vec2 wd2 = normalize(uWind.xz + 1e-4); float sA = dot(vWPos.xz, wd2), sB = dot(vWPos.xz, wq2); float st = zvn3(vec3(sB * 0.021, sA * 0.0055, 5.5)) * 0.6 + zvn3(vec3(sB * 0.06, sA * 0.016, 1.7)) * 0.4; float far = smoothstep(30.0, 140.0, length(vWPos - cameraPosition)); diffuseColor.rgb *= 1.0 + (st - 0.5) * 0.3 * far * (1.0 - rockAmt); }   // far-field wind streaks (scoured crust vs fresh powder)
    diffuseColor.rgb = mix(diffuseColor.rgb, rc, rockAmt);
    roughnessFactor = mix(roughnessFactor, 0.94, rockAmt);
    diffuseColor.rgb *= mix(vec3(1.0), ${v(tint)}, smoothstep(60.0, 320.0, vWPos.y));
    ${ice > 0 ? `float iceP = smoothstep(0.62, 0.8, zfbm3(vWPos * 0.18 + 4.0)) * (1.0 - rockAmt) * ${ice.toFixed(2)}; diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.78, 0.9), iceP * 0.6); roughnessFactor = mix(roughnessFactor, 0.12, iceP);` : ''}
  }`;
}


/** GLSL for realistic snow surfaces: wind-carved micro relief (sastrugi, stretched along the atmosphere wind), pit AO, sub-surface blue in the shade, random glints. */
export function snowFragGLSL({ bump = 0.6, sss = [0.02, 0.04, 0.09], glint = 0.9, scale = 1.0, aniso = 1.0, mask = '1.0', macro = 1.0 } = {}) {
  const v3 = (a) => `vec3(${a.map((x) => x.toFixed(3)).join(',')})`; const f = (x, n = 3) => x.toFixed(n);
  if (typeof location !== 'undefined' && /nosnowfx/.test(location.search)) return '';        // profiling switch: ?nosnowfx=1 removes the per-pixel snow relief
  // Three scales of wind-carved relief (all from the shared 3D noise, gradient by finite differences):
  //   macro  (12-40 m dunes, visible to 260 m): broad soft undulation that gives a snowfield structure at distance -- normal tilt + a little albedo modulation
  //   ripple (0.5-2.5 m, to 75 m): sastrugi with a modest 2.5:1 aspect (not hair-thin streaks), domain-warped so ridges bend and merge, in patches
  //   glints: rare sparkling crystals
  return `
    float dW = length(vWPos - cameraPosition); float detail = 1.0 - smoothstep(20.0, 75.0, dW);
    float upS = smoothstep(0.55, 0.9, normalize(vWN).y) * (${mask});
    vec2 wd0 = uWind.xz; float wl0 = length(wd0); vec2 wd = wl0 > 0.05 ? wd0 / wl0 : vec2(0.35, 0.94); vec2 wq = vec2(-wd.y, wd.x);
    #define W3(p) (0.6 * texture(uNoise3, (p) * 0.125).r + 0.4 * texture(uNoise3, (p) * 0.2537 + vec3(0.37, 0.11, 0.53)).g)
    if (upS > 0.003) {
      float wpA = zvn3(vWPos * 0.09) - 0.5, wpB = zvn3(vWPos * 0.09 + vec3(5.3, 1.7, 2.9)) - 0.5;
      float sa = dot(vWPos.xz, wd) + wpA * 6.0, sb = dot(vWPos.xz, wq) + wpB * 4.0;
      // macro dunes
      vec3 m0 = vec3(sb * 0.052, sa * 0.021, 2.3), mb = m0 + vec3(0.02, 0.0, 0.0), mc = m0 + vec3(0.0, 0.02, 0.0);
      float k0 = W3(m0), k1 = W3(mb), k2 = W3(mc); vec2 mg = vec2(k1 - k0, k2 - k0) / 0.02; vec2 mw = wq * mg.x + wd * mg.y;
      float mFade = 1.0 - smoothstep(120.0, 300.0, dW);
      normal = normalize(normal + (viewMatrix * vec4(vec3(-mw.x, 0.0, -mw.y) * ${f(macro * 0.0125, 4)} * upS * mFade, 0.0)).xyz);
      diffuseColor.rgb *= 1.0 + ${f(macro * 0.16, 3)} * (k0 - 0.5) * mFade * upS;
      if (detail > 0.003) {
        float crustP = smoothstep(0.28, 0.66, zvn3(vec3(sb * 0.085, sa * 0.05, 9.0)));                                    // fields of ridged snow between smooth wind-crust
        vec3 q0 = vec3(sb * ${f(1.3 * scale, 2)}, sa * ${f(0.52 / aniso)}, 0.5), q1 = vec3(sb * ${f(4.6 * scale, 2)}, sa * ${f(1.7 / aniso)}, 3.1);
        float sh0 = 0.65 * W3(q0) + 0.35 * W3(q1);
        vec3 b0 = q0 + vec3(${f(0.04 * 1.3 * scale, 4)}, 0.0, 0.0), b1 = q1 + vec3(${f(0.04 * 4.6 * scale, 4)}, 0.0, 0.0), c0 = q0 + vec3(0.0, ${f(0.04 * 0.52 / aniso, 4)}, 0.0), c1 = q1 + vec3(0.0, ${f(0.04 * 1.7 / aniso, 4)}, 0.0);
        float sh1 = 0.65 * W3(b0) + 0.35 * W3(b1), sh2 = 0.65 * W3(c0) + 0.35 * W3(c1);
        vec2 sg = vec2(sh1 - sh0, sh2 - sh0) / 0.04; vec2 gw = wq * sg.x + wd * sg.y; float uD = upS * detail * (0.3 + 0.7 * crustP);
        normal = normalize(normal + (viewMatrix * vec4(vec3(-gw.x, 0.0, -gw.y) * ${f(bump, 2)} * 0.05 * uD, 0.0)).xyz);
        diffuseColor.rgb *= 0.92 + 0.16 * sh0 * uD + 0.08 * (1.0 - uD);
        float gl = step(0.9962, zvn3(vWPos * 47.0 + vec3(1.7, 0.3, 2.1))) * uD * ${f(glint, 2)};
        if (gl > 0.0) { normal = normalize(normal + (viewMatrix * vec4((vec3(zvn3(vWPos * 91.0), zvn3(vWPos * 83.0 + 3.0), zvn3(vWPos * 77.0 + 7.0)) - 0.5) * 1.6 * gl, 0.0)).xyz); roughnessFactor = mix(roughnessFactor, 0.07, gl); }
      }
    }
    #undef W3
    totalEmissiveRadiance += diffuseColor.rgb * ${v3(sss)} * (0.4 + 0.6 * upS);
  `;
}

// ------------------------------------------------------------------ pine trees (vertex-coloured, snow-laden)
const _pineCache = new Map();
/** Pine/spruce: trunk + whorls of folded branch fans (each fan = 4 triangles: two snow-dusted upper faces, two dark under faces), so the silhouette is
 *  jagged and layered instead of a smooth cone. Vertex colours carry the snow / needle / shadow tones. ~ (whorls*fans*4 + 12) triangles. */
export function pineGeometry({ h = 11, tiers = 8, snow = 0.7, fans = 7, seed = 1, seg = 0 } = {}) {
  const key = `v2|${h}|${tiers}|${snow}|${fans}|${seed}`; if (_pineCache.has(key)) return _pineCache.get(key);
  const rng = makeRng(seed), P = [], N = [], C = [], U = [], I = [];
  const dark = new THREE.Color(0x0b1810), mid = new THREE.Color(0x172a1d), lit = new THREE.Color(0x27432f), tip = new THREE.Color(0x35583c), sn = new THREE.Color(0xe6eef8), sn2 = new THREE.Color(0xc4d2e6);
  const tri = (a, b, c, col) => { // flat-shaded triangle with per-vertex colours [c0,c1,c2]
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]; let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const base = P.length / 3; [a, b, c].forEach((p, i) => { P.push(p[0], p[1], p[2]); N.push(nx, ny, nz); C.push(col[i].r, col[i].g, col[i].b); U.push(p[0], p[2]); }); I.push(base, base + 1, base + 2); };
  // trunk (tapered, 6 sides)
  const trunkH = h * 0.16, tr = 0.11 + 0.012 * h; const bark = new THREE.Color(0x2c2119), bark2 = new THREE.Color(0x1a130e);
  for (let k = 0; k < 6; k++) { const a0 = k / 6 * 6.2832, a1 = (k + 1) / 6 * 6.2832; const p0 = [Math.cos(a0) * tr, 0, Math.sin(a0) * tr], p1 = [Math.cos(a1) * tr, 0, Math.sin(a1) * tr], q0 = [Math.cos(a0) * tr * 0.35, h * 0.95, Math.sin(a0) * tr * 0.35], q1 = [Math.cos(a1) * tr * 0.35, h * 0.95, Math.sin(a1) * tr * 0.35]; tri(p0, p1, q1, [bark2, bark2, bark]); tri(p0, q1, q0, [bark2, bark, bark]); }
  const top = h;
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1); const yb = trunkH + (h - trunkH) * (f * 0.93); const rad = h * 0.34 * Math.pow(1 - f, 0.85) * (0.88 + rng() * 0.24) + 0.15; const droop = rad * (0.34 - 0.1 * f); const n = Math.max(5, Math.round(fans * (1 - f * 0.45))); const rot = rng() * 6.28;
    for (let k = 0; k < n; k++) {
      const a = rot + (k + (rng() - 0.5) * 0.4) / n * 6.2832, r = rad * (0.78 + rng() * 0.4), w = (rad * 6.2832 / n) * (0.62 + rng() * 0.25); const ca = Math.cos(a), sa = Math.sin(a);
      const base = [ca * 0.12, yb + 0.05, sa * 0.12]; const tp = [ca * r, yb - droop * (0.8 + rng() * 0.4), sa * r];
      const mp = [ca * r * 0.5, yb + droop * 0.16, sa * r * 0.5]; const lft = [mp[0] - sa * w * 0.5, mp[1] - droop * 0.28, mp[2] + ca * w * 0.5], rgt = [mp[0] + sa * w * 0.5, mp[1] - droop * 0.28, mp[2] - ca * w * 0.5];
      const snowK = snow * (0.55 + 0.45 * rng()) * (1 - 0.35 * f); const up = sn.clone().lerp(sn2, rng() * 0.5).lerp(lit, 1 - snowK), up2 = up.clone().lerp(mid, 0.25), under = dark.clone().lerp(mid, 0.25 + rng() * 0.25);
      const tipC = tip.clone().lerp(sn, snowK * 0.35);
      tri(base, lft, tp, [up2, up, tipC]); tri(base, tp, rgt, [up2, tipC, up]);       // upper faces (snow)
      tri(base, tp, lft, [under, under, under]); tri(base, rgt, tp, [under, under, under]); // under faces
    }
  }
  // leader (top spike)
  { const y0 = top * 0.9, tp = [0, top + 0.5, 0]; for (let k = 0; k < 4; k++) { const a = k / 4 * 6.2832 + rng(), b = a + 1.4; tri([Math.cos(a) * 0.22, y0, Math.sin(a) * 0.22], [Math.cos(b) * 0.22, y0, Math.sin(b) * 0.22], tp, [mid, mid, sn]); } }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setIndex(I);
  g.computeBoundingSphere(); _pineCache.set(key, g); return g;
}
export function pineMaterial(extra = {}) { return std({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide, ...extra }); }

// ------------------------------------------------------------------ additive far lights (windows, piste lights): fog attenuation is reduced so they punch through a blizzard
const FL_VS = `attribute vec3 aPos; attribute vec4 aCol; attribute vec3 aPar; uniform float uTime; varying vec2 vUv; varying vec4 vCol; varying vec3 vWPos;
void main(){ vec4 vp = viewMatrix * vec4(aPos, 1.0); float fl = 1.0; if (aPar.y > 0.0) fl = 0.75 + 0.25 * sin(uTime * aPar.y + aPar.z) * sin(uTime * aPar.y * 2.3 + aPar.z * 3.1);
  float dist = length(vp.xyz); float sz = aPar.x * (1.0 + dist * 0.006); vp.xy += position.xy * sz; gl_Position = projectionMatrix * vp; vUv = position.xy; vCol = vec4(aCol.rgb * fl, aCol.a); vWPos = aPos; }`;
const FL_FS = `precision highp float; varying vec2 vUv; varying vec4 vCol; varying vec3 vWPos; uniform float uFogK; ${FOG_GLSL}
void main(){ float r = length(vUv); if (r > 1.0) discard; float core = exp(-r * r * 22.0), glow = pow(1.0 - r, 2.6) * 0.45; float a = (core * 2.2 + glow) * vCol.a;
  gl_FragColor = vec4(vCol.rgb * a * (1.0 - fogFactor(vWPos) * uFogK), 0.0); }`;
export class FarLights {
  constructor(max = 512, fogK = 0.7) {
    this.max = max; this.n = 0; const g = new THREE.InstancedBufferGeometry(); g.instanceCount = 0;
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3)); g.setIndex([0, 1, 2, 0, 2, 3]);
    this.pos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3); this.col = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); this.par = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    g.setAttribute('aPos', this.pos); g.setAttribute('aCol', this.col); g.setAttribute('aPar', this.par); this.geo = g;
    this.mat = new THREE.ShaderMaterial({ vertexShader: FL_VS, fragmentShader: FL_FS, transparent: true, depthWrite: false, depthTest: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      uniforms: { uTime: G.uTime, uFogK: { value: fogK }, uFogColor: G.uFogColor, uFogScatter: G.uFogScatter, uFogParams: G.uFogParams, uSunDir: G.uSunDir } });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 19;
  }
  add(p, color = 0xffc880, size = 1, intensity = 1, flicker = 0) {
    if (this.n >= this.max) return -1; const i = this.n++; const c = new THREE.Color(color);
    this.pos.setXYZ(i, p[0], p[1], p[2]); this.col.setXYZW(i, c.r, c.g, c.b, intensity); this.par.setXYZ(i, size, flicker, Math.random() * 100);
    this.geo.instanceCount = this.n; this.pos.needsUpdate = this.col.needsUpdate = this.par.needsUpdate = true; return i;
  }
}

// ------------------------------------------------------------------ light spill: soft warm rectangles on the snow below lit windows (additive)
let _spillTex = null;
export function spillTexture() {
  if (_spillTex) return _spillTex; const S = 128, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.14)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; _spillTex = t; return t;
}
export function spillMaterial() {
  const m = new THREE.MeshBasicMaterial({ map: spillTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uFogColor: G.uFogColor, uFogScatter: G.uFogScatter, uFogParams: G.uFogParams, uSunDir: G.uSunDir });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;').replace('#include <fog_vertex>', '#include <fog_vertex>\n vWPos = cameraPosition + transpose(mat3(viewMatrix)) * mvPosition.xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\n' + FOG_GLSL).replace('#include <fog_fragment>', 'gl_FragColor.rgb *= 1.0 - fogFactor(vWPos);');
  };
  m.customProgramCacheKey = () => 'spill'; return m;
}
/** add a warm spill quad on the ground at frame/world-local (x,z): w x d metres, tinted colour with intensity (colour is multiplied) */
export function spill(B, mat, x, y, z, w, d, yaw, color, k = 1) {
  const raw = { p: new Float32Array([-w / 2, 0, -d / 2, w / 2, 0, -d / 2, w / 2, 0, d / 2, -w / 2, 0, d / 2]), n: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), u: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), i: new Uint32Array([0, 2, 1, 0, 3, 2]) };
  B.addRaw(raw, B.matrix([x, y, z], yaw), mat, { cast: false, recv: false });
}

// ------------------------------------------------------------------ icicles: instanced cones hanging from eaves
let _icicleGeo = null;
export function icicleGeometry() {
  if (_icicleGeo) return _icicleGeo; const g = new THREE.ConeGeometry(0.014, 1, 5, 1, true); g.rotateX(Math.PI); g.translate(0, -0.5, 0); g.computeBoundingSphere(); _icicleGeo = g; return g;
}
export function addIcicles(B, mat, a, b, { every = 0.22, minLen = 0.12, maxLen = 0.75, seed = 1, y = 0 } = {}) {
  const rng = makeRng(seed), g = icicleGeometry(); const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz); const n = Math.floor(L / every);
  for (let i = 0; i < n; i++) { const t = (i + rng() * 0.8) / n; const len = lerp(minLen, maxLen, Math.pow(rng(), 2.2)); B.instance('icicle', g, mat, B.matrix([a[0] + dx * t, y, a[1] + dz * t], 0, [1 + rng() * 0.8, len, 1 + rng() * 0.8]), 0xffffff, { cast: false }); }
}

// ------------------------------------------------------------------ shared terrain material (identical bake for the route and every stop => seamless world)
export function terrainMaterial(B, o = {}) {
  const def = { pattern: 'snow', size: 1024, tile: 6, colors: [0xdfe8f5, 0xf2f7ff, 0xa9bdd6], params: { scale: 5, ripples: 0.15, sparkle: 0.7, direction: 0, crust: 0.25 }, bump: 24, rough: [0.5, 0.8] };
  return B.m(o.name || 'terrain', def, { triplanar: 1 / 6, breakup: 0.5, frag: terrainFrag(o.frag || {}) });
}

/** tiny build profiler: const T = timer('village'); T('terrain') logs the ms since the previous mark */
export function timer(tag) { let t = performance.now(); return (what) => { const n = performance.now(); console.log(`[whiteout] ${tag} ${what} ${(n - t).toFixed(0)} ms`); t = n; }; }

/** Fast exact sampler of the terrain mesh (same triangulation as terrainPatch): use it as the colliders' heightFn (SkyVis, nav, player and bullets query it a lot). */
export function heightGrid(H, minX, maxX, minZ, maxZ, cell) {
  const nx = Math.ceil((maxX - minX) / cell), nz = Math.ceil((maxZ - minZ) / cell), W = nx + 1; const g = new Float32Array(W * (nz + 1));
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) g[j * W + i] = H(minX + i * cell, minZ + j * cell);
  const f = (x, z) => {
    const u = (x - minX) / cell, v = (z - minZ) / cell, i = Math.floor(u), j = Math.floor(v); if (i < 0 || j < 0 || i >= nx || j >= nz) return H(x, z);
    const fx = u - i, fz = v - j, a = g[j * W + i], b = g[j * W + i + 1], c = g[(j + 1) * W + i], d = g[(j + 1) * W + i + 1];
    return fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
  };
  return f;
}

/** A flat quad with 0..1 UVs facing +Z rotated by yaw (signs, billboards). p = centre. */
export function quad(B, mat, p, w, h, yaw = 0, flip = false) {
  const hx = w / 2, hy = h / 2; const raw = { p: new Float32Array([-hx, -hy, 0, hx, -hy, 0, hx, hy, 0, -hx, hy, 0]), n: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), u: new Float32Array(flip ? [1, 0, 0, 0, 0, 1, 1, 1] : [0, 0, 1, 0, 1, 1, 0, 1]), i: new Uint32Array([0, 1, 2, 0, 2, 3]) };
  B.addRaw(raw, B.matrix(p, yaw), mat, { cast: false, recv: false });
}

// ------------------------------------------------------------------ wind-swept snow drifts as real terrain-conforming meshes (no floating "sausages")
import { noise2 } from '../../core/util.js';
/** Drift along the axis (ax,az) (unit), centred (x,z): len x wid footprint, crest height h; steep lee (t>0), long windward ramp (t<0), tapered tail. H = ground fn. */
export function driftMesh(B, mat, H, { x, z, len, wid, h, ax = 0.35, az = 0.94, seed = 1, head = 0.35, shape = 1 }) {
  const nS = Math.max(10, Math.round(len / 0.9)), nT = 10, tx = -az, tz = ax; const P = [], N = [], U = [], I = []; const y = (s, t) => {
    const u = s / (len / 2); if (Math.abs(u) >= 1) return 0; const c = t / (wid / 2); if (Math.abs(c) >= 1) return 0;
    const p = Math.pow(Math.max(0, 1 - u * u), 1.25) * (0.75 + 0.35 * noise2(s * 0.22 + seed * 3.1, seed));
    const q = c < 0 ? Math.pow(1 - Math.pow(-c, 1.3), 1.4) : Math.pow(1 - Math.pow(c, 2.4), 1.2);
    return h * p * q * shape;
  };
  const pos = (s, t) => [x + ax * s + tx * t, z + az * s + tz * t];
  for (let j = 0; j <= nS; j++) for (let i = 0; i <= nT; i++) {
    const s = (j / nS - 0.5) * len, t = (i / nT - 0.5) * wid; const [px, pz] = pos(s, t); const g = H(px, pz); P.push(px, g + y(s, t) - 0.08, pz); U.push(px, pz);
    const e = 0.5, [ax1, az1] = pos(s + e, t), [ax0, az0] = pos(s - e, t), [bx1, bz1] = pos(s, t + e), [bx0, bz0] = pos(s, t - e);
    const hs = (H(ax1, az1) + y(s + e, t)) - (H(ax0, az0) + y(s - e, t)), ht = (H(bx1, bz1) + y(s, t + e)) - (H(bx0, bz0) + y(s, t - e));
    const dS = [ax * 2 * e, hs, az * 2 * e], dT = [tx * 2 * e, ht, tz * 2 * e]; let nx = dS[1] * dT[2] - dS[2] * dT[1], ny = dS[2] * dT[0] - dS[0] * dT[2], nz = dS[0] * dT[1] - dS[1] * dT[0]; if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; } const l = Math.hypot(nx, ny, nz) || 1; N.push(nx / l, ny / l, nz / l);
  }
  for (let j = 0; j < nS; j++) for (let i = 0; i < nT; i++) { const a = j * (nT + 1) + i, b = a + 1, c = a + nT + 1, d = c + 1; I.push(a, c, b, b, c, d, a, b, c, b, d, c); }
  B.addRaw({ p: new Float32Array(P), n: new Float32Array(N), u: new Float32Array(U), i: new Uint32Array(I) }, new THREE.Matrix4(), mat, { cast: true, recv: true });
}
/** Sunken heightfield: H lowered by `depth` under a rectangle (in a rotated frame) so a slab can sit flush with no z-fighting and no holes. */
export function sunkH(H, F, u0, u1, v0, v1, depth = 0.7, feather = 1.6) {
  return (x, z) => { const u = x * F.c - z * F.s, v = x * F.s + z * F.c; const du = Math.max(u0 - u, 0, u - u1), dv = Math.max(v0 - v, 0, v - v1); const d = Math.hypot(du, dv); const m = 1 - smoothstep(0, feather, d); return H(x, z) - depth * m; };
}

/** Per-frame additive modulation of the CURRENT atmosphere (fog density/colour, key light, IBL, sky lightning) that is safe against gfx.setAtmo / blendAtmo
 *  rewriting the values: it only reverts its own previous delta while the value is still exactly what it wrote. */
export class AtmoMod {
  constructor(gfx) { this.gfx = gfx; this.w = { fog: null, r: null, g: null, b: null, sun: null, env: null, sky: null }; this.d = { fog: 0, r: 0, g: 0, b: 0, sun: 0, env: 0, sky: 0 }; }
  apply({ fog = 0, fr = 0, fg = 0, fb = 0, sun = 0, env = 0, sky = 0 }) {
    const g = this.gfx, P = G.uFogParams.value, C = G.uFogColor.value, S = g.sun, U = g.sky.uniforms.uLightning, w = this.w, d = this.d;
    if (w.fog !== null && P.x === w.fog) P.x -= d.fog; if (w.r !== null && C.r === w.r) C.r -= d.r; if (w.g !== null && C.g === w.g) C.g -= d.g; if (w.b !== null && C.b === w.b) C.b -= d.b;
    if (w.sun !== null && S.intensity === w.sun) S.intensity -= d.sun; if (w.env !== null && g.scene.environmentIntensity === w.env) g.scene.environmentIntensity -= d.env; if (w.sky !== null && U.value === w.sky) U.value -= d.sky;
    P.x += fog; C.r += fr; C.g += fg; C.b += fb; S.intensity += sun; g.scene.environmentIntensity += env; U.value += sky;
    w.fog = P.x; w.r = C.r; w.g = C.g; w.b = C.b; w.sun = S.intensity; w.env = g.scene.environmentIntensity; w.sky = U.value; d.fog = fog; d.r = fr; d.g = fg; d.b = fb; d.sun = sun; d.env = env; d.sky = sky;
  }
}

/** standalone snow surface fragment (drifts, roof slabs): patch option `frag` */
export const snowFrag = (o = {}) => `{ ${snowFragGLSL(o)} }`;

/** Fewest draw calls / program switches for a small stop: every batch is ONE cell (cell = Infinity -> floor(x/inf) = 0 on both sides of the origin) and every
 *  static mesh receives shadows (receiveShadow is part of the shader program key: one variant per material instead of two). */
export function coarse(B) {
  const box0 = B.box.bind(B); B.box = (o) => { if (!o.s || o.bevel === 0) return box0(o); const m = Math.min(o.s[0], o.s[1], o.s[2]); return m < 0.075 ? box0({ ...o, bevel: 0 }) : m < 0.12 ? box0({ ...o, bevel: Math.min(o.bevel ?? 0.006, m * 0.12) }) : box0(o); };      // a bevel on a slat / trim / strap is invisible: 24 vertices instead of 96 (keeps SkyVis + batch cost down)
  B.batch.cell = Infinity; B.batch.cellY = Infinity; B.inst.cell = Infinity;
  const a0 = B.batch.add.bind(B.batch); B.batch.add = (raw, m, mat, o = {}) => a0(raw, m, mat, { ...o, recv: true });
  const i0 = B.inst.add.bind(B.inst); B.inst.add = (key, geo, mat, m, color, o = {}) => i0(key, geo, mat, m, color, { ...o, recv: true });
}

/** Fewer distinct shader programs per view: every synth/std material of the stop gets the same patch feature set (snow + breakup at a negligible amount), so all
 *  plain surfaces share ONE program (per instancing / vertex-visibility / map variant) instead of one per option combination. Called at the end of a stop build. */
export function unifyPrograms(B) { /* no-op: core patch() is a uniform-driven uber program now (snow/breakup/wet/triplanar/detail strengths are runtime uniforms), so materials that differ only in those already share one program */ }
