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
// Custom ShaderMaterials only need `fog: true`, UniformsLib.fog merged in and the fog chunks included.
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
  // x: time (s), y: wind strength 0..1, z/w: wind direction (unit, xz)
  uWind: { value: new SharedVec4(0, 0.4, 0.8, 0.6) },
};

const FOG_PARS_VERTEX = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vFogViewPos;
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
float stnHG01(float c, float g) {
  // Henyey-Greenstein normalised to 1 at c = 1
  float g2 = g * g;
  return pow((1.0 + g2 - 2.0 * g) / max(1e-4, 1.0 + g2 - 2.0 * g * c), 1.5);
}
vec3 stnFogColor(vec3 baseCol, vec3 dir) {
  float c = dot(dir, uSunDirW);
  float lobe = 0.75 * stnHG01(c, 0.8) + 0.25 * stnHG01(c, 0.35);
  return mix(baseCol, uFogSun, clamp(lobe * uMist.w, 0.0, 1.0));
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
    fogOD += stnMistOD(cameraPosition.y, cameraPosition.y + fogRay.y, fogL);
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
}

installGlobals();
