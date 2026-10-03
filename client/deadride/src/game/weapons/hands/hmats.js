// Materials of the hands (4 draw calls): glove (knit back + synthetic-leather palm + TPR + velcro + thread), bare skin, field-jacket sleeve, hardware
// (watch steel, dial, lume, leather strap). Textures come from the GPU synth (materials.js modes 13-16, 1024 px, mip-mapped, detail normals);
// zone weights / wear / dirt / perforation / AO travel in vertex attributes (aZ, aX) written by the geometry builders (kit.js). Procedural relief
// (TPR ridges, cuff rib, perforation holes) is derivative-bump-mapped in the fragment shader with true metric slopes.
import * as THREE from 'three';
import { canvasTexture } from '../../../core/canvas2d.js';
import { GUN_MAT_DEFS } from '../materials.js';

/** shared per-frame light-rig outputs (written by viewmodel.js, read by the hand shaders) */
export const HAND_LIGHT = { wb: { value: new THREE.Vector3(1, 1, 1) }, lume: { value: 1 } };

const COMMON = /* glsl */`
varying vec4 vZ; varying vec4 vX; varying vec4 vJ; uniform vec3 uWB; uniform float uLume;
vec3 zPerturb(vec3 sp, vec3 sn, vec2 dh, float fd){ vec3 sx = normalize(dFdx(sp)), sy = normalize(dFdy(sp)); vec3 r1 = cross(sy, sn), r2 = cross(sn, sx); float fdet = dot(sx, r1) * fd; vec3 g = sign(fdet) * (dh.x * r1 + dh.y * r2); return normalize(abs(fdet) * sn - g); }
vec2 zSlope(float h){ return vec2(dFdx(h) / max(length(dFdx(vViewPosition)), 1e-6), dFdy(h) / max(length(dFdy(vViewPosition)), 1e-6)); }
`;
const VS_DECL = 'attribute vec4 aZ; attribute vec4 aX; attribute vec4 aJ; varying vec4 vZ; varying vec4 vX; varying vec4 vJ;';
// pose-driven bunching: at a bent joint linear-blend skinning collapses the girth (inner side pinches to r*(1+cos)/2); push the skin back out along its
// rest normal in proportion to the bend angle (volume compensation), keep the dorsal fabric taut over the knuckle and ripple the palmar side into creases.
const BEND_VS = /* glsl */`
uniform float uBend[32];
float zBend(out float slope) {
  slope = 0.0; float jid = aJ.x; if (jid < 0.5) return 0.0;
  int idx = int(jid + 0.5) + (skinIndex.x > 17.5 ? 16 : 0); float b = uBend[idx]; if (b < 0.03) return 0.0;
  float pr = aJ.y, sg = aJ.z, ax = aJ.w; float b01 = clamp(b / 1.55, 0.0, 1.0);
  float comp = 0.0095 * (1.0 - cos(min(b, 2.4))) * 0.5; float pal = smoothstep(0.1, 0.9, -sg), dor = smoothstep(0.1, 0.9, sg);
  float d = comp * pr * (0.62 * pal + 0.78 * dor + 0.7 * max(0.0, 1.0 - pal - dor));
  float ph = 6.2831853 * ax / 0.0026; d += pal * b01 * 0.00065 * sin(ph) * pr; d -= dor * b01 * 0.0002 * pr;
  slope = pal * b01 * 0.00065 * 2416.0 * cos(ph) * pr; return d;
}`;

