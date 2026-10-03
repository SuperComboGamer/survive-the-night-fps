// Renderer, HDR post pipeline (MSAA scene -> SSAO -> dual-filter bloom -> auto exposure -> filmic composite),
// atmosphere system, pooled dynamic lights, image-based-lighting capture.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { G } from './mats.js';
import { Sky, SKY_DEFAULT } from './sky.js';
import { clamp, lerp, damp } from './util.js';

const V3 = THREE.Vector3;

// ---------------------------------------------------------------- shaders
const QUAD_VS = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const DOWN_FS = /* glsl */`
precision highp float; varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uKaris;
vec3 T(vec2 o){ return min(max(texture2D(tSrc, vUv + o * uTexel).rgb, vec3(0.0)), vec3(30000.0)); }
float kw(vec3 c){ return 1.0 / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722))); }
void main(){
  vec3 a=T(vec2(-2,2)), b=T(vec2(0,2)), c=T(vec2(2,2)), d=T(vec2(-2,0)), e=T(vec2(0,0)), f=T(vec2(2,0)), g=T(vec2(-2,-2)), h=T(vec2(0,-2)), i=T(vec2(2,-2)), j=T(vec2(-1,1)), k=T(vec2(1,1)), l=T(vec2(-1,-1)), m=T(vec2(1,-1));
  vec3 res;
  if (uKaris > 0.5) {
    vec3 g0 = (a+b+d+e)*0.25, g1=(b+c+e+f)*0.25, g2=(d+e+g+h)*0.25, g3=(e+f+h+i)*0.25, g4=(j+k+l+m)*0.25;
    res = g0*0.125*kw(g0) + g1*0.125*kw(g1) + g2*0.125*kw(g2) + g3*0.125*kw(g3) + g4*0.5*kw(g4);
    res /= (0.125*(kw(g0)+kw(g1)+kw(g2)+kw(g3)) + 0.5*kw(g4));
  } else res = e*0.125 + (a+c+g+i)*0.03125 + (b+d+f+h)*0.0625 + (j+k+l+m)*0.125;
  gl_FragColor = vec4(res, 1.0);
}`;
const UP_FS = /* glsl */`
precision highp float; varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uWeight;
void main(){
  vec4 s = texture2D(tSrc, vUv + uTexel*vec2(-1,1)) + texture2D(tSrc, vUv + uTexel*vec2(1,1)) + texture2D(tSrc, vUv + uTexel*vec2(-1,-1)) + texture2D(tSrc, vUv + uTexel*vec2(1,-1));
  vec4 e = texture2D(tSrc, vUv + uTexel*vec2(0,1)) + texture2D(tSrc, vUv + uTexel*vec2(0,-1)) + texture2D(tSrc, vUv + uTexel*vec2(1,0)) + texture2D(tSrc, vUv + uTexel*vec2(-1,0));
  vec4 c = texture2D(tSrc, vUv);
  gl_FragColor = vec4(((s + 2.0*e + 4.0*c) / 16.0).rgb * uWeight, 1.0);
}`;

// average log-luminance -> adapted exposure (1x1 ping-pong)
const EXPO_FS = /* glsl */`
precision highp float; varying vec2 vUv; uniform sampler2D tLum; uniform sampler2D tPrev; uniform float uDt; uniform float uKey; uniform vec2 uRange; uniform float uSpeedUp; uniform float uSpeedDown; uniform float uReset;
void main(){
  float sum = 0.0;
  for (int y = 0; y < 6; y++) for (int x = 0; x < 6; x++) {
    vec3 c = texture2D(tLum, (vec2(float(x), float(y)) + 0.5) / 6.0).rgb;
    float L = dot(c, vec3(0.2126, 0.7152, 0.0722));
    sum += log(max(L, 1e-4));
  }
  float avg = exp(sum / 36.0);
  float target = clamp(uKey / max(avg, 1e-3), uRange.x, uRange.y);
  float prev = texture2D(tPrev, vec2(0.5)).r; if (uReset > 0.5) prev = target;
  float sp = target > prev ? uSpeedUp : uSpeedDown;
  float e = mix(prev, target, 1.0 - exp(-sp * uDt));
  gl_FragColor = vec4(e, e, e, 1.0);
}`;

const AO_FS = /* glsl */`
precision highp float; varying vec2 vUv;
uniform sampler2D tDepth; uniform mat4 uInvProj; uniform mat4 uProj; uniform vec2 uRes; uniform float uRadius; uniform float uStrength; uniform float uTime;
vec3 vpos(vec2 uv){ float d = texture2D(tDepth, uv).r; vec4 v = uInvProj * vec4(uv*2.0-1.0, d*2.0-1.0, 1.0); return v.xyz / v.w; }
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main(){
  float d0 = texture2D(tDepth, vUv).r; if (d0 >= 0.99999) { gl_FragColor = vec4(1.0); return; }
  vec2 px = 1.0 / uRes;
  vec3 P = vpos(vUv);
  vec3 Pr = vpos(vUv + vec2(px.x, 0.0)), Pl = vpos(vUv - vec2(px.x, 0.0)), Pu = vpos(vUv + vec2(0.0, px.y)), Pd = vpos(vUv - vec2(0.0, px.y));
  vec3 dx = abs(Pr.z - P.z) < abs(P.z - Pl.z) ? Pr - P : P - Pl;
  vec3 dy = abs(Pu.z - P.z) < abs(P.z - Pd.z) ? Pu - P : P - Pd;
  vec3 N = normalize(cross(dx, dy)); if (dot(N, -P) < 0.0) N = -N;
  float rpx = uRadius * uProj[1][1] * 0.5 * uRes.y / max(-P.z, 0.1);
  rpx = clamp(rpx, 3.0, 90.0);
  float rot = ign(gl_FragCoord.xy + uTime) * 6.2831853;
  float occ = 0.0;
  const int NS = 14;
  for (int i = 0; i < NS; i++) {
    float fi = (float(i) + 0.5) / float(NS);
    float ang = rot + fi * 6.2831853 * 3.0;
    float rr = fi * fi * 0.85 + 0.15;
    vec2 uv = vUv + vec2(cos(ang), sin(ang)) * rr * rpx * px;
    vec3 S = vpos(uv);
    vec3 v = S - P; float dd = dot(v, v);
    float w = clamp(1.0 - dd / (uRadius * uRadius * 1.5), 0.0, 1.0);
    occ += max(0.0, dot(N, v) / sqrt(dd + 1e-5) - 0.12) * w;
  }
  float ao = 1.0 - clamp(occ / float(NS) * 2.2 * uStrength, 0.0, 1.0);
  gl_FragColor = vec4(ao, ao, ao, 1.0);
}`;
const AO_BLUR_FS = /* glsl */`
precision highp float; varying vec2 vUv; uniform sampler2D tAO; uniform sampler2D tDepth; uniform vec2 uDir; uniform mat4 uInvProj;
float lin(vec2 uv){ float d = texture2D(tDepth, uv).r; vec4 v = uInvProj * vec4(uv*2.0-1.0, d*2.0-1.0, 1.0); return -v.z / v.w; }
void main(){
  float z0 = lin(vUv); float sum = 0.0, ws = 0.0;
  for (int i = -3; i <= 3; i++) {
    vec2 uv = vUv + uDir * float(i);
    float z = lin(uv); float w = exp(-abs(z - z0) * 8.0 / max(z0, 0.5)) * (1.0 - abs(float(i)) * 0.12);
    sum += texture2D(tAO, uv).r * w; ws += w;
  }
  float a = sum / ws; gl_FragColor = vec4(a, a, a, 1.0);
}`;


