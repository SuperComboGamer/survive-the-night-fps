// Global shader state shared by every material, plus the replacement fog model.
//
// G.*: uniforms that every built-in material (Lambert, Basic, Standard, Sprite, Points, ...) and every
// ShaderMaterial that merges THREE.UniformsLib.fog or .lights receives BY REFERENCE. Update the
// `.value` fields (never reassign them) once per frame and every program sees the new values.
// This module must be imported before any material is created (main.js imports it first).
//
// Fog: replaces three's fog chunks. Keeps scene.fog (FogExp2) as the distance haze - so
// Environment.fogVisibility still bounds what must be drawn - and adds:
//  - a low-lying exponential mist layer that pools in valleys and over water (analytic integral
//    of density exp(-falloff * (y - base)) along the view ray),
//  - forward sun/moon in-scattering: haze towards the light glows with the light colour
//    (two-lobe Henyey-Greenstein), which is what makes backlit trees and dusk read as "real".
//  - a flare gun's flare overhead (client/game/skyflares.js): the haze lit by it, all round and most of all towards it.
// Custom ShaderMaterials only need `fog: true`, UniformsLib.fog merged in and the fog chunks included.
//
// PS1 mode (the "PS1 shader" setting, GameRenderer.setPs1): every fogged built-in material snaps its vertices
// to the pixel grid of the low-resolution frame, which is the polygon wobble of a console with no sub-pixel
// precision, and the fog closes in. The depth materials of the shadow passes include no fog chunk, so the
// shadow maps stay as they are.
import * as THREE from 'three';

// three clones uniform values per material; these return themselves so all programs share one value
class SharedVec3 extends THREE.Vector3 {
  clone() {
    return this;
  }
}
class SharedVec4 extends THREE.Vector4 {
  clone() {
    return this;
  }
}
class SharedColor extends THREE.Color {
  clone() {
    return this;
  }
}

export const G = {
  // x: mist density at its base (1/m), y: mist base height (m), z: mist falloff (1/m), w: sun scatter strength 0..1
  uMist: { value: new SharedVec4(0.0, 0.0, 0.3, 0.6) },
  // in-scattered light colour towards the sun/moon (linear, same units as fogColor)
  uFogSun: { value: new SharedColor(0, 0, 0) },
  // world-space unit vector towards the dominant light (sun by day, moon by night)
  uSunDirW: { value: new SharedVec3(0, 1, 0) },
  // x: sway clock (s, runs faster in strong wind), y: wind strength (~0.45 breeze .. ~1.1 gale),
  // z/w: direction the wind blows toward (unit, xz). Foliage.update drives it from the weather.
  uWind: { value: new SharedVec4(0, 0.4, 0.8, 0.6) },
  // PS1 mode. xy: half the frame size in pixels (0 = off, vertices are not snapped), z: extra fog (added share
  // of the optical depth). GameRenderer drives it.
  uPs1: { value: new SharedVec4(0, 0, 0, 0) },
  // a sky flare lighting the haze (linear, same units as fogColor; black: none) and the world-space unit vector from
  // the eye towards it. SkyFlares drives both
  uFlareFog: { value: new SharedColor(0, 0, 0) },
  uFlareDirW: { value: new SharedVec3(0, 1, 0) },
};

const FOG_PARS_VERTEX = /* glsl */ `
#define STN_PS1
uniform vec4 uPs1;
#ifdef USE_FOG
  varying vec3 vFogViewPos;
#endif
`;

// appended to three's project_vertex (vertices behind the eye are left alone: their triangles are clipped).
// A lit material's vertex then takes the depth of its own face (the plane through it square to its normal) where
// that face is seen at the snapped pixel: the snap moves where a face is drawn, never how far off it is. Snapped as
// it was, a face took up to a pixel's worth of its own slope in depth, and a room's plaster, 6 mm in front of the
// dark wall it lines, lost to that wall in wedges wherever it was seen edge on. Only the depth: w stays, so what is
// painted on a face wobbles as it did. (Not for a face seen too nearly edge on to find that point, nor for an
// orthographic camera.)
const PS1_SNAP_VERTEX = /* glsl */ `
#ifdef STN_PS1
  if (uPs1.x > 0.0 && gl_Position.w > 0.0) {
    vec2 ps1Ndc = floor(gl_Position.xy / gl_Position.w * uPs1.xy + 0.5) / uPs1.xy;
    gl_Position.xy = ps1Ndc * gl_Position.w;
    #if defined( LAMBERT ) || defined( PHONG ) || defined( STANDARD ) || defined( TOON )
    if (projectionMatrix[2][3] < -0.5) {
      vec3 ps1N = normalize(transformedNormal);
      vec3 ps1Ray = vec3((ps1Ndc.x + projectionMatrix[2][0]) / projectionMatrix[0][0], (ps1Ndc.y + projectionMatrix[2][1]) / projectionMatrix[1][1], -1.0);
      float ps1Across = dot(ps1N, ps1Ray);
      if (abs(ps1Across) > 0.03 * length(ps1Ray)) {
        vec4 ps1At = projectionMatrix * vec4(ps1Ray * (dot(ps1N, mvPosition.xyz) / ps1Across), 1.0);
        float ps1Z = ps1At.z / ps1At.w;
        if (ps1At.w > 0.0 && abs(ps1Z) < 1.0) gl_Position.z = ps1Z * gl_Position.w;
      }
    }
    #endif
  }
#endif
`;