const BLOCK = {
  glove: /* glsl */`{
  float wL = vZ.x, wT = vZ.y, wV = step(0.5, vZ.z), wH = step(1.5, vZ.z), wTh = step(0.5, vZ.w); float wO = clamp(wT + wV + wTh, 0.0, 1.0);
  vec2 uvm = vMapUv * uTileK; vec2 uvl = vMapUv * uLS;
  vec4 lt = texture2D(uLMap, uvl); vec4 lo = texture2D(uLOrm, uvl); vec3 ln = texture2D(uLNrm, uvl).xyz * 2.0 - 1.0;
  vec3 nGeo = normalize(vNormal);
  vec3 albedo = mix(diffuseColor.rgb, lt.rgb * vColor.rgb, wL);
  albedo = mix(albedo, texture2D(map, vMapUv * 1.9).rgb * vColor.rgb * 1.2, wV);
  albedo = mix(albedo, albedo * 0.62, wH); albedo = mix(albedo, vColor.rgb, clamp(wT + wTh, 0.0, 1.0));
  float rf = mix(roughnessFactor, lo.g, wL); rf = mix(rf, 0.5, wT); rf = mix(rf, mix(0.93, 0.98, wH), wV); rf = mix(rf, 0.62, wTh);
  vec3 nrm = normal; vec3 nL = normalize(tbn * vec3(ln.xy * 0.9 * uLNS, ln.z)); nrm = normalize(mix(nrm, nL, wL)); nrm = normalize(mix(nrm, nGeo, wO));
  float hp = 0.0; float ph = 6.2831853 * uvm.x / 0.0024; float rib = vX.z * (1.0 - wL) * (1.0 - wO);
  hp += rib * 0.0005 * (0.5 + 0.5 * cos(ph)); albedo *= 1.0 - rib * 0.2 * (0.5 - 0.5 * cos(ph));
  hp += wT * 0.0004 * pow(0.5 + 0.5 * cos(ph), 1.4);
  float perf = vX.z * wL; vec2 gq = uvm / 0.0031; gq.y /= 0.866; gq.x += 0.5 * mod(floor(gq.y), 2.0); vec2 fq = fract(gq) - 0.5; float hd = length(fq * vec2(0.0031, 0.0031 * 0.866));
  float hole = (1.0 - smoothstep(0.00042, 0.00058, hd)) * perf; hp -= hole * 0.0008; albedo *= 1.0 - 0.85 * hole; rf = mix(rf, 0.95, hole);
  float nz = zvn3(vLoc * 220.0); float polish = wL * vX.x * smoothstep(0.3, 0.65, nz + 0.25); albedo *= 1.0 - 0.34 * polish; rf = mix(rf, 0.42, polish);
  float scuff = wT * vX.x * smoothstep(0.55, 0.78, zvn3(vLoc * 160.0)); albedo *= 1.0 + 1.6 * scuff; rf = min(1.0, rf + 0.3 * scuff);
  float pill = (1.0 - wL) * (1.0 - wO) * vX.x * smoothstep(0.55, 0.8, zvn3(vLoc * 700.0)); albedo += 0.035 * pill;
  float nA = zfbm3(vLoc * 60.0); float dirt = vX.y * (0.5 + 0.5 * nA); albedo *= 1.0 - 0.36 * dirt; rf = min(1.0, rf + 0.08 * dirt);
  albedo *= 0.9 + 0.2 * nA;
  diffuseColor.rgb = albedo; roughnessFactor = rf; normal = zPerturb(-vViewPosition, nrm, zSlope(hp), faceDirection); }`,
  sleeve: /* glsl */`{
  float nA = zfbm3(vLoc * 30.0); float dirt = vX.y * (0.5 + 0.5 * nA); diffuseColor.rgb *= 1.0 - 0.42 * dirt; roughnessFactor = min(1.0, roughnessFactor + 0.05 * dirt);
  float wr = vX.x * smoothstep(0.42, 0.75, zvn3(vLoc * 110.0)); diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.3 + 0.012, wr);
  diffuseColor.rgb *= 0.92 + 0.16 * nA; }`,
  skin: /* glsl */`{
  float bl = 0.5 + 0.5 * zvn3(vLoc * 30.0); diffuseColor.rgb *= vec3(1.0 + 0.04 * bl, 1.0 - 0.01 * bl, 1.0 - 0.04 * bl);
  float dirt = vX.y * (0.4 + 0.6 * zvn3(vLoc * 90.0)) * smoothstep(0.35, 0.7, zvn3(vLoc * 55.0 + 3.0)); diffuseColor.rgb *= 1.0 - 0.3 * dirt * vec3(0.9, 1.0, 1.1); }`,
  hw: /* glsl */`{
  float wD = vZ.x, wS = vZ.y, wLu = vZ.z, wK = vZ.w; vec3 col = vColor.rgb; vec4 dm = texture2D(map, vMapUv);
  float br = zvn3(vLoc * vec3(650.0, 40.0, 650.0)); float brushed = vX.z;
  float rgh = mix(0.14, 0.38, brushed) + 0.1 * br * brushed; float met = 1.0;
  vec3 leath = col * (0.8 + 0.4 * zvn3(vLoc * 1300.0)) * (0.85 + 0.3 * zfbm3(vLoc * 140.0));
  col = mix(col, leath, wS); rgh = mix(rgh, 0.52 + 0.2 * zvn3(vLoc * 260.0), wS); met = mix(met, 0.0, wS);
  col = mix(col, dm.rgb, wD); rgh = mix(rgh, 0.1, wD); met = mix(met, 0.0, wD);
  col = mix(col, col * 0.9, wLu); rgh = mix(rgh, 0.5, wLu); met = mix(met, 0.0, wLu);
  float sc = smoothstep(0.55, 0.8, zfbm3(vLoc * 500.0)) * vX.x * (1.0 - wD); col *= 1.0 - 0.25 * sc * (1.0 - wS); rgh = min(1.0, rgh + 0.2 * sc);
  diffuseColor.rgb = col; roughnessFactor = rgh; metalnessFactor = met;
  totalEmissiveRadiance += vec3(0.55, 0.95, 0.62) * wLu * 0.22 * uLume;
  normal = zPerturb(-vViewPosition, normal, zSlope((br - 0.5) * 0.00006 * brushed + wS * 0.0002 * (zvn3(vLoc * 500.0) - 0.5)), faceDirection); }`,
};

