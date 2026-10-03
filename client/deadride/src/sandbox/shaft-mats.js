// Shaft Nine material lab: ?sandbox=shaft-mats — the custom patterns on 1 m tiles under a raking warm light + a cool fill. window.__t.set(list) swaps sets.
import * as THREE from 'three';
import { Synth } from '../core/synth.js';
import { compileAtmo } from '../core/gfx.js';
import { custom, SHAFT_GLSL, TIMBER, STRATA, SHUTTER, COAL, CINDER, BASALT, CALCITE } from '../maps/shaft-nine/glsl.js';

export async function run(gfx, P) {
  const synth = new Synth(gfx.renderer); const sc = gfx.scene; await synth.warm(true);
  const atmo = compileAtmo({ fog: { color: 0x101014, density: 0.002 }, sky: null, sun: { dir: [0.6, 0.4, 0.7], color: 0xfff0e0, intensity: 1.5, shadow: false }, env: { intensity: 0.35 }, exposure: 1, bloom: 0.02, vignette: 0.05, grain: 0, autoExposure: { key: 0.18, min: 0.6, max: 1.2 } });
  atmo.envTex = gfx.makeEnv({ sky: { zenith: 0x304050, horizon: 0x506070, stars: 0, disc: 0, cloud: 0 }, fog: { color: 0x506070 } }); gfx.setAtmo(atmo);
  const sets = {
    a: [
      ['timber dark', custom(TIMBER, [0.3, 0.3, 0.2, 0.2, 0, 0.8, 1], { colors: [0x2b2118, 0x5a4634], tile: 1.5, bump: 10, rough: [0.7, 0.96], layers: { grime: 0.3 } })],
      ['timber boards', custom(TIMBER, [0.5, 0.5, 0.3, 0.4, 0, 0.6, 5], { colors: [0x32271c, 0x6a5540], tile: 1.5, bump: 8, rough: [0.7, 0.96] })],
      ['strata', custom(STRATA, [4, 0.3, 0.5, 0.4, 7, 0.6, 0.3], { colors: [0x1a1b1c, 0x35322d, 0x4a443b, 0x6b6250], tile: 4, size: 1024, bump: 120, rough: [0.6, 0.98] })],
      ['shutter', custom(SHUTTER, [12, 1, 0.6, 0.6, 0.6, 0.5], { colors: [0x6c6e6b, 0x8b8d88, 0x2f3130], tile: 3, size: 1024, bump: 6, rough: [0.7, 0.97] })],
      ['coal', custom(COAL, [7, 0.8, 0.5], { colors: [0x1a1a1c, 0x2a2a2e, 0x3a3b44, 0x9a9cb0], tile: 1, bump: 30, rough: [0.2, 0.6] })],
      ['cinder', custom(CINDER, [40, 0.3, 0.3, 0.4, 0.3], { colors: [0x38342e, 0x4b453c, 0x201d19, 0x7d7263], tile: 4, size: 1024, bump: 10, rough: [0.85, 1] })],
      ['basalt', custom(BASALT, [5, 0.25, 0.3, 0.15, 0.4], { colors: [0x0e0c0c, 0x1c1817, 0x2c2522, 0x50453d], tile: 4, size: 1024, bump: 100, rough: [0.6, 1] })],
      ['calcite', custom(CALCITE, [8, 0.6, 0.5, 0.5, 0.5], { colors: [0x2a2438, 0x4a4060, 0x6a5c88, 0xc8b8ff], tile: 4, size: 1024, bump: 90, rough: [0.3, 0.85] })],
    ],
  };
  const group = new THREE.Group(); sc.add(group);
  const build = (list) => {
    group.clear(); const cols = 4; const rows = Math.ceil(list.length / cols);
    list.forEach(([name, def], i) => { const m = synth.material(def); const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), m); mesh.position.set((i % cols) * 1.56 - (cols - 1) * 0.78, -Math.floor(i / cols) * 1.56 + (rows - 1) * 0.78, 0); group.add(mesh); });
  };
  build(sets.a);
  gfx.camera.position.set(0, 0, 5.2); gfx.camera.lookAt(0, 0, 0); gfx.vmEnabled = false; gfx.camera.fov = 44; gfx.camera.updateProjectionMatrix(); gfx.shadowCenter.set(0, 0, 0);
  let t = 0, last = performance.now();
  window.__t = { gfx, synth, sets, build, SHAFT_GLSL, custom, ids: { TIMBER, STRATA, SHUTTER, COAL, CINDER, BASALT, CALCITE }, big(i, size = 8, def) { group.clear(); const m = synth.material(def || sets.a[i][1]); const g = new THREE.PlaneGeometry(size, size); const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * size, uv.getY(k) * size); const mesh = new THREE.Mesh(g, m); group.add(mesh); return sets.a[i][0]; }, cam(x, y, z, lx = 0, ly = 0, lz = 0, fov = 44) { gfx.camera.position.set(x, y, z); gfx.camera.lookAt(lx, ly, lz); gfx.setFov(fov); } };
  const loop = () => { const n = performance.now(); const dt = Math.min(0.05, (n - last) / 1000); last = n; t += dt; gfx.render(dt, t); requestAnimationFrame(loop); };
  requestAnimationFrame(loop); await new Promise((r) => setTimeout(r, 500)); window.__ready = true;
}
