// Hard-surface gun look-dev sandbox (gunsA): ?sandbox=hsgun&gun=m14|m1911|remington870[&light=studio|dusk|tunnel|blue|neon]
// Loads ONLY the three rebuilt models (no viewmodel / hands), so it keeps working while other workers change shared files.
//   __t.gallery(id, view) · __t.view(name) · __t.shot(pos, tgt, fov) (gun-local metres) · __t.fp(id) first-person hip framing (camera at the eye, FOV 50)
//   __t.pose({part:[tx,ty,tz,rx,ry,rz]}) · __t.measure() · __t.stats()
import * as THREE from 'three';
import { compileAtmo } from '../core/gfx.js';
import { Synth } from '../core/synth.js';
import { gunMats } from '../game/weapons/materials.js';
import { modelData, GunRig } from '../game/weapons/rig.js';
import { measureKit } from '../game/weapons/hs-kit.js';
import m14 from '../game/weapons/models/m14.js';
import m1911 from '../game/weapons/models/m1911.js';
import remington870 from '../game/weapons/models/r870.js';

const MODELS = { m14, m1911, remington870 };
const HIP = { // camera-space hip poses (viewmodel.js handling.hip) so first-person framing matches the game
  m14: { p: [0.098, -0.105, -0.17], r: [0.6, 2.2, 0] }, m1911: { p: [0.108, -0.1, -0.385], r: [0.5, 2.5, 0] }, remington870: { p: [0.1, -0.115, -0.17], r: [0.8, 2.2, 0] },
};
export async function run(gfx, P) {
  const synth = new Synth(gfx.renderer); await synth.warm(true);
  const mats = gunMats(gfx.renderer, synth); const T = window.__t = { gfx, mats, THREE };
  const sc = gfx.scene; gfx.vmEnabled = false; const LP = P.get('light') || 'studio';
  const PRE = {
    studio: { atmo: { fog: { color: 0x15181c, density: 0.0005 }, sky: { zenith: 0x14171b, horizon: 0x1e2228, ground: 0x0c0d0e, stars: 0, disc: 0, cloud: 0 }, sun: { dir: [-0.45, 0.75, 0.5], color: 0xfff4e6, intensity: +(P.get('sun') || 3.0), shadow: true }, env: { intensity: +(P.get('env') || 0.85) }, exposure: +(P.get('exp') || 1.0), bloom: 0.1, vignette: 0.22, grain: 0.012, chroma: 0.0004, ao: 0.4, autoExposure: { key: 0.18, min: 1, max: 1 } },
      env: [{ dir: [-0.3, 0.8, 0.5], color: 0xfff2e0, size: 2.6, intensity: 4.2 }, { dir: [0.2, 0.9, -0.3], color: 0xf0f4ff, size: 2.2, intensity: 2.6 }, { dir: [0.9, 0.25, -0.4], color: 0xcfe0ff, size: 1.2, intensity: 3.0 }, { dir: [-0.8, 0.1, -0.6], color: 0xffe0c0, size: 1.0, intensity: 2.0 }, { dir: [-0.9, 0.3, 0.3], color: 0xffffff, size: 1.0, intensity: 1.6 }, { dir: [0, -1, 0], color: 0x3a3c40, size: 3, intensity: 1 }],
      lamps: [{ p: [0.6, 0.5, -0.9], c: 0xcfe0ff, i: 2.2, d: 6 }, { p: [-0.8, 0.2, 0.9], c: 0xffe8d0, i: 1.2, d: 6 }] },
    dusk: { atmo: { fog: { color: 0x3f5480, scatter: 0xf0ab72, density: 0.0021, falloff: 0.03, base: 0, power: 10 }, sky: { zenith: 0x0b1634, horizon: 0xe28a4e, ground: 0x171a26, gradPow: 0.55, sunColor: 0xffa060, sunSize: 0.035, sunGlow: 0.45, disc: 1, stars: 0.5, cloud: 0.5, cloudColor: 0x2b3050, cloudLit: 0xff8e52, cloudSpeed: 0.003, cloudScale: 1.7, cloudDark: 0.6, horizonFog: 0.55 },
      sun: { dir: [0.78, 0.11, 0.52], color: 0xffb074, intensity: 4.4, shadow: true }, env: { intensity: 1.35 }, exposure: 1.0, bloom: 0.3, vignette: 0.36, grain: 0.03, chroma: 0.0014, ao: 0.8, grade: { sat: 1.0, contrast: 1.12, lift: [0.0, 0.004, 0.014], gain: [1.0, 0.99, 1.01], tint: [1, 1, 1] }, autoExposure: { key: 0.2, min: 0.9, max: 1.8 } },
      env: [{ dir: [0.78, 0.11, 0.52], color: 0xff9a55, size: 2.2, intensity: 10 }, { dir: [-0.6, 0.55, -0.4], color: 0x6a88d0, size: 4, intensity: 3.2 }, { dir: [0, 1, 0], color: 0x3a55a0, size: 5, intensity: 2.6 }, { dir: [-0.7, 0.1, 0.5], color: 0x4a62a8, size: 3, intensity: 1.6 }] },
    tunnel: { atmo: { fog: { color: 0x060403, scatter: 0x1f130a, density: 0.026, falloff: 0.0, base: 0, power: 2.5 }, sky: null, sun: { dir: [0.05, 0.03, 1], color: 0xffb060, intensity: 0, shadow: false }, env: { intensity: 0.1 }, exposure: 1.0, bloom: 0.42, vignette: 0.42, grain: 0.04, chroma: 0.0018, ao: 0.9, grade: { sat: 0.94, contrast: 1.16, lift: [0.004, 0.006, 0.012], gain: [1, 1, 1], tint: [1, 1, 1] }, autoExposure: { key: 0.09, min: 1.0, max: 2.6 } },
      env: [{ dir: [0, 1, 0.2], color: 0x90a8d0, size: 4, intensity: 4 }, { dir: [0, 0.2, 1], color: 0xffa060, size: 2, intensity: 1.0 }], lamps: [{ p: [0.9, 0.5, 1.2], c: 0xffb070, i: 14, d: 12 }, { p: [-1.6, 0.9, -1.5], c: 0xffb070, i: 10, d: 12 }], flash: true },
    blue: { atmo: { fog: { color: 0x0b1428, scatter: 0x2a4a8a, density: 0.006, falloff: 0.02, base: 0, power: 4 }, sky: { zenith: 0x040a1c, horizon: 0x16264a, ground: 0x080c18, disc: 2, stars: 0.8, cloud: 0.2 }, sun: { dir: [-0.3, 0.5, 0.45], color: 0x9bb8ff, intensity: 1.1, shadow: true }, env: { intensity: 0.5 }, exposure: 1.5, bloom: 0.4, vignette: 0.4, grain: 0.03, ao: 0.7, autoExposure: { key: 0.12, min: 1.2, max: 2.2 } },
      env: [{ dir: [-0.3, 0.5, 0.45], color: 0x9bb8ff, size: 2.2, intensity: 4 }, { dir: [0, 1, 0], color: 0x233c7a, size: 5, intensity: 2.2 }], lamps: [{ p: [0.7, 0.3, 0.8], c: 0x88aaff, i: 3, d: 8 }] },
    neon: { atmo: { fog: { color: 0x150a22, density: 0.006 }, sky: null, sun: { dir: [0.2, 0.4, 1], color: 0xff60c0, intensity: 0, shadow: false }, env: { intensity: 0.22 }, exposure: 1.3, bloom: 0.55, vignette: 0.4, grain: 0.03, ao: 0.8, autoExposure: { key: 0.12, min: 1.0, max: 2.2 } },
      env: [{ dir: [0.8, 0.4, 0.5], color: 0xff30b0, size: 2.5, intensity: 6 }, { dir: [-0.8, 0.3, 0.3], color: 0x20d8ff, size: 2.5, intensity: 6 }], lamps: [{ p: [0.7, 0.5, 0.6], c: 0xff2aa8, i: 22, d: 8 }, { p: [-0.8, 0.3, 0.4], c: 0x20d0ff, i: 22, d: 8 }, { p: [0.0, 0.9, -0.3], c: 0xffe070, i: 8, d: 8 }] },
  };
  const pre = PRE[LP] || PRE.studio; const atmo = compileAtmo(pre.atmo); atmo.envTex = gfx.makeEnv(pre.atmo, pre.env); gfx.setAtmo(atmo);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.85 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -0.2; floor.receiveShadow = true; sc.add(floor);
  const lamps = (pre.lamps || []).map((l) => gfx.addLight({ kind: 'point', pos: new THREE.Vector3(...l.p), color: l.c, intensity: l.i, distance: l.d }));
  const flashSrc = gfx.addLight({ kind: 'spot', pos: new THREE.Vector3(0.16, -0.12, 0.25), dir: new THREE.Vector3(0, 0, -1), color: 0xfff2dc, intensity: 70, distance: 38, decay: 2, angle: 0.42, penumbra: 0.65, shadow: true, priority: 50, enabled: !!pre.flash });
  gfx.shadowCenter.set(0, 0, 0); gfx.shadowRadius = 1.2;
  const holder = new THREE.Group(); sc.add(holder);
  let rig = null, turntable = 0, view = 'left', fp = false;
  const VIEWS = { left: [0, 4, 1.0, [0, 0, 0]], right: [180, 4, 1.0, [0, 0, 0]], q34: [-35, 18, 1.0, [0, 0, 0]], q34r: [145, 20, 1.0, [0, 0, 0]], top: [0, 80, 1.05, [0, 0, 0]], under: [15, -45, 0.9, [0, 0, 0]] };
  const cam = gfx.camera; cam.fov = 30; cam.near = 0.01; cam.updateProjectionMatrix();
  const place = () => {
    if (!rig || view === '__free' || fp) return; const b = rig.data.box; const size = new THREE.Vector3(); b.getSize(size); const ctr = new THREE.Vector3(); b.getCenter(ctr);
    const v = VIEWS[view] || VIEWS.left; const asp = gfx.aspect || 1.7; const hf = Math.atan(Math.tan(cam.fov * Math.PI / 360) * asp); const L = Math.max(size.z, size.y * 1.9);
    const dist = (L * 0.5 / 0.84) / Math.tan(hf) * v[2]; const tgt = new THREE.Vector3(ctr.x + v[3][0] * size.x, ctr.y + v[3][1] * size.y, ctr.z + v[3][2] * size.z);
    const az = (v[0] + turntable) * Math.PI / 180, el = v[1] * Math.PI / 180;
    cam.position.set(tgt.x - Math.cos(el) * Math.cos(az) * dist, tgt.y + Math.sin(el) * dist, tgt.z + Math.cos(el) * Math.sin(az) * dist); cam.lookAt(tgt); floor.position.y = b.min.y - 0.02;
  };
  T.gallery = (id, v = 'left', o = {}) => {
    if (rig) holder.remove(rig.group); const t0 = performance.now(); const data = modelData(MODELS[id], mats); rig = new GunRig(data, mats, { layer: 0, skinned: true, shadow: true }); holder.add(rig.group);
    fp = false; holder.matrixAutoUpdate = true; holder.position.set(0, 0, 0); holder.quaternion.identity(); view = v; turntable = o.turn || 0; cam.fov = o.fov || 30; cam.updateProjectionMatrix(); place(); T.id = id;
    return { id, tris: data.tris, meshes: rig.meshes.length, buildMs: Math.round(data.ms), build: Math.round(data.msBuild), merge: Math.round(data.msMerge), bake: Math.round(data.msBake), ms: Math.round(performance.now() - t0), mats: rig.meshes.map((m) => m.material.name) };
  };
  T.view = (v, turn = 0) => { fp = false; holder.position.set(0, 0, 0); holder.quaternion.identity(); view = v; turntable = turn; cam.fov = 30; cam.updateProjectionMatrix(); place(); return v; };
  T.shot = (pos, tgt, fov = 30) => { fp = false; holder.position.set(0, 0, 0); holder.quaternion.identity(); view = '__free'; cam.fov = fov; cam.updateProjectionMatrix(); cam.position.set(...pos); cam.lookAt(...tgt); return true; };
  T.pose = (poses) => { for (const [k, a] of Object.entries(poses)) rig.set(k, ...a); return true; };
  // first-person hip framing: camera at the origin looking down -Z, the gun placed by the game's hip pose; optional ADS (rear sight on the axis)
  T.fp = (id = T.id, o = {}) => {
    if (!rig || T.id !== id) T.gallery(id); const H = HIP[id]; const D = Math.PI / 180; fp = true; view = '__fp'; cam.fov = o.fov || 50; cam.near = 0.01; cam.updateProjectionMatrix(); cam.position.set(0, 0, 0); cam.quaternion.identity();
    const e = new THREE.Euler((H.r[0]) * D, (H.r[1]) * D, (H.r[2]) * D, 'YXZ'); holder.position.set(...H.p); holder.quaternion.setFromEuler(e); holder.updateMatrixWorld(true);
    floor.position.y = -1.65; flashSrc.pos.set(0.16, -0.12, -0.25); flashSrc.dir.set(0, 0, -1); return true;
  };
  // material swatches: rounded blocks (metre UVs, like the guns) in a row at z=-3 ; defs: {name: def} adds/overrides finishes on the fly (look-dev without rebuilding models)
  const swatches = new THREE.Group(); sc.add(swatches);
  T.swatch = async (names, defs = {}, o = {}) => {
    const M = await import('../game/weapons/materials.js'); const { rboxRaw } = await import('../game/weapons/hs-kit.js'); Object.assign(M.GUN_MAT_DEFS, defs); swatches.clear(); const raw = rboxRaw(0.05, 0.05, 0.05, 0.004, 3);
    const g = new THREE.BufferGeometry(); const p = new Float32Array(raw.p), n = new Float32Array(raw.n), uv = new Float32Array(p.length / 3 * 2);
    for (let k = 0; k < p.length / 3; k++) { const ax = Math.abs(n[k * 3]), ay = Math.abs(n[k * 3 + 1]), az = Math.abs(n[k * 3 + 2]); if (ax >= ay && ax >= az) { uv[k * 2] = p[k * 3 + 2]; uv[k * 2 + 1] = p[k * 3 + 1]; } else if (ay >= az) { uv[k * 2] = p[k * 3 + 2]; uv[k * 2 + 1] = p[k * 3]; } else { uv[k * 2] = p[k * 3]; uv[k * 2 + 1] = p[k * 3 + 1]; } }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('normal', new THREE.BufferAttribute(n, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(new THREE.BufferAttribute(new Uint32Array(raw.i), 1));
    const wv = new Float32Array(p.length / 3); for (let k = 0; k < wv.length; k++) wv[k] = raw.w[k]; g.setAttribute('aWear', new THREE.BufferAttribute(wv, 1)); g.setAttribute('aCav', new THREE.BufferAttribute(new Float32Array(wv.length * 2), 2));
    names.forEach((nm, i) => { const m = new THREE.Mesh(g, mats.get(nm)); m.position.set((i - (names.length - 1) / 2) * 0.062, 0, 0); m.castShadow = true; m.receiveShadow = true; swatches.add(m); });
    if (holder) holder.visible = false; view = '__free'; fp = false; cam.fov = o.fov || 24; cam.updateProjectionMatrix(); cam.position.set(...(o.pos || [0.04, 0.05, 0.36])); cam.lookAt(...(o.tgt || [0, 0, 0])); floor.position.y = -0.03; return names.length;
  };
  // ADS framing (same maths as viewmodel._adsMatrix): rear sight `eye` metres ahead of the camera, sight line on the axis
  const ADSFOV = { m14: 40, m1911: 48, remington870: 42 }, EYE = { m14: 0.155, m1911: 0.42, remington870: 0.14 };
  T.ads = (id = T.id) => {
    if (!rig || T.id !== id) T.gallery(id); const sk = rig.sockets, R = sk.sightRear.pos.clone(), F = sk.sightFront.pos.clone(), dir = F.clone().sub(R).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(dir, new THREE.Vector3(0, 0, -1)); const pos = new THREE.Vector3(0, 0, -EYE[id]).sub(R.clone().applyQuaternion(q));
    fp = true; view = '__fp'; cam.fov = ADSFOV[id]; cam.near = 0.01; cam.updateProjectionMatrix(); cam.position.set(0, 0, 0); cam.quaternion.identity(); holder.position.copy(pos); holder.quaternion.copy(q); holder.updateMatrixWorld(true); floor.position.y = -1.65; return true;
  };
  T.measure = (checks = []) => { const r = measureKit(rig.data.K, checks); return r.rows.join('\n'); };
  T.stats = () => ({ ...gfx.stats, gpu: +gfx.gpuMsAvg.toFixed(2) });
  T.rig = () => rig; T.place = place; T.lamps = lamps; T.flash = (on = true) => { flashSrc.enabled = !!on; return on; };
  T.gallery(P.get('gun') || 'm14', P.get('view') || 'left'); if (P.get('fp')) T.fp(P.get('gun') || 'm14');
  let t = 0, last = performance.now();
  const loop = () => { const n = performance.now(); const dt = Math.min(0.05, (n - last) / 1000); last = n; t += dt; gfx.render(dt, t); requestAnimationFrame(loop); };
  requestAnimationFrame(loop); await new Promise((r) => setTimeout(r, 400)); window.__ready = true;
}
