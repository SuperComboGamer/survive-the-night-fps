// Stop viewer: ?sandbox=stop&map=shaft-nine&stop=0 — builds the map, places the player, exposes window.__t for scripted screenshots.
import * as THREE from 'three';
import { Synth } from '../core/synth.js';
import { FX } from '../core/fx.js';
import { World } from '../core/world.js';
import { Player } from '../core/player.js';
import { input } from '../core/input.js';
import { loadMap } from '../maps/index.js';

export async function run(gfx, P) {
  const synth = new Synth(gfx.renderer); const fx = new FX(gfx); const world = new World(gfx, synth, fx);
  input.init(gfx.canvas);
  const map = await loadMap(P.get('map') || 'shaft-nine');
  const t0 = performance.now();
  await world.loadMap(map, (p, msg) => console.log(`load ${(p * 100).toFixed(0)}% ${msg}`));
  console.log('map built in', (performance.now() - t0).toFixed(0), 'ms');
  if (P.get('warm') !== '0') { const tw = performance.now(); try { await world.warm(); } catch (e) { console.warn('warm failed', e); } console.log('warm-up (all stops visible, un-culled) in', (performance.now() - tw).toFixed(0), 'ms'); }     // like the real boot: no first-use shader compiles in measurements (?warm=0 to skip)
  const idx = +(P.get('stop') || 0); world.setActive(Math.min(idx, world.stops.length - 1));
  const player = new Player(gfx, world, input); const st = world.active; player.teleport([st.origin.x + st.playerStart.pos[0], st.origin.y + st.playerStart.pos[1], st.origin.z + st.playerStart.pos[2]], st.playerStart.yaw);
  gfx.vmEnabled = false;
  let t = 0, last = performance.now(), frames = 0; const ft = [];
  const T = window.__t = {
    gfx, world, player, fx, synth, input,
    cam(x, y, z, yaw, pitch, fov) { player.frozen = true; player.pos.set(x, y - 1.7, z); player.yaw = yaw; player.pitch = pitch; if (fov) gfx.setFov(fov); player.update(0.001); },
    free(x, y, z, lx, ly, lz, fov) { player.frozen = true; gfx.camera.position.set(x, y, z); gfx.camera.lookAt(lx, ly, lz); player._free = true; if (fov) gfx.setFov(fov); },
    frames: () => frames, ft: () => ft.slice(),
  };
  const loop = () => {
    const n = performance.now(); const dt = Math.min(0.05, (n - last) / 1000); last = n; t += dt; frames++; ft.push(dt * 1000); if (ft.length > 600) ft.shift();
    if (!player._free) player.update(dt);
    world.update(dt, t, gfx.camera.position); fx.update(dt, t, gfx.camera.position);
    gfx.shadowCenter.copy(gfx.camera.position); gfx.render(dt, t); input.endFrame(); requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  await new Promise((r) => setTimeout(r, 500)); window.__ready = true;
}
