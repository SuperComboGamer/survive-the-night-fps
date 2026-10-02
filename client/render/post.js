// Screen-space passes that need the world depth buffer: ambient occlusion and sun shafts.
// Both are computed at reduced resolution between the world render and the viewmodel render, then
// applied IN PLACE into the multisampled scene target with one blended full-screen quad
// (out = rays + dst * ao), so the viewmodel drawn afterwards is never darkened or hazed.
//
//  AO:   half-res, 8/12-tap spiral on view positions rebuilt from depth, normals from depth; each sample
//        occludes by the ANGLE it rises above the surface (minus a ~17 deg bias), not by 1/distance, so
//        shallow creases between the 2 m terrain triangles never darken (they showed as stripes along
//        the ground) while real corners (walls, trunks, props on the ground) do. Fades out by 70 m;
//        separable depth-aware blur; depth-aware upsample in the apply pass.
//  Rays: quarter-res; mask = visible sky around the sun (depth == far, weighted by sky luminance so
//        clouds and canopy gaps shape it), 3 chained radial-blur passes towards the sun (8 taps each,
//        512 effective taps), applied with a Henyey-Greenstein phase and distance-based in-scattering.
//  Beam: half-res ray march (12 jittered steps, stops at the scene depth) of the local flashlight
//        cone scattering in the haze, so the torch beam shows in the night mist.
import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const DEPTH_FUNCS = /* glsl */ `
uniform sampler2D tDepth;
uniform float uNear;
uniform float uFar;
uniform vec2 uTanFov; // tan(fovY/2) * aspect, tan(fovY/2)
float viewZAt(vec2 uv) {
  float d = texture2D(tDepth, uv).r;
  // perspectiveDepthToViewZ (negative in front of the camera)
  return (uNear * uFar) / ((uFar - uNear) * d - uFar);
}
vec3 viewPosAt(vec2 uv, float vz) {
  return vec3((uv * 2.0 - 1.0) * uTanFov * -vz, vz);
}
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;

const AO_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
${DEPTH_FUNCS}
uniform vec2 uTexel;      // full-res depth texel
uniform float uRadius;    // world radius (m)
uniform float uProjScale; // pixels per metre at 1 m (half-res target)
uniform int uSamples;
void main() {
  float vz = viewZAt(vUv);
  float dist = -vz;
  if (dist > 75.0) { gl_FragColor = vec4(1.0, dist / uFar, 0.0, 1.0); return; }
  vec3 P = viewPosAt(vUv, vz);
  // normal from the smaller of the forward/backward differences (robust at silhouettes)
  vec2 dx = vec2(uTexel.x * 2.0, 0.0), dy = vec2(0.0, uTexel.y * 2.0);
  vec3 pr = viewPosAt(vUv + dx, viewZAt(vUv + dx)) - P;
  vec3 pl = P - viewPosAt(vUv - dx, viewZAt(vUv - dx));
  vec3 pu = viewPosAt(vUv + dy, viewZAt(vUv + dy)) - P;
  vec3 pd = P - viewPosAt(vUv - dy, viewZAt(vUv - dy));
  vec3 ddx = abs(pr.z) < abs(pl.z) ? pr : pl;
  vec3 ddy = abs(pu.z) < abs(pd.z) ? pu : pd;
  vec3 N = normalize(cross(ddx, ddy));
  float rPx = uRadius * uProjScale / dist;
  if (rPx < 1.0) { gl_FragColor = vec4(1.0, dist / uFar, 0.0, 1.0); return; }
  rPx = min(rPx, 90.0);
  float phi = ign(gl_FragCoord.xy) * 6.2831853;
  float sum = 0.0;
  float n = float(uSamples);
  for (int i = 0; i < 12; i++) {
    if (i >= uSamples) break;
    float t = (float(i) + 0.5) / n;
    float a = phi + float(i) * 2.39996323;
    vec2 off = vec2(cos(a), sin(a)) * (t * rPx) * uTexel * 2.0;
    vec2 suv = vUv + off;
    vec3 S = viewPosAt(suv, viewZAt(suv));
    vec3 v = S - P;
    float vv = dot(v, v);
    // sine of the elevation of the sample above the tangent plane, with an angle bias; distant samples
    // (behind silhouettes) fade out
    float sinE = dot(v, N) * inversesqrt(vv + 1e-6);
    float range = 1.0 - smoothstep(uRadius * uRadius, uRadius * uRadius * 4.0, vv);
    sum += clamp((sinE - 0.3) / 0.7, 0.0, 1.0) * range;
  }
  float ao = max(0.0, 1.0 - 1.9 * sum / n);
  ao = mix(ao, 1.0, smoothstep(45.0, 75.0, dist));
  gl_FragColor = vec4(ao, dist / uFar, 0.0, 1.0);
}
`;

