// Zombie material: ONE MeshPhysicalMaterial program for every zombie (per-zombie clones only carry uniforms). Patched in
// onBeforeCompile like mats.js patch(): analytic height fog + sun in-scatter, sky-visibility masking of IBL, per-vertex AO — plus
// per-vertex material ids (skin, cloth, leather, rubber, metal, paint, hair, teeth, mouth, flesh, bone, emissive, glass, fur,
// crystal, rope, nail, plastic) with procedural detail evaluated in REST-POSE space (so it sticks to the body while animating):
// dead-skin mottling, livor mortis, veins, rot; painted eyes/lids/lips/brows/hair from anatomical landmarks; cloth weaves,
// denim twill, knit, stripes, oilskin; leather grain, scuffs; rust, chipped paint; per-zombie layers: up to 8 persistent wounds,
// wetness (clearcoat film + running rivulets), frost crust with glints, coal/rock dust, blood, char + glowing magma cracks,
// crystal-vein glow. Dismemberment hides whole regions (bitmask) in the vertex shader; the depth material does the same so
// severed limbs cast no shadow.
import * as THREE from 'three';
import { G, FOG_GLSL, NOISE_GLSL } from '../../core/mats.js';
import { HEAD_CENTER } from './rig.js';
import { CAP_MASK } from './mesh.js';
import { SKIN_PARS, SKIN_BRANCH, EYE_BRANCH, OTHER_BRANCHES, patchLightChunk } from './skinshade.js';
import { WEAVE } from './weave.js';

const f = (x) => x.toFixed(5);
/** global shader switches for every zombie material (quality levels / GPU ablation tests): setZombieShaderDefines({ZABL_NOISE:''}) */
export const ZSHADER = { defines: {}, key: '', mats: new Set() };
export function setZombieShaderDefines(defs = {}) { ZSHADER.defines = { ...defs }; ZSHADER.key = Object.keys(defs).sort().join(','); for (const m of ZSHADER.mats) { m.defines = { ...(m.userData.far ? { ZFAR: '' } : {}), ...ZSHADER.defines }; m.needsUpdate = true; } }
const HC = `vec3(${f(HEAD_CENTER.x)}, ${f(HEAD_CENTER.y)}, ${f(HEAD_CENTER.z)})`;

const VERT_PARS = /* glsl */`
attribute vec4 aCol; attribute vec4 aMat; attribute vec4 aMat2; attribute vec4 aAux;
varying vec3 vRest; varying vec3 vRestN; varying vec3 vZCol; varying vec4 vMat; varying vec4 vMat2; varying vec4 vAux;
varying vec3 vWPos; varying vec3 vWN;
uniform int uHide; uniform float uTime; uniform vec4 uZ[19];
#define uSwayP uZ[10]
`;
const VERT_BEGIN = /* glsl */`
vRest = position; vRestN = normal; vZCol = pow(aCol.rgb, vec3(2.2)); vMat = aMat; vMat2 = aMat2; vAux = aAux;
`;
// after skinning: sway (seaweed, flaps) in world axes; hide dismembered regions
const VERT_SWAY = /* glsl */`
{ float sw = aAux.z / 255.0; if (sw > 0.0) { float ph = dot(position, vec3(7.1, 3.3, 5.7)) + uSwayP.w; float amp = sw * (0.018 + 0.03 * uSwayP.y);
  transformed += vec3(sin(uTime * 2.3 + ph) * amp - uSwayP.x * sw * 0.06, -abs(sin(uTime * 1.7 + ph)) * amp * 0.3, cos(uTime * 1.9 + ph * 1.3) * amp - uSwayP.z * sw * 0.06); } }
`;
const VERT_HIDE = /* glsl */`
{ int reg = int(aAux.y + 0.5); if ((((uHide >> reg) & 1) != 0) || (reg == 29 && ((uHide >> 1) & 1) != 0)) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }
`;

const FRAG_PARS = /* glsl */`
varying vec3 vRest; varying vec3 vRestN; varying vec3 vZCol; varying vec4 vMat; varying vec4 vMat2; varying vec4 vAux;
varying vec3 vWPos; varying vec3 vWN;
uniform float uTime; uniform float uAmbOcc; uniform sampler2D uWeave;
uniform vec4 uZ[19]; // packed per-zombie block (see packZ): seed/skyVis, skin tint, layers, layers2, glow, emissive, hair, hair2, style, face, sway, wounds[8]
#define uSeed uZ[0].x
#define uSkyVis uZ[0].y
#define uSkinTint uZ[1].xyz
#define uLayers uZ[2]
#define uLayers2 uZ[3]
#define uGlow uZ[4]
#define uEmis uZ[5]
#define uHair uZ[6]
#define uHair2 uZ[7]
#define uStyle uZ[8]
#define uFace uZ[9]
${FOG_GLSL}
${NOISE_GLSL}
${SKIN_PARS}
float zfb2(vec3 p){ return 0.47 + ((0.5 * texture(uNoise3, p * 0.125).r + 0.25 * texture(uNoise3, p * 0.2537 + vec3(0.37, 0.11, 0.53)).g) * 1.25 - 0.47) * 0.85; }
float zfb1(vec3 p){ return 0.47 + (texture(uNoise3, p * 0.125).r - 0.5) * 0.6; } // one fetch, fbm-like distribution
#ifndef ZOLDNOISE
#define zfbm3(p) zfb1(p)   // one fetch: the 4-octave fbm was ~1/3 of the zombie fragment texture work in a close swarm
#endif
#ifdef ZFAR
#undef zfbm3
#define zfbm3(p) zfb1(p)
#endif
#ifdef ZABL_NOISE
#undef zfbm3
#define zfbm3(p) zvn3(p)
#endif
#ifdef ZABL_PL
#undef NUM_POINT_LIGHTS
#define NUM_POINT_LIGHTS ZABL_PL
#endif
#ifdef ZABL_SL
#undef NUM_SPOT_LIGHTS
#define NUM_SPOT_LIGHTS ZABL_SL
#endif
const vec3 HC = ${HC};
float zh1(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float ridge(vec3 p){ return 1.0 - abs(zvn3(p) * 2.0 - 1.0); }
// cellular (F1, F2-F1) for cracks / char plates
vec2 cell3(vec3 p){ vec3 i = floor(p), fr = fract(p); float d1 = 8.0, d2 = 8.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec3 g = vec3(float(x), float(y), float(z)); vec3 o = vec3(zh1(i + g), zh1(i + g + 17.3), zh1(i + g + 41.9)); vec3 r = g + o - fr; float d = dot(r, r); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
  return vec2(sqrt(d1), sqrt(d2) - sqrt(d1)); }
vec3 zPerturb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir){
  vec3 vSigmaX = normalize(dFdx(surf_pos)); vec3 vSigmaY = normalize(dFdy(surf_pos)); vec3 vN = surf_norm;
  vec3 R1 = cross(vSigmaY, vN); vec3 R2 = cross(vN, vSigmaX); float fDet = dot(vSigmaX, R1) * faceDir;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2); return normalize(abs(fDet) * surf_norm - vGrad); }
float aaFade(float period, float fp){ return 1.0 - smoothstep(period * 0.25, period * 0.6, fp); }
#ifdef ZOLDNOISE
#define zvnF(p, per) zvn3(p)
#else
#define zvnF(p, per) (fp < (per) ? zvn3(p) : 0.5)
#endif
`;

