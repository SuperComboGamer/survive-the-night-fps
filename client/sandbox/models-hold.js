// Third-person hold sandbox (loaded by models-test.js when ?hold= is present): one survivor holding an item, posed
// and frozen, seen close up round its hands, with a clip check of the item against the body.
//   ?hold=ITEMID        what is in the right hand (0: nothing)
//   &pose=idle|walk|sprint|crouch|crouchwalk|lookup|lookdown|reload|fire|melee|throw|downed|seated|swim|air
//   &t=SECONDS          the clock (pulses - fire, melee, throw - start at t=1; t is the time after that for them)
//   &pack=1             wearing the crafted backpack;  &seed=N  which survivor;  &look=CODE  a custom survivor
//                       instead (the character creator: shared/appearance.js lookCode)
//   &cam=yaw,pitch,dist[,tx,ty,tz]   an orbit round the right hand (tx..: offset of the target from it, m), or
//   &cam=body,yaw,pitch,dist          round the chest (the whole figure);  default: round the right hand from the front
//   &clip=1             measure (window.__clip): the deepest item vertex inside the body, body vertex inside the item,
//                       body vertex inside the worn pack, and (on its own: a fist is a block closed round a handle)
//                       item vertex inside a fist
//   &dots=1             with clip=1: mark them;  &xray=1  the item see-through
//   &nk=SCRIPT          nunchucks (?hold=57): play their moves (nk-script.js), starting at t = 1 like the pulses, so
//                       &t is the time into the script; &hit=flesh|... lands the blows.  &ts=a,b,c: a strip of frames
//                       at those times (no clip check);  &slow=K: the clock run K times slower between frames (the
//                       chain's own steps do not change: it is the same motion, looked at more often)
//   &cat=1              the stray cat in their arms (s.cradle; &pet=1 stroking it, &coat=N its coat). The clip check
//                       counts the cat, as its skinned mesh is posed, as the item
import * as THREE from 'three';
import * as CHARS from '../render/models/characters.js';
import { createCat } from '../render/models/cat.js';
import { CANIM } from '../../shared/defs.js';
import { nkScript } from './nk-script.js';
const { createSurvivor } = CHARS;