// ---- planar water reflection: every opaque pixel of the frame is splatted to its mirrored screen position (depth-tested point cloud, half res).
// water.js samples the result next frame (reprojected). Handles skyline / lamps / ships / sky exactly like a planar mirror without re-rendering the scene.
const REFL_VS = /* glsl */`
precision highp float;
uniform sampler2D tColor; uniform sampler2D tDepth; uniform mat4 uInvVP; uniform mat4 uVP; uniform vec3 uCam; uniform float uLevel; uniform vec2 uGrid; uniform float uPt;
varying vec3 vCol;
void main(){
  float id = position.x; float gy = floor(id / uGrid.x); float gx = id - gy * uGrid.x;
  vec2 uv = (vec2(gx, gy) + 0.5) / uGrid;
  vec4 c = texture2D(tColor, uv); float d = texture2D(tDepth, uv).r;
  vec4 wp = uInvVP * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); vec3 P = wp.xyz / wp.w;
  if (d > 0.99999) P = uCam + normalize(P - uCam) * 900.0;                  // sky: a far point along the ray
  bool water = c.a > 0.93 && c.a < 0.98;                                     // alpha code of the water surface (water.js)
  bool ok = c.a > 0.25 && !water && P.y > uLevel + 0.03 && all(lessThan(abs(c.rgb), vec3(1e5)));
  vec4 clip = uVP * vec4(P.x, 2.0 * uLevel - P.y, P.z, 1.0);
  if (!ok || clip.w < 0.1) { gl_Position = vec4(3.0, 3.0, 3.0, 1.0); gl_PointSize = 0.0; vCol = vec3(0.0); return; }
  gl_Position = clip; gl_PointSize = uPt; vCol = min(c.rgb, vec3(30.0));
}`;
const REFL_FS = /* glsl */`precision highp float; varying vec3 vCol; void main(){ gl_FragColor = vec4(vCol, 1.0); }`;

const TAA_FS = /* glsl */`
precision highp float; varying vec2 vUv;
uniform sampler2D tCur; uniform sampler2D tHist; uniform sampler2D tDepth; uniform sampler2D tAO;
uniform mat4 uInvVP; uniform mat4 uPrevVP; uniform vec2 uRes; uniform float uAO; uniform float uReset; uniform float uHistW;
vec3 tm(vec3 c){ return c / (1.0 + max(max(c.r, c.g), c.b)); }
vec3 itm(vec3 c){ return c / max(1.0 - max(max(c.r, c.g), c.b), 1e-3); }
vec3 catmull(sampler2D tex, vec2 uv){
  vec2 sp = uv * uRes; vec2 t1 = floor(sp - 0.5) + 0.5; vec2 f = sp - t1;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f)); vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f); vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f)); vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2; vec2 o12 = w2 / w12; vec2 t0 = (t1 - 1.0) / uRes, t3 = (t1 + 2.0) / uRes, t12 = (t1 + o12) / uRes;
  vec3 r = texture2D(tex, vec2(t12.x, t0.y)).rgb * (w12.x * w0.y) + texture2D(tex, vec2(t0.x, t12.y)).rgb * (w0.x * w12.y) + texture2D(tex, vec2(t12.x, t12.y)).rgb * (w12.x * w12.y) + texture2D(tex, vec2(t3.x, t12.y)).rgb * (w3.x * w12.y) + texture2D(tex, vec2(t12.x, t3.y)).rgb * (w12.x * w3.y);
  float ws = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y; return r / ws;
}
void main(){
  vec4 cur4 = texture2D(tCur, vUv); vec3 cur = max(cur4.rgb, 0.0); bool vm = cur4.a < 0.25; // alpha code: 0 = viewmodel, 0.25..0.9 = dynamic skinned body (no motion vectors -> short history), 1 = static world
  float ao = texture2D(tAO, vUv).r; cur *= mix(1.0, ao, uAO * (vm ? 0.0 : 1.0));
  float depth = texture2D(tDepth, vUv).r;
  vec4 wp = uInvVP * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0); wp /= wp.w;
  vec4 pp = uPrevVP * wp; vec2 puv = pp.xy / pp.w * 0.5 + 0.5; if (vm) puv = vUv;
  vec3 m1 = vec3(0.0), m2 = vec3(0.0); vec3 cmin = vec3(1e9), cmax = vec3(-1e9); vec2 px = 1.0 / uRes; float dyn = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec4 c4 = texture2D(tCur, vUv + vec2(float(x), float(y)) * px); vec3 c = tm(max(c4.rgb, 0.0)); if (c4.a > 0.25 && c4.a < 0.9) dyn = 1.0;
    if (x == 0 && y == 0) c = tm(cur); m1 += c; m2 += c * c; cmin = min(cmin, c); cmax = max(cmax, c);
  }
  vec3 mu = m1 / 9.0; vec3 sd = sqrt(max(m2 / 9.0 - mu * mu, 0.0)); vec3 mn = max(mu - 1.4 * sd, cmin), mx = min(mu + 1.4 * sd, cmax);
  vec3 ctm = tm(cur);
  bool off = puv.x < 0.0 || puv.y < 0.0 || puv.x > 1.0 || puv.y > 1.0;
  vec3 h = tm(max(catmull(tHist, clamp(puv, vec2(0.001), vec2(0.999))), 0.0));
  // clip history toward the current colour into the neighbourhood box
  vec3 ctr = 0.5 * (mn + mx), ext = 0.5 * (mx - mn) + 1e-4; vec3 v = h - ctr; vec3 a = abs(v / ext); float mxA = max(max(a.x, a.y), a.z); if (mxA > 1.0) h = ctr + v / mxA;
  float vel = length((puv - vUv) * uRes);
  float w = uHistW; w = mix(w, 0.55, clamp(vel / 10.0, 0.0, 1.0)); if (vm) w = min(w, 0.72); if (dyn > 0.5) w = min(w, 0.4); if (off || uReset > 0.5) w = 0.0;
  vec3 res = itm(mix(ctm, h, w));
  gl_FragColor = vec4(res, cur4.a);
}`;

// light shafts: (1) prepare a quarter-res "emission" map (sky pixels only, from the full-res scene + depth), (2) radial scan over that small map.
// The old single pass sampled full-res depth + colour 40x per pixel (≈10 ms on a GTX 1070); this is ~0.4 ms.
const SHAFT_PREP_FS = /* glsl */`
precision highp float; varying vec2 vUv; uniform sampler2D tScene; uniform sampler2D tDepth; uniform vec2 uTexel;
void main(){
  vec3 acc = vec3(0.0); float k = 0.0;
  for (int y = -1; y <= 1; y += 2) for (int x = -1; x <= 1; x += 2) {
    vec2 uv = vUv + vec2(float(x), float(y)) * uTexel * 1.5; float d = texture2D(tDepth, uv).r;
    if (d > 0.99999) { vec3 c = min(texture2D(tScene, uv).rgb, vec3(6.0)); float l = dot(c, vec3(0.3, 0.55, 0.15)); acc += c * (l * l * 0.5 + l * 0.15); }
  }
  gl_FragColor = vec4(acc * 0.25, 1.0);
}`;
const SHAFT_FS = /* glsl */`
precision highp float; varying vec2 vUv;
uniform sampler2D tEmit; uniform vec2 uSun; uniform float uDensity; uniform float uDecay;
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main(){
  vec2 dir = (uSun - vUv); const int N = 32; vec2 stepv = dir / float(N) * uDensity; vec2 uv = vUv + stepv * ign(gl_FragCoord.xy); float illum = 1.0; vec3 acc = vec3(0.0);
  for (int i = 0; i < N; i++) {
    uv += stepv; if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { illum *= uDecay; continue; }
    acc += texture2D(tEmit, uv).rgb * illum; illum *= uDecay;
  }
  gl_FragColor = vec4(acc / float(N), 1.0);
}`;

