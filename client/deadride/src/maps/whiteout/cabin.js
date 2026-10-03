// The WHITEOUT gondola cabin (8 passengers, detachable, red/white livery). Cabin-local axes: origin = floor centre, +Y up, forward = -Z, left (door side) = -X.
// Interior 2.0 m wide x 2.3 m long x 2.0 m high; benches on the front and back walls, 1.3 m sliding doors in the middle of the left side.
import * as THREE from 'three';
import { Builder } from '../../core/build.js';
import { std, G } from '../../core/mats.js';
import { signMaterial } from '../../core/canvas2d.js';
import { quad, unifyPrograms } from './common.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const CAB = { W: 2.1, D: 2.4, H: 2.15, floor: 0.0, hangerTop: 4.45, doorW: 1.3, sill: 0.82, glassTop: 1.9, doorSide: -1 };

/** shared frost uniform + frosted glass material (frost creeps in from the pane edges) */
export function makeGlass({ tint = 0xa9c4d0, opacity = 0.16 } = {}) {
  const frost = { value: 0.2 };
  const m = std({ color: tint, roughness: 0.06, metalness: 0.0, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.6 });
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (sh) => {
    base(sh); sh.uniforms.uFrostK = frost;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vFU;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vFU = uv;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vFU; uniform float uFrostK;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      { vec2 q = vFU; float ed = min(min(q.x, 1.0 - q.x), min(q.y, 1.0 - q.y));
        float n = zfbm3(vec3(q * 7.0, 2.0)) * 0.7 + zfbm3(vec3(q * 23.0, 7.0)) * 0.3;
        float reach = 0.03 + uFrostK * 0.4; float f = smoothstep(reach, reach * 0.15, ed + (n - 0.45) * 0.3) * clamp(uFrostK * 2.2, 0.0, 1.0);
        float crystal = zfbm3(vec3(q * vec2(38.0, 9.0), 4.0)) * 0.5 + zfbm3(vec3(q.yx * vec2(38.0, 9.0), 9.0)) * 0.5;
        f = clamp(f * (0.6 + 0.6 * crystal), 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.84, 0.91, 0.97) * (0.75 + 0.35 * crystal), f); diffuseColor.a = mix(diffuseColor.a, 0.85, f); roughnessFactor = mix(roughnessFactor, 0.6, f); }`);
  };
  m.customProgramCacheKey = () => 'gondolaGlassFrost';
  return { mat: m, frost };
}

/** Build the cabin. Returns {group, doors:[leafL,leafR], glass, frost, lampMat, parts:[{geometry, material}] (static parts only)}. */
export function buildCabin(ctx, { doors = 'separate', livery = 0xb3161c, number = 7, roofSnow = true } = {}) {
  const synth = ctx.synth; const group = new THREE.Group(); const B = new Builder({ synth, group, seed: 9 + number });
  const paint = B.m('cabPaint', { pattern: 'noise', size: 512, tile: 2, colors: [livery, livery, livery, livery], params: { scale: 3, contrast: 0.1, fine: 96 }, bump: 0.3, rough: [0.2, 0.3], metal: 0.25, layers: { scratch: 0.14, grime: 0.09, streak: 0.22 } });
  const white = B.m('cabWhite', { pattern: 'noise', size: 512, tile: 2, colors: [0xcfd2d6, 0xc4c8cd, 0xb0b5bb, 0xdfe2e6], params: { scale: 3, contrast: 0.2, fine: 96 }, bump: 0.4, rough: [0.35, 0.5], layers: { grime: 0.1, streak: 0.15, scratch: 0.1 } }, { snow: roofSnow ? 0.9 : 0 });
  const steel = B.m('cabSteel', { pattern: 'plates', size: 512, tile: 1, colors: [0x5b6066, 0x484d53, 0x22262a], params: { cols: 1, rows: 1, seam: 0.0, rivets: 0, brushed: 0.8 }, bump: 1.2, metal: 1, rough: [0.32, 0.6], layers: { scratch: 0.5, grime: 0.4, frost: 0.2 } });
  const rubber = B.m('cabRubber', { pattern: 'rubber', size: 512, tile: 0.6, colors: [0x232427, 0x33353a], params: { scale: 10, tread: 1 }, bump: 2, rough: [0.85, 0.98] });
  const cushion = B.m('cabCushion', { pattern: 'weave', size: 512, tile: 0.4, colors: [0x56708f, 0x445c7a], params: { threads: 120, twill: 1, variation: 0.35, fuzz: 0.7 }, bump: 0.5, rough: [0.85, 1], layers: { grime: 0.05 } });
  const chrome = B.m('cabChrome', std({ color: 0xc5c9ce, metalness: 1, roughness: 0.22 }));
  const lampMat = B.m('cabLamp', std({ color: 0x111111, emissive: 0xffe6c0, emissiveIntensity: 2.2, roughness: 0.4 }));
  const signM = B.m('cabSign', signMaterial({ lines: ['WHITEOUT', 'RESORT'], bg: '#e8ebee', fg: '#b3161c', w: 512, h: 256, weather: 0.25, border: false }));
  const numM = B.m('cabNum', signMaterial({ lines: [String(number).padStart(2, '0')], bg: '#e6e8ea', fg: '#1a1d21', w: 128, h: 128, weather: 0.2, border: false }));
  const { G: glass, frost } = (() => { const g = makeGlass(); return { G: g.mat, frost: g.frost }; })();
  const { W, D, H, sill, glassTop, doorW } = CAB; const hw = W / 2, hd = D / 2; const S = CAB.doorSide;                // doors on the LEFT (-X): every platform is on the left of the exit arm
  // ---- floor + chassis
  B.box({ p: [0, -0.16, 0], s: [W, 0.16, D], mat: steel, bevel: 0.03, cast: true });
  B.box({ p: [0, 0.0, 0], s: [W - 0.14, 0.02, D - 0.14], mat: rubber, bevel: 0.006, cast: false, recv: true });
  // ---- lower body (red): front/back/left walls full, right wall split around the door
  const wt = 0.07;
  B.box({ p: [0, 0, -hd + wt / 2], s: [W, sill, wt], mat: paint, bevel: 0.035 }); B.box({ p: [0, 0, hd - wt / 2], s: [W, sill, wt], mat: paint, bevel: 0.035 });
  B.box({ p: [-S * (hw - wt / 2), 0, 0], s: [wt, sill, D], mat: paint, bevel: 0.02 });
  const sideSeg = (D - doorW) / 2; for (const sz of [-1, 1]) B.box({ p: [S * (hw - wt / 2), 0, sz * (doorW / 2 + sideSeg / 2)], s: [wt, sill, sideSeg], mat: paint, bevel: 0.02 });
  B.box({ p: [S * (hw - wt / 2), 0, 0], s: [wt, 0.1, doorW], mat: paint, bevel: 0.02 }); // door sill plate zone
  // ---- window band: mullions (white) + glass panes
  const gy = sill, gh = glassTop - sill; const post = 0.07;
  for (const [x, z] of [[-hw + post / 2, -hd + post / 2], [hw - post / 2, -hd + post / 2], [-hw + post / 2, hd - post / 2], [hw - post / 2, hd - post / 2]]) B.box({ p: [x, gy, z], s: [post, gh, post], mat: white, bevel: 0.012 });
  for (const sz of [-1, 1]) B.box({ p: [S * (hw - post / 2), gy, sz * (doorW / 2 + 0.03)], s: [post, gh, 0.06], mat: white, bevel: 0.01 }); // door posts
  B.box({ p: [-S * (hw - post / 2), gy, 0], s: [post, gh, 0.06], mat: white, bevel: 0.01 });                                                         // left mullion
  // glass panes are flat quads with 0..1 UVs (the frost shader works in pane space)
  const paneZ = (x, z, w) => quad(B, glass, [x, gy + gh / 2, z], w, gh, 0), paneX = (x, z, w) => quad(B, glass, [x, gy + gh / 2, z], w, gh, Math.PI / 2);
  paneZ(0, -hd + 0.035, W - 0.14); paneZ(0, hd - 0.035, W - 0.14);
  for (const sz of [-1, 1]) paneX(-S * (hw - 0.035), sz * (hd / 2 + 0.03), hd - 0.16);
  for (const sz of [-1, 1]) paneX(S * (hw - 0.035), sz * (doorW / 2 + sideSeg / 2 + 0.03), sideSeg - 0.1);
  // ---- roof (white composite, domed) + headers
  B.box({ p: [0, glassTop, 0], s: [W + 0.06, 0.09, D + 0.06], mat: white, bevel: 0.03 });
  B.sphere({ p: [0, glassTop + 0.085, 0], r: 1, seg: 20, ps: 0.5, scale: [W * 0.5 + 0.02, 0.22, D * 0.5 + 0.02], mat: white });     // roof dome: upper half only (the lower half used to hang into the cabin)
  B.box({ p: [0, glassTop - 0.02, hd + 0.005], s: [W, 0.04, 0.02], mat: chrome, bevel: 0.006, cast: false });
  // livery + numbers + signs
  B.box({ p: [hw + 0.005, 0.18, -0.9], s: [0.012, 0.36, 0.7], mat: signM, cast: false }); B.box({ p: [hw + 0.005, 0.18, 0.9], s: [0.012, 0.36, 0.7], mat: signM, cast: false });
  B.box({ p: [-hw - 0.005, 0.2, 0], s: [0.012, 0.42, 0.9], mat: signM, cast: false });
  B.box({ p: [hw + 0.006, 1.98, 0], s: [0.01, 0.16, 0.16], mat: numM, cast: false }); B.box({ p: [-hw - 0.006, 1.98, 0], s: [0.01, 0.16, 0.16], mat: numM, cast: false });
  // ---- interior: benches (front/back), backrests, grab rail, lamp, intercom
  for (const sz of [-1, 1]) {
    const z = sz * (hd - wt - 0.24);
    B.box({ p: [0, 0.0, z], s: [W - 0.16, 0.26, 0.46], mat: steel, bevel: 0.02 });                                     // seat box
    B.box({ p: [0, 0.26, z], s: [W - 0.2, 0.1, 0.44], mat: cushion, bevel: 0.04 });                                     // cushion
    B.box({ p: [0, 0.4, sz * (hd - wt - 0.05)], s: [W - 0.2, 0.62, 0.1], mat: cushion, bevel: 0.05, cast: false });     // backrest
    for (const k of [-1, 0, 1]) B.box({ p: [k * (W - 0.2) / 3.4, 0.4, sz * (hd - wt - 0.1)], s: [0.012, 0.55, 0.012], mat: steel, cast: false }); // seams
  }
  B.cyl({ p: [-S * (hw - 0.12), 1.12, 0], r: 0.018, h: 1.7, seg: 8, mat: chrome, pitch: Math.PI / 2, anchor: 'center', cast: false });
  B.cyl({ p: [S * (hw - 0.12), 1.75, -0.98], r: 0.018, h: 0.9, seg: 8, mat: chrome, pitch: Math.PI / 2, anchor: 'center', cast: false });
  const liner = B.m('cabLiner', { pattern: 'weave', size: 256, tile: 0.5, colors: [0x808894, 0x6c7480], params: { threads: 64, twill: 0, variation: 0.3, fuzz: 0.3 }, bump: 0.3, rough: [0.85, 1] });
  B.box({ p: [0, glassTop - 0.07, 0], s: [W - 0.16, 0.03, D - 0.16], mat: liner, bevel: 0.01, cast: false });                 // headliner
  B.box({ p: [0, glassTop - 0.09, 0], s: [0.9, 0.025, 0.28], mat: lampMat, bevel: 0.01, cast: false });                 // interior lamp panel
  B.box({ p: [0.3, glassTop - 0.1, -0.7], s: [0.16, 0.03, 0.16], mat: steel, bevel: 0.01, cast: false }); B.box({ p: [S * (hw - 0.05), 1.62, -0.86], s: [0.03, 0.34, 0.24], mat: B.m('cabPlaque', signMaterial({ lines: ['MAX 8', 'EMERGENCY', 'STOP: RED'], bg: '#e8ebee', fg: '#a01018', w: 256, h: 256, weather: 0.1, border: true })), cast: false });
  B.box({ p: [-S * (hw - 0.045), 1.42, 0.35], s: [0.04, 0.18, 0.12], mat: steel, bevel: 0.01, cast: false });                   // intercom / emergency phone
  // ---- exterior details: ski / board racks on the closed (right) side, roof marker lights, underfloor equipment, window seals
  for (const sz of [-0.55, 0.55]) { B.cyl({ p: [hw + 0.13, 0.62, sz], r: 0.022, h: 0.5, seg: 8, mat: chrome, cast: false }); B.box({ p: [hw + 0.07, 0.35, sz], s: [0.1, 0.06, 0.34], mat: rubber, bevel: 0.02, cast: false }); B.box({ p: [hw + 0.07, 1.05, sz], s: [0.1, 0.06, 0.3], mat: rubber, bevel: 0.02, cast: false }); }
  const skiC = [0x1c4f9c, 0xd8d8d8, 0xc8a000, 0x7a1f1f]; for (let i = 0; i < 4; i++) B.box({ p: [hw + 0.11, 0.26 + i * 0.1, 0.0], s: [0.06, 0.07, 1.8], mat: B.m('cabSki' + i, std({ color: skiC[i], roughness: 0.4, metalness: 0.1 })), yaw: 0, bevel: 0.01, cast: false });   // skis lying in the outside rack
  for (const [x, z] of [[-hw + 0.05, -hd + 0.05], [hw - 0.05, -hd + 0.05], [-hw + 0.05, hd - 0.05], [hw - 0.05, hd - 0.05]]) B.box({ p: [x, glassTop + 0.02, z], s: [0.09, 0.05, 0.09], mat: B.m('cabAmber', std({ color: 0x140a02, emissive: 0xffa020, emissiveIntensity: 3 })), bevel: 0.01, cast: false });
  B.box({ p: [0, -0.34, 0], s: [W * 0.6, 0.18, D * 0.5], mat: steel, bevel: 0.03, cast: false }); for (const sx of [-1, 1]) B.cyl({ p: [sx * 0.6, -0.42, 0.7], r: 0.04, h: 0.36, seg: 8, mat: rubber, cast: false });
  for (const sz of [-1, 1]) for (const yy of [sill - 0.02, glassTop]) B.box({ p: [0, yy, sz * (hd - 0.03)], s: [W - 0.06, 0.03, 0.035], mat: rubber, bevel: 0.006, cast: false });   // gaskets
  // ---- fidelity pass: button-tufted seats with piping, floor ribs + drain grates, ceiling vent slots / speaker, rivet rows + panel seams on the red skirt, door rails, roof vent + rail, hanger clamp bolts
  for (const sz of [-1, 1]) { const z = sz * (hd - wt - 0.24); for (let k = -2; k <= 2; k++) for (const row of [0.29, 0.62]) B.sphere({ p: [k * 0.36, row + (row > 0.5 ? 0.06 : 0.02), sz * (hd - wt - 0.11 - (row > 0.5 ? 0 : 0.13))], r: 0.016, seg: 5, mat: steel, cast: false });                     // tufting buttons
    B.box({ p: [0, 0.35, z - sz * 0.225], s: [W - 0.2, 0.016, 0.022], mat: white, bevel: 0.004, cast: false }); B.box({ p: [0, 0.0, z - sz * 0.235], s: [W - 0.16, 0.05, 0.02], mat: chrome, bevel: 0.006, cast: false }); }                                                               // piping + kick strip
  for (let k = 0; k < 9; k++) B.box({ p: [-hw + 0.22 + k * 0.2, 0.005, 0], s: [0.05, 0.012, D - 0.7], mat: rubber, bevel: 0.003, cast: false });                                                                                                                              // floor ribs
  for (const sz of [-1, 1]) B.box({ p: [0.75 * -S, 0.008, sz * 0.5], s: [0.16, 0.012, 0.16], mat: steel, bevel: 0.002, cast: false });
  for (let k = 0; k < 6; k++) B.box({ p: [-0.55 + k * 0.09, glassTop - 0.085, 0.42], s: [0.05, 0.006, 0.22], mat: steel, cast: false }); B.box({ p: [0.5, glassTop - 0.09, -0.62], s: [0.14, 0.02, 0.14], mat: chrome, bevel: 0.006, cast: false });          // vent slots + speaker
  for (let i = 0; i < 12; i++) for (const sz of [-1, 1]) for (const sx of [-1, 1]) if (sx * sz > 0 || i % 2) B.sphere({ p: [sx * (hw + 0.004), 0.1 + (i % 2) * 0.09 + Math.floor(i / 2) * 0, sz * (0.45 + i * 0.08)], r: 0.011, seg: 5, mat: steel, cast: false });     // rivet rows on the skirt
  for (const z of [-0.75, -0.35, 0.35, 0.75]) B.box({ p: [hw + 0.006, 0.02, z], s: [0.008, sill - 0.05, 0.03], mat: white, cast: false });                                                                                                                                       // panel seams
  B.box({ p: [S * (hw + 0.04), sill - 0.03, 0], s: [0.05, 0.04, doorW + 0.5], mat: steel, bevel: 0.006, cast: false }); B.box({ p: [S * (hw + 0.04), glassTop - 0.08, 0], s: [0.05, 0.06, doorW + 0.5], mat: steel, bevel: 0.006, cast: false });                                 // door rails
  B.box({ p: [0.3, glassTop + 0.1, 0.5], s: [0.5, 0.09, 0.3], mat: white, bevel: 0.03 }); for (let k = 0; k < 5; k++) B.box({ p: [0.3, glassTop + 0.17, 0.4 + k * 0.05], s: [0.4, 0.012, 0.02], mat: steel, cast: false });                                                    // roof vent + louvres
  for (const sx of [-1, 1]) B.box({ p: [sx * 0.3, glassTop + 0.16, -0.9], s: [0.02, 0.05, 0.5], mat: chrome, cast: false });
  // ---- hanger arm + grip (pivot at y = hangerTop)
  const top = CAB.hangerTop, hy = glassTop + 0.15;
  B.box({ p: [0, hy - 0.05, 0], s: [0.5, 0.12, 0.34], mat: steel, bevel: 0.03 });
  B.cyl({ p: [0, hy, 0], r: [0.055, 0.045], h: top - hy - 0.42, seg: 12, mat: steel });
  B.box({ p: [0, top - 0.44, 0], s: [0.3, 0.18, 0.26], mat: steel, bevel: 0.03 });
  B.box({ p: [0, top - 0.26, 0], s: [0.22, 0.34, 0.5], mat: steel, bevel: 0.04 });              // grip body
  B.box({ p: [0, top - 0.02, 0], s: [0.16, 0.12, 0.62], mat: steel, bevel: 0.03 });             // rope clamp head
  for (const sz of [-1, 1]) for (const k of [-1, 1]) B.cyl({ p: [0.09, top - 0.02 + k * 0.03, sz * 0.22], r: 0.018, h: 0.04, seg: 6, mat: chrome, roll: Math.PI / 2, anchor: 'center', cast: false }); B.cyl({ p: [0, top - 0.3, 0.0], r: 0.035, h: 0.16, seg: 8, mat: rubber, cast: false });   // clamp bolts + spring boot
  for (const sz of [-1, 1]) B.cyl({ p: [0, top + 0.05, sz * 0.24], r: 0.06, h: 0.06, seg: 12, mat: steel, pitch: Math.PI / 2, anchor: 'center', cast: false }); // rope sheaves
  // ---- sliding doors (right side)
  const leaf = (sz) => { const g = new THREE.Group(); const bb = new Builder({ synth, group: g, seed: 3 });
    const bp = bb.m('cabPaint', paint), bg = bb.m('cabGlass', glass), bw = bb.m('cabWhite', white);
    bb.box({ p: [0, 0, 0], s: [0.05, sill, doorW / 2 - 0.005], mat: bp, bevel: 0.015 }); quad(bb, bg, [0, sill + gh / 2, 0], doorW / 2 - 0.02, gh, Math.PI / 2);
    bb.box({ p: [0, sill, sz * (-doorW / 4 + 0.02)], s: [0.06, gh, 0.045], mat: bw, bevel: 0.01 }); bb.box({ p: [0, sill, sz * (doorW / 4 - 0.02)], s: [0.06, gh, 0.045], mat: bw, bevel: 0.01 });
    bb.box({ p: [0.03 * S, 0.9, sz * (-doorW / 4 + 0.09)], s: [0.03, 0.22, 0.03], mat: chrome, cast: false, bevel: 0.006 }); bb.finish(); return g; };
  const bb0 = () => {};
  const doorMats = { L: leaf(-1), R: leaf(1) };
  const doorFrame = { x: S * (hw + 0.02) }; doorMats.L.position.set(doorFrame.x, 0, -doorW / 4); doorMats.R.position.set(doorFrame.x, 0, doorW / 4);
  unifyPrograms(B); bb0(); B.finish();
  mergeByMaterial(group);
  group.add(doorMats.L, doorMats.R);
  const parts = []; group.traverse((o) => { if (o.isMesh && o.parent === group) parts.push({ geometry: o.geometry, material: o.material, cast: o.castShadow, recv: o.receiveShadow }); });
  // static (door-closed) copies of the door leaves for instanced traffic cabins
  const doorParts = []; for (const lf of [doorMats.L, doorMats.R]) lf.traverse((o) => { if (o.isMesh) doorParts.push({ geometry: o.geometry, material: o.material, offset: lf.position.clone() }); });
  return { group, doors: [doorMats.L, doorMats.R], doorClosed: [doorMats.L.position.z, doorMats.R.position.z], glass, frost, lampMat, parts, doorParts };
}

/** the Builder splits geometry into 28 m cells (up to 8 per material around the origin): merge them back into one mesh per material (fewer draw calls) */
function mergeByMaterial(group) {
  const by = new Map(); for (const o of [...group.children]) { if (!o.isMesh) continue; const k = o.material.uuid + (o.castShadow ? 'c' : '') + (o.receiveShadow ? 'r' : ''); let e = by.get(k); if (!e) by.set(k, (e = { mat: o.material, cast: o.castShadow, recv: o.receiveShadow, geos: [] })); e.geos.push(o.geometry); group.remove(o); }
  for (const e of by.values()) { const g = e.geos.length > 1 ? mergeGeometries(e.geos, false) : e.geos[0]; g.computeBoundingSphere(); const m = new THREE.Mesh(g, e.mat); m.castShadow = e.cast; m.receiveShadow = e.recv; m.matrixAutoUpdate = false; group.add(m); }
}
