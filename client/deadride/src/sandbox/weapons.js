// Weapons sandbox: ?sandbox=weapons[&gun=m1911][&mode=gallery|range]
//  gallery: studio turntable of the unheld gun (skinned rig on layer 0) for grading model detail.
//  range  : lit test range with the real gfx pipeline + viewmodel pass, dummy targets, WeaponSystem, combat mock.
// window.__t: equip(id) fire(n) reload() ads(on) melee() grenade() sprint(on) freeze(clip,t) cam(name) gallery(id,view) stats()
import * as THREE from 'three';
import { compileAtmo } from '../core/gfx.js';
import { Synth } from '../core/synth.js';
import { gunMats } from '../game/weapons/materials.js';
import { modelData, GunRig } from '../game/weapons/rig.js';
import { MODELS } from '../game/weapons/models/index.js';
import { FX } from '../core/fx.js';
import { Builder } from '../core/build.js';
import { Player } from '../core/player.js';
import { input } from '../core/input.js';
import { WeaponSystem, WEAPONS, buildWorldModel, getOutline, getIcon } from '../game/weapons/index.js';
import { CombatMock, Dummy } from '../game/weapons/combat-mock.js';

export async function run(gfx, P) {
  const mode = P.get('mode') || 'gallery';
  const synth = new Synth(gfx.renderer); await synth.warm(true);
  const mats = gunMats(gfx.renderer, synth);
  const T = window.__t = { gfx, mats, THREE };
  if (mode === 'gallery') await gallery(gfx, P, T, mats);
  else if (mode === 'audio') { /* sound analysis page (tools/weapon-audio.mjs) */ }
  else await range(gfx, P, T, synth, mats);
  window.__ready = true;
}