const COMP_FS = /* glsl */`
precision highp float; varying vec2 vUv;
uniform sampler2D tScene; uniform sampler2D tBloom; uniform sampler2D tAO; uniform sampler2D tExpo; uniform sampler2D tOverlay; uniform sampler2D tShafts; uniform vec4 uShaft;
uniform float uExposure; uniform float uBloom; uniform float uVignette; uniform float uGrain; uniform float uTime; uniform float uChroma;
uniform float uSat; uniform float uContrast; uniform vec3 uLift; uniform vec3 uGain; uniform vec3 uTint; uniform float uAO; uniform float uAutoExp;
uniform float uTM; uniform float uSharp; uniform float uDamage; uniform vec4 uFlash; uniform float uUnderwater; uniform vec2 uRes; uniform float uFrost; uniform float uLowHP;
vec3 aces(vec3 x){ const float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0); }
vec3 toSRGB(vec3 c){ return mix(c*12.92, 1.055*pow(max(c, 0.0), vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main(){
  vec2 uv = vUv; vec2 c = uv - 0.5; float r2 = dot(c, c);
  if (uUnderwater > 0.0) uv += 0.004 * uUnderwater * vec2(sin(uv.y*40.0 + uTime*3.0), cos(uv.x*35.0 + uTime*2.5));
  vec3 col;
  float ca = uChroma * (0.5 + r2 * 2.0);
  col.r = texture2D(tScene, uv + c * ca).r; col.g = texture2D(tScene, uv).g; col.b = texture2D(tScene, uv - c * ca).b;
  { // clamped unsharp mask in a compressed (perceptual) space: no bright halos around dark silhouettes against a bright sky
    vec2 px = 1.0 / uRes; vec3 tl = texture2D(tScene, uv + vec2(px.x, 0.0)).rgb, tr = texture2D(tScene, uv - vec2(px.x, 0.0)).rgb, tu = texture2D(tScene, uv + vec2(0.0, px.y)).rgb, td = texture2D(tScene, uv - vec2(0.0, px.y)).rgb;
    vec3 cc = col / (1.0 + col); vec3 a1 = tl / (1.0 + tl), a2 = tr / (1.0 + tr), a3 = tu / (1.0 + tu), a4 = td / (1.0 + td);
    vec3 avg = (a1 + a2 + a3 + a4) * 0.25; vec3 lo = min(min(min(a1, a2), min(a3, a4)), cc), hi = max(max(max(a1, a2), max(a3, a4)), cc);
    vec3 sc = clamp(cc + (cc - avg) * uSharp, lo, hi); sc = min(sc, vec3(0.985)); col = sc / (1.0 - sc); }
  float ao = texture2D(tAO, uv).r; col *= mix(1.0, ao, uAO);
  col += texture2D(tBloom, uv).rgb * uBloom;
  col += texture2D(tShafts, uv).rgb * uShaft.rgb * uShaft.a;
  float ex = uExposure * mix(1.0, texture2D(tExpo, vec2(0.5)).r, uAutoExp);
  { float vmA = texture2D(tScene, uv).a; ex = mix(ex, min(ex, 1.3), 1.0 - step(0.25, vmA)); } // viewmodel pixels (alpha 0) keep a limited exposure: guns must not burn out in dark stops where the eye-adapted exposure is 2.6
  col *= ex;
  col = col * uGain + uLift * 0.1;
  col *= uTint;
  col += uFlash.rgb * uFlash.a;
  if (uTM > 0.5) { // hue-preserving filmic curve: tone-map the luminance, keep chroma ratios, roll the brightest highlights toward white (no orange->yellow hue shifts, more photographic colour)
    float Lw = max(dot(col, vec3(0.2126, 0.7152, 0.0722)), 1e-5); float Lt = aces(vec3(Lw)).x; vec3 cp = col * (Lt / Lw); cp = mix(cp, vec3(Lt), smoothstep(0.55, 1.0, Lt) * 0.6);
    col = mix(aces(col), cp, uTM);
  } else col = aces(col);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSat);
  col = (col - 0.18) * uContrast + 0.18; col = max(col, 0.0);
  col *= 1.0 - uVignette * smoothstep(0.18, 0.95, r2 * 2.2);
  col = toSRGB(col);
  // low-health/blood edge overlay
  float edge = smoothstep(0.08, 0.5, r2 * 2.0);
  col = mix(col, vec3(0.45, 0.0, 0.0), uDamage * edge * 0.85);
  col = mix(col, col * vec3(0.55, 0.5, 0.5) + vec3(0.1), uLowHP * 0.35);
  // frost creeping in at the screen edges (cold stops)
  float fn = hash12(floor(uv * uRes * 0.25)); col = mix(col, vec3(0.75, 0.85, 0.95), uFrost * smoothstep(0.25, 0.6, r2 * 2.6 + fn * 0.12) * 0.22);
  // film grain + dithering
  float g = hash12(gl_FragCoord.xy + fract(uTime) * 91.7) - 0.5;
  col += g * uGrain + (hash12(gl_FragCoord.xy * 1.3 + uTime) - hash12(gl_FragCoord.xy * 0.7 - uTime)) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}`;

// ---------------------------------------------------------------- atmosphere
/** Atmosphere schema (hex colours / arrays are compiled to THREE.Color / Vector3). See docs/API.md */
export const ATMO_DEFAULT = {
  fog: { color: 0x0b0f14, scatter: 0x1a2430, density: 0.02, falloff: 0.0, base: 0, power: 6 },
  sky: null, // null => uses SKY_DEFAULT with zenith/horizon derived from fog colour
  sun: { dir: [0.3, 0.8, 0.2], color: 0xbfd0ff, intensity: 0.0, shadow: false },
  env: { intensity: 0.4 },
  exposure: 1.0, bloom: 0.35, vignette: 0.35, grain: 0.03, chroma: 0.0016,
  grade: { sat: 1.0, contrast: 1.05, lift: [0, 0, 0], gain: [1, 1, 1], tint: [1, 1, 1] },
  autoExposure: { key: 0.18, min: 0.6, max: 2.2 },
  wind: [0, 0, 0], snow: 0, wet: 0, frost: 0, ao: 0.6, shafts: 0,
};
const NUM_KEYS = ['exposure', 'bloom', 'vignette', 'grain', 'chroma', 'snow', 'wet', 'frost', 'ao', 'shafts'];
export function compileAtmo(a) {
  const d = ATMO_DEFAULT, c = {};
  const f = { ...d.fog, ...(a.fog || {}) };
  c.fog = { color: new THREE.Color(f.color), scatter: new THREE.Color(f.scatter), density: f.density, falloff: f.falloff, base: f.base, power: f.power };
  const s = { ...d.sun, ...(a.sun || {}) };
  c.sun = { dir: new V3(...s.dir).normalize(), color: new THREE.Color(s.color), intensity: s.intensity, shadow: !!s.shadow };
  c.env = { ...d.env, ...(a.env || {}) };
  c.sky = { ...SKY_DEFAULT, ...(a.sky || {}) };
  if (!a.sky) { c.sky.zenith = a.fog?.color ?? 0x0b0f14; c.sky.horizon = a.fog?.color ?? 0x0b0f14; c.sky.stars = 0; c.sky.disc = 0; }
  c.skyC = { zenith: new THREE.Color(c.sky.zenith), horizon: new THREE.Color(c.sky.horizon), ground: new THREE.Color(c.sky.ground), sunColor: new THREE.Color(c.sky.sunColor), cloudColor: new THREE.Color(c.sky.cloudColor), cloudLit: new THREE.Color(c.sky.cloudLit), auroraA: new THREE.Color(c.sky.auroraA), auroraB: new THREE.Color(c.sky.auroraB) };
  for (const k of NUM_KEYS) c[k] = a[k] ?? d[k];
  const g = { ...d.grade, ...(a.grade || {}) };
  c.grade = { sat: g.sat, contrast: g.contrast, lift: new V3(...g.lift), gain: new V3(...g.gain), tint: new V3(...g.tint) };
  c.autoExposure = { ...d.autoExposure, ...(a.autoExposure || {}) };
  c.wind = new V3(...(a.wind || d.wind));
  c.reverb = a.reverb || 'open'; c.envTex = a.envTex || null; c.name = a.name || 'atmo';
  c.lightning = a.lightning || 0;
  return c;
}
const _c = new THREE.Color();
export function mixAtmo(A, B, t, out = null) {
  const o = out || compileAtmo({});
  const mc = (r, a, b) => { r.copy(a).lerp(b, t); };
  const mv = (r, a, b) => { r.copy(a).lerp(b, t); };
  mc(o.fog.color, A.fog.color, B.fog.color); mc(o.fog.scatter, A.fog.scatter, B.fog.scatter);
  for (const k of ['density', 'falloff', 'base', 'power']) o.fog[k] = lerp(A.fog[k], B.fog[k], t);
  mv(o.sun.dir, A.sun.dir, B.sun.dir); o.sun.dir.normalize(); mc(o.sun.color, A.sun.color, B.sun.color);
  o.sun.intensity = lerp(A.sun.intensity, B.sun.intensity, t); o.sun.shadow = t < 0.5 ? A.sun.shadow : B.sun.shadow;
  o.env = { ...(t < 0.5 ? A.env : B.env), intensity: lerp(A.env.intensity, B.env.intensity, t) };
  for (const k of NUM_KEYS) o[k] = lerp(A[k], B[k], t);
  for (const k of ['zenith', 'horizon', 'ground', 'sunColor', 'cloudColor', 'cloudLit', 'auroraA', 'auroraB']) mc(o.skyC[k], A.skyC[k], B.skyC[k]);
  for (const k of ['gradPow', 'sunSize', 'sunGlow', 'stars', 'cloud', 'cloudSpeed', 'cloudScale', 'cloudDark', 'aurora', 'horizonFog']) o.sky[k] = lerp(A.sky[k], B.sky[k], t);
  o.sky.disc = t < 0.5 ? A.sky.disc : B.sky.disc;
  mv(o.grade.lift, A.grade.lift, B.grade.lift); mv(o.grade.gain, A.grade.gain, B.grade.gain); mv(o.grade.tint, A.grade.tint, B.grade.tint);
  o.grade.sat = lerp(A.grade.sat, B.grade.sat, t); o.grade.contrast = lerp(A.grade.contrast, B.grade.contrast, t);
  o.autoExposure = { key: lerp(A.autoExposure.key, B.autoExposure.key, t), min: lerp(A.autoExposure.min, B.autoExposure.min, t), max: lerp(A.autoExposure.max, B.autoExposure.max, t) };
  mv(o.wind, A.wind, B.wind); o.reverb = t < 0.5 ? A.reverb : B.reverb; o.envTex = t < 0.5 ? A.envTex : B.envTex; o.lightning = lerp(A.lightning, B.lightning, t);
  return o;
}