const q = new URLSearchParams(location.search);
const info = document.getElementById('info');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101318);
scene.add(new THREE.HemisphereLight(0xb4bccc, 0x2a2418, 1.6));
const key = new THREE.DirectionalLight(0xffe6c8, 2.2);
key.position.set(-2, 4, -3);
scene.add(key);
const rim = new THREE.DirectionalLight(0x8090c0, 0.8);
rim.position.set(3, 2, 3);
scene.add(rim);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshLambertMaterial({ color: 0x2a2b26 }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

if (q.has('pocket')) CHARS.setStockPocket?.(...q.get('pocket').split(',').map(Number)); // &pocket=z[,rpgLift]: where a shouldered butt ends (tuning)
// &cradle=pitch,abd,twist,elbow / &petarm=... / &catat=x,y,z: the cat-in-arms pose and where the cat lies (tuning)
const nums = (k) => (q.has(k) ? q.get(k).split(',').map(Number) : null);
if (q.has('cradle') || q.has('petarm') || q.has('catat')) CHARS.setCradle(nums('cradle'), nums('petarm'), nums('catat'));
const item = +(q.get('hold') || 0);
const pose = q.get('pose') || 'idle';
const T = +(q.get('t') ?? 1);
const sv = q.has('look') ? createSurvivor(1, 'a:' + q.get('look')) : createSurvivor(+(q.get('seed') || 3));
sv.setWeapon(item);
if (q.get('pack') === '1') sv.setBackpack(true);
scene.add(sv.object);
const o = sv.object;
o.rotation.order = 'YXZ';
const st = { speed: 0, sprint: false, crouch: false, pitch: 0, onGround: true, reloading: false, dead: false, sit: false, swim: false };
if (pose === 'walk') st.speed = 4.3;
if (pose === 'sprint') Object.assign(st, { speed: 7.5, sprint: true });
if (pose === 'crouch') st.crouch = true;
if (pose === 'crouchwalk') Object.assign(st, { crouch: true, speed: 2 });
if (pose === 'lookup') st.pitch = 0.9;
if (pose === 'lookdown') st.pitch = -0.9;
if (pose === 'reload') st.reloading = true;
if (pose === 'downed') Object.assign(st, { crouch: true, speed: 0.4, pitch: 0.9 });
if (pose === 'seated') st.sit = true;
if (pose === 'swim') Object.assign(st, { swim: true, speed: 1.5 });
if (pose === 'air') st.onGround = false;
// &cat=1: the stray cat in their arms (Entities: the weapon put away, the cat drawn at cradleAt, its head to their left)
const cat = q.get('cat') === '1' ? createCat(+(q.get('coat') || 0), 5) : null;
if (cat) {
  sv.setWeapon(0);
  st.cradle = true;
  st.pet = q.get('pet') === '1';
  scene.add(cat.object);
}
const placeCat = (time) => {
  if (!cat) return;
  sv.object.updateMatrixWorld(true);
  sv.cradleAt(cat.object.position);
  cat.object.rotation.y = sv.object.rotation.y + Math.PI / 2;
  cat._inst._seen = true;
  cat.update(DT, st.pet ? CANIM.PET : CANIM.HELD, 0, time);
};
if (pose === 'downed') {
  o.rotation.x = -1.3;
  o.position.y = 0.18;
}
if (pose === 'seated') o.position.y = 0.45;
// (Entities puts the weapon away in the water)
if (pose === 'swim') sv.setWeapon(0);
const pulse = { fire: () => sv.fire(), melee: () => sv.melee(), throw: () => sv.throwAnim() }[pose];
const nk = q.has('nk') ? nkScript(q.get('nk'), q.get('hit') || '') : null;
if (nk && nk.crouch) st.crouch = true;
const inst = sv._inst;
if (nk && inst.nk) inst.nk.core.noIdle = q.get('nk') !== 'idle';
const times = q.has('ts') ? q.get('ts').split(',').map(Number) : null;
const DT = 1 / 60;
const total = (pulse || nk ? 1 : 0) + (times ? Math.max(...times) : T);
let time = 0, nkAt = 0, shot = 0;
const handR = inst.bones[15]; // HAND_R (characters.js)
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.01, 50);
const aim = () => {
  const c = (q.get('cam') || '0.5,0.15,0.75').split(',');
  const body = c[0] === 'body';
  const [yaw, pitch, dist, tx = 0, ty = 0, tz = 0] = (body ? c.slice(1) : c).map(Number);
  const tgt = new THREE.Vector3();
  if (body) tgt.set(0, pose === 'downed' ? 0.4 : 1.1, 0).applyMatrix4(o.matrixWorld);
  else (inst.weapon || handR).getWorldPosition(tgt);
  tgt.add(new THREE.Vector3(+tx, +ty, +tz));
  // yaw 0 = in front of the survivor (it faces -Z)
  camera.position.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(dist).add(tgt);
  camera.lookAt(tgt);
};
// &ts=: one tile a frame, drawn as the clock passes each time
const cols = times ? Math.min(times.length, +(q.get('cols') || 6)) : 1, rows = times ? Math.ceil(times.length / cols) : 1;
const tile = () => {
  const tw = Math.floor(innerWidth / cols), th = Math.floor(innerHeight / rows);
  const x = (shot % cols) * tw, y = innerHeight - (((shot / cols) | 0) + 1) * th;
  camera.aspect = tw / th;
  camera.updateProjectionMatrix();
  scene.updateMatrixWorld(true);
  aim();
  renderer.setScissorTest(true);
  renderer.setViewport(x, y, tw, th);
  renderer.setScissor(x, y, tw, th);
  renderer.render(scene, camera);
  shot++;
};
if (times) renderer.autoClear = true;
for (let i = 0, n = Math.round(total / DT); i < n; i++) {
  time += DT;
  if (pulse && Math.abs(time - 1) < DT / 2) pulse();
  if (nk) {
    for (; nkAt < nk.events.length && nk.events[nkAt].t <= time - 1 + 1e-6; nkAt++) {
      const e = nk.events[nkAt];
      if (e.swing !== undefined) sv.nkSwing(e.swing);
      if (e.hit) sv.nkHit(e.hit.kind, e.hit.power);
      if (e.flourish) sv.nkFlourish();
      if (e.set) Object.assign(st, e.set);
    }
    st.wind = nk.wind(time - 1);
  }
  inst._seen = true; // (nothing is drawn between the steps: the pose is still wanted)
  sv.update(DT, { ...st, time });
  placeCat(time);
  scene.updateMatrixWorld(true);
  while (times && shot < times.length && times[shot] <= time - (pulse || nk ? 1 : 0) + 1e-6) tile();
}
scene.updateMatrixWorld(true);
if (times) {
  info.textContent = `hold ${item} ${nk ? 'nk=' + q.get('nk') : 'pose ' + pose} ts=${times.join(',')}`;
}
{
  const c = (q.get('cam') || '0.5,0.15,0.75').split(',');
  const body = c[0] === 'body';
  const [yaw, pitch, dist, tx = 0, ty = 0, tz = 0] = (body ? c.slice(1) : c).map(Number);
  const tgt = new THREE.Vector3();
  if (body) tgt.set(0, pose === 'downed' ? 0.4 : 1.1, 0).applyMatrix4(o.matrixWorld);
  else (inst.weapon || handR).getWorldPosition(tgt);
  tgt.add(new THREE.Vector3(+tx, +ty, +tz));
  // yaw 0 = in front of the survivor (it faces -Z)
  camera.position.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(dist).add(tgt);
  camera.lookAt(tgt);
}
if (q.get('xray') === '1' && inst.weapon) {
  const glass = new THREE.MeshLambertMaterial({ color: 0x88aaff, transparent: true, opacity: 0.4, depthWrite: false });
  inst.weapon.traverse((m) => {
    if (m.isMesh) {
      m.material = glass;
      m.renderOrder = 5;
    }
  });
}
if (!times) {
  renderer.render(scene, camera);
  info.textContent = `hold ${item} ${nk ? 'nk=' + q.get('nk') : 'pose ' + pose} t=${T}`;
}

