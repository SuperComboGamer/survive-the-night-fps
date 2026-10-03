// Last Ferry ride/dock viewer (dev tool): ?sandbox=ferry-ride&from=0&to=1[&snap=1][&auto=0][&lf=N]
//   snap=1: ferry starts docked (snapDocked), else it sails in (arrive). auto=1 (default): ride starts once docked.
// window.__t: free(x,y,z,lx,ly,lz,fov) world camera; fcam(x,y,z,yaw,pitch,fov) camera fixed in the FERRY frame (follows the ferry); inside() player rides the platform;
//   info() -> ferry state numbers; ride(i,j), dock(i)
import * as THREE from 'three';
import { Synth } from '../core/synth.js';
import { FX } from '../core/fx.js';
import { World } from '../core/world.js';
import { Player } from '../core/player.js';
import { input } from '../core/input.js';
import { loadMap } from '../maps/index.js';

export async function run(gfx, P) {
  const synth = new Synth(gfx.renderer); const fx = new FX(gfx); const world = new World(gfx, synth, fx); input.init(gfx.canvas);
  const map = await loadMap('last-ferry'); await world.loadMap(map, (p, m) => console.log(`load ${(p * 100) | 0}% ${m}`));
  const from = +(P.get('from') || 0), to = +(P.get('to') || (from + 1) % 4);
  world.setActive(from); const veh = world.vehicle; gfx.vmEnabled = false;
  const st = world.stops[from]; const player = new Player(gfx, world, input); player.teleport([st.origin.x + st.playerStart.pos[0], st.origin.y + st.playerStart.pos[1], st.origin.z + st.playerStart.pos[2]], st.playerStart.yaw);
  let t = 0, last = performance.now(), frames = 0; const ft = []; let follow = null;
  veh.onEvent = (e, d) => { (window.__events = window.__events || []).push([+t.toFixed(1), e, d]); };
  const R = (n) => +n.toFixed(3);
  const T = window.__t = {
    gfx, world, player, fx, synth, input, veh, k: 0,
    cam(x, y, z, yaw, pitch, fov) { follow = null; player._free = false; player.frozen = true; player.pos.set(x, y - 1.7, z); player.yaw = yaw; player.pitch = pitch; if (fov) gfx.setFov(fov); player.update(0.001); },
    free(x, y, z, lx, ly, lz, fov) { follow = null; player._free = true; gfx.camera.position.set(x, y, z); gfx.camera.lookAt(lx, ly, lz); if (fov) gfx.setFov(fov); },
    fcam(x, y, z, yaw, pitch, fov) { player._free = true; follow = { p: new THREE.Vector3(x, y, z), yaw, pitch }; if (fov) gfx.setFov(fov); },
    inside(lx = 2.7, lz = 0, yaw = 0, pitch = 0) { follow = null; player.frozen = false; player._free = false; const l = new THREE.Vector3(lx, 0, lz); veh.frame.updateWorldMatrix(true, false); veh.localToWorld(l, player.pos); player.yaw = yaw; player.pitch = pitch; player.setPlatform(veh); },
    async dock(i) { world.setActive(i); await veh.arrive(world.stops[i]); },
    async ride(i, j) { T.riding = true; const hooks = { progress: (kk) => { T.k = kk; world.setTransit(i, j, kk); } }; await veh.ride(world.stops[i], world.stops[j], hooks); world.setActive(j); T.riding = false; console.log('ride complete'); },
    info() { const b = veh.body; const O = b.deckPos([0, 0, 0]); const y = veh.frame.rotation; return { state: veh.state, mode: veh.mode, k: R(veh.rideK), speed: R(veh.speed), pos: [R(O[0]), R(O[1]), R(O[2])], rot: [R(y.x * 57.3), R(y.y * 57.3), R(y.z * 57.3)], doors: R(veh.doors), ramp: R(veh.rampAngle * 57.3), amp: R(veh.sea.amp), contact: b.contact, fender: R(b.fenderF / 1000), ropeT: b.ropeT.map((v) => R(v / 1000)), t: R(t), calls: gfx.stats.calls, tris: gfx.stats.tris }; },
    events() { return window.__events || []; }, frames: () => frames, ft: () => ft.slice(),
  };
  const loop = () => {
    const n = performance.now(); const dt = Math.min(0.05, (n - last) / 1000); last = n; t += dt; frames++; ft.push(dt * 1000); if (ft.length > 900) ft.shift();
    if (!player._free) player.update(dt);
    world.update(dt, t, gfx.camera.position); fx.update(dt, t, gfx.camera.position);
    if (follow) { veh.frame.updateWorldMatrix(true, false); gfx.camera.position.copy(follow.p).applyMatrix4(veh.frame.matrixWorld); const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(follow.pitch, follow.yaw, 0, 'YXZ')); const fq = new THREE.Quaternion(); veh.frame.getWorldQuaternion(fq); gfx.camera.quaternion.copy(fq.multiply(q)); gfx.camera.updateMatrixWorld(); }
    gfx.shadowCenter.copy(gfx.camera.position); gfx.render(dt, t); input.endFrame(); requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  window.__ready = true;
  (async () => { if (P.get('snap') === '1') { veh.snapDocked(world.stops[from]); } else await veh.arrive(world.stops[from]); console.log('docked'); if (P.get('auto') === '1') await T.ride(from, to); })();
}