// ---------------------------------------------------------------- quality presets
export const QUALITY = {
  low: { aa: 'none', msaa: 0, shadow: 1024, ao: false, bloomLevels: 4, scale: 0.75, pool: 3 },
  medium: { aa: 'taa', msaa: 0, shadow: 2048, ao: true, bloomLevels: 5, scale: 1, pool: 5 },
  high: { aa: 'taa', msaa: 0, shadow: 2048, ao: true, bloomLevels: 6, scale: 1, pool: 6 },
  ultra: { aa: 'taa', msaa: 0, shadow: 4096, ao: true, bloomLevels: 6, scale: 1, pool: 8 },
};

const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };

export const gfx = {
  renderer: null, scene: null, camera: null, vmCamera: null, sky: null, sun: null, canvas: null,
  q: QUALITY.high, qName: 'high', renderScale: 1, dynRes: false,
  atmo: null, atmoA: null, atmoB: null, atmoMix: 0,
  _fc: 0, sunShadowOn: false, _sunDirty: true, shadowCenter: new V3(), shadowRadius: 36, vmEnabled: true, vmFov: 58, bloomScale: 0.62, vmEnv: 0.6, // bloomScale: global multiplier on every stop's atmo.bloom (kept low: heavy bloom reads as a soft-focus filter) // vmEnv: image-based light scale for the viewmodel pass (guns are dark coated steel; a full-strength dusk sky makes them read as pale plastic)
  damage: 0, lowHP: 0, flash: new THREE.Vector4(1, 1, 1, 0), underwater: 0, resetExposure: true,
  lightSources: [], pool: { points: [], spots: [] },
  stats: { calls: 0, tris: 0, geoms: 0, tex: 0, progs: 0 },

  init(canvas, { quality = 'high' } = {}) {
    this.canvas = canvas;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, alpha: false, preserveDrawingBuffer: false });
    // shader link failures happen (very rarely, under heavy multi-process GPU load) and leave a black draw: remember them and recompile everything once things calm down (max 3 tries)
    r.debug.onShaderError = (gl, program, vs, fs) => { this._shaderErr = (this._shaderErr || 0) + 1; this._shaderErrT = performance.now(); this._firstErrAt = this._firstErrAt || performance.now();
      if (this._shaderErr <= 4) { let msg = ''; try { msg = 'program: ' + gl.getProgramInfoLog(program) + ' | vs: ' + (gl.getShaderInfoLog(vs) || '').slice(0, 500) + ' | fs: ' + (gl.getShaderInfoLog(fs) || '').slice(0, 900); } catch (e) { /* ignore */ } console.error('[gfx] shader link/compile failure ' + this._shaderErr + ': ' + msg);
        if (this._shaderErr === 1) { try { console.error('[gfx] stack: ' + new Error().stack.split('\n').slice(2, 14).map((l) => l.trim().replace(/\(.*\/(.*)\)/, '($1)')).join(' < ')); } catch (e) { /* ignore */ } try { const src = gl.getShaderSource(fs).split('\n'); const m2 = /ERROR: 0:(\d+)/.exec(msg); const ln = m2 ? +m2[1] : 0; console.error('[gfx] failing fragment source around line ' + ln + ':\n' + src.slice(Math.max(0, ln - 3), ln + 2).join('\n').slice(0, 1400) + '\n... first lines: ' + src.filter((l) => /^(#define|uniform) /.test(l)).slice(0, 6).join(' ; ').slice(0, 500)); } catch (e) { /* ignore */ } } } };
    r.setPixelRatio(1);
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap; r.shadowMap.autoUpdate = false;
    r.toneMapping = THREE.NoToneMapping; r.outputColorSpace = THREE.LinearSRGBColorSpace;
    r.info.autoReset = false;
    r.setClearColor(0x000000, 1);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(78, 16 / 9, 0.05, 2600);
    this.camera.layers.set(0);
    this.vmCamera = new THREE.PerspectiveCamera(this.vmFov, 16 / 9, 0.01, 6);
    this.vmCamera.layers.set(1);
    this.scene.add(this.camera, this.vmCamera);
    this.sky = new Sky(); this.scene.add(this.sky.mesh); this.vmSkip = new Set([this.sky.mesh]); // objects that never hold viewmodel parts: hidden during the viewmodel pass so three.js does not traverse thousands of world objects again
    // key light (sun / moon) with shadow map
    const sun = this.sun = new THREE.DirectionalLight(0xffffff, 0);
    sun.castShadow = true; sun.layers.enable(1); sun.shadow.needsUpdate = true; // first render creates the shadow map even if the first atmosphere has no sun
    sun.shadow.camera.layers.enable(5); // depth-only shadow proxies (build.js SHADOW_LAYER)
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.035; sun.shadow.radius = 2.5;
    this.scene.add(sun, sun.target);
    this.pmrem = new THREE.PMREMGenerator(r);
    this._buildLightPool();
    this._buildPost();
    this.setQuality(quality, true);
    this.atmo = compileAtmo({ name: 'default' });
    this.applyAtmo(this.atmo);
    // GPU timer
    const gl = r.getContext();
    this._gl = gl; this._timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2'); this._queries = []; this.gpuMs = 0; this.gpuMsAvg = 0;
    addEventListener('resize', () => this.resize());
    this.resize();
    return this;
  },

  setQuality(name, first = false) {
    this.qName = name; this.q = QUALITY[name] || QUALITY.high;
    const q = this.q, s = this.sun.shadow;
    if (s.map && (s.mapSize.x !== q.shadow)) { s.map.dispose(); s.map = null; }
    s.mapSize.set(q.shadow, q.shadow);
    this._buildLightPool();
    if (!first) this._allocTargets();
  },

  // ---- light pool: fixed number of lights whose parameters are re-assigned each frame => no shader recompiles
  _buildLightPool() {
    const P = this.pool;
    for (const l of [...P.points, ...P.spots]) { this.scene.remove(l); l.dispose?.(); }
    P.points = []; P.spots = [];
    const n = this.q.pool;
    for (let i = 0; i < n; i++) { const l = new THREE.PointLight(0xffffff, 0, 10, 2); l.layers.enable(1); l.userData = { src: null, level: 0 }; this.scene.add(l); P.points.push(l); }
    for (let i = 0; i < 3; i++) {
      const l = new THREE.SpotLight(0xffffff, 0, 30, 0.5, 0.5, 2); l.layers.enable(1); l.userData = { src: null, level: 0 };
      l.castShadow = i < 2; if (l.castShadow) { l.shadow.camera.layers.enable(5); l.shadow.mapSize.set(1024, 1024); l.shadow.bias = -0.0005; l.shadow.normalBias = 0.03; l.shadow.camera.near = 0.15; l.shadow.radius = 2; l.shadow.autoUpdate = false; l.shadow.needsUpdate = true; /* render once so the map exists; afterwards only when the light is in use */ }
      this.scene.add(l, l.target); P.spots.push(l);
    }
  },
  /** Register a light source. kind 'point' | 'spot'. Returns the source object (mutate .pos/.intensity/.color at will). */
  addLight(o) {
    const s = Object.assign({ kind: 'point', pos: new V3(), color: new THREE.Color(0xffffff), intensity: 10, distance: 12, decay: 2, angle: 0.5, penumbra: 0.5, dir: new V3(0, -1, 0), flicker: 0, flickerSpeed: 8, enabled: true, priority: 1, shadow: false, on: 1, seed: Math.random() * 100, level: 0 }, o);
    if (!(s.color instanceof THREE.Color)) s.color = new THREE.Color(s.color);
    this.lightSources.push(s); return s;
  },
  removeLight(s) { const i = this.lightSources.indexOf(s); if (i >= 0) this.lightSources.splice(i, 1); },
  clearLights() { this.lightSources.length = 0; },
  _scoreSrc(s, cam) { const dx = s.pos.x - cam.x, dy = s.pos.y - cam.y, dz = s.pos.z - cam.z; const d2 = dx * dx + dy * dy + dz * dz; return s.priority * s.intensity * s.on / (d2 + 4); },
  updateLights(dt, time, camPos) {
    const src = this.lightSources, P = this.pool;
    for (const kind of ['point', 'spot']) {
      const pool = kind === 'point' ? P.points : P.spots;
      const cand = [];
      for (const s of src) if (s.kind === kind && s.enabled) { s._score = this._scoreSrc(s, camPos); if (s._score > 1e-4 && (s.distance <= 0 || s._score >= 0)) cand.push(s); }
      cand.sort((a, b) => b._score - a._score);
      const want = cand.slice(0, pool.length);
      const wantSet = new Set(want);
      const assigned = new Set();
      for (const l of pool) { const u = l.userData; if (u.src && !wantSet.has(u.src)) { u.level = Math.max(0, u.level - dt * 9); if (u.level <= 0) u.src = null; } else if (u.src) assigned.add(u.src); }
      for (const s of want) if (!assigned.has(s)) { const free = pool.find((l) => !l.userData.src); if (free) { free.userData.src = s; free.userData.level = 0; assigned.add(s); } }
      for (const l of pool) {
        const u = l.userData, s = u.src;
        if (!s) { l.intensity = 0; l.visible = true; if (kind === 'spot' && l.castShadow) { l.shadow.autoUpdate = false; u.shSrc = null; } continue; }
        if (wantSet.has(s)) u.level = Math.min(1, u.level + dt * 9);
        let fl = 1; if (s.flicker > 0) { fl = 1 - s.flicker * (0.5 + 0.5 * Math.sin(time * s.flickerSpeed + s.seed) * Math.sin(time * s.flickerSpeed * 2.7 + s.seed * 3.1)) - s.flicker * 0.5 * Math.max(0, Math.sin(time * 31 + s.seed * 9)) * 0.5; }
        l.position.copy(s.pos); l.color.copy(s.color); l.intensity = s.intensity * s.on * fl * u.level; l.distance = s.distance; l.decay = s.decay;
        if (kind === 'spot') { l.angle = s.angle; l.penumbra = s.penumbra; l.target.position.copy(s.pos).add(s.dir); l.target.updateMatrixWorld(); if (l.castShadow) { l.shadow.autoUpdate = false; if (s.shadow) { const fresh = u.shSrc !== s; u.shSrc = s; if (fresh || (this._fc & 1) === 1) l.shadow.needsUpdate = true; } else u.shSrc = null; } }
      }
    }
  },

  // ---- atmosphere
  setAtmo(a, snap = true) { // a: compiled atmosphere
    this.atmoA = this.atmoB = a; this.atmoMix = 0; this.atmo = a; this.applyAtmo(a); if (snap) this.resetExposure = true;
  },
  blendAtmo(A, B, t) {
    if (!this._atmoTmp) this._atmoTmp = compileAtmo({});
    this.atmo = mixAtmo(A, B, t, this._atmoTmp); this.applyAtmo(this.atmo);
  },
  applyAtmo(a) {
    const f = a.fog;
    G.uFogColor.value.copy(f.color); G.uFogScatter.value.copy(f.scatter); G.uFogParams.value.set(f.density, f.falloff, f.base, f.power);
    G.uSunDir.value.copy(a.sun.dir); G.uWind.value.copy(a.wind); G.uSnow.value = a.snow; G.uWet.value = a.wet; G.uFrost.value = a.frost;
    const s = this.sun; s.color.copy(a.sun.color); s.intensity = a.sun.intensity; s.castShadow = true; s.visible = true; this.sunShadowOn = !!(a.sun.shadow && a.sun.intensity > 0.001); this._sunDirty = true; s.shadow.autoUpdate = false; /* constant light/shadow config => no shader variants; render() requests the map update (amortised) */
    this._sunDir = a.sun.dir; { const L = this.partLightBase || (this.partLightBase = new THREE.Color()); L.setRGB(0, 0, 0); L.r = a.sun.color.r * a.sun.intensity * 0.2 + a.fog.color.r * 0.7 + a.env.intensity * 0.1; L.g = a.sun.color.g * a.sun.intensity * 0.2 + a.fog.color.g * 0.7 + a.env.intensity * 0.1; L.b = a.sun.color.b * a.sun.intensity * 0.2 + a.fog.color.b * 0.7 + a.env.intensity * 0.1; L.r = Math.max(L.r, 0.03); L.g = Math.max(L.g, 0.03); L.b = Math.max(L.b, 0.03); G.uPartLight.value.copy(L); }
    if (a.envTex) { this.scene.environment = a.envTex; } else this.scene.environment = null;
    this.scene.environmentIntensity = a.env.intensity;
    const u = this.sky.uniforms, k = a.sky, c = a.skyC;
    u.uZenith.value.copy(c.zenith); u.uHorizon.value.copy(c.horizon); u.uGround.value.copy(c.ground); u.uSunColor.value.copy(c.sunColor);
    u.uCloudColor.value.copy(c.cloudColor); u.uCloudLit.value.copy(c.cloudLit); u.uAuroraA.value.copy(c.auroraA); u.uAuroraB.value.copy(c.auroraB);
    u.uGradPow.value = k.gradPow; u.uSunSize.value = k.sunSize; u.uSunGlow.value = k.sunGlow; u.uDisc.value = k.disc; u.uStars.value = k.stars;
    u.uCloud.value = k.cloud; u.uCloudSpeed.value = k.cloudSpeed; u.uCloudScale.value = k.cloudScale; u.uCloudDark.value = k.cloudDark; u.uAurora.value = k.aurora; u.uHorizonFog.value = k.horizonFog;
    u.uLightning.value = a.lightning; u.uWindDir.value.copy(a.wind).normalize();
    const cu = this.compU;
    cu.uBloom.value = a.bloom * this.bloomScale; cu.uVignette.value = a.vignette; cu.uGrain.value = a.grain; cu.uChroma.value = a.chroma; cu.uExposure.value = a.exposure;
    cu.uSat.value = a.grade.sat; cu.uContrast.value = a.grade.contrast; cu.uLift.value.copy(a.grade.lift); cu.uGain.value.copy(a.grade.gain); cu.uTint.value.copy(a.grade.tint);
    cu.uFrost.value = a.frost; this.shaftK = a.shafts * (a.sun.intensity > 0.5 ? 1 : 0); cu.uShaft.value.set(a.sun.color.r, a.sun.color.g, a.sun.color.b, 0);
    this.aoStrength = a.ao;
    const eu = this.expoU; eu.uKey.value = a.autoExposure.key; eu.uRange.value.set(a.autoExposure.min, a.autoExposure.max);
  },

  /** Build an IBL environment texture from sky params (+ optional coloured emissive patches [{dir:[x,y,z], color, size, intensity}]). */
  makeEnv(atmoDef, patches = [], res = 128) {
    const a = compileAtmo(atmoDef);
    const s = new THREE.Scene(); const sky = new Sky(); sky.mesh.scale.setScalar(20); sky.mesh.material = sky.material.clone();
    const u = sky.mesh.material.uniforms;
    u.uFogColor = { value: a.fog.color.clone() }; u.uSunDir = { value: a.sun.dir.clone() }; u.uTime = { value: 3.0 };
    const k = a.sky, c = a.skyC;
    u.uZenith.value.copy(c.zenith); u.uHorizon.value.copy(c.horizon); u.uGround.value.copy(c.ground); u.uSunColor.value.copy(c.sunColor);
    u.uGradPow.value = k.gradPow; u.uSunSize.value = k.sunSize; u.uSunGlow.value = k.sunGlow; u.uDisc.value = k.disc; u.uStars.value = k.stars; u.uCloud.value = k.cloud;
    u.uCloudColor.value.copy(c.cloudColor); u.uCloudLit.value.copy(c.cloudLit); u.uHorizonFog.value = k.horizonFog;
    s.add(sky.mesh);
    for (const p of patches) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(p.color).multiplyScalar(p.intensity ?? 4), side: THREE.DoubleSide, fog: false }));
      const d = new V3(...p.dir).normalize(); m.position.copy(d).multiplyScalar(8); m.lookAt(0, 0, 0); m.scale.setScalar((p.size ?? 1.5) * 2); s.add(m);
    }
    const rt = this.pmrem.fromScene(s, 0, 0.1, 60);
    s.traverse((o) => { o.geometry?.dispose(); });
    return rt.texture;
  },

  /** debug: read adapted exposure (sync readback; tests only) */
  debugExposure() { const r = this.renderer, b = new Uint16Array(4); r.readRenderTargetPixels(this.rtExpoA, 0, 0, 1, 1, b); const f = (h) => { const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff; return e === 0 ? s * Math.pow(2, -14) * (m / 1024) : s * Math.pow(2, e - 15) * (1 + m / 1024); }; return f(b[0]); },

  // ---- post pipeline
  _buildPost() {
    const mk = (fs, uniforms, extra = {}) => new THREE.ShaderMaterial({ vertexShader: QUAD_VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false, ...extra });
    this.qDown = new FullScreenQuad(mk(DOWN_FS, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uKaris: { value: 0 } }));
    this.qUp = new FullScreenQuad(mk(UP_FS, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uWeight: { value: 1 } }, { blending: THREE.AdditiveBlending, transparent: true }));
    this.expoU = { tLum: { value: null }, tPrev: { value: null }, uDt: { value: 0.016 }, uKey: { value: 0.18 }, uRange: { value: new THREE.Vector2(0.6, 2.2) }, uSpeedUp: { value: 1.6 }, uSpeedDown: { value: 0.8 }, uReset: { value: 1 } };
    this.qExpo = new FullScreenQuad(mk(EXPO_FS, this.expoU));
    this.aoU = { tDepth: { value: null }, uInvProj: { value: new THREE.Matrix4() }, uProj: { value: new THREE.Matrix4() }, uRes: { value: new THREE.Vector2() }, uRadius: { value: 0.9 }, uStrength: { value: 1 }, uTime: { value: 0 } };
    this.qAO = new FullScreenQuad(mk(AO_FS, this.aoU));
    this.aoBlurU = { tAO: { value: null }, tDepth: { value: null }, uDir: { value: new THREE.Vector2() }, uInvProj: { value: new THREE.Matrix4() } };
    this.qAOBlur = new FullScreenQuad(mk(AO_BLUR_FS, this.aoBlurU));
    this.compU = {
      tScene: { value: null }, tBloom: { value: null }, tAO: { value: null }, tExpo: { value: null }, tOverlay: { value: null }, tShafts: { value: null }, uShaft: { value: new THREE.Vector4(1, 1, 1, 0) },
      uExposure: { value: 1 }, uBloom: { value: 0.3 }, uVignette: { value: 0.3 }, uGrain: { value: 0.03 }, uTime: { value: 0 }, uChroma: { value: 0.0016 }, uSat: { value: 1 }, uContrast: { value: 1.05 },
      uLift: { value: new V3() }, uGain: { value: new V3(1, 1, 1) }, uTint: { value: new V3(1, 1, 1) }, uAO: { value: 0.6 }, uAutoExp: { value: 1 },
      uSharp: { value: 0.28 }, uTM: { value: (typeof location !== 'undefined' && /[?&]tm=([0-9.]+)/.exec(location.search)) ? +/[?&]tm=([0-9.]+)/.exec(location.search)[1] : 0 }, uDamage: { value: 0 }, uFlash: { value: this.flash }, uUnderwater: { value: 0 }, uRes: { value: new THREE.Vector2() }, uFrost: { value: 0 }, uLowHP: { value: 0 },
    };
    this.taaU = { tCur: { value: null }, tHist: { value: null }, tDepth: { value: null }, tAO: { value: null }, uInvVP: { value: new THREE.Matrix4() }, uPrevVP: { value: new THREE.Matrix4() }, uRes: { value: new THREE.Vector2() }, uAO: { value: 0 }, uReset: { value: 1 }, uHistW: { value: 0.92 } };
    this.qTAA = new FullScreenQuad(mk(TAA_FS, this.taaU));
    this.shaftU = { tEmit: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uDensity: { value: 0.92 }, uDecay: { value: 0.955 } }; this.qShaft = new FullScreenQuad(mk(SHAFT_FS, this.shaftU)); this.shaftPU = { tScene: { value: null }, tDepth: { value: null }, uTexel: { value: new THREE.Vector2() } }; this.qShaftPrep = new FullScreenQuad(mk(SHAFT_PREP_FS, this.shaftPU)); this.shaftK = 0; this._sunNdc = new V3();
    this.qComp = new FullScreenQuad(mk(COMP_FS, this.compU));
    this.reflU = { tColor: { value: null }, tDepth: { value: null }, uInvVP: { value: new THREE.Matrix4() }, uVP: { value: new THREE.Matrix4() }, uCam: { value: new V3() }, uLevel: { value: 0 }, uGrid: { value: new THREE.Vector2(2, 2) }, uPt: { value: 2 } };
    this.reflPoints = new THREE.Points(new THREE.BufferGeometry(), new THREE.ShaderMaterial({ vertexShader: REFL_VS, fragmentShader: REFL_FS, uniforms: this.reflU, depthTest: true, depthWrite: true, transparent: false, blending: THREE.NoBlending }));
    this.reflPoints.frustumCulled = false; this._reflScene = new THREE.Scene(); this._reflScene.add(this.reflPoints); this._reflCam = new THREE.Camera(); this._reflVP = new THREE.Matrix4(); this._cc = new THREE.Color();
    this.frameIdx = 0; this._P0 = new THREE.Matrix4(); this._V = new THREE.Matrix4(); this._VP = new THREE.Matrix4(); this._prevVP = new THREE.Matrix4(); this._prevValid = false; this._tmpM = new THREE.Matrix4(); this._pos0 = new V3(); this.histI = 0;
  },
  _allocTargets() {
    const r = this.renderer, q = this.q;
    const W = Math.max(2, Math.floor(this.canvas.width * this.renderScale * q.scale)), H = Math.max(2, Math.floor(this.canvas.height * this.renderScale * q.scale));
    this.W = W; this.H = H;
    for (const rt of [this.rtScene, this.rtAO, this.rtAO2, ...(this.bloomRT || []), this.rtExpoA, this.rtExpoB, this.rtShaft, this.rtShaftLo, this.rtRefl, ...(this.rtHist || [])]) rt?.dispose(); this.reflPoints?.geometry.dispose();
    const depth = new THREE.DepthTexture(W, H); depth.type = THREE.FloatType; depth.format = THREE.DepthFormat;
    this.rtScene = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, samples: q.aa === 'msaa' ? q.msaa : 0, depthBuffer: true, stencilBuffer: false, depthTexture: depth, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    const ho = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false }; this.rtHist = [new THREE.WebGLRenderTarget(W, H, ho), new THREE.WebGLRenderTarget(W, H, ho)]; this._taaReset = true; this._prevValid = false;
    const aw = Math.max(2, W >> 1), ah = Math.max(2, H >> 1);
    const aoOpt = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false };
    this.rtAO = new THREE.WebGLRenderTarget(aw, ah, aoOpt); this.rtAO2 = new THREE.WebGLRenderTarget(aw, ah, aoOpt);
    this.bloomRT = [];
    let w = W >> 1, h = H >> 1;
    for (let i = 0; i < q.bloomLevels; i++) { this.bloomRT.push(new THREE.WebGLRenderTarget(Math.max(2, w), Math.max(2, h), { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false })); w >>= 1; h >>= 1; }
    const eo = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false };
    this.rtShaft = new THREE.WebGLRenderTarget(Math.max(2, W >> 2), Math.max(2, H >> 2), { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false });
    this.rtShaftLo = new THREE.WebGLRenderTarget(Math.max(2, W >> 2), Math.max(2, H >> 2), { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false });
    this.rtExpoA = new THREE.WebGLRenderTarget(1, 1, eo); this.rtExpoB = new THREE.WebGLRenderTarget(1, 1, eo);
    { // planar reflection target (half res) + one point per texel of it
      const rw = Math.max(2, W >> 1), rh = Math.max(2, H >> 1);
      this.rtRefl = new THREE.WebGLRenderTarget(rw, rh, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true, generateMipmaps: false });
      const ids = new Float32Array(rw * rh); for (let i = 0; i < ids.length; i++) ids[i] = i;
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(ids, 1)); g.boundingSphere = new THREE.Sphere(new V3(), 1e9); g.boundingBox = new THREE.Box3(new V3(-1e9, -1e9, -1e9), new V3(1e9, 1e9, 1e9)); this.reflPoints.geometry = g; this.reflU.uGrid.value.set(rw, rh); G.uReflOn.value = 0;
    }
    this.resetExposure = true;
  },
  /** planar water reflection splat pass (see REFL_VS). Runs right after the world pass, only while a Water mesh was drawn this frame. */
  _renderRefl() {
    const r = this.renderer, cam = this.camera, u = this.reflU;
    if (!this.rtRefl || cam.position.y < G.reflLevel + 0.15) { G.uReflOn.value = 0; return; }
    const vp = this._reflVP.multiplyMatrices(this._P0, this._V); u.uVP.value.copy(vp); u.uInvVP.value.copy(vp).invert();
    u.tColor.value = this.rtScene.texture; u.tDepth.value = this.rtScene.depthTexture; u.uCam.value.copy(cam.position); u.uLevel.value = G.reflLevel; G.uReflLevelU.value = G.reflLevel;
    const ac = r.autoClear, ca = r.getClearAlpha(); r.getClearColor(this._cc);
    r.setRenderTarget(this.rtRefl); r.setClearColor(0x000000, 0); r.autoClear = true; r.render(this._reflScene, this._reflCam);
    r.setClearColor(this._cc, ca); r.autoClear = ac; r.setRenderTarget(this.rtScene);
    G.uReflTex.value = this.rtRefl.texture; G.uReflVP.value.copy(vp); G.uReflOn.value = 1;
  },
  resize() {
    const c = this.canvas, dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(c.clientWidth * dpr) || 1280, h = Math.floor(c.clientHeight * dpr) || 720;
    if (c.width !== w || c.height !== h || !this.rtScene) { this.renderer.setSize(w, h, false); this._allocTargets(); }
    const asp = w / h; this.camera.aspect = asp; this.camera.updateProjectionMatrix(); this.vmCamera.aspect = asp; this.vmCamera.updateProjectionMatrix();
    this.aspect = asp;
  },
  /** Compile every material (parallel compile) and render one un-culled frame so shadow-depth / instanced / skinned variants are built before gameplay. */
  async warmup() {
    const r = this.renderer, sc = this.scene; const saved = [];
    sc.traverse((o) => { if (o.frustumCulled !== undefined && (o.isMesh || o.isPoints || o.isLine || o.isSprite)) { saved.push([o, o.frustumCulled]); o.frustumCulled = false; } });
    try { await r.compileAsync(sc, this.camera); this.render(0.016, 0); this.render(0.016, 0.016); } finally { for (const [o, f] of saved) o.frustumCulled = f; }
    this.resetTAA(); this.resetExposure = true;
  },
  resetTAA() { this._taaReset = true; },
  setFov(f) { this.camera.fov = f; this.camera.updateProjectionMatrix(); },
  setVmFov(f) { this.vmCamera.fov = f; this.vmCamera.updateProjectionMatrix(); },
  setRenderScale(s) { if (Math.abs(s - this.renderScale) > 0.01) { this.renderScale = s; this._allocTargets(); } },

  // ---- shadow rig: keep the sun's shadow frustum centred (texel-snapped) on the focus point
  _updateSun() {
    const s = this.sun, sh = s.shadow, R = this.shadowRadius, dir = this._sunDir; if (!dir) return;
    const ts = (2 * R) / sh.mapSize.x;
    const cx = Math.round(this.shadowCenter.x / ts) * ts, cy = Math.round(this.shadowCenter.y / ts) * ts, cz = Math.round(this.shadowCenter.z / ts) * ts;
    if (Math.abs(cx - s.target.position.x) + Math.abs(cz - s.target.position.z) > 8) this._sunDirty = true; // teleport / stop change: never sample a map centred elsewhere
    s.target.position.set(cx, cy, cz); s.position.set(cx + dir.x * 120, cy + dir.y * 120, cz + dir.z * 120);   // always aim the light (shadow or not)
    s.target.updateMatrixWorld(); s.updateMatrixWorld();
    if (!this.sunShadowOn) return;
    const c = sh.camera; if (c.right !== R) { c.left = -R; c.right = R; c.top = R; c.bottom = -R; c.near = 1; c.far = 260; c.updateProjectionMatrix(); }
  },

  /** per-pass GPU profiler (gfx.profile = true): gfx.passMs = {name: ms} */
  _pb(name) { if (!this.profile || !this._timerExt || this._inQ) return null; const gl = this._gl, te = this._timerExt; const q = gl.createQuery(); gl.beginQuery(te.TIME_ELAPSED_EXT, q); this._inQ = true; return { name, q }; },
  _pe(h) { if (!h) return; this._gl.endQuery(this._timerExt.TIME_ELAPSED_EXT); this._inQ = false; (this._pending || (this._pending = [])).push(h); },
  _pcollect() { const gl = this._gl, te = this._timerExt; if (!this._pending) return; const out = this.passMs || (this.passMs = {}); while (this._pending.length) { const h = this._pending[0]; if (!gl.getQueryParameter(h.q, gl.QUERY_RESULT_AVAILABLE)) break; const dis = gl.getParameter(te.GPU_DISJOINT_EXT); if (!dis) { const ms = gl.getQueryParameter(h.q, gl.QUERY_RESULT) / 1e6; out[h.name] = lerp(out[h.name] ?? ms, ms, 0.08); } gl.deleteQuery(h.q); this._pending.shift(); } if (this._pending.length > 40) { for (const h of this._pending) gl.deleteQuery(h.q); this._pending.length = 0; } },

  // ---- frame
  render(dt, time) {
    const r = this.renderer, cam = this.camera;
    if (this._shaderErr && performance.now() - this._shaderErrT > 1500 && (this._shaderRetries || 0) < 3) {
      this._shaderRetries = (this._shaderRetries || 0) + 1; console.warn('[gfx] shader errors seen (' + this._shaderErr + '): recompiling all materials, try ' + this._shaderRetries); this._shaderErr = 0;
      this.scene.traverse((o) => { const m = o.material; if (m) for (const mm of Array.isArray(m) ? m : [m]) mm.needsUpdate = true; });
    }
    G.uTime.value = time;
    this.updateLights(dt, time, cam.position);
    this._updateSun();
    this.sky.update(cam.position);
    r.info.reset();
    // GPU timing
    const gl = this._gl, te = this._timerExt; let q = null;
    if (this.profile) { this._pcollect(); q = null; } else if (te) { // collect finished queries
      while (this._queries.length) { const qq = this._queries[0]; const ok = gl.getQueryParameter(qq, gl.QUERY_RESULT_AVAILABLE); const dis = gl.getParameter(te.GPU_DISJOINT_EXT); if (ok && !dis) { this.gpuMs = gl.getQueryParameter(qq, gl.QUERY_RESULT) / 1e6; this.gpuMsAvg = lerp(this.gpuMsAvg || this.gpuMs, this.gpuMs, 0.05); gl.deleteQuery(qq); this._queries.shift(); } else if (dis || this._queries.length > 6) { gl.deleteQuery(qq); this._queries.shift(); } else break; }
      if (this._queries.length < 4) { q = gl.createQuery(); gl.beginQuery(te.TIME_ELAPSED_EXT, q); }
    }
    // ---- TAA jitter (unjittered matrices are kept for reprojection)
    const taa = this.q.aa === 'taa'; const vmc = this.vmCamera;
    cam.clearViewOffset(); vmc.clearViewOffset(); this._V.copy(cam.matrixWorld).invert(); this._P0.copy(cam.projectionMatrix);
    if (taa) { const k = (this.frameIdx++ % 16) + 1; const jx = halton(k, 2) - 0.5, jy = halton(k, 3) - 0.5; cam.setViewOffset(this.W, this.H, jx, jy, this.W, this.H); vmc.setViewOffset(this.W, this.H, jx, jy, this.W, this.H); }
    // world pass
    let ph = this._pb('world+shadows');
    // shadow maps are amortised: sun on even frames, pooled spot shadows on odd frames (or immediately when a slot is re-assigned) -> half the shadow-pass draw calls; sampling stays consistent because the shadow matrix is only updated together with the map
    if (this.sunShadowOn && ((this._fc & 1) === 0 || this._sunDirty)) { this.sun.shadow.needsUpdate = true; this._sunDirty = false; }
    r.setRenderTarget(this.rtScene); r.autoClear = true; r.shadowMap.needsUpdate = true; G.uVM.value = 0; this._fc = (this._fc + 1) | 0;
    G.reflReq = G.reflWant !== null; if (G.reflReq) G.reflLevel = G.reflWant; cam.layers.set(0); r.render(this.scene, cam); this._pe(ph); ph = this._pb('reflection');
    if (G.reflReq) this._renderRefl(); else G.uReflOn.value = 0;
    this._pe(ph); ph = this._pb('viewmodel');
    // viewmodel pass (own FOV, cleared depth so it never clips into walls; shadow maps already rendered). Its pixels get alpha 0 = TAA mask.
    if (this.vmEnabled) { const envI = this.scene.environmentIntensity; this.scene.environmentIntensity = envI * this.vmEnv; r.autoClear = false; r.clearDepth(); G.uVM.value = 1; vmc.position.copy(cam.position); vmc.quaternion.copy(cam.quaternion); vmc.updateMatrixWorld(); const mwau = this.scene.matrixWorldAutoUpdate; this.scene.matrixWorldAutoUpdate = false; /* (matrices were just updated by the world pass) */ const sk = this._skipVis || (this._skipVis = []); sk.length = 0; for (const o of this.vmSkip) { sk.push(o, o.visible); o.visible = false; } r.render(this.scene, vmc); for (let i = 0; i < sk.length; i += 2) sk[i].visible = sk[i + 1]; this.scene.matrixWorldAutoUpdate = mwau; G.uVM.value = 0; r.autoClear = true; this.scene.environmentIntensity = envI; }
    this._pe(ph); ph = this._pb('ao');
    // AO
    const W = this.W, H = this.H, cu = this.compU;
    const useAO = this.q.ao && this.aoStrength > 0.01;
    if (useAO) {
      const au = this.aoU; au.tDepth.value = this.rtScene.depthTexture; au.uInvProj.value.copy(cam.projectionMatrixInverse); au.uProj.value.copy(cam.projectionMatrix);
      au.uRes.value.set(this.rtAO.width, this.rtAO.height); au.uTime.value = (time * 60) % 64;
      r.setRenderTarget(this.rtAO); this.qAO.render(r);
      const bu = this.aoBlurU; bu.tDepth.value = this.rtScene.depthTexture; bu.uInvProj.value.copy(cam.projectionMatrixInverse);
      bu.tAO.value = this.rtAO.texture; bu.uDir.value.set(1 / this.rtAO.width, 0); r.setRenderTarget(this.rtAO2); this.qAOBlur.render(r);
      bu.tAO.value = this.rtAO2.texture; bu.uDir.value.set(0, 1 / this.rtAO.height); r.setRenderTarget(this.rtAO); this.qAOBlur.render(r);
    }
    this._pe(ph); ph = this._pb('taa');
    // ---- TAA resolve (also applies AO so the AO noise is temporally averaged)
    let sceneTex = this.rtScene.texture;
    if (taa) {
      const tu = this.taaU; this._VP.multiplyMatrices(cam.projectionMatrix, this._V); tu.uInvVP.value.copy(this._VP).invert();
      this._tmpM.multiplyMatrices(this._P0, this._V); const cur0 = this._tmpM;
      let reset = this._taaReset || !this._prevValid; { const dp = cam.position.distanceToSquared(this._pos0); if (dp > 9) reset = true; }
      tu.uPrevVP.value.copy(this._prevValid ? this._prevVP : cur0); tu.uReset.value = reset ? 1 : 0; this._taaReset = false;
      tu.tCur.value = this.rtScene.texture; tu.tDepth.value = this.rtScene.depthTexture; tu.tHist.value = this.rtHist[1 - this.histI].texture; tu.tAO.value = useAO ? this.rtAO.texture : this.rtScene.texture; tu.uAO.value = useAO ? this.aoStrength : 0; tu.uRes.value.set(W, H);
      r.setRenderTarget(this.rtHist[this.histI]); this.qTAA.render(r); sceneTex = this.rtHist[this.histI].texture; this.histI ^= 1;
      this._prevVP.copy(cur0); this._prevValid = true; this._pos0.copy(cam.position);
    }
    cam.clearViewOffset(); vmc.clearViewOffset();
    // light shafts (quarter res radial scan toward the sun, occluded by scene depth)
    let shaftOn = false;
    if (this.shaftK > 0.01 && this.q.ao !== undefined) { const sd = this._sunDir; this._sunNdc.set(cam.position.x + sd.x * 1000, cam.position.y + sd.y * 1000, cam.position.z + sd.z * 1000).applyMatrix4(this._V); const fwd = -this._sunNdc.z; if (fwd > 1) { this._sunNdc.applyMatrix4(cam.projectionMatrix); this.shaftU.uSun.value.set(this._sunNdc.x * 0.5 + 0.5, this._sunNdc.y * 0.5 + 0.5); const fade = Math.max(0, 1 - Math.max(Math.abs(this._sunNdc.x), Math.abs(this._sunNdc.y)) * 0.55); shaftOn = fade > 0.02; this.compU.uShaft.value.w = this.shaftK * 0.32 * fade; this.shaftPU.tScene.value = sceneTex; this.shaftPU.tDepth.value = this.rtScene.depthTexture; this.shaftPU.uTexel.value.set(1 / this.rtShaftLo.width, 1 / this.rtShaftLo.height); r.setRenderTarget(this.rtShaftLo); this.qShaftPrep.render(r); this.shaftU.tEmit.value = this.rtShaftLo.texture; r.setRenderTarget(this.rtShaft); this.qShaft.render(r); this.compU.tShafts.value = this.rtShaft.texture; } }
    if (!shaftOn) { this.compU.uShaft.value.w = 0; this.compU.tShafts.value = this.rtShaft.texture; }
    this._pe(ph); ph = this._pb('bloom');
    // bloom: downsample chain
    const B = this.bloomRT; let src = sceneTex, sw = W, sh = H;
    const du = this.qDown.material.uniforms;
    for (let i = 0; i < B.length; i++) { du.tSrc.value = src; du.uTexel.value.set(1 / sw, 1 / sh); du.uKaris.value = i === 0 ? 1 : 0; r.setRenderTarget(B[i]); this.qDown.render(r); src = B[i].texture; sw = B[i].width; sh = B[i].height; }
    const uu = this.qUp.material.uniforms;
    r.autoClear = false;
    for (let i = B.length - 1; i > 0; i--) { uu.tSrc.value = B[i].texture; uu.uTexel.value.set(1 / B[i].width, 1 / B[i].height); uu.uWeight.value = 0.9; r.setRenderTarget(B[i - 1]); this.qUp.render(r); }
    r.autoClear = true;
    this._pe(ph); ph = this._pb('exposure');
    // auto exposure
    const eu = this.expoU; eu.tLum.value = B[Math.min(B.length - 1, 4)].texture; eu.tPrev.value = this.rtExpoA.texture; eu.uDt.value = Math.min(dt, 0.1); eu.uReset.value = this.resetExposure ? 1 : 0; this.resetExposure = false;
    r.setRenderTarget(this.rtExpoB); this.qExpo.render(r);
    const t = this.rtExpoA; this.rtExpoA = this.rtExpoB; this.rtExpoB = t;
    G.uExpoTex.value = this.rtExpoA.texture; // adapted exposure (1x1) for glow/beam shaders: they divide by max(1, exposure) so lamps don't white out in dark stops (NEVER read GPU results back on the CPU: getBufferSubData/readPixels stall the whole pipeline)
    this._pe(ph); ph = this._pb('composite');
    // composite to screen
    cu.tScene.value = sceneTex; cu.tBloom.value = B[0].texture; cu.tAO.value = useAO ? this.rtAO.texture : sceneTex; cu.uAO.value = (useAO && !taa) ? this.aoStrength : 0; cu.tExpo.value = this.rtExpoA.texture;
    cu.uTime.value = time; cu.uDamage.value = this.damage; cu.uLowHP.value = this.lowHP; cu.uUnderwater.value = this.underwater; cu.uRes.value.set(this.canvas.width, this.canvas.height);
    r.setRenderTarget(null); this.qComp.render(r); this._pe(ph);
    if (te && q) { gl.endQuery(te.TIME_ELAPSED_EXT); this._queries.push(q); }
    const inf = r.info; this.stats.calls = inf.render.calls; this.stats.tris = inf.render.triangles; this.stats.geoms = inf.memory.geometries; this.stats.tex = inf.memory.textures; this.stats.progs = inf.programs?.length || 0;
  },
};