// The surface model. Inputs: vRest, vRestN, vZCol, vMat, vMat2, vAux.  Outputs: zAlb, zRough, zMetal, zH (bump, metres),
// zEmis, zCC (clearcoat), zCCR, zSheen, zSheenR, zAO.
const SURFACE = /* glsl */`
vec3 P = vRest; vec3 Nr = normalize(vRestN); vec3 q = P - HC;
float fp = length(fwidth(P)) + 1e-5;   // pixel footprint in rest metres (for band-limiting procedural detail)
int id = int(vMat.x + 0.5);
float zRough = vMat.y / 255.0, zMetal = vMat.z / 255.0, param = vMat.w / 255.0;
float wear = vMat2.x / 255.0, dirt = vMat2.y / 255.0; int pat = int(vMat2.z + 0.5); float psc = vMat2.w / 255.0;
vec3 zAlb = vZCol; float zH = 0.0; vec3 zEmis = vec3(0.0); float zCC = 0.0, zCCR = 0.35; vec3 zSheen = vec3(0.0); float zSheenR = 0.6;
float zAO = vAux.x / 255.0; float frostExp = vAux.w / 255.0;
vec3 S = P * 1.0 + vec3(uSeed * 7.13, uSeed * 3.71, uSeed * 5.17);
bool porous = false; bool isSkin = false; bool faceHair = false;
float headZone = step(length(q), 0.15) * step(-0.12, q.y);

#ifndef ZABL_SURF
${SKIN_BRANCH}else if (id == 1 || id == 15) { // ---------------- cloth / rope
  porous = true;
  float s = 1.0, h = 0.0;
  // weaves at real thread scale (1.5-3 mm repeats) with thread irregularity; band-limited so they fade to their mean at distance
  float slub = zvn3(S * vec3(30.0, 400.0, 30.0));
  vec3 an = abs(Nr); vec2 wuv = (an.z > an.x && an.z > an.y) ? P.xy : ((an.x > an.y) ? P.zy : P.xz); vec4 wv = texture(uWeave, wuv * 40.0); // fabric micro-structure: 2.5 cm tile = 8 threads (shared texture, mip-faded)
  float wf = 1.0 - smoothstep(0.0035, 0.008, fp), bk = -1.0;
  if (pat == 1 || pat == 0) { h = wv.r; s = 0.0009; bk = wf; zAlb *= (0.93 + 0.14 * slub) * (1.0 + (wv.r - 0.5) * 0.22 * wf); }
  else if (pat == 2) { h = wv.g; s = 0.0011; bk = wf; zAlb *= (0.82 + 0.32 * zvn3(S * vec3(4.0, 160.0, 4.0))) * (1.0 + (wv.g - 0.5) * 0.26 * wf); } // denim twill + slubs + fading
  else if (pat == 3) { h = wv.r; s = 0.0012; bk = wf; zAlb *= (0.9 + 0.2 * slub) * (1.0 + (wv.r - 0.5) * 0.26 * wf); }
  else if (pat == 4) { h = wv.b; s = 0.0015; bk = wf; zAlb *= 1.0 + (wv.b - 0.5) * 0.32 * wf; }
  else if (pat == 6) { float b = step(0.5, fract(P.y * 9.0)); zAlb = mix(zAlb, vec3(0.03), b * 0.9); h = wv.r; s = 0.0009; bk = wf; zAlb *= 1.0 + (wv.r - 0.5) * 0.3 * wf; }
  else if (pat == 7) { float b = step(0.5, fract(P.y * 12.0)) + step(0.5, fract((P.x + P.z) * 12.0)); zAlb *= b == 1.0 ? 0.6 : (b > 1.5 ? 0.35 : 1.0); vec3 t = S * 700.0; h = sin(t.x) * sin(t.y); s = 0.0008; }
  else if (pat == 8) { h = zfbm3(S * vec3(30.0, 8.0, 30.0)); s = 0.0022; zCC = 0.4; zCCR = 0.32; zRough = clamp(zRough, 0.45, 0.6) - h * 0.1; porous = false; zAlb *= 0.85 + 0.2 * h; } // oilskin: waxy satin, not lacquer (no neon glare)
  else if (pat == 9) { float fl = zvn3(S * vec3(180.0, 40.0, 180.0) + zvn3(S * 20.0) * 3.0); h = fl; s = 0.003; zAlb *= 0.7 + 0.5 * fl; zSheen = zAlb * 1.2; zSheenR = 0.35; }
  else if (pat == 10) { vec3 g = abs(fract(S * 90.0) - 0.5); float grid = smoothstep(0.43, 0.5, max(g.x, g.y)); h = grid * 0.65 + wv.r * 0.35; s = 0.001; bk = max(wf, 0.45 * (1.0 - smoothstep(0.006, 0.02, fp))); zAlb *= (1.0 - grid * 0.11 * bk) * (1.0 + (wv.r - 0.5) * 0.12 * wf); } // ripstop: visible grid + nylon weave
  else if (pat == 11) { h = wv.a; s = 0.0024; bk = wf; zAlb *= 0.78 + 0.5 * wv.a; zSheen = zAlb * 0.9; zSheenR = 0.4; } // fleece nap
  else if (pat == 12) { // hi-vis: fluorescent + reflective bands
    float band = smoothstep(0.012, 0.009, abs(fract(P.y * 5.2) - 0.5)); zAlb = mix(zAlb, vec3(0.7), band); zRough = mix(zRough, 0.2, band); zMetal = band * 0.6; zEmis += zAlb * 0.04 * (1.0 - band);
    h = wv.r * (1.0 - band); s = 0.0008; bk = wf; }
  else if (pat == 5) { float baf = abs(fract(P.y * 9.0) - 0.5); h = smoothstep(0.5, 0.35, baf); s = 0.0007; zSheen = zAlb * 0.5; zCC = 0.2; zCCR = 0.4; h += 0.5 * wv.r; bk = wf; } // quilted shell: baffles are geometry, this is the nylon weave
  zH += h * s * (bk >= 0.0 ? bk : aaFade(s * 3.0, fp));
  if (pat != 8 && pat != 5) zRough = max(zRough, 0.86); if (pat == 5) { zRough = max(zRough, 0.62); zCC = 0.03; } // cloth: low, broad specular (no plastic / latex gloss)
  if (id == 15) { float tw = sin((P.x + P.y + P.z) * 900.0); zH += tw * 0.0006; }
  // drape: long vertical folds + a few horizontal compression folds (4-8 cm) that shade at 5 m
  float dr = zvn3(vec3(P.x * 16.0, P.y * 3.0, P.z * 16.0) + uSeed); float dh = zvn3(vec3(P.x * 5.0, P.y * 22.0, P.z * 5.0) + uSeed * 1.7);
  zH += (dr - 0.5) * 0.0018 + (dh - 0.5) * 0.0009; zAO *= 0.92 + 0.16 * dr; // real folds / baffles are geometry now (cloth.js + folds.js): only a faint painted drape remains
  // grime gradients: hems / trouser bottoms, knees, seat, collar, elbows, and every crease (AO)
  float knee = smoothstep(0.1, 0.0, abs(P.y - 0.5)) * smoothstep(0.1, -0.2, Nr.z), hemD = smoothstep(0.34, 0.06, P.y), collar = smoothstep(1.4, 1.52, P.y);
  float elbow = smoothstep(0.07, 0.0, length(vec2(abs(P.x) - 0.36, P.y - 1.12))), seat = smoothstep(0.08, 0.0, abs(P.y - 0.88)) * smoothstep(0.1, 0.4, Nr.z);
  float grime = clamp((knee * 0.8 + hemD + collar * 0.6 + elbow * 0.7 + seat * 0.5) * (0.35 + dirt) + (1.0 - zAO) * 0.7, 0.0, 1.0) * (0.55 + 0.45 * zfbm3(S * 7.0));
  zAlb = mix(zAlb, zAlb * vec3(0.32, 0.28, 0.24), grime * 0.85); zRough = mix(zRough, 0.95, grime * 0.4);
  // sewn-on patches (per zombie): two rectangles picked by the seed on knees / elbows / chest / thigh
  for (int k = 0; k < 2; k++) {
    float hk = fract(uSeed * (3.17 + float(k) * 5.31)); vec3 pc = hk < 0.25 ? vec3(0.1, 0.5, -0.06) : hk < 0.5 ? vec3(0.36, 1.12, 0.03) : hk < 0.75 ? vec3(0.09, 1.25, -0.1) : vec3(0.11, 0.74, -0.08);
    vec2 d2 = abs(vec2(abs(P.x) - pc.x, P.y - pc.y)) - vec2(0.045, 0.05) * (0.8 + 0.4 * fract(hk * 7.0)); float bx = max(d2.x, d2.y);
    float inP = smoothstep(0.002, -0.002, bx) * step(abs(P.z - pc.z), 0.09) * step(0.5, fract(hk * 13.0 + float(k)));
    zAlb = mix(zAlb, zAlb * (fract(hk * 3.0) < 0.5 ? vec3(0.62, 0.58, 0.5) : vec3(1.25, 1.1, 0.95)), inP); zH += inP * 0.0008 - smoothstep(0.003, 0.0, abs(bx)) * inP * 0.0006;
  }
  // fading, sun bleach on raised parts, wear at edges, stains, tears showing skin
  float n = zfb2(S * 5.0);
  zAlb *= 0.75 + 0.5 * n;
  float stain = smoothstep(0.55, 0.7, zfbm3(S * 3.0 + 5.0)) * (0.4 + dirt);
  zAlb = mix(zAlb, zAlb * vec3(0.45, 0.4, 0.32), stain * 0.75); zRough = mix(zRough, 0.55, stain * 0.4);
  // rips: ragged (domain-warped, stretched along the weave), dark inside (shadowed skin / lining), frayed lighter edges
  float tn = zfbm3(S * vec3(6.0, 2.8, 6.0) + zvn3(S * 22.0) * 0.55 + 1.7) + wear * 0.08;
  float tear = smoothstep(0.725, 0.74, tn) * wear * 0.3 * step(0.2, P.y); // (ragged holes are geometry now; this is only thin worn patches)
  float tearEdge = smoothstep(0.67, 0.715, tn) * wear * 0.5 * step(0.2, P.y) - tear;
  zAlb = mix(zAlb, mix(uSkinTint * vec3(0.2, 0.22, 0.18), vec3(0.16, 0.025, 0.025), smoothstep(0.76, 0.8, tn)), tear); zH -= tear * 0.003; zAO *= 1.0 - tear * 0.45;
  zAlb = mix(zAlb, zAlb * 1.25 + 0.015, tearEdge * 0.5 * smoothstep(0.4, 0.7, zvnF(S * 700.0, 0.00429)));
  // construction details (flags in param): 1 placket+buttons, 2 chest pockets, 4 torso seams, 8 trouser details, 16 knee patches,
  // 32 zip instead of buttons
  int fl = int(param * 255.0 + 0.5);
#ifdef ZFAR
  fl = 0;
#endif
  if (fl != 0) {
    float frontN = smoothstep(-0.15, -0.5, Nr.z), backN = smoothstep(0.15, 0.5, Nr.z); float ax = abs(P.x); float det = 0.0, rh = 0.0;
    if ((fl & 1) != 0 && P.y > 0.82 && P.y < 1.44) {
      float pk = smoothstep(0.019, 0.017, ax) * frontN;
      det += (smoothstep(0.0012, 0.0, abs(ax - 0.018)) + smoothstep(0.0009, 0.0, abs(P.x + 0.012)) * 0.7) * frontN; rh += pk * 0.0005;
      if ((fl & 32) != 0) { float zm = smoothstep(0.0045, 0.003, ax) * frontN; zAlb = mix(zAlb, vec3(0.3, 0.29, 0.27), zm); zMetal = mix(zMetal, 0.85, zm); zRough = mix(zRough, 0.35, zm); rh += zm * (0.0003 + 0.0003 * sin(P.y * 2600.0)); }
      else {
        float fb = fract((P.y - 1.395) / 0.088) - 0.5; vec2 bd = vec2(P.x + 0.001, fb * 0.088); float br = length(bd);
        float btn = smoothstep(0.0066, 0.0054, br) * frontN * step(P.y, 1.41);
        float holes = btn * (smoothstep(0.0011, 0.0006, length(bd - vec2(0.0017, 0.0))) + smoothstep(0.0011, 0.0006, length(bd + vec2(0.0017, 0.0))));
        zAlb = mix(zAlb, vec3(0.12, 0.105, 0.085) * (0.8 + 0.4 * zvn3(S * 90.0)), btn); zAlb *= 1.0 - holes * 0.7; zRough = mix(zRough, 0.35, btn); zCC = max(zCC, btn * 0.5);
        rh += btn * 0.0011 * (1.0 - br / 0.0066 * 0.5) - holes * 0.0004; zSheen *= 1.0 - btn;
      }
    }
    if ((fl & 2) != 0) { // chest patch pockets with button-down flaps
      vec2 pc = vec2(ax - 0.088, P.y - 1.282); vec2 dq = abs(pc) - vec2(0.041, 0.05); float bx = max(dq.x, dq.y);
      float inside = smoothstep(0.001, -0.001, bx) * frontN; float fl0 = abs(pc.y - 0.028);
      det += (smoothstep(0.0022, 0.0006, abs(bx)) + smoothstep(0.0016, 0.0, fl0) * step(abs(pc.x), 0.041)) * frontN;
      rh += inside * (0.0006 + step(0.028, pc.y) * 0.0005); zAO *= 1.0 - smoothstep(0.004, 0.0, pc.y - 0.024) * step(pc.y, 0.028) * inside * 0.35;
      vec2 pb = vec2(ax - 0.088, P.y - 1.296); float pbt = smoothstep(0.0055, 0.0045, length(pb)) * frontN; zAlb = mix(zAlb, vec3(0.12, 0.105, 0.085), pbt); rh += pbt * 0.001;
    }
    if ((fl & 4) != 0) { // side seams + shoulder seams
      det += smoothstep(0.0022, 0.0006, abs(P.z - 0.012)) * step(0.9, P.y) * step(P.y, 1.42) * step(0.1, ax);
      det += smoothstep(0.0022, 0.0006, abs(P.z - 0.02)) * step(1.42, P.y) * step(0.07, ax) * step(ax, 0.21) * step(0.3, Nr.y);
    }
    if ((fl & 8) != 0 && P.y < 1.03) { // waistband, fly, belt loops, back pockets, leg side seams
      det += smoothstep(0.0016, 0.0, abs(P.y - 0.955)) * step(0.93, P.y);
      det += frontN * step(0.84, P.y) * step(P.y, 0.955) * smoothstep(0.0016, 0.0, abs(P.x - 0.024));
      float la = atan(P.x, -(P.z - 0.015)); float lp = abs(fract(la / 0.9 + 0.5) - 0.5) * 0.9; float loop = step(0.957, P.y) * step(P.y, 1.0) * smoothstep(0.075, 0.06, lp); rh += loop * 0.0012; det += smoothstep(0.08, 0.07, lp) * step(0.957, P.y) * step(P.y, 1.0) * (1.0 - loop);
      vec2 bp = vec2(ax - 0.085, P.y - 0.895); vec2 dq = abs(bp) - vec2(0.05, 0.052); float bb = max(dq.x, dq.y);
      det += smoothstep(0.0022, 0.0006, abs(bb)) * backN; rh += smoothstep(0.001, -0.001, bb) * 0.0006 * backN;
      det += smoothstep(0.975, 0.993, Nr.x * sign(P.x)) * step(P.y, 0.86) * step(0.14, P.y) * 0.6; // outseam
    }
    if ((fl & 16) != 0) { vec2 kp = vec2(ax - 0.093, P.y - 0.49); vec2 dq = abs(kp) - vec2(0.05, 0.068); float kb = max(dq.x, dq.y); float kin = smoothstep(0.001, -0.001, kb) * frontN;
      zAlb = mix(zAlb, zAlb * vec3(0.72, 0.7, 0.66), kin); det += smoothstep(0.0022, 0.0006, abs(kb)) * frontN; rh += kin * 0.0009; }
    float st = clamp(det, 0.0, 1.0) * aaFade(0.004, fp);
    zAlb *= 1.0 - st * 0.4; zH += rh - st * 0.00035; zAO *= 1.0 - st * 0.2;
  }
  float gr = dirt * (0.35 * (1.0 - zAO) + 0.65 * smoothstep(0.35, 0.75, zfbm3(S * 4.0 + 2.0)) * (0.4 + 0.6 * smoothstep(1.0, 0.1, P.y)));
  zAlb = mix(zAlb, vec3(0.05, 0.042, 0.032), clamp(gr, 0.0, 0.8));
  if (pat != 9 && pat != 11 && pat != 5) { zSheen = max(zSheen, zAlb * 0.62); zSheenR = 0.7; } // grazing-angle fibre fuzz rim
}
else if (id == 2) { // ---------------- leather
  porous = true;
  float grain = zvnF(S * 900.0, 0.00333); float crease = smoothstep(0.9, 0.98, ridge(S * vec3(60.0, 220.0, 60.0))) * aaFade(0.006, fp);
  zH += (grain - 0.5) * 0.00008 * aaFade(0.002, fp) - crease * 0.0004;
  float scuff = smoothstep(0.62, 0.85, zfbm3(S * 9.0)) * wear; zAlb = mix(zAlb * (0.88 + 0.2 * zvn3(S * 6.0)), zAlb * 1.35 + 0.02, scuff * 0.5); zRough = mix(zRough, 0.75, scuff);
  zAlb *= 1.0 - crease * 0.25; zCC = 0.1 * (1.0 - scuff); zCCR = 0.45; zRough = max(zRough, 0.6);
  float mud = dirt * smoothstep(0.35, 0.02, P.y) * (0.5 + 0.5 * zfbm3(S * 9.0)); zAlb = mix(zAlb, vec3(0.06, 0.05, 0.038), clamp(mud * 1.3, 0.0, 0.9)); zRough = mix(zRough, 0.95, mud);
}
else if (id == 3) { // ---------------- rubber
  zH += (zvnF(S * 400.0, 0.00750) - 0.5) * 0.00008; zAlb *= 0.9 + 0.2 * zvn3(S * 10.0);
  float dst = smoothstep(0.4, 0.8, zfbm3(S * 7.0)) * (0.3 + dirt); zAlb = mix(zAlb, vec3(0.16, 0.15, 0.13), dst * 0.45); zRough = mix(zRough, 0.95, dst);
  float mud = dirt * smoothstep(0.3, 0.02, P.y); zAlb = mix(zAlb, vec3(0.05, 0.045, 0.035), clamp(mud, 0.0, 0.8));
}
else if (id == 4) { // ---------------- metal (raw / galvanised / brass) with rust
  float rust = smoothstep(0.55, 0.75, zfbm3(S * 9.0) + wear * 0.25) * wear;
  float scr = smoothstep(0.93, 0.99, ridge(S * vec3(200.0, 20.0, 60.0))) * aaFade(0.004, fp);
  zAlb = mix(zAlb, vec3(0.16, 0.07, 0.035) * (0.7 + 0.6 * zvn3(S * 60.0)), rust); zMetal = mix(zMetal, 0.15, rust); zRough = mix(zRough, 0.88, rust) - scr * 0.2;
  zAlb = mix(zAlb, zAlb * 1.4, scr * (1.0 - rust)); zH += rust * (zvn3(S * 150.0) - 0.5) * 0.0005;
  float gr = dirt * (1.0 - zAO) * 1.3; zAlb = mix(zAlb, vec3(0.04, 0.035, 0.03), clamp(gr, 0.0, 0.8)); zMetal *= 1.0 - gr * 0.6;
}
else if (id == 5 || id == 18) { // ---------------- paint on metal/fibreglass (helmets) / plastic (mascots)
  float chip = smoothstep(0.66, 0.675, zfbm3(S * 34.0) * 0.8 + zvn3(S * 120.0) * 0.2 + wear * 0.27) * wear * (id == 5 ? 1.0 : 0.5);
  float scr = smoothstep(0.94, 0.99, ridge(S * vec3(160.0, 30.0, 160.0))) * wear * aaFade(0.004, fp);
  zAlb = mix(zAlb * (0.92 + 0.16 * zvn3(S * 20.0)), vec3(0.18, 0.17, 0.16), chip); zMetal = mix(zMetal, 0.8, chip * param); zRough = mix(zRough, 0.5, chip); zH -= chip * 0.0004;
  zAlb = mix(zAlb, zAlb * 0.6 + 0.08, scr);
  zCC = (id == 5 ? 0.08 : 0.14) * (1.0 - chip); zCCR = 0.5; zRough = max(zRough, id == 5 ? 0.55 : 0.5); // matte paint / plastic (no mirror coat)
  if (id == 18 && param > 0.01) { vec2 cr = cell3(S * vec3(9.0, 9.0, 9.0)); /* 27-cell search only when the plastic is actually cracked */ float crack = smoothstep(0.035, 0.0, cr.y) * smoothstep(0.35, 0.6, zvn3(S * 3.0)) * param * 3.0; zAlb = mix(zAlb, vec3(0.02), clamp(crack, 0.0, 0.95)); zH -= crack * 0.001; zCC *= 1.0 - crack; }
  float gr = dirt * (0.5 * (1.0 - zAO) + 0.5 * smoothstep(0.5, 0.8, zfbm3(S * 5.0)) + 0.5 * smoothstep(0.3, 0.9, Nr.y) * (0.3 + zfbm3(S * 9.0))); zAlb = mix(zAlb, vec3(0.05, 0.045, 0.04), clamp(gr, 0.0, 0.85)); zCC *= 1.0 - gr;
}
${EYE_BRANCH}${OTHER_BRANCHES}else if (id == 11) { // emissive (lamp lens / indicator)
  zEmis += zAlb * param * 16.0 * uEmis.w; zAlb = zAlb * 0.3; zRough = 0.15; zCC = 1.0; zCCR = 0.05;
}
else if (id == 12) { // glass (goggles, lamp lens cover)
  zAlb = vec3(0.02); zRough = 0.04; zCC = 1.0; zCCR = 0.03; zMetal = 0.0;
  float grime = smoothstep(0.5, 0.8, zfbm3(S * 20.0)) * (0.3 + dirt); zAlb += vec3(0.05, 0.045, 0.04) * grime; zRough += grime * 0.4;
  float crk = smoothstep(0.97, 0.995, ridge(S * 60.0)) * wear; zAlb += crk * 0.3;
}
else if (id == 13) { // plush fur (mascot suits)
  vec3 fl = S * vec3(160.0, 55.0, 160.0); float fib = zvn3(fl + zvn3(S * 18.0) * 4.0); float clump = zfbm3(S * 14.0);
  zAlb *= 0.55 + 0.6 * fib * (0.6 + 0.4 * clump); zH += (fib - 0.5) * 0.0025 * aaFade(0.01, fp); zSheen = zAlb * 1.6 + 0.02; zSheenR = 0.3;
  float matted = smoothstep(0.55, 0.75, zfbm3(S * 4.0)) * (0.4 + dirt); zAlb = mix(zAlb, zAlb * vec3(0.45, 0.4, 0.33), matted);
}
else if (id == 14) { // crystal growth: faceted, glowing from within
  float fac = zvn3(S * 40.0); vec2 cr = cell3(S * 20.0);
  zAlb = zAlb * (0.3 + 0.4 * fac); zRough = 0.08 + 0.1 * fac; zCC = 1.0; zCCR = 0.03; zH += cr.y * 0.001;
  float pulse = 0.75 + 0.25 * sin(uTime * 2.1 + uSeed * 6.0 + P.y * 8.0);
  zEmis += vZCol * (param * 16.0) * uEmis.w * pulse * (0.45 + 0.8 * smoothstep(0.08, 0.0, cr.y) + 0.4 * fac);
}


#endif
#ifndef ZABL_LAYERS
// ---------------- per-zombie layers
// wounds (rest space; persistent)
for (int i = 0; i < 8; i++) {
  vec4 w = uZ[11 + i]; if (w.w <= 0.0) continue;
  float wt = floor(w.w); vec3 d3 = P - w.xyz; float d = length(d3); float R = w.w - wt;
  if (d > R * 4.0) continue;
  if (wt >= 3.0) { // bandage: dirty wrapped cloth with a blood seep, raised
    float band = smoothstep(R, R * 0.85, d); float wrap = 0.5 + 0.5 * sin((d3.y + d3.x * 0.4) * 520.0);
    zAlb = mix(zAlb, mix(vec3(0.52, 0.48, 0.4), vec3(0.3, 0.26, 0.2), zfbm3(P * 60.0)) * (0.85 + 0.15 * wrap), band); zH += band * (0.002 + wrap * 0.0003); zRough = mix(zRough, 0.95, band);
    zAlb = mix(zAlb, vec3(0.22, 0.02, 0.02), band * smoothstep(0.5, 0.2, d / R) * smoothstep(0.4, 0.7, zfbm3(P * 30.0 + 3.0))); zSheen *= 1.0 - band; zMetal *= 1.0 - band;
    continue;
  }
  if (wt >= 2.0) { // bite: bruised ring of torn punctures around a ragged dark centre
    float ringD = abs(length(d3 * vec3(1.0, 1.4, 1.0)) - R * 0.55); float ang = atan(d3.y, d3.x + d3.z);
    float marks = smoothstep(R * 0.14, 0.0, ringD) * smoothstep(0.1, 0.35, abs(fract(ang * 1.9) - 0.5)) ;
    float bruise = smoothstep(R * 1.6, R * 0.6, d);
    zAlb = mix(zAlb, zAlb * vec3(0.35, 0.18, 0.28), bruise * 0.8); zAlb = mix(zAlb, vec3(0.1, 0.008, 0.01), clamp(marks + smoothstep(R * 0.3, R * 0.15, d), 0.0, 1.0));
    zH -= marks * 0.0015; zRough = mix(zRough, 0.25, marks); continue;
  }
  float core = smoothstep(R, R * 0.35, d + (zvn3(P * 400.0) - 0.5) * R * 0.5);
  float bruise = smoothstep(R * 1.9, R * 0.9, d) * (1.0 - core);
  float drip = smoothstep(R * 0.9, 0.0, abs(d3.x + d3.z * 0.3 + sin(d3.y * 60.0) * 0.004)) * smoothstep(0.0, -R * 3.5, d3.y) * smoothstep(-R * 4.0, -R * 1.0, d3.y) * step(d3.y, 0.0);
  float stain = max(smoothstep(R * 2.4, R, d) * 0.7, drip) * (1.0 - core);
  vec3 blood = porous ? vec3(0.08, 0.004, 0.004) : vec3(0.14, 0.006, 0.006);
  zAlb = mix(zAlb, zAlb * vec3(0.4, 0.22, 0.28), bruise * (isSkin ? 0.7 : 0.0));
  zAlb = mix(zAlb, blood, clamp(stain * (porous ? 0.85 : 0.7), 0.0, 1.0)); zRough = mix(zRough, porous ? 0.55 : 0.25, stain); zCC = max(zCC, stain * (porous ? 0.2 : 0.6));
  zAlb = mix(zAlb, vec3(0.22, 0.012, 0.015) * (0.6 + 0.6 * zvn3(P * 900.0)), core); zRough = mix(zRough, 0.18, core); zCC = max(zCC, core * 0.9); zCCR = min(zCCR, 0.1); zMetal *= 1.0 - core;
  if (wt >= 1.0) { // open wound: glistening muscle with exposed bone (ribs / spine run horizontally on the torso)
    // curved, irregular rib bones (not a regular stripe pattern), dark cavity between them
    float rph = (P.y + abs(P.x) * abs(P.x) * 2.2 + (zvn3(P * 60.0) - 0.5) * 0.012) / 0.03;
    float bone = core * smoothstep(0.26, 0.06, abs(fract(rph) - 0.5)) * smoothstep(0.85, 0.35, d / R) * smoothstep(0.3, 0.55, zvn3(P * 35.0 + 2.0));
    zAlb = mix(zAlb, vec3(0.08, 0.01, 0.012), core * (1.0 - bone) * 0.55); zAO *= 1.0 - core * (1.0 - bone) * 0.5;
    zAlb = mix(zAlb, vec3(0.46, 0.38, 0.27) * (0.75 + 0.35 * zvn3(P * 500.0)), bone); zH += bone * 0.0025; zRough = mix(zRough, 0.45, bone);
  }
  zH -= core * 0.003 * (1.0 - d / R); zEmis *= 1.0 - core; zSheen = mix(zSheen, vec3(0.25, 0.01, 0.01), core);
}
// burn: charred crust + glowing magma cracks
if (uLayers2.x > 0.0) {
  vec3 Sw = S * vec3(18.0, 15.0, 18.0) + zvn3(S * 7.0) * 1.2;  // domain-warped so the fissures meander
  vec2 c = cell3(Sw); vec2 c2 = cell3(S * 55.0 + 7.0);
  float cov = smoothstep(0.3, 0.6, zfbm3(S * 3.0) + uLayers2.x * 0.45) * uLayers2.x;
  if (id == 4 || id == 12 || id == 11) cov *= 0.25;
  float crackMask = isSkin ? 1.0 : 0.0;
  float crack = smoothstep(0.045, 0.0, c.y) * smoothstep(0.35, 0.7, zvn3(S * 9.0 + 3.0)) * crackMask;      // only some cell edges glow
  float fine = smoothstep(0.03, 0.0, c2.y) * 0.6 * crackMask * smoothstep(0.55, 0.8, zvn3(S * 14.0));
  vec3 ch = vec3(0.022, 0.019, 0.017) * (0.55 + 0.9 * zvn3(S * 90.0));
  zAlb = mix(zAlb, ch, cov * (1.0 - max(crack, fine) * 0.9)); zRough = mix(zRough, 0.92, cov); zH += cov * ((zvn3(S * 120.0) - 0.5) * 0.001 - crack * 0.0015); zCC *= 1.0 - cov; zSheen *= 1.0 - cov;
  float fl = 0.7 + 0.3 * sin(uTime * 3.1 + c.x * 20.0 + uSeed * 9.0) * sin(uTime * 1.7 + P.y * 13.0);
  zEmis += vec3(4.2, 1.3, 0.2) * max(crack, fine) * cov * fl * (0.8 + uLayers2.x) * uEmis.w * (0.35 + 0.65 * uStyle.w) /* dimmer in bright stops (no bloom wash) */ + vec3(0.5, 0.1, 0.015) * cov * crackMask * smoothstep(0.12, 0.0, c.y) * 0.25 * uEmis.w;
}
// crystal infection: glowing veins on skin
if (uLayers2.y > 0.0 && isSkin) {
  float vr = ridge(S * vec3(12.0, 5.0, 12.0) + zvn3(S * 6.0)); float cv = smoothstep(0.9, 0.975, vr) * uLayers2.y * smoothstep(0.35, 0.6, zfbm3(S * 2.5 + 4.0));
  float pulse = 0.7 + 0.3 * sin(uTime * 2.1 + uSeed * 6.0 + P.y * 8.0);
  zEmis += uEmis.rgb * cv * 3.0 * pulse * uEmis.w; zAlb = mix(zAlb, uEmis.rgb * 0.2, cv * 0.5);
}
// coal / rock dust (dry, black, glinting)
if (uLayers.z > 0.0) {
  float n = zfbm3(S * 5.0 + 1.0);
  float cov = clamp(uLayers.z * (0.8 + (n - 0.5) * 0.7) + (1.0 - zAO) * 0.35 * uLayers.z + smoothstep(0.8, 0.1, P.y) * 0.25 * uLayers.z, 0.0, 1.0);
  // sweat / wipe streaks: vertical runs where the dust was washed or wiped off (skin and face)
  float sweat = isSkin ? smoothstep(0.62, 0.85, zvn3(vec3(S.x * 40.0, S.y * 4.0, S.z * 40.0))) * smoothstep(0.45, 0.7, zfbm3(S * 3.0 + 7.0)) : 0.0;
  cov *= 1.0 - sweat * 0.55;
  if (id == 11 || id == 14 || id == 12) cov *= 0.1;
  if (id == 17 || (headZone > 0.5 && isSkin && length((q - vec3(sign(q.x) * 0.032, -0.0205, -0.0825)) * vec3(1.0, 1.6, 1.0)) < 0.0135)) cov *= 0.25; // eyes stay pale
  zAlb = mix(zAlb, zAlb * 0.1 + vec3(0.011, 0.0105, 0.01), cov); zRough = mix(zRough, 0.78, cov * 0.7); zCC *= 1.0 - cov; zMetal *= 1.0 - cov * 0.7; zSheen *= 1.0 - cov;
  float gl = step(0.985, zh1(floor(S * 700.0))) * cov * aaFade(0.0015, fp); zRough = mix(zRough, 0.15, gl); zAlb += gl * 0.05;
}
// frost crust (Whiteout): up-facing, edges, exposed; rime on hair
if (uLayers.y > 0.0) {
  // patchy crust: mostly on up-facing surfaces, creases (low AO) and hair / brows / stubble (rime); vertical skin stays mostly bare
  float up = smoothstep(-0.1, 0.9, Nr.y); float n = zfbm3(S * 6.0 + 4.0), nf = zvn3(S * 40.0);
  float cov = uLayers.y * frostExp * (up * 0.6 + (faceHair ? 0.55 : 0.0) + (1.0 - zAO) * 0.3 + 0.08) + (n - 0.47) * 0.55 * uLayers.y + (nf - 0.5) * 0.12;
  cov = smoothstep(0.28, 0.62, cov) * 0.94; if (id == 11) cov *= 0.2;
  float cry = zvnF(S * 900.0, 0.00333); float glint = step(0.93, zh1(floor(S * 1300.0))) * aaFade(0.001, fp);
  zAlb = mix(zAlb, vec3(0.72, 0.78, 0.84) * (0.85 + 0.2 * cry), cov); zRough = mix(zRough, 0.55 - glint * 0.5, cov); zMetal *= 1.0 - cov; zH += cov * (cry - 0.5) * 0.0012 * aaFade(0.004, fp);
  zCC = mix(zCC, 0.35, cov); zCCR = mix(zCCR, 0.2, cov); zSheen *= 1.0 - cov; zAlb += glint * cov * 0.6;
}
// wetness (Last Ferry): darker porous surfaces, water film (clearcoat), running rivulets + droplets
if (uLayers.x > 0.0) {
  float wet = uLayers.x * (0.75 + 0.25 * zvn3(S * 3.0));
  if (porous) zAlb *= mix(1.0, 0.55, wet);
  zRough = mix(zRough, zRough * 0.55, wet); zCC = max(zCC, wet * (porous ? 0.38 : 0.8)); zCCR = mix(zCCR, 0.12, wet); // soaked cloth: dark + satin, not latex
  float riv = smoothstep(0.82, 0.98, ridge(vec3(vWPos.x * 38.0, vWPos.y * 3.0 + uTime * 0.8, vWPos.z * 38.0) + zvn3(S * 8.0))) * wet * smoothstep(0.9, 0.3, abs(normalize(vWN).y));
  zH += riv * 0.0004; zRough = mix(zRough, 0.02, riv); zAlb *= 1.0 - riv * 0.2;
  float drop = smoothstep(0.55, 0.9, zvnF(S * 260.0, 0.01154)) * wet * aaFade(0.004, fp); zH += drop * 0.0003; zRough = mix(zRough, 0.02, drop);
  zSheen *= 1.0 - wet * 0.7;
}
// general blood spatter (feeding) on hands/chest
if (uLayers.w > 0.0) {
  float sp = smoothstep(0.72, 0.8, zfbm3(S * 11.0 + 3.0)) * uLayers.w * (0.3 + 0.7 * smoothstep(1.0, 1.4, P.y)) * (id == 11 || id == 12 ? 0.0 : 1.0);
  zAlb = mix(zAlb, vec3(0.07, 0.004, 0.004), sp * 0.85); zRough = mix(zRough, 0.35, sp);
}
#endif
zAlb = min(zAlb, vec3(0.6)); // whites never clip (albedo ceiling ~0.6)
zRough = clamp(zRough, 0.03, 1.0); zMetal = clamp(zMetal, 0.0, 1.0);
// thin parts (ears, nose, fingers) for the warm back-scatter term
float zThin = 0.0;
if (isSkin) { zThin = headZone * (smoothstep(0.062, 0.075, abs(q.x)) * step(-0.045, q.y) * step(q.y, 0.035) + smoothstep(-0.1, -0.115, q.z) * smoothstep(0.02, 0.01, abs(q.x)) * step(-0.085, q.y) * step(q.y, -0.03))
  + smoothstep(0.34, 0.42, abs(P.x)) * step(P.y, 1.02) * 0.22; }
`;