const AO_BLUR = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uDir;
void main() {
  vec2 c = texture2D(tSrc, vUv).rg;
  float sum = c.r;
  float wsum = 1.0;
  for (int i = -3; i <= 3; i++) {
    if (i == 0) continue;
    vec2 s = texture2D(tSrc, vUv + uDir * float(i)).rg;
    float w = exp(-abs(s.g - c.g) * 800.0 / max(c.g, 1e-4) * 0.02) * (1.0 - abs(float(i)) * 0.2);
    sum += s.r * w;
    wsum += w;
  }
  gl_FragColor = vec4(sum / wsum, c.g, 0.0, 1.0);
}
`;

const RAY_MASK = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDepth;
uniform sampler2D tScene;
uniform vec2 uTexel;
uniform vec2 uSunUv;
uniform float uAspect;
uniform float uExposure;
void main() {
  // 4 depth taps: only open sky (far plane) lets light through
  float sky = 0.0;
  sky += step(0.99999, texture2D(tDepth, vUv + uTexel * vec2(-1.0, -1.0)).r);
  sky += step(0.99999, texture2D(tDepth, vUv + uTexel * vec2(1.0, -1.0)).r);
  sky += step(0.99999, texture2D(tDepth, vUv + uTexel * vec2(-1.0, 1.0)).r);
  sky += step(0.99999, texture2D(tDepth, vUv + uTexel * vec2(1.0, 1.0)).r);
  sky *= 0.25;
  vec2 d = (vUv - uSunUv) * vec2(uAspect, 1.0);
  float r = length(d);
  float glow = exp(-r * r * 18.0) + 0.25 * exp(-r * 4.5);
  vec3 c = texture2D(tScene, vUv).rgb * uExposure;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(sky * glow * smoothstep(0.05, 1.1, l), 0.0, 0.0, 1.0);
}
`;

const RAY_BLUR = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uSunUv;
uniform float uStep;
void main() {
  vec2 delta = (uSunUv - vUv) * uStep / 8.0;
  vec2 uv = vUv;
  float sum = 0.0;
  float w = 1.0;
  float wsum = 0.0;
  for (int i = 0; i < 8; i++) {
    sum += texture2D(tSrc, uv).r * w;
    wsum += w;
    w *= 0.955;
    uv += delta;
  }
  gl_FragColor = vec4(sum / wsum, 0.0, 0.0, 1.0);
}
`;

const BEAM_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
${DEPTH_FUNCS}
uniform vec3 uLPos;   // view space
uniform vec3 uLDir;   // view space, unit
uniform vec2 uCone;   // cos outer, cos inner
uniform float uRange;
void main() {
  float vz = viewZAt(vUv);
  vec3 P = viewPosAt(vUv, vz);
  float L = min(length(P), uRange);
  vec3 V = normalize(P);
  float j = ign(gl_FragCoord.xy);
  float sum = 0.0;
  for (int i = 0; i < 12; i++) {
    // quadratic step spacing: most samples close to the camera where the cone is narrow
    float t = (float(i) + j) / 12.0;
    float d = t * t * L;
    vec3 toP = V * d - uLPos;
    float r2 = dot(toP, toP);
    float c = dot(toP, uLDir) * inversesqrt(r2);
    float cone = smoothstep(uCone.x, uCone.y, c);
    sum += cone / (1.0 + r2 * 0.09) * (2.0 * t * L / 12.0);
  }
  gl_FragColor = vec4(sum, 0.0, 0.0, 1.0);
}
`;