const FOG_VERTEX = /* glsl */ `
#ifdef USE_FOG
  vFogViewPos = mvPosition.xyz;
#endif
`;

// shared by materials and the sky shader (which inlines it without USE_FOG)
export const FOG_FUNCS = /* glsl */ `
uniform vec4 uMist;
uniform vec3 uFogSun;
uniform vec3 uSunDirW;
uniform vec3 uFlareFog;
uniform vec3 uFlareDirW;
float stnHG01(float c, float g) {
  // Henyey-Greenstein normalised to 1 at c = 1
  float g2 = g * g;
  return pow((1.0 + g2 - 2.0 * g) / max(1e-4, 1.0 + g2 - 2.0 * g * c), 1.5);
}
vec3 stnFogColor(vec3 baseCol, vec3 dir) {
  float c = dot(dir, uSunDirW);
  float lobe = 0.75 * stnHG01(c, 0.8) + 0.25 * stnHG01(c, 0.35);
  vec3 col = mix(baseCol, uFogSun, clamp(lobe * uMist.w, 0.0, 1.0));
  // a flare overhead lights the haze all round, and most where the eye looks towards it
  return col + uFlareFog * (0.3 + 0.7 * stnHG01(dot(dir, uFlareDirW), 0.7));
}
// optical depth of the mist layer between two heights along a ray of length L
float stnMistOD(float y0, float y1, float L) {
  float b = uMist.z;
  float rho0 = uMist.x * exp(-min(b * (y0 - uMist.y), 40.0));
  float k = b * (y1 - y0);
  return abs(k) > 1e-3 ? rho0 * L * (1.0 - exp(-clamp(k, -40.0, 40.0))) / k : rho0 * L * (1.0 - 0.5 * k);
}
`;

const FOG_PARS_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform vec4 uPs1;
  varying vec3 vFogViewPos;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  ${FOG_FUNCS}
#endif
`;

const FOG_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  {
    // world-space ray from the camera (view -> world rotation is the transpose of viewMatrix)
    vec3 fogRay = (vec4(vFogViewPos, 0.0) * viewMatrix).xyz;
    float fogL = length(fogRay);
    vec3 fogDir = fogRay / max(fogL, 1e-4);
    #ifdef FOG_EXP2
      float fogOD = fogDensity * fogDensity * fogL * fogL;
    #else
      float fogOD = 3.0 * smoothstep(fogNear, fogFar, fogL);
    #endif
    // (the mist lies on the valley floor, not under it: down a drift of the mine it is no thicker than there)
    fogOD += stnMistOD(max(cameraPosition.y, uMist.y - 1.5), max(cameraPosition.y + fogRay.y, uMist.y - 1.5), fogL);
    fogOD *= 1.0 + uPs1.z;
    float fogFactor = 1.0 - exp(-fogOD);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, stnFogColor(fogColor, fogDir), fogFactor);
  }
#endif
`;

let installed = false;
export function installGlobals() {
  if (installed) return;
  installed = true;
  for (const lib of Object.values(THREE.ShaderLib)) Object.assign(lib.uniforms, G);
  Object.assign(THREE.UniformsLib.fog, G);
  Object.assign(THREE.UniformsLib.lights, G);
  THREE.ShaderChunk.fog_pars_vertex = FOG_PARS_VERTEX;
  THREE.ShaderChunk.fog_vertex = FOG_VERTEX;
  THREE.ShaderChunk.fog_pars_fragment = FOG_PARS_FRAGMENT;
  THREE.ShaderChunk.fog_fragment = FOG_FRAGMENT;
  THREE.ShaderChunk.project_vertex += PS1_SNAP_VERTEX;
}

installGlobals();