/** create the zombie material for one body. MeshStandardMaterial (no clearcoat / sheen lobes — far cheaper per pixel): the wet
 *  film is folded into roughness, cloth sheen / skin back-scatter / sky rim are one cheap fresnel term on the received light.
 *  far = true compiles the LOD2 variant (#define ZFAR: fine sub-pixel detail skipped). */
export function createZombieMaterial(u, far = false) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0 });
  m.userData.u = u; m.userData.far = far; m.defines = { ...(far ? { ZFAR: '' } : {}), ...ZSHADER.defines }; ZSHADER.mats.add(m);
  m.customProgramCacheKey = () => (far ? 'zombie-far-v3' : 'zombie-v3') + ZSHADER.key;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uTime: G.uTime, uFogColor: G.uFogColor, uFogScatter: G.uFogScatter, uFogParams: G.uFogParams, uSunDir: G.uSunDir, uAmbOcc: G.uAmbOcc, uNoise3: G.uNoise3 }, { uHide: u.uHide, uZ: u.uZ, uWeave: { get value() { return WEAVE.value; } } });
    let vs = shader.vertexShader, fs = shader.fragmentShader;
    vs = vs.replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n' + VERT_BEGIN)
      .replace('#include <skinning_vertex>', '#include <skinning_vertex>\n' + VERT_SWAY)
      .replace('#include <skinnormal_vertex>', '#include <skinnormal_vertex>\n vWN = normalize(mat3(modelMatrix) * objectNormal);')
      .replace('#include <project_vertex>', '#include <project_vertex>\n' + VERT_HIDE)
      .replace('#include <fog_vertex>', '#include <fog_vertex>\n vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    fs = fs.replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + SURFACE + '\n diffuseColor.rgb = zAlb;')
      // wet film / clearcoat → smoother, glossier roughness (one specular lobe instead of two)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(zRough, max(zCCR, 0.07), clamp(zCC, 0.0, 1.0) * 0.8);')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = zMetal;')
      .replace('#include <lights_physical_pars_fragment>', patchLightChunk(THREE.ShaderChunk.lights_physical_pars_fragment))
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (gHair > 0.5) { gHairT = normalize(vNormal); vec3 Vh = normalize(vViewPosition); normal = normalize(Vh - gHairT * dot(Vh, gHairT)); }
        { vec2 dH = vec2(dFdx(zH), dFdy(zH)) / vec2(max(length(dFdx(vViewPosition)), 1e-6), max(length(dFdy(vViewPosition)), 1e-6)); dH = clamp(dH, vec2(-3.0), vec2(3.0)); normal = zPerturb(-vViewPosition, normal, dH, faceDirection); }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance = zEmis;')
      .replace('iblIrradiance += getIBLIrradiance( geometryNormal );', 'iblIrradiance += getIBLIrradiance( geometryNormal ) * mix(1.0, uSkyVis, uAmbOcc);')
      .replace('radiance += iblRadiance;', 'radiance += iblRadiance * mix(1.0, uSkyVis, uAmbOcc) * mix(1.0, zAO, 0.7) * (gSSS > 0.0 ? 0.55 : 1.0);')
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= zAO; reflectedLight.directDiffuse *= mix(1.0, zAO, 0.35);`)
      // cheap velvet / back-scatter / rim: fresnel × light actually received (works under sun, lamps and flashlights alike)
      .replace('#include <opaque_fragment>', `{ float ndv = clamp(dot(geometryNormal, normalize(vViewPosition)), 0.0, 1.0); float fr = pow(1.0 - ndv, 4.0); // geometric normal: no speckle on bumps
          vec3 Ein = reflectedLight.directDiffuse / max(diffuseColor.rgb, vec3(0.04)) + reflectedLight.indirectDiffuse * 0.4 / max(diffuseColor.rgb, vec3(0.04));
          if (gSSS > 0.0) Ein = min(Ein, vec3(1.6)); // skin / mucosa: albedo-independent, no red glow rims
          outgoingLight += fr * Ein * (zSheen * 0.7 + zThin * vec3(0.12, 0.03, 0.02));
          outgoingLight += fr * uFogColor * 0.06 * (1.0 - uStyle.w) * zAO; }
        #include <opaque_fragment>`)
      .replace('#include <fog_fragment>', 'gl_FragColor.rgb = applyFog(gl_FragColor.rgb, vWPos); gl_FragColor.a = 0.6; /* TAA marker: dynamic skinned body (see gfx.js TAA resolve) */');
    shader.vertexShader = vs; shader.fragmentShader = fs;
  };
  return m;
}

