// Smoke test of water, terrain, beams, halos, weather, tracers, decals, explosion, impacts.
import * as THREE from 'three';
import { Synth } from '../core/synth.js';
import { FX, DECAL } from '../core/fx.js';
import { Builder } from '../core/build.js';
import { Water } from '../core/water.js';
import { buildTerrain } from '../core/terrain.js';
import { makeBeam, HaloBatch } from '../core/glow.js';
import { compileAtmo } from '../core/gfx.js';
import { std } from '../core/mats.js';

export async function run(gfx, P) {
  const synth = new Synth(gfx.renderer); await synth.warm(true); const fx = new FX(gfx);
  const group = new THREE.Group(); gfx.scene.add(group); const B = new Builder({ synth, group, seed: 3 });
  const snowM = B.m('snow', { pattern: 'snow', size: 512, tile: 3, colors: [0xdfe7f2, 0xf4f8ff, 0xb9c8de], params: { scale: 4, ripples: 0.8, sparkle: 1, direction: 0, crust: 0.5 }, bump: 30, rough: [0.5, 0.8] }, { triplanar: 1 / 3, snow: 1 });
  const rock = B.m('rock', { pattern: 'rock', size: 512, tile: 4, colors: [0x2b2a28, 0x46433d, 0x635d52, 0x7d766a], params: { scale: 5, strata: 7, cracks: 0.9 }, bump: 90, rough: [0.7, 0.95] }, { triplanar: 1 / 4, snow: 1 });
  const H = (x, z) => 3 * Math.sin(x * 0.05) * Math.cos(z * 0.04) + Math.max(0, x - 10) * 0.25;
  buildTerrain(B, { minX: -60, maxX: 60, minZ: -60, maxZ: 60, cell: 2, heightFn: H, mat: rock });
  for (let i = 0; i < 6; i++) B.rock({ p: [-10 + i * 4, H(-10 + i * 4, 6) + 0.5, 6], r: 1.2 + i * 0.2, mat: snowM, amp: 0.4, seed: i, squash: [1, 0.7, 1] });
  B.box({ p: [0, H(0, 0), 0], s: [2, 2.5, 2], mat: B.m('conc', { pattern: 'noise', size: 512, tile: 2, colors: [0x6c6a64, 0x585650, 0x2f2d2a, 0x8a877e], params: { scale: 5, contrast: 3, fine: 96 }, bump: 3 }), col: 'concrete' });
  B.finish();
  const water = new Water({ waves: [{ dir: [1, 0.3], len: 40, amp: 0.5, steep: 0.5 }, { dir: [0.6, 1], len: 18, amp: 0.25, steep: 0.5 }, { dir: [-0.4, 0.8], len: 7, amp: 0.08, steep: 0.6 }], level: -1.5, color: 0x0d2a36, deep: 0x02090d }); gfx.scene.add(water.mesh);
  const beam = makeBeam({ length: 20, r1: 2.2, intensity: 0.6 }); beam.position.set(-6, 4, 12); beam.lookAt(-6, 0, 2); if (!P.get('nobeam')) gfx.scene.add(beam);
  const halos = new HaloBatch(8); gfx.scene.add(halos.mesh); for (let i = 0; i < 5; i++) halos.add([-12 + i * 3, 3.5, 10], i % 2 ? 0xffc080 : 0x80c0ff, 0.7, 1, 4);
  const atmo = compileAtmo({ fog: { color: 0x8a97a8, scatter: 0xd0dcf0, density: 0.012, falloff: 0.03, base: 0 }, sky: { zenith: 0x1a2a44, horizon: 0x7f8ea3, stars: 0, disc: 0, cloud: 0.8, cloudColor: 0x606c80, cloudLit: 0xb0bccc }, sun: { dir: [0.4, 0.5, 0.3], color: 0xfff0e0, intensity: 4.5, shadow: true }, env: { intensity: 0.7 }, snow: 1, exposure: 1, bloom: 0.35 });
  atmo.envTex = gfx.makeEnv({ fog: { color: 0x8a97a8 }, sky: { zenith: 0x1a2a44, horizon: 0x7f8ea3, stars: 0, disc: 0, cloud: 0.8, cloudColor: 0x606c80, cloudLit: 0xb0bccc } }); gfx.setAtmo(atmo);
  gfx.addLight({ kind: 'point', pos: new THREE.Vector3(0, 5, 8), color: 0xffb060, intensity: 60, distance: 20 });
  fx.addWeather({ count: 5000, box: [40, 24, 40], fall: 1.3, size: 0.03, turb: 0.5, color: [1, 1, 1], alpha: 0.8, cell: 3 });
  const world = { groundAt: (x, z) => ({ y: H(x, z), surface: 'snow' }), raycast: () => false }; fx.setWorld(world);
  gfx.vmEnabled = false; gfx.camera.position.set(0, 4, 24); gfx.camera.lookAt(0, 1, 0); gfx.shadowCenter.set(0, 0, 0);
  let t = 0, last = performance.now(); const T = window.__t = { gfx, fx, water };
  const loop = () => { const n = performance.now(); const dt = Math.min(0.05, (n - last) / 1000); last = n; t += dt; water.update(t, gfx.camera.position, 1); fx.update(dt, t, gfx.camera.position); gfx.render(dt, t); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  await new Promise((r) => setTimeout(r, 300));
  if (P.get('nofx')) { window.__ready = true; return; }
  // effects burst
  const v = (x, y, z) => new THREE.Vector3(x, y, z); const up = v(0, 1, 0);
  fx.explosion(v(14, H(14, -4) + 0.5, -4), 4, 1);
  for (let i = 0; i < 8; i++) fx.tracers.add(v(-3, 2, 20), v(-2 + i * 1.5, 2 + Math.sin(i) , -6), t + i * 0.02, { speed: 400, len: 8, width: 0.03, color: [1, 0.7, 0.3] });
  for (const [i, s] of ['concrete', 'metal', 'wood', 'snow', 'ice', 'water', 'glass', 'crystal', 'lava', 'dirt', 'flesh'].entries()) fx.impact(s, v(-9 + i * 1.4, 1.2, 12.5), v(0, 0, 1), v(0, 0, -1), {});
  fx.decals.add(v(0, 1, 1.01), v(0, 0, 1), DECAL.scorch, 1.2, 0.9);
  await new Promise((r) => setTimeout(r, 200)); window.__ready = true;
}