const APPLY = /* glsl */ `
precision highp float;
varying vec2 vUv;
${DEPTH_FUNCS}
uniform sampler2D tAO;
uniform sampler2D tRays;
uniform vec2 uAOTexel;
uniform float uAOOn;
uniform float uAOStrength;
uniform float uRayOn;
uniform vec3 uRayColor;
uniform float uRaySigma;
uniform vec3 uSunView; // view-space direction to the sun
uniform sampler2D tBeam;
uniform vec2 uBeamTexel;
uniform vec3 uBeamColor;
uniform float uDebug;
void main() {
  float vz = viewZAt(vUv);
  float dist = -vz;
  float ao = 1.0;
  if (uAOOn > 0.5) {
    // depth-aware upsample of the half-res AO (weights by linear depth similarity)
    vec2 base = vUv / uAOTexel - 0.5;
    vec2 f = fract(base);
    vec2 uv0 = (floor(base) + 0.5) * uAOTexel;
    float dn = dist / uFar;
    vec2 s00 = texture2D(tAO, uv0).rg;
    vec2 s10 = texture2D(tAO, uv0 + vec2(uAOTexel.x, 0.0)).rg;
    vec2 s01 = texture2D(tAO, uv0 + vec2(0.0, uAOTexel.y)).rg;
    vec2 s11 = texture2D(tAO, uv0 + uAOTexel).rg;
    vec4 w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
    vec4 dz = abs(vec4(s00.g, s10.g, s01.g, s11.g) - dn) / max(dn, 1e-4);
    w *= 1.0 / (1e-3 + dz * 40.0);
    ao = dot(vec4(s00.r, s10.r, s01.r, s11.r), w) / max(dot(w, vec4(1.0)), 1e-5);
    ao = mix(1.0, ao, uAOStrength);
  }
  vec3 rays = vec3(0.0);
  if (uRayOn > 0.5) {
    vec3 V = normalize(viewPosAt(vUv, vz));
    float c = dot(V, uSunView);
    float g = 0.62;
    float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * c, 1.5);
    float hgMax = (1.0 - g * g) / pow(1.0 - g, 3.0);
    float phase = 0.08 + hg / hgMax * 4.0;
    float scatter = 1.0 - exp(-min(dist, 3000.0) * uRaySigma);
    rays = uRayColor * texture2D(tRays, vUv).r * phase * scatter;
  }
  if (dot(uBeamColor, uBeamColor) > 0.0) {
    float b = texture2D(tBeam, vUv + uBeamTexel * vec2(-0.75, -0.25)).r + texture2D(tBeam, vUv + uBeamTexel * vec2(0.75, 0.25)).r
      + texture2D(tBeam, vUv + uBeamTexel * vec2(0.25, -0.75)).r + texture2D(tBeam, vUv + uBeamTexel * vec2(-0.25, 0.75)).r;
    rays += uBeamColor * b * 0.25;
  }
  if (uDebug > 0.5) { gl_FragColor = vec4(uDebug > 1.5 ? vec3(ao) : rays + texture2D(tRays, vUv).r * 0.2, 0.0); return; }
  gl_FragColor = vec4(rays, ao);
}
`;

function pass(frag, uniforms) {
  return new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
}

