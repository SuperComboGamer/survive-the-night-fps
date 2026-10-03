// Gameplay props viewer: perk machines, mystery box, wall-buy plate, power-ups.
import * as THREE from 'three';
import { Synth } from '../core/synth.js';
import { FX } from '../core/fx.js';
import { compileAtmo } from '../core/gfx.js';
import { PerkMachine, PERKS, MysteryBox, WallBuy, PowerUp, POWERUPS } from '../game/props3d.js';

export async function run(gfx, P) {
  const synth = new Synth(gfx.renderer); await synth.warm(true); const fx = new FX(gfx); gfx.vmEnabled = false;
  const floor = synth.material({ pattern: 'tiles', size: 512, tile: 2, colors: [0x55524a, 0x46443e, 0x1c1b18], params: { n: 8, grout: 0.01, checker: 1, bevel: 0.004, wear: 0.4, gloss: 0.3 }, bump: 2, rough: [0.5, 0.9], layers: { grime: 0.5, cracks: 0.3 } });
  const wallM = synth.material({ pattern: 'bricks', size: 512, tile: 2, colors: [0x6a4a3a, 0x54382c, 0x8a857a], params: { rows: 24, cols: 8, mortar: 0.006, variation: 0.6 }, bump: 5, rough: [0.8, 0.95] });
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(40, 30), floor); fl.rotation.x = -Math.PI / 2; fl.receiveShadow = true; gfx.scene.add(fl); fl.material.map.repeat.set(0.5, 0.5);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(40, 6, 0.3), wallM); wall.position.set(0, 3, -3); wall.receiveShadow = true; gfx.scene.add(wall);
  const atmo = compileAtmo({ fog: { color: 0x14161c, scatter: 0x202634, density: 0.006 }, sky: { zenith: 0x080a10, horizon: 0x141822, stars: 0, disc: 0 }, sun: { dir: [0.3, 0.6, 0.6], color: 0xffe0b0, intensity: 0.9, shadow: true }, env: { intensity: 0.25 }, exposure: 1.4, bloom: 0.5, autoExposure: { key: 0.2, min: 1, max: 1.6 } });
  atmo.envTex = gfx.makeEnv({ fog: { color: 0x14161c }, sky: { zenith: 0x080a10, horizon: 0x141822, stars: 0, disc: 0 } }); gfx.setAtmo(atmo);
  const kinds = Object.keys(PERKS); const machines = kinds.map((k, i) => { const m = new PerkMachine(gfx.scene, gfx, k, synth); m.place([-7 + i * 3.2, 0, -2.4], 0); m.setVisible(true); m.src.enabled = true; return m; });
  const api = { WEAPONS: {}, getOutline: () => null };
  const wb = new WallBuy(gfx.scene, gfx, { pos: [-4, 1.6, -2.8], yaw: 0, gun: 'm14' }, api, { name: 'M14', wallPrice: 500 }); const wb2 = new WallBuy(gfx.scene, gfx, { pos: [-2, 1.6, -2.8], yaw: 0, gun: 'olympia' }, api, { name: 'OLYMPIA', wallPrice: 500 }); wb.setNear(1);
  const box = new MysteryBox(gfx.scene, gfx, synth, api); box.place([6, 0, -1], 0.3); box.setVisible(true); box.open(['a', 'b', 'c'], 'a'); box.t = 0;
  const pus = Object.keys(POWERUPS).map((k, i) => new PowerUp(gfx.scene, gfx, k, new THREE.Vector3(-5 + i * 2, 0, 3)));
  gfx.addLight({ kind: 'point', pos: new THREE.Vector3(0, 5, 4), color: 0xffd8a8, intensity: 60, distance: 30 });
  gfx.camera.position.set(0, 1.7, 9); gfx.camera.lookAt(0, 1.2, 0); gfx.shadowCenter.set(0, 0, 0); gfx.setFov(60);
  let t = 0, last = performance.now(); window.__t = { gfx, machines, box, wb, pus, cam(x, y, z, lx, ly, lz) { gfx.camera.position.set(x, y, z); gfx.camera.lookAt(lx, ly, lz); } };
  const loop = () => { const n = performance.now(); const dt = Math.min(0.05, (n - last) / 1000); last = n; t += dt; machines.forEach((m) => m.update(dt, t)); box.update(dt, t); pus.forEach((p) => { p.life = 30; p.update(dt, t); }); fx.update(dt, t, gfx.camera.position); gfx.render(dt, t); requestAnimationFrame(loop); };
  requestAnimationFrame(loop); await new Promise((r) => setTimeout(r, 500)); window.__ready = true;
}
