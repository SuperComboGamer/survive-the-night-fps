// Third-person hold sandbox (loaded by models-test.js when ?hold= is present): one survivor holding an item, posed
// and frozen, seen close up round its hands, with a clip check of the item against the body.
//   ?hold=ITEMID        what is in the right hand (0: nothing)
//   &pose=idle|walk|sprint|crouch|crouchwalk|lookup|lookdown|reload|fire|melee|throw|downed|seated|swim|air
//   &t=SECONDS          the clock (pulses - fire, melee, throw - start at t=1; t is the time after that for them)
//   &pack=1             wearing the crafted backpack;  &seed=N  which survivor
//   &cam=yaw,pitch,dist[,tx,ty,tz]   an orbit round the right hand (tx..: offset of the target from it, m), or
//   &cam=body,yaw,pitch,dist          round the chest (the whole figure);  default: round the right hand from the front
//   &clip=1             measure (window.__clip): the deepest item vertex inside the body, and body vertex inside the item
//   &dots=1             with clip=1: mark them;  &xray=1  the item see-through
import * as THREE from 'three';
import * as CHARS from '../render/models/characters.js';
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
const item = +(q.get('hold') || 0);
const pose = q.get('pose') || 'idle';
const T = +(q.get('t') ?? 1);
const sv = createSurvivor(+(q.get('seed') || 3));
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
if (pose === 'downed') {
  o.rotation.x = -1.3;
  o.position.y = 0.18;
}
if (pose === 'seated') o.position.y = 0.45;
// (Entities puts the weapon away in the water)
if (pose === 'swim') sv.setWeapon(0);
const pulse = { fire: () => sv.fire(), melee: () => sv.melee(), throw: () => sv.throwAnim() }[pose];
const DT = 1 / 60;
const total = pulse ? 1 + T : T;
let time = 0;
for (let i = 0, n = Math.round(total / DT); i < n; i++) {
  time += DT;
  if (pulse && Math.abs(time - 1) < DT / 2) pulse();
  sv.update(DT, { ...st, time });
}
scene.updateMatrixWorld(true);

const inst = sv._inst;
const handR = inst.bones[15]; // HAND_R (characters.js)
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.01, 50);
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
renderer.render(scene, camera);
info.textContent = `hold ${item} pose ${pose} t=${T}`;

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
  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.BufferAttribute(sk, 3));
  bg.setIndex(g.index);
  bg.computeBoundingBox();
  const dbl = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const bodyM = new THREE.Mesh(bg, dbl);
  bodyM.updateMatrixWorld(true);
  const parts = [];
  if (inst.weapon) inst.weapon.traverse((m) => m.isMesh && m.visible && parts.push(m));
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
  // which bone a body vertex mostly follows, for the report
  const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  const boneOf = (i) => {
    let b = 0, w = -1;
    for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > w) (w = sw.getComponent(i, k)), (b = si.getComponent(i, k));
    return inst.bones[b] ? inst.bones[b].name || 'bone' + b : '?';
  };
  const res = { itemInBody: { d: 0, n: 0, what: '' }, bodyInItem: { d: 0, n: 0, what: '' }, bodyInPack: { d: 0, n: 0, what: '' } };
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
      }
    }
  }
  // body vertices inside the item / the pack
  for (const [key, list] of [['bodyInItem', proxies.filter((p) => !p.userData.pack)], ['bodyInPack', proxies.filter((p) => p.userData.pack)]]) {
    if (!list.length) continue;
    for (let i = 0; i < pos.count; i++) {
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
  res.text = `item-in-body ${mm(res.itemInBody)} | body-in-item ${mm(res.bodyInItem)} | body-in-pack ${mm(res.bodyInPack)}`;
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