export class ScreenPasses {
  constructor(renderer, quad, postScene, postCamera) {
    this.r = renderer;
    this.quad = quad;
    this.scene = postScene;
    this.camera = postCamera;
    const depthU = () => ({ tDepth: { value: null }, uNear: { value: 0.05 }, uFar: { value: 500 }, uTanFov: { value: new THREE.Vector2(1, 1) } });
    this.aoMat = pass(AO_FRAG, { ...depthU(), uTexel: { value: new THREE.Vector2() }, uRadius: { value: 0.9 }, uProjScale: { value: 500 }, uSamples: { value: 8 } });
    this.aoBlur = pass(AO_BLUR, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.maskMat = pass(RAY_MASK, { tDepth: { value: null }, tScene: { value: null }, uTexel: { value: new THREE.Vector2() }, uSunUv: { value: new THREE.Vector2() }, uAspect: { value: 1 }, uExposure: { value: 1 } });
    this.rayBlur = pass(RAY_BLUR, { tSrc: { value: null }, uSunUv: { value: new THREE.Vector2() }, uStep: { value: 1 } });
    this.applyMat = pass(APPLY, {
      ...depthU(),
      tAO: { value: null },
      tRays: { value: null },
      uAOTexel: { value: new THREE.Vector2() },
      uAOOn: { value: 0 },
      uAOStrength: { value: 0.85 },
      uRayOn: { value: 0 },
      uRayColor: { value: new THREE.Color() },
      uRaySigma: { value: 0.02 },
      uSunView: { value: new THREE.Vector3() },
      tBeam: { value: null },
      uBeamTexel: { value: new THREE.Vector2() },
      uBeamColor: { value: new THREE.Color(0, 0, 0) },
      uDebug: { value: 0 }, // 1: show sun shafts only, 2: show AO only
    });
    this.beamMat = pass(BEAM_FRAG, { ...depthU(), uLPos: { value: new THREE.Vector3() }, uLDir: { value: new THREE.Vector3() }, uCone: { value: new THREE.Vector2() }, uRange: { value: 30 } });
    // out = src.rgb + dst.rgb * src.a  (rays added, AO multiplied)
    this.applyMat.blending = THREE.CustomBlending;
    this.applyMat.blendEquation = THREE.AddEquation;
    this.applyMat.blendSrc = THREE.OneFactor;
    this.applyMat.blendDst = THREE.SrcAlphaFactor;
    this.applyMat.blendSrcAlpha = THREE.ZeroFactor;
    this.applyMat.blendDstAlpha = THREE.OneFactor;
    this.applyMat.transparent = true;

    const opt = { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false };
    this.aoA = new THREE.WebGLRenderTarget(4, 4, opt);
    this.aoB = new THREE.WebGLRenderTarget(4, 4, opt);
    this.rayA = new THREE.WebGLRenderTarget(4, 4, opt);
    this.rayB = new THREE.WebGLRenderTarget(4, 4, opt);
    this.beam = new THREE.WebGLRenderTarget(4, 4, opt);
    this._v = new THREE.Vector3();
    this._p = new THREE.Vector4();
    this.raysActive = false;
  }

  setSize(pw, ph) {
    this.aoA.setSize(Math.max(4, pw >> 1), Math.max(4, ph >> 1));
    this.aoB.setSize(Math.max(4, pw >> 1), Math.max(4, ph >> 1));
    this.rayA.setSize(Math.max(4, pw >> 2), Math.max(4, ph >> 2));
    this.rayB.setSize(Math.max(4, pw >> 2), Math.max(4, ph >> 2));
    this.beam.setSize(Math.max(4, pw >> 1), Math.max(4, ph >> 1));
    this.pw = pw;
    this.ph = ph;
  }

  _run(mat, target) {
    this.quad.material = mat;
    this.r.setRenderTarget(target);
    this.r.render(this.scene, this.camera);
  }

  _depthUniforms(u, camera, depth) {
    u.tDepth.value = depth;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    const ty = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    u.uTanFov.value.set(ty * camera.aspect, ty);
  }

  // Renders AO / sun shafts from the resolved world depth, then blends them into `sceneRT`.
  // opts: { ao: 0|1|2, rays: {sunDir: Vector3 (world), color: Color, strength, sigma} | null, exposure,
  //         beam: {light: SpotLight (child of the camera), density} | null }
  run(sceneRT, camera, opts) {
    const depth = sceneRT.depthTexture;
    const aoOn = opts.ao > 0;
    let raysOn = false;
    const au = this.applyMat.uniforms;
    if (aoOn) {
      const u = this.aoMat.uniforms;
      this._depthUniforms(u, camera, depth);
      u.uTexel.value.set(1 / this.pw, 1 / this.ph);
      u.uSamples.value = opts.ao > 1 ? 12 : 8;
      u.uRadius.value = 0.9;
      // pixels (half-res) per metre at 1 m distance
      u.uProjScale.value = (this.ph * 0.5) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
      this._run(this.aoMat, this.aoA);
      const b = this.aoBlur.uniforms;
      b.tSrc.value = this.aoA.texture;
      b.uDir.value.set(1 / this.aoA.width, 0);
      this._run(this.aoBlur, this.aoB);
      b.tSrc.value = this.aoB.texture;
      b.uDir.value.set(0, 1 / this.aoA.height);
      this._run(this.aoBlur, this.aoA);
      au.tAO.value = this.aoA.texture;
      au.uAOTexel.value.set(1 / this.aoA.width, 1 / this.aoA.height);
    }
    const rays = opts.rays;
    if (rays && rays.strength > 0.002) {
      // sun position on screen (skip when behind the camera or far off-screen)
      const v = this._v.copy(rays.sunDir).multiplyScalar(1000).add(camera.position);
      const p = this._p.set(v.x, v.y, v.z, 1).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
      if (p.w > 0) {
        const sx = (p.x / p.w) * 0.5 + 0.5;
        const sy = (p.y / p.w) * 0.5 + 0.5;
        const off = Math.max(Math.abs(sx - 0.5), Math.abs(sy - 0.5));
        const fade = 1 - THREE.MathUtils.smoothstep(off, 0.65, 1.1);
        if (fade > 0.01) {
          raysOn = true;
          const m = this.maskMat.uniforms;
          m.tDepth.value = depth;
          m.tScene.value = sceneRT.texture;
          m.uTexel.value.set(1 / this.pw, 1 / this.ph);
          m.uSunUv.value.set(sx, sy);
          m.uAspect.value = camera.aspect;
          m.uExposure.value = opts.exposure ?? 1;
          this._run(this.maskMat, this.rayA);
          const b = this.rayBlur.uniforms;
          b.uSunUv.value.set(sx, sy);
          const steps = [1 / 64, 1 / 8, 1];
          let src = this.rayA;
          let dst = this.rayB;
          for (const s of steps) {
            b.tSrc.value = src.texture;
            b.uStep.value = s;
            this._run(this.rayBlur, dst);
            [src, dst] = [dst, src];
          }
          au.tRays.value = src.texture;
          au.uRayColor.value.copy(rays.color).multiplyScalar(rays.strength * fade);
          au.uRaySigma.value = rays.sigma;
          au.uSunView.value.copy(rays.sunDir).transformDirection(camera.matrixWorldInverse);
        }
      }
    }
    this.raysActive = raysOn;
    const beam = opts.beam;
    const beamOn = !!(beam && beam.light.intensity > 0 && beam.density > 0);
    au.uBeamColor.value.setRGB(0, 0, 0);
    if (beamOn) {
      const L = beam.light;
      const u = this.beamMat.uniforms;
      this._depthUniforms(u, camera, depth);
      // the light is parented to the camera, so its local transform is already view space
      u.uLPos.value.copy(L.position);
      u.uLDir.value.copy(L.target.position).sub(L.position).normalize();
      u.uCone.value.set(Math.cos(L.angle), Math.cos(L.angle * (1 - L.penumbra * 0.8)));
      u.uRange.value = Math.min(L.distance || 40, 40);
      this._run(this.beamMat, this.beam);
      au.tBeam.value = this.beam.texture;
      au.uBeamTexel.value.set(1 / this.beam.width, 1 / this.beam.height);
      au.uBeamColor.value.copy(L.color).multiplyScalar(L.intensity * beam.density);
    }
    if (!aoOn && !raysOn && !beamOn) return;
    au.uAOOn.value = aoOn ? 1 : 0;
    au.uRayOn.value = raysOn ? 1 : 0;
    this._depthUniforms(au, camera, depth);
    this.r.autoClear = false;
    this._run(this.applyMat, sceneRT);
    this.r.autoClear = true;
  }

  dispose() {
    for (const t of [this.aoA, this.aoB, this.rayA, this.rayB, this.beam]) t.dispose();
  }
}