// ------------------------------------------------------------------ studio gallery
async function gallery(gfx, P, T, mats) {
  const sc = gfx.scene; gfx.vmEnabled = false;
  const atmoDef = { fog: { color: 0x15181c, density: 0.0005 }, sky: { zenith: 0x14171b, horizon: 0x1e2228, ground: 0x0c0d0e, stars: 0, disc: 0, cloud: 0 }, sun: { dir: [-0.45, 0.75, 0.5], color: 0xfff4e6, intensity: +(P.get('sun') || 3.0), shadow: true }, env: { intensity: +(P.get('env') || 0.85) }, exposure: +(P.get('exp') || 1.0), bloom: 0.1, vignette: 0.22, grain: 0.012, chroma: 0.0004, ao: 0.4, autoExposure: { key: 0.18, min: 1, max: 1 } };
  const atmo = compileAtmo(atmoDef);
  atmo.envTex = gfx.makeEnv(atmoDef, [{ dir: [-0.3, 0.8, 0.5], color: 0xfff2e0, size: 2.6, intensity: 4.2 }, { dir: [0.2, 0.9, -0.3], color: 0xf0f4ff, size: 2.2, intensity: 2.6 }, { dir: [0.9, 0.25, -0.4], color: 0xcfe0ff, size: 1.2, intensity: 3.0 }, { dir: [-0.8, 0.1, -0.6], color: 0xffe0c0, size: 1.0, intensity: 2.0 }, { dir: [-0.9, 0.3, 0.3], color: 0xffffff, size: 1.0, intensity: 1.6 }, { dir: [0, -1, 0], color: 0x3a3c40, size: 3, intensity: 1 }]);
  gfx.setAtmo(atmo);
  // backdrop: large dark sweep + floor that catches the shadow
  const floorM = new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.85 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), floorM); floor.rotation.x = -Math.PI / 2; floor.position.y = -0.2; floor.receiveShadow = true; sc.add(floor);
  const rim = gfx.addLight({ kind: 'point', pos: new THREE.Vector3(0.6, 0.5, -0.9), color: 0xcfe0ff, intensity: 2.2, distance: 6 });
  const fill = gfx.addLight({ kind: 'point', pos: new THREE.Vector3(-0.8, 0.2, 0.9), color: 0xffe8d0, intensity: 1.2, distance: 6 });
  gfx.shadowCenter.set(0, 0, 0); gfx.shadowRadius = 1.2;
  const holder = new THREE.Group(); sc.add(holder);
  let rig = null, turntable = 0, spin = 0, view = 'left';
  const VIEWS = { // [azimuth deg (0 = looking at the left side), elevation deg, distance factor, target offset [x,y,z] as fraction of size]
    left: [0, 4, 1.0, [0, 0, 0]], right: [180, 4, 1.0, [0, 0, 0]], q34: [-35, 18, 1.0, [0, 0, 0]], q34r: [145, 20, 1.0, [0, 0, 0]], top: [0, 80, 1.05, [0, 0, 0]],
    front: [-88, 6, 0.55, [0, 0, -0.45]], rear: [92, 10, 0.55, [0, 0.05, 0.4]], mech: [170, 12, 0.5, [0, 0.05, 0.05]], grip: [20, -10, 0.55, [0, -0.2, 0.2]], under: [15, -45, 0.9, [0, 0, 0]],
  };
  const cam = gfx.camera; cam.fov = 30; cam.near = 0.01; cam.updateProjectionMatrix();
  const place = () => {
    if (!rig || view === '__free') return; const b = rig.data.box; const size = new THREE.Vector3(); b.getSize(size); const ctr = new THREE.Vector3(); b.getCenter(ctr);
    if (view === 'sights') { const m = rig.meta; const L = m.length || 0.3; const rz = m.rearSightZ ?? 0, sh = m.sightHeight ?? 0.03; cam.position.set(0, sh + L * 0.045, rz + L * 0.75); cam.lookAt(0, sh - L * 0.01, m.frontSightZ ?? -L * 0.5); floor.position.y = rig.data.box.min.y - 0.02; return; }
    const v = VIEWS[view] || VIEWS.left; const asp = gfx.aspect || 1.7; const hf = Math.atan(Math.tan(cam.fov * Math.PI / 360) * asp); const L = Math.max(size.z, size.y * 1.9);
    const dist = (L * 0.5 / 0.84) / Math.tan(hf) * v[2];
    const tgt = new THREE.Vector3(ctr.x + v[3][0] * size.x, ctr.y + v[3][1] * size.y, ctr.z + v[3][2] * size.z);
    const az = (v[0] + turntable) * Math.PI / 180, el = v[1] * Math.PI / 180;
    // azimuth 0 => camera on -X side looking at the gun's left flank
    cam.position.set(tgt.x - Math.cos(el) * Math.cos(az) * dist, tgt.y + Math.sin(el) * dist, tgt.z + Math.cos(el) * Math.sin(az) * dist);
    cam.lookAt(tgt); floor.position.y = b.min.y - 0.02;
  };
  T.gallery = (id, v = 'left', o = {}) => {
    if (rig) { holder.remove(rig.group); }
    const def = MODELS[id]; const t0 = performance.now(); const data = modelData(def, mats); rig = new GunRig(data, mats, { layer: 0, skinned: true, shadow: true }); holder.add(rig.group);
    view = v; turntable = o.turn || 0; spin = o.spin || 0; if (o.fov) { cam.fov = o.fov; cam.updateProjectionMatrix(); } place();
    return { id, tris: data.tris, meshes: rig.meshes.length, buildMs: Math.round(data.ms), ms: Math.round(performance.now() - t0), mats: rig.meshes.map((m) => m.material.name) };
  };
  T.view = (v, turn = 0) => { view = v; turntable = turn; place(); return v; };
  T.pose = (poses) => { for (const [k, a] of Object.entries(poses)) rig.set(k, ...a); return true; };
  T.rig = () => rig; T.place = place;
  T.shot = (pos, tgt, fov = 30) => { view = '__free'; cam.fov = fov; cam.updateProjectionMatrix(); cam.position.set(...pos); cam.lookAt(...tgt); return true; }; // free close-up camera (gun-local metres)
  T.stats = () => ({ ...gfx.stats, gpu: +gfx.gpuMsAvg.toFixed(2) });
  T.gallery(P.get('gun') || 'm1911', P.get('view') || 'left');
  let t = 0, last = performance.now();
  const loop = () => { const n = performance.now(); const dt = Math.min(0.05, (n - last) / 1000); last = n; t += dt; if (spin) { turntable += spin * dt; place(); } gfx.render(dt, t); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  await new Promise((r) => setTimeout(r, 400));
}

