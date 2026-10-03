// Ride viewer: ?sandbox=ride&map=<id>&from=0&to=1  — docks the map's vehicle at stop `from`, puts the player inside, runs the ride to `to`.
// window.__t: cam(...) free camera, inside() player rides platform, dock(i), ride(i,j), state(), riding progress in __t.k
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
  await world.loadMap(map, (p, m) => console.log(`load ${(p * 100) | 0}% ${m}`));
  if (P.get('warm') !== '0') { const tw = performance.now(); try { await world.warm(); } catch (e) { console.warn('warm failed', e); } console.log('warm-up in', (performance.now() - tw).toFixed(0), 'ms'); }     // like the real boot (?warm=0 to skip)
  const from = +(P.get('from') || 0), to = +(P.get('to') || 1);
  world.setActive(from); const veh = world.vehicle; if (!veh) throw new Error('map has no vehicle');
  const st = world.stops[from]; const player = new Player(gfx, world, input); gfx.vmEnabled = false;
  player.teleport([st.origin.x + st.playerStart.pos[0], st.origin.y + st.playerStart.pos[1], st.origin.z + st.playerStart.pos[2]], st.playerStart.yaw);
  let t = 0, last = performance.now(), frames = 0, k = 0; const ft = [];
  veh.onEvent = (e, d) => console.log('vehicle event', e, JSON.stringify(d || {}));
  const T = window.__t = {
    gfx, world, player, fx, synth, input, veh, k: 0,
    cam(x, y, z, yaw, pitch, fov) { player.frozen = true; player._free = false; player.pos.set(x, y - 1.7, z); player.yaw = yaw; player.pitch = pitch; if (fov) gfx.setFov(fov); player.update(0.001); },
    free(x, y, z, lx, ly, lz, fov) { player._free = true; gfx.camera.position.set(x, y, z); gfx.camera.lookAt(lx, ly, lz); if (fov) gfx.setFov(fov); },
    async dock(i) { world.setActive(i); await veh.arrive(world.stops[i]); },
    inside() { player.frozen = false; player._free = false; const v = veh; const c = v.boardBox; const local = new THREE.Vector3((c.min.x + c.max.x) / 2, v.floorY, (c.min.z + c.max.z) / 2); v.frame.updateWorldMatrix(true, false); v.localToWorld(local, player.pos); player.yaw = 0; player.setPlatform(v); },
    outside(pos) { player.setPlatform(null); if (pos) player.teleport(pos); },
    async ride(i, j) { T.riding = true; const hooks = { progress: (kk) => { T.k = kk; world.setTransit(i, j, kk); } }; await veh.ride(world.stops[i], world.stops[j], hooks); world.setActive(j); T.riding = false; console.log('ride complete'); },
    frames: () => frames, ft: () => ft.slice(),
  };
  await T.dock(from); T.inside();
  const loop = () => {
    const n = performance.now(); const dt = Math.min(0.05, (n - last) / 1000); last = n; t += dt; frames++; ft.push(dt * 1000); if (ft.length > 900) ft.shift();
    if (!player._free) player.update(dt);
    world.update(dt, t, gfx.camera.position); fx.update(dt, t, gfx.camera.position);
    gfx.shadowCenter.copy(gfx.camera.position); gfx.render(dt, t); input.endFrame(); requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  if (P.get('auto') !== '0') T.ride(from, to);
  await new Promise((r) => setTimeout(r, 400)); window.__ready = true;
}