// ---------------------------------------------------------------- clip check
// Same rule as the viewmodel's (models-vm.js): a vertex is inside a model when the first face three of four rays from
// it meet is a back face. The body is skinned: its vertices are skinned on the CPU, and it is turned into a static
// mesh of where they are now for the rays.
if (q.get('clip') === '1') {
  const body = inst.mesh;
  const g = body.geometry, pos = g.attributes.position;
  const sk = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    body.getVertexPosition(i, v);
    v.applyMatrix4(body.matrixWorld);
    sk[i * 3] = v.x;
    sk[i * 3 + 1] = v.y;
    sk[i * 3 + 2] = v.z;
  }
  // which bone a body vertex mostly follows, for the report and to tell the fists from the rest
  const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  const boneOf = (i) => {
    let b = 0, w = -1;
    for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > w) (w = sw.getComponent(i, k)), (b = si.getComponent(i, k));
    return inst.bones[b] ? inst.bones[b].name || 'bone' + b : '?';
  };
  const FIST = /^hand[LR]$/;
  const fistV = new Uint8Array(pos.count);
  for (let i = 0; i < pos.count; i++) fistV[i] = FIST.test(boneOf(i)) ? 1 : 0;
  // The fists are solid blocks closed round a handle, so a handle inside one is how it is held: item-in-fist is
  // reported on its own, and the body (bg) is everything but the fists
  const idx = g.index.array, bodyIdx = [], fistIdx = [];
  for (let t = 0; t < idx.length; t += 3) (fistV[idx[t]] || fistV[idx[t + 1]] || fistV[idx[t + 2]] ? fistIdx : bodyIdx).push(idx[t], idx[t + 1], idx[t + 2]);
  const meshOf = (index) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(sk, 3));
    geo.setIndex(index);
    geo.computeBoundingBox();
    const m = new THREE.Mesh(geo, dbl);
    m.updateMatrixWorld(true);
    return m;
  };
  const dbl = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const bodyM = meshOf(bodyIdx), fistM = meshOf(fistIdx);
  const bg = bodyM.geometry;
  bg.boundingBox.union(fistM.geometry.boundingBox);
  const parts = [];
  if (inst.weapon) inst.weapon.traverse((m) => m.isMesh && m.visible && m.name !== 'nunchakuTrail' && parts.push(m));
  if (cat) {
    // the cat: its skinned mesh as it is posed now, baked into a plain one
    const ck = cat._inst.mesh;
    ck.skeleton.update();
    const src = ck.geometry.attributes.position;
    const out = new Float32Array(src.count * 3);
    for (let i = 0; i < src.count; i++) ck.getVertexPosition(i, v).toArray(out, i * 3);
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
    cg.setIndex(ck.geometry.index);
    const m = new THREE.Mesh(cg);
    m.matrixWorld.copy(ck.matrixWorld);
    parts.push(m);
  }
  if (inst.pack && inst.pack.visible) inst.pack.traverse((m) => m.isMesh && parts.push(m));
  const proxies = parts.map((m) => {
    const p = new THREE.Mesh(m.geometry, dbl);
    p.matrixWorld.copy(m.matrixWorld);
    p.matrixAutoUpdate = false;
    p.updateMatrixWorld = () => {};
    p.userData.pack = !!(inst.pack && inst.pack.getObjectById(m.id));
    p.userData.box = new THREE.Box3().setFromBufferAttribute(m.geometry.attributes.position).applyMatrix4(m.matrixWorld).expandByScalar(0.002);
    return p;
  });
  const DIRS = [new THREE.Vector3(1, 0.31, 0.17), new THREE.Vector3(-0.23, 1, 0.41), new THREE.Vector3(0.37, -0.29, 1), new THREE.Vector3(-0.6, -0.55, -0.58)].map((d) => d.normalize());
  const ray = new THREE.Raycaster();
  const N = new THREE.Vector3(), nm = new THREE.Matrix3();
  const flagged = [];
  const inside = (P, targets) => {
    let back = 0, depth = Infinity;
    for (const d of DIRS) {
      ray.set(P, d);
      ray.near = 1e-5;
      ray.far = 1.5;
      const h = ray.intersectObjects(targets, false)[0];
      if (!h) continue;
      nm.getNormalMatrix(h.object.matrixWorld);
      if (N.copy(h.face.normal).applyMatrix3(nm).dot(d) > 0) {
        back++;
        depth = Math.min(depth, h.distance);
      }
    }
    return back >= 3 ? depth : 0;
  };
  const res = { itemInBody: { d: 0, n: 0, what: '' }, bodyInItem: { d: 0, n: 0, what: '' }, bodyInPack: { d: 0, n: 0, what: '' }, itemInFist: { d: 0, n: 0, what: '' } };
  // item vertices inside the body
  for (const p of proxies) {
    const pp = p.geometry.attributes.position;
    for (let i = 0; i < pp.count; i++) {
      v.fromBufferAttribute(pp, i).applyMatrix4(p.matrixWorld);
      if (!bg.boundingBox.containsPoint(v)) continue;
      const d = inside(v, [bodyM]);
      if (d) {
        const r = res.itemInBody;
        r.n++;
        flagged.push(v.x, v.y, v.z);
        if (d > r.d) Object.assign(r, { d, what: p.userData.pack ? 'pack' : 'item' });
      } else if (!p.userData.pack) {
        const df = inside(v, [fistM]);
        const r = res.itemInFist;
        if (df) {
          r.n++;
          if (df > r.d) Object.assign(r, { d: df, what: 'item' });
        }
      }
    }
  }
  // body vertices inside the item / the pack
  for (const [key, list] of [['bodyInItem', proxies.filter((p) => !p.userData.pack)], ['bodyInPack', proxies.filter((p) => p.userData.pack)]]) {
    if (!list.length) continue;
    for (let i = 0; i < pos.count; i++) {
      if (fistV[i]) continue; // (the fists: item-in-fist)
      v.set(sk[i * 3], sk[i * 3 + 1], sk[i * 3 + 2]);
      const near = list.filter((p) => p.userData.box.containsPoint(v));
      if (!near.length) continue;
      const d = inside(v, near);
      if (d) {
        const r = res[key];
        r.n++;
        flagged.push(v.x, v.y, v.z);
        if (d > r.d) Object.assign(r, { d, what: boneOf(i) });
      }
    }
  }
  const mm = (r) => (r.n ? `${(r.d * 1000).toFixed(1)}mm ${r.what} (${r.n}v)` : '-');
  res.text = `item-in-body ${mm(res.itemInBody)} | body-in-item ${mm(res.bodyInItem)} | body-in-pack ${mm(res.bodyInPack)} | item-in-fist ${mm(res.itemInFist)}`;
  window.__clip = res;
  info.textContent += '\n' + res.text;
  if (q.get('dots') === '1' && flagged.length) {
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.Float32BufferAttribute(flagged, 3));
    const pts = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xff2020, size: 3, sizeAttenuation: false, depthTest: false }));
    pts.renderOrder = 20;
    scene.add(pts);
    renderer.render(scene, camera);
  }
}
window.__done = true;