// ------------------------------------------------------------------ test range
async function range(gfx, P, T, synth, mats) {
  const sc = gfx.scene; const fx = new FX(gfx); const group = new THREE.Group(); sc.add(group); const B = new Builder({ synth, group, seed: 5 });
  const conc = B.m('conc', { pattern: 'noise', size: 1024, tile: 3, colors: [0x6c6a64, 0x585650, 0x2f2d2a, 0x8a877e], params: { scale: 5, contrast: 3, fine: 96, speckle: 0.04, pores: 0.6, panels: 3, panelWidth: 0.003 }, bump: 3, rough: [0.8, 0.98], layers: { grime: 0.5, cracks: 0.3 } }, { breakup: 0.5 });
  const floorM = B.m('floor', { pattern: 'noise', size: 1024, tile: 4, colors: [0x5a5854, 0x4a4844, 0x2a2826, 0x6a6862], params: { scale: 6, contrast: 2.5, fine: 128, speckle: 0.05, pores: 0.4, panels: 1, panelWidth: 0.004 }, bump: 2, rough: [0.75, 0.95], layers: { grime: 0.6, oil: 0.2 } }, { breakup: 0.6 });
  const steel = B.m('steel', { pattern: 'plates', size: 512, tile: 1.5, colors: [0x4a4e52, 0x3a3e42, 0x1a1c1e], params: { cols: 1, rows: 1, seam: 0.01, rivets: 8, brushed: 0.6 }, bump: 2, metal: 1, rough: [0.35, 0.6], layers: { rust: 0.25, scratch: 0.5 } });
  const wood = B.m('wood', { pattern: 'planks', size: 512, tile: 2, colors: [0x8a6a44, 0x5a4026, 0x1a120a], params: { rows: 8, gap: 0.004, grain: 7, knots: 0.35, cols: 1, weather: 0.3, nails: 1 }, bump: 3, rough: [0.6, 0.9] });
  const sand = B.m('sand', { pattern: 'weave', size: 512, tile: 0.6, colors: [0x7a6a4a, 0x6a5a3c], params: { threads: 40, twill: 0, variation: 0.5, fuzz: 0.8 }, bump: 1.5, rough: [0.9, 1] });
  B.plane({ p: [0, 0, -10], s: [40, 60], mat: floorM, col: 'concrete' });
  B.box({ p: [0, 0, -26], s: [24, 5, 0.6], mat: conc, col: 'concrete' });
  B.box({ p: [-4, 0, -25.4], s: [2.2, 2.2, 0.03], mat: steel, col: 'metal' });
  B.box({ p: [0, 0, -25.5], s: [2.4, 2.4, 0.12], mat: wood, col: 'wood' });
  for (let i = 0; i < 12; i++) B.box({ p: [3.5 + (i % 4) * 0.62 - 0.9, Math.floor(i / 4) * 0.3, -25.2], s: [0.6, 0.3, 0.4], mat: sand, col: 'fabric', bevel: 0.06 });
  B.box({ p: [2.6, 0, -6], s: [0.4, 3.2, 14], mat: conc, col: 'concrete' });     // side wall (wall-retract tests at x = 2.4)
  B.box({ p: [-7, 0, -8], s: [0.4, 3.2, 22], mat: conc, col: 'concrete' });
  B.box({ p: [-1.6, 0, -1.2], s: [1.4, 0.92, 0.7], mat: wood, col: 'wood' }); // bench
  for (const x of [-5, 5]) B.box({ p: [x, 3.2, -8], s: [0.25, 0.25, 22], mat: steel, col: false });
  B.finish();
  const world = { synth, raycast: (ox, oy, oz, dx, dy, dz, maxT, out) => B.colliders.raycast(ox, oy, oz, dx, dy, dz, maxT, out), groundAt: (x, z, yRef, out = { y: 0, surface: 'concrete', col: null }, step = 0.5) => B.colliders.ground(x, z, yRef, step, out), push: (pos, r, y, h, step = 0.45) => B.colliders.push(pos, r, y, h, step), clear: () => true };
  fx.setWorld(world);
  // lighting presets: day (default) | dark | dusk (= Shaft Nine surface yard) | tunnel (= Shaft Nine timbered tunnels, lamps + flashlight)
  const LP = P.get('light') || 'day';
  const PRE = {
    day: { atmo: { fog: { color: 0x8a96a4, scatter: 0xd8c8a8, density: 0.004, falloff: 0.02 }, sky: { zenith: 0x3a5a86, horizon: 0xb0bccc, stars: 0, disc: 1, sunColor: 0xfff0d8, sunGlow: 0.3, cloud: 0.4 }, sun: { dir: [0.45, 0.62, 0.35], color: 0xfff0dc, intensity: 3.6, shadow: true }, env: { intensity: 0.55 }, exposure: 1.0, bloom: 0.35, vignette: 0.3, grain: 0.02, autoExposure: { key: 0.18, min: 0.8, max: 1.5 } },
      env: [{ dir: [0.45, 0.62, 0.35], color: 0xfff0d8, size: 1.4, intensity: 6 }] },
    dark: { atmo: { fog: { color: 0x0b0d10, density: 0.01 }, sky: null, sun: { dir: [0.3, 0.8, 0.2], intensity: 0 }, env: { intensity: 0.12 }, exposure: 1.2, bloom: 0.45, vignette: 0.4, grain: 0.03, autoExposure: { key: 0.14, min: 0.9, max: 2.2 } },
      env: [{ dir: [0, 1, -0.3], color: 0xffc080, size: 1.2, intensity: 3 }], lamps: [[0, 3, -3], [-3, 3, -14]] },
    dusk: { atmo: { fog: { color: 0x3f5480, scatter: 0xf0ab72, density: 0.0021, falloff: 0.03, base: 0, power: 10 },
      sky: { zenith: 0x0b1634, horizon: 0xe28a4e, ground: 0x171a26, gradPow: 0.55, sunColor: 0xffa060, sunSize: 0.035, sunGlow: 0.45, disc: 1, stars: 0.5, cloud: 0.5, cloudColor: 0x2b3050, cloudLit: 0xff8e52, cloudSpeed: 0.003, cloudScale: 1.7, cloudDark: 0.6, horizonFog: 0.55 },
      sun: { dir: [0.78, 0.11, 0.52], color: 0xffb074, intensity: 4.4, shadow: true }, env: { intensity: 1.35 }, exposure: 1.0, bloom: 0.3, vignette: 0.36, grain: 0.03, chroma: 0.0014, ao: 0.8,
      grade: { sat: 1.0, contrast: 1.12, lift: [0.0, 0.004, 0.014], gain: [1.0, 0.99, 1.01], tint: [1, 1, 1] }, autoExposure: { key: 0.2, min: 0.9, max: 1.8 } },
      env: [{ dir: [0.78, 0.11, 0.52], color: 0xff9a55, size: 2.2, intensity: 10 }, { dir: [-0.6, 0.55, -0.4], color: 0x6a88d0, size: 4, intensity: 3.2 }, { dir: [0, 1, 0], color: 0x3a55a0, size: 5, intensity: 2.6 }, { dir: [-0.7, 0.1, 0.5], color: 0x4a62a8, size: 3, intensity: 1.6 }] },
    tunnel: { atmo: { fog: { color: 0x060403, scatter: 0x1f130a, density: 0.026, falloff: 0.0, base: 0, power: 2.5 }, sky: null, sun: { dir: [0.05, 0.03, 1], color: 0xffb060, intensity: 0, shadow: false }, env: { intensity: 0.1 },
      exposure: 1.0, bloom: 0.42, vignette: 0.42, grain: 0.04, chroma: 0.0018, ao: 0.9, grade: { sat: 0.94, contrast: 1.16, lift: [0.004, 0.006, 0.012], gain: [1.0, 1.0, 1.0], tint: [1, 1, 1] }, autoExposure: { key: 0.09, min: 1.0, max: 2.6 } },
      env: [{ dir: [0, 1, 0.2], color: 0x90a8d0, size: 4, intensity: 4 }, { dir: [0, 0.2, 1], color: 0xffa060, size: 2, intensity: 1.0 }], lamps: [[1.5, 2.6, -4], [-2, 2.6, -12]], lampI: 14, flash: true },
  };
  const pre = PRE[LP] || PRE.day; const atmoDef = pre.atmo;
  const atmo = compileAtmo(atmoDef); atmo.envTex = gfx.makeEnv(atmoDef, pre.env); gfx.setAtmo(atmo);
  for (const l of pre.lamps || []) gfx.addLight({ kind: 'point', pos: new THREE.Vector3(...l), color: 0xffb070, intensity: pre.lampI || 30, distance: 16 });
  // the game's flashlight (game.js: spot 70 cd, 38 m, placed eye + 0.16 right - 0.12 up + 0.25 forward)
  const flashSrc = gfx.addLight({ kind: 'spot', pos: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1), color: 0xfff2dc, intensity: 70, distance: 38, decay: 2, angle: 0.42, penumbra: 0.65, shadow: true, priority: 50, enabled: !!(pre.flash || P.get('flash')) });
  T.flashlight = (on = true) => { flashSrc.enabled = !!on; return on; };
  const dm = new THREE.MeshStandardMaterial({ color: 0x6a5a44, roughness: 0.85 }), hm = new THREE.MeshStandardMaterial({ color: 0x8a7a5a, roughness: 0.8 });
  const targets = [new Dummy(sc, [-2, 0, -8], dm, hm), new Dummy(sc, [1.2, 0, -13], dm, hm), new Dummy(sc, [-0.5, 0, -19], dm, hm)];
  input.init(gfx.canvas); input.locked = true; // scripted input: treat as pointer-locked
  const player = new Player(gfx, world, input); player.teleport([0, 0, 0], 0);
  let audio = null; try { audio = (await import('../core/audio.js')).audio; await audio.init(); } catch (e) { console.warn('audio unavailable:', e.message); audio = { ready: false, register() {}, play() { return null; }, get() { return null; }, lib: null, update() {} }; }
  const combat = new CombatMock({ world, fx, audio, targets });
  const ws = new WeaponSystem({ gfx, fx, audio, world, player, input, combat });
  ws.give(P.get('gun') || 'm1911'); if (P.get('gun2')) ws.give(P.get('gun2'));
  Object.assign(T, { fx, world, player, ws, input, combat, targets, audio, B, buildWorldModel, getOutline, getIcon, WEAPONS });
  let t = 0, last = performance.now(), frames = 0, timeScale = 1; const ft = []; let inspect = null;
  const hold = (code, on) => input.hold(code, on);
  T.equip = async (id) => { ws.give(id); await wait(900); return ws.currentId; };
  T.fire = async (n = 1, gap = null) => { const spec = WEAPONS[ws.currentId]; if (spec.mode === 'auto') { input.holdMouse(0, true); await wait((60 / spec.rpm) * 1000 * n - 5); input.holdMouse(0, false); } else for (let i = 0; i < n; i++) { input.holdMouse(0, true); await wait(40); input.holdMouse(0, false); await wait(gap ?? Math.max(60, 1000 / (spec.triggerRate || 5))); } return ws.current.mag; };
  T.reload = () => { input.tap('KeyR'); return true; }; T.melee = () => { input.tap('KeyV'); return true; }; T.grenade = () => { input.tap('KeyG'); return true; };
  T.ads = (on = true) => { input.holdMouse(2, !!on); return on; }; T.sprint = (on = true) => { hold('KeyW', on); hold('ShiftLeft', on); return on; }; T.walk = (on = true) => { hold('KeyW', on); return on; };
  T.look = (dx, dy) => { input.look(dx, dy); return true; };
  T.freeze = (clip, tt) => ws.freeze(clip, tt); T.still = (on = true) => { ws.vm.still = on; return on; };
  T.setTime = (s) => { timeScale = s; return s; };
  T.cam = (name) => { const C = { range: [0, 0, 0, 0, 0], wall: [2.0, 0, -4, -Math.PI / 2, 0], down: [0, 0, 0, 0, -0.9], up: [0, 0, 0, 0, 0.35], dummy: [0, 0, 0, 0.1, -0.02] }[name] || name; player.teleport([C[0], C[1], C[2]], C[3]); player.pitch = C[4]; return name; };
  T.inspect = (on = true, az = 30, el = 10, dist = 0.9, tgt = [0.05, -0.12, -0.3]) => { // orbit an external camera around the view-model
    const vm = ws.vm; if (!on) { if (inspect) { gfx.vmCamera.add(vm.root); vm.root.traverse((o) => { if (o.isMesh) o.layers.set(1); }); gfx.vmEnabled = true; inspect = null; } return false; }
    if (!inspect) { inspect = new THREE.Group(); sc.add(inspect); inspect.add(vm.root); inspect.userData.q = gfx.camera.quaternion.clone(); inspect.userData.p = player.eye.clone(); }
    vm.root.traverse((o) => { if (o.isMesh) o.layers.enable(0); }); inspect.position.copy(inspect.userData.p); inspect.quaternion.copy(inspect.userData.q); gfx.vmEnabled = false;
    const a = az * Math.PI / 180, e = el * Math.PI / 180; const tw = new THREE.Vector3(...tgt).applyQuaternion(inspect.quaternion).add(inspect.position);
    const offs = new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)).multiplyScalar(dist).applyQuaternion(inspect.quaternion);
    inspect.userData.cam = [tw.clone().add(offs), tw]; return true;
  };
  // live tuning: T.frame('gripR', {p, fd, pn}) ; T.pose('pistolGrip', [[...5]...]) ; T.hideGun(true)
  T.frame = async (name, F) => { const { handQuat } = await import('../game/weapons/hands.js'); const g = ws.vm.cur; const part = g.data.K.byName[F.part || 'root']; const q = handQuat(F.fd, F.pn); const m = new THREE.Matrix4().compose(new THREE.Vector3(...F.p), q, new THREE.Vector3(1, 1, 1)); m.premultiply(new THREE.Matrix4().makeTranslation(-part.pivot.x, -part.pivot.y, -part.pivot.z)); g.frames[name] = { bone: part.index, local: m }; return true; };
  T.pose = async (name, arr) => { const H = await import('../game/weapons/hands.js'); H.POSES[name] = arr; const a = H.poseArr(arr); if (H.POSE_ARR[name]) H.POSE_ARR[name].set(a); else H.POSE_ARR[name] = a; return true; };
  T.clip = async (name, def) => { const { makeClip } = await import('../game/weapons/anim.js'); ws.vm.cur.clips[name] = makeClip({ ...def, name }); return true; };
  T.clipDef = (name) => ws.vm.cur.clips[name]?.def;
  T.flash = (hold = true) => { const f = ws.vm.cur.flash; if (!f) return false; f.fire(1); f.hold = hold; return true; };
  T.hideGun = (on = true) => { ws.vm.hideGun = on; return on; };
  T.hip = (p, r) => { const g = ws.vm.cur; g.hipM = ws.vm._poseMatrix({ p, r }); return true; };
  T.stats = () => { const vm = ws.vm; let calls = 0, tris = 0; vm.root.traverse((o) => { if (o.isMesh && o.visible && isVisible(o)) { calls++; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3 * (o.geometry.instanceCount ?? 1); } }); return { frame: { ...gfx.stats }, vm: { calls, tris: Math.round(tris) }, gpu: +gfx.gpuMsAvg.toFixed(2), ws: ws.stats(), ft: ft.slice(-120).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(120, ft.length)) }; };
  T.state = () => ({ id: ws.currentId, state: ws.state, mag: ws.current?.mag, reserve: ws.current?.reserve, grenades: ws.grenades, ads: +ws.adsK.toFixed(2), sprint: +ws.sprintK.toFixed(2), wall: +ws.wallK.toFixed(2), spread: +ws.spread.toFixed(4), pitch: +player.pitch.toFixed(4), shots: combat.shots, hits: targets.map((d) => d.hits) });
  const isVisible = (o) => { while (o) { if (!o.visible) return false; o = o.parent; } return true; };
  const loop = () => {
    const n = performance.now(); let dt = Math.min(0.05, (n - last) / 1000); last = n; ft.push(dt * 1000); if (ft.length > 600) ft.shift(); dt *= timeScale; t += dt; frames++;
    gfx.fxShake = fx.shake; player.update(dt); ws.update(dt, t);
    if (flashSrc.enabled) { flashSrc.pos.copy(player.eye).addScaledVector(player.right, 0.16).addScaledVector(_up, -0.12).addScaledVector(player.forward, 0.25); flashSrc.dir.copy(player.forward); }
    if (inspect) { const c = inspect.userData.cam; if (c) { gfx.camera.position.copy(c[0]); gfx.camera.lookAt(c[1]); gfx.camera.updateMatrixWorld(); } }
    for (const d of targets) d.update(dt); fx.update(dt, t, gfx.camera.position); audio.update?.(dt, { pos: gfx.camera.position, forward: player.forward, up: { x: 0, y: 1, z: 0 } }, {});
    gfx.shadowCenter.copy(player.pos); gfx.setFov(player.fov * (ws.fovMul ?? (1 - 0.34 * player.adsK))); gfx.render(dt, t); input.endFrame(); requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop); await wait(1200);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const _up = new THREE.Vector3(0, 1, 0);
