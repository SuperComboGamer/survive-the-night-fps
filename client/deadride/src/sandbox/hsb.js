// HSB gun-model studio (independent of the hands/viewmodel modules so gun modelling can be reviewed while those are being reworked):
//   ?sandbox=hsb&gun=ak74u[&view=left]   window.__t: gallery(id, view, {turn,spin,fov}) view(v, turn) shot(pos, tgt, fov) pose({part:[...]}) dims(part?) stats() light(name)
import * as THREE from 'three';
import { compileAtmo } from '../core/gfx.js';
import { Synth } from '../core/synth.js';
import { gunMats } from '../game/weapons/materials.js';
import { modelData, GunRig, bakeCavity } from '../game/weapons/rig.js';
import { Kit } from '../game/weapons/geo.js';
import mp5 from '../game/weapons/models/mp5.js';
import ak74u from '../game/weapons/models/ak74u.js';
import olympia from '../game/weapons/models/olympia.js';
import raygun from '../game/weapons/models/raygun.js';
const MODELS = { mp5, ak74u, olympia, raygun };

export async function run(gfx, P) {
  const synth = new Synth(gfx.renderer); await synth.warm(true); const mats = gunMats(gfx.renderer, synth); mats.util();
  const T = window.__t = { gfx, mats, THREE }; const sc = gfx.scene; gfx.vmEnabled = false;
  const LIGHTS = {
    studio: { atmo: { fog: { color: 0x15181c, density: 0.0005 }, sky: { zenith: 0x14171b, horizon: 0x1e2228, ground: 0x0c0d0e, stars: 0, disc: 0, cloud: 0 }, sun: { dir: [-0.45, 0.75, 0.5], color: 0xfff4e6, intensity: 3.0, shadow: true }, env: { intensity: 0.85 }, exposure: 1.0, bloom: 0.1, vignette: 0.22, grain: 0.012, chroma: 0.0004, ao: 0.4, autoExposure: { key: 0.18, min: 1, max: 1 } },
      env: [{ dir: [-0.3, 0.8, 0.5], color: 0xfff2e0, size: 2.6, intensity: 4.2 }, { dir: [0.2, 0.9, -0.3], color: 0xf0f4ff, size: 2.2, intensity: 2.6 }, { dir: [0.9, 0.25, -0.4], color: 0xcfe0ff, size: 1.2, intensity: 3.0 }, { dir: [-0.8, 0.1, -0.6], color: 0xffe0c0, size: 1.0, intensity: 2.0 }, { dir: [-0.9, 0.3, 0.3], color: 0xffffff, size: 1.0, intensity: 1.6 }, { dir: [0, -1, 0], color: 0x3a3c40, size: 3, intensity: 1 }] },
    dusk: { atmo: { fog: { color: 0x3f5480, scatter: 0xf0ab72, density: 0.0021, falloff: 0.03, base: 0, power: 10 }, sky: { zenith: 0x0b1634, horizon: 0xe28a4e, ground: 0x171a26, gradPow: 0.55, sunColor: 0xffa060, sunSize: 0.035, sunGlow: 0.45, disc: 1, stars: 0.5, cloud: 0.5, cloudColor: 0x2b3050, cloudLit: 0xff8e52, cloudSpeed: 0.003, cloudScale: 1.7, cloudDark: 0.6, horizonFog: 0.55 },
      sun: { dir: [-0.5, 0.11, 0.6], color: 0xffb074, intensity: 4.4, shadow: true }, env: { intensity: 1.35 }, exposure: 1.0, bloom: 0.3, vignette: 0.36, grain: 0.03, chroma: 0.0014, ao: 0.8, grade: { sat: 1.0, contrast: 1.12, lift: [0.0, 0.004, 0.014], gain: [1.0, 0.99, 1.01], tint: [1, 1, 1] }, autoExposure: { key: 0.2, min: 0.9, max: 1.8 } },
      env: [{ dir: [-0.5, 0.11, 0.6], color: 0xff9a55, size: 2.2, intensity: 10 }, { dir: [0.6, 0.55, -0.4], color: 0x6a88d0, size: 4, intensity: 3.2 }, { dir: [0, 1, 0], color: 0x3a55a0, size: 5, intensity: 2.6 }] },
  };
  let lightSrc = []; T.light = (name = 'studio') => { const L = LIGHTS[name] || LIGHTS.studio; const atmo = compileAtmo(L.atmo); atmo.envTex = gfx.makeEnv(L.atmo, L.env); gfx.setAtmo(atmo); return name; };
  T.light(P.get('light') || 'studio'); LIGHTS.noao = JSON.parse(JSON.stringify(LIGHTS.studio)); LIGHTS.noao.atmo.ao = 0;
  const floorM = new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.85 }); const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), floorM); floor.rotation.x = -Math.PI / 2; floor.position.y = -0.2; floor.receiveShadow = true; sc.add(floor);
  gfx.addLight({ kind: 'point', pos: new THREE.Vector3(0.6, 0.5, -0.9), color: 0xcfe0ff, intensity: 2.2, distance: 6 }); gfx.addLight({ kind: 'point', pos: new THREE.Vector3(-0.8, 0.2, 0.9), color: 0xffe8d0, intensity: 1.2, distance: 6 });
  gfx.shadowCenter.set(0, 0, 0); gfx.shadowRadius = 1.2;
  const holder = new THREE.Group(); sc.add(holder); let rig = null, turntable = 0, spin = 0, view = 'left';
  const VIEWS = { left: [0, 4, 1.0, [0, 0, 0]], right: [180, 4, 1.0, [0, 0, 0]], q34: [-35, 18, 1.0, [0, 0, 0]], q34r: [145, 20, 1.0, [0, 0, 0]], top: [0, 80, 1.05, [0, 0, 0]], front: [-88, 6, 0.55, [0, 0, -0.45]], rear: [92, 10, 0.55, [0, 0.05, 0.4]], under: [15, -45, 0.9, [0, 0, 0]] };
  const cam = gfx.camera; cam.fov = 30; cam.near = 0.01; cam.updateProjectionMatrix();
  const place = () => {
    if (!rig || view === '__free') return; const b = rig.data.box; const size = new THREE.Vector3(); b.getSize(size); const ctr = new THREE.Vector3(); b.getCenter(ctr);
    const v = VIEWS[view] || VIEWS.left; const asp = gfx.aspect || 1.7; const hf = Math.atan(Math.tan(cam.fov * Math.PI / 360) * asp); const L = Math.max(size.z, size.y * 1.9); const dist = (L * 0.5 / 0.84) / Math.tan(hf) * v[2];
    const tgt = new THREE.Vector3(ctr.x + v[3][0] * size.x, ctr.y + v[3][1] * size.y, ctr.z + v[3][2] * size.z); const az = (v[0] + turntable) * Math.PI / 180, el = v[1] * Math.PI / 180;
    cam.position.set(tgt.x - Math.cos(el) * Math.cos(az) * dist, tgt.y + Math.sin(el) * dist, tgt.z + Math.cos(el) * Math.sin(az) * dist); cam.lookAt(tgt); floor.position.y = b.min.y - 0.02;
  };
  T.gallery = (id, v = 'left', o = {}) => {
    if (rig) holder.remove(rig.group); const def = MODELS[id]; const t0 = performance.now(); const data = modelData(def, mats); rig = new GunRig(data, mats, { layer: 0, skinned: true, shadow: true }); for (const m of rig.meshes) m.receiveShadow = false; holder.add(rig.group); // no self-shadowing: the studio sun map acnes on round tubes
    view = v; turntable = o.turn || 0; spin = o.spin || 0; if (o.fov) { cam.fov = o.fov; cam.updateProjectionMatrix(); } place();
    return { id, tris: data.tris, meshes: rig.meshes.length, buildMs: Math.round(data.ms), ms: Math.round(performance.now() - t0), mats: rig.meshes.map((m) => m.material.name) };
  };
  T.view = (v, turn = 0) => { view = v; turntable = turn; cam.fov = 30; cam.updateProjectionMatrix(); place(); return v; };
  T.pose = (poses) => { for (const [k, a] of Object.entries(poses)) rig.set(k, ...a); return true; };
  T.rig = () => rig; T.place = place;
  T.shot = (pos, tgt, fov = 30) => { view = '__free'; cam.fov = fov; cam.updateProjectionMatrix(); cam.position.set(...pos); cam.lookAt(...tgt); return true; };
  T.dims = (part) => { const K = rig.data.K, box = new THREE.Box3(); const parts = part ? [K.byName[part]] : K.parts; for (const p of parts) for (const [, b] of p.bufs) for (let i = 0; i < b.P.length; i += 3) box.expandByPoint(new THREE.Vector3(b.P[i], b.P[i + 1], b.P[i + 2])); const s = new THREE.Vector3(); box.getSize(s); return { min: box.min.toArray().map((x) => +(x * 1000).toFixed(1)), max: box.max.toArray().map((x) => +(x * 1000).toFixed(1)), size_mm: s.toArray().map((x) => +(x * 1000).toFixed(1)) }; };
  T.debug = (mode) => { const g = rig.meshes; for (const m of g) { const geo = m.geometry;
      if (mode === 'nowear') { geo.attributes.aWear.array.fill(0); geo.attributes.aWear.needsUpdate = true; }
      if (mode === 'nocav') { geo.attributes.aCav.array.fill(0); geo.attributes.aCav.needsUpdate = true; }
      if (mode === 'plain') { m.userData.orig = m.userData.orig || m.material; m.material = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.5, metalness: 0.6 }); }
      if (mode === 'nomaps') { const mt = m.material; m.userData.maps = m.userData.maps || { map: mt.map, n: mt.normalMap, r: mt.roughnessMap, a: mt.aoMap }; mt.map = null; mt.normalMap = null; mt.roughnessMap = null; mt.metalnessMap = null; mt.aoMap = null; mt.color.set(0x1a1b1e); mt.roughness = 0.65; mt.metalness = 0; mt.needsUpdate = true; }
      if (mode === 'noao') { }
      if (mode === 'restore' && m.userData.orig) m.material = m.userData.orig; } return mode; };
  // first-person preview WITHOUT hands: same pose maths as viewmodel.js (hip pose / ADS from the sight sockets), rendered through the real view-model pass
  const SPEC = { mp5: [52, 44], ak74u: [52, 44], olympia: [54, 42], raygun: [54, 48] };
  T.vm = (id, mode = 'hip', state = {}) => {
    if (rig) holder.remove(rig.group); if (rig && rig.group.parent) rig.group.parent.remove(rig.group);
    const def = MODELS[id]; const data = modelData(def, mats); rig = new GunRig(data, mats, { layer: 1, skinned: true }); const H = def.handling; const D = Math.PI / 180;
    const E = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
    const pm = (p) => { E.set((p.r?.[0] || 0) * D, (p.r?.[1] || 0) * D, (p.r?.[2] || 0) * D, 'YXZ'); return new THREE.Matrix4().compose(new THREE.Vector3(...p.p), new THREE.Quaternion().setFromEuler(E), one); };
    const hip = pm(H.hip), s = rig.sockets, R = s.sightRear.pos.clone(), F = s.sightFront.pos.clone(); const q = new THREE.Quaternion().setFromUnitVectors(F.clone().sub(R).normalize(), new THREE.Vector3(0, 0, -1));
    const pos = new THREE.Vector3(0, 0, -(H.eye ?? 0.3)).sub(R.clone().applyQuaternion(q)); if (H.adsOffset) pos.add(new THREE.Vector3(...H.adsOffset)); const ads = new THREE.Matrix4().compose(pos, q, one);
    const M = mode === 'ads' ? ads : hip; rig.group.matrixAutoUpdate = false; rig.group.matrix.copy(M); rig.group.matrixWorldNeedsUpdate = true;
    rig.reset(); if (H.parts) H.parts(rig, { mag: 30, barrels: [1, 1], ...state }, { time: 0 }); rig.solve();
    gfx.vmCamera.add(rig.group); gfx.vmEnabled = true; gfx.setVmFov(SPEC[id][mode === 'ads' ? 1 : 0]);
    for (const m of holder.children) m.visible = false; cam.fov = 60; cam.updateProjectionMatrix(); cam.position.set(0, 1.7, 0); cam.lookAt(0, 1.62, -10); floor.position.y = 0; return { id, mode };
  };
  T.timeBuild = (id) => { const def = MODELS[id]; const t0 = performance.now(); const K = new Kit(def.id); def.build(K, mats); const t1 = performance.now(); const g = K.geometry(); const t2 = performance.now(); bakeCavity(g.geos); const t3 = performance.now(); return { id, build: Math.round(t1 - t0), merge: Math.round(t2 - t1), bake: Math.round(t3 - t2), total: Math.round(t3 - t0), tris: g.tris, verts: [...g.geos.values()].reduce((a, q) => a + q.attributes.position.count, 0), draws: g.geos.size }; };
  T.stats = () => ({ ...gfx.stats, gpu: +gfx.gpuMsAvg.toFixed(2) });
  T.gallery(P.get('gun') || 'ak74u', P.get('view') || 'left');
  let t = 0, last = performance.now();
  const loop = () => { const n = performance.now(); const dt = Math.min(0.05, (n - last) / 1000); last = n; t += dt; if (spin) { turntable += spin * dt; place(); } gfx.render(dt, t); requestAnimationFrame(loop); };
  requestAnimationFrame(loop); await new Promise((r) => setTimeout(r, 400)); window.__ready = true;
}