/** copy the per-zombie parameters into the packed uZ array (called once per frame per visible body; three uploads it with one
 *  uniform4fv, and skips it entirely when nothing changed) */
export function packZ(u) {
  const a = u.uZ.value; const v4 = (i, v) => { a[i * 4] = v.x; a[i * 4 + 1] = v.y; a[i * 4 + 2] = v.z; a[i * 4 + 3] = v.w ?? 0; };
  a[0] = u.uSeed.value; a[1] = u.uSkyVis.value; v4(1, u.uSkinTint.value); v4(2, u.uLayers.value); v4(3, u.uLayers2.value); v4(4, u.uGlow.value); v4(5, u.uEmis.value);
  v4(6, u.uHair.value); v4(7, u.uHair2.value); v4(8, u.uStyle.value); v4(9, u.uFace.value); v4(10, u.uSwayP.value); const W = u.uWounds.value; for (let i = 0; i < 8; i++) v4(11 + i, W[i]);
}
/** per-zombie uniform block (JS-side fields; packZ packs them into uZ) */
export function makeUniforms() {
  return {
    uHide: { value: CAP_MASK }, uSeed: { value: Math.random() * 10 }, uSkinTint: { value: new THREE.Vector3(1, 1, 1) },
    uLayers: { value: new THREE.Vector4(0, 0, 0, 0) },   // wet, frost, dust, blood
    uLayers2: { value: new THREE.Vector4(0, 0, 0, 0) },  // burn, crystal, decay(unused), fade
    uGlow: { value: new THREE.Vector4(1.0, 0.55, 0.15, 0) }, uEmis: { value: new THREE.Vector4(1, 0.8, 0.5, 1) },
    uHair: { value: new THREE.Vector4(0.05, 0.04, 0.035, 0.8) }, uHair2: { value: new THREE.Vector4(0.3, 0.6, 1, 0) },
    uWounds: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, 0, 0)) }, uSkyVis: { value: 1 },
    uStyle: { value: new THREE.Vector4(0.7, 0, 0, 0) }, uSwayP: { value: new THREE.Vector4(0, 0, 0, 0) },
    uFace: { value: new THREE.Vector4(0, 0, 0, 0) }, // moustache, sideburns, age lines, torn cheek (±1 = side)
    uZ: { value: new Float32Array(19 * 4) },
  };
}

/** depth material (shadow maps) honouring the hidden-region mask */
export function createDepthMaterial(u) {
  const m = new THREE.MeshDepthMaterial();
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uHide = u.uHide;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aAux; uniform int uHide;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n' + VERT_HIDE);
  };
  m.customProgramCacheKey = () => 'zombie-depth-v1';
  return m;
}