function patchHand(mat, kind, U) {
  const base = mat.onBeforeCompile, key = mat.customProgramCacheKey();
  mat.onBeforeCompile = (sh) => {
    base(sh); Object.assign(sh.uniforms, U, { uWB: HAND_LIGHT.wb, uLume: HAND_LIGHT.lume });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + VS_DECL).replace('#include <skinning_pars_vertex>', '#include <skinning_pars_vertex>\n' + (kind === 'glove' ? BEND_VS : '')).replace('#include <begin_vertex>', '#include <begin_vertex>\n vZ = aZ; vX = aX; vJ = aJ;' + (kind === 'glove' ? ' { float zs; float zd = zBend(zs); transformed += normalize(normal) * zd; }' : ''));
    if (kind === 'glove') sh.vertexShader = sh.vertexShader.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n { float zs; float zd = zBend(zs); objectNormal = normalize(objectNormal + vec3(0.0, 0.0, zs)); }');
    const decl = kind === 'glove' ? 'uniform sampler2D uLMap; uniform sampler2D uLNrm; uniform sampler2D uLOrm; uniform float uLS; uniform float uLNS; uniform float uTileK;\n' : '';
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + decl + COMMON)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + BLOCK[kind])
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n reflectedLight.indirectDiffuse *= vX.w; reflectedLight.indirectSpecular *= mix(1.0, vX.w, 0.85);')
      .replace('#include <opaque_fragment>', (kind === 'sleeve' ? 'outgoingLight *= pow(uWB, vec3(1.9));' : 'outgoingLight *= uWB;') + '\n#include <opaque_fragment>');
  };
  mat.customProgramCacheKey = () => key + '|hand:' + kind; mat.vertexColors = true; mat.needsUpdate = true; return mat;
}

/** the four hand materials (created once per material library) */
export function handMaterials(mats) {
  if (mats.__hand) return mats.__hand;
  const D = GUN_MAT_DEFS; const tileK = D.gloveKnit.tile, tileL = D.gloveLeather.tile;
  const U = { uBend: { value: new Float32Array(32) }, uLMap: { value: null }, uLNrm: { value: null }, uLOrm: { value: null }, uLS: { value: tileK / tileL }, uLNS: { value: 1 }, uTileK: { value: tileK } };
  const glove = mats.get('gloveKnit', { variant: ':hand' });
  const sL = mats.set('gloveLeather'); U.uLMap.value = sL.map; U.uLNrm.value = sL.normalMap; U.uLOrm.value = sL.orm;
  if (sL.deferred) (sL.users || (sL.users = [])).push(() => ({ set map(v) { U.uLMap.value = v; }, set normalMap(v) { U.uLNrm.value = v; }, set roughnessMap(v) { U.uLOrm.value = v; }, set metalnessMap(v) {}, set aoMap(v) {} }));
  patchHand(glove, 'glove', U);
  const sleeve = patchHand(mats.get('sleeveRip', { variant: ':hand' }), 'sleeve', {});
  const skin = patchHand(mats.get('handSkin', { variant: ':hand' }), 'skin', {});
  // hardware: steel / dial / lume / leather strap in one draw; the dial artwork is a canvas texture
  const dial = canvasTexture(512, 512, drawDial, { srgb: true, aniso: 8 });
  const hw = mats.basic('handHW', { color: 0xffffff, roughness: 0.3, metalness: 1, map: dial });
  hw.userData.isHW = true; patchHand(hw, 'hw', {});
  return (mats.__hand = { glove, skin, sleeve, hw, U });
}

function drawDial(c, W, H) {
  const R = W / 2; c.translate(R, R); c.fillStyle = '#0b0c0d'; c.fillRect(-R, -R, W, H);
  const g = c.createRadialGradient(0, 0, R * 0.1, 0, 0, R); g.addColorStop(0, 'rgba(255,255,255,0.05)'); g.addColorStop(1, 'rgba(0,0,0,0.25)'); c.fillStyle = g; c.fillRect(-R, -R, W, H);
  c.strokeStyle = '#d9d9d2'; c.lineCap = 'butt';
  for (let i = 0; i < 60; i++) { const a = i / 60 * Math.PI * 2; const big = i % 5 === 0; c.lineWidth = big ? 5 : 2.5; c.beginPath(); c.moveTo(Math.sin(a) * R * 0.965, -Math.cos(a) * R * 0.965); c.lineTo(Math.sin(a) * R * (big ? 0.905 : 0.935), -Math.cos(a) * R * (big ? 0.905 : 0.935)); c.stroke(); }
  c.fillStyle = '#e4e4dc'; c.font = 'bold 70px "Arial Narrow", Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  for (const [t, a] of [['12', 0], ['3', 90], ['6', 180], ['9', 270]]) { const r = R * 0.62; c.save(); c.translate(Math.sin(a * Math.PI / 180) * r, -Math.cos(a * Math.PI / 180) * r); c.fillText(t, 0, 4); c.restore(); }
  c.font = 'bold 26px Arial, sans-serif'; c.fillStyle = '#c9c9c0'; c.fillText('FIELD', 0, -R * 0.3); c.font = '20px Arial, sans-serif'; c.fillStyle = '#9a9a92'; c.fillText('AUTOMATIC', 0, R * 0.32); c.fillText('WATER RESIST 100M', 0, R * 0.42);
  c.fillStyle = '#d6503a'; c.fillRect(-2, R * 0.05, 4, 10);
}
