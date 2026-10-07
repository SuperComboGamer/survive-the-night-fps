// The vehicles in the models sandbox (loaded by models-test.js when ?veh= is present): one standing, as found or
// running, with survivors in its seats as the game seats them (game/vehicles.js seatBody), seen from several sides at
// once, and a clip check of every body against it.
//   ?veh=1|2|3        the moped, the car, the bicycle (shared/vehicles.js VEH)
//   &tint=N           its paint; &state=0|1|2|3 as found, running, broken down, burnt out
//   &seed=N           who is at the bars or the wheel (the character: seed % 10); &seed=-1 nobody
//   &pass=N           how many ride with them (the next characters); &hold=ID what the passengers hold
//   &steer=R          the steering (rad, + right); &lean=R the lean (two wheels); &lights=1; &night=1
//   &views=LIST       columns: q (three-quarter front), side, back, rq (three-quarter rear), front, top, hands, feet,
//                     in (through the windscreen). Default q,side,rq,top
//   &cell=W,H         each cell's size in px (default 480,360)
//   &clip=1           window.__clip = { text, worst: { d, n, what, who }, each: [...] }: the deepest vertex of each
//                     body inside the vehicle and of the vehicle inside each body, and how far each of the driver's
//                     fists is from its grip; &dots=1 marks them, &xray=1 draws the vehicle see-through
import * as THREE from 'three';
import * as CHARS from '../render/models/characters.js';
import { VehicleModel } from '../render/models/vehicles.js';
import { VEH, VEHICLES } from '../../shared/vehicles.js';
import { seatBody } from '../game/vehicles.js';

const q = new URLSearchParams(location.search);
const info = document.getElementById('info');
const vk = +(q.get('veh') || 1);
const P = VEHICLES[vk];
const views = (q.get('views') || 'q,side,rq,top').split(',');
const [CW, CH] = (q.get('cell') || '480,360').split(',').map(Number);
const night = q.get('night') === '1';
const cols = Math.min(views.length, +(q.get('cols') || 4)), rows = Math.ceil(views.length / cols);
const W = CW * cols, H = CH * rows;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.setScissorTest(true);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = night ? 1.5 : 1.2;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(night ? 0x06080c : 0x2a2d33);
if (night) {
  scene.add(new THREE.HemisphereLight(0x56688a, 0x101008, 0.45));
  const moon = new THREE.DirectionalLight(0x9ab0d8, 0.45);
  moon.position.set(3, 6, 4);
  scene.add(moon);
} else {
  scene.add(new THREE.HemisphereLight(0xc8d0dc, 0x3a3226, 1.5));
  const key = new THREE.DirectionalLight(0xfff0dc, 2.4);
  key.position.set(-2.5, 5, -4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x9aa8c8, 0.7);
  fill.position.set(4, 2, -1);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xc0c8ff, 1.0);
  rim.position.set(2, 4, 5);
  scene.add(rim);
}
const ground = new THREE.Mesh(new THREE.CircleGeometry(7, 40), new THREE.MeshLambertMaterial({ color: night ? 0x15160f : 0x3a3b34 }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const model = new VehicleModel(vk, +(q.get('tint') || 0));
model.setState(+(q.get('state') ?? 1));
model.setLamps(q.get('lights') === '1', q.get('brake') === '1');
model.setWheels(+(q.get('roll') || 0.3), +(q.get('steer') || 0));
model.setDash(+(q.get('speed') || 0.4), +(q.get('fuel') || 0.6));
model.body.rotation.z = -(+(q.get('lean') || 0));
scene.add(model.group);
if (night && q.get('lights') === '1') {
  const sp = new THREE.SpotLight(0xfff0d0, 60, 40, 0.5, 0.6, 1.2);
  const pos = new THREE.Vector3(), dir = new THREE.Vector3();
  scene.updateMatrixWorld(true);
  model.lampWorld(pos, dir);
  sp.position.copy(pos);
  sp.target.position.copy(pos).addScaledVector(dir, 10);
  scene.add(sp, sp.target);
}

// who sits in it
const seed0 = +(q.get('seed') ?? 3);
const riders = [];
if (seed0 >= 0) {
  const n = Math.min(P.seats.length, 1 + +(q.get('pass') || 0));
  for (let k = 0; k < n; k++) {
    const sv = CHARS.createSurvivor(seed0 + k);
    sv.setWeapon(k === 0 ? 0 : +(q.get('hold') || 0));
    scene.add(sv.object);
    riders.push({ sv, k, pose: {} });
  }
}
// (from the driver's own eyes - the fp views - their head is not drawn, as in the game)
if (views.every((v) => /^fp/.test(v)) && riders[0]) riders[0].sv.setHide(+(q.get('hide') || 1));
const DT = 1 / 60;
let time = 0;
for (let i = 0; i < 90; i++) {
  time += DT;
  for (const r of riders) {
    r.sv._inst._seen = true;
    const ride = seatBody(model, vk, r.k, r.sv, r.pose);
    r.sv.update(DT, { speed: 0, sprint: false, crouch: false, pitch: 0, onGround: true, reloading: false, dead: false, sit: true, sitT: ride.sitT, sitK: ride.sitK, sitSplay: ride.sitSplay, sitLean: ride.sitLean, sitTwist: ride.sitTwist, feet: ride.feet, sitNow: 1, reach: ride.reach, time });
  }
  scene.updateMatrixWorld(true);
}

// ---------------------------------------------------------------- the views
const persp = new THREE.PerspectiveCamera(30, CW / CH, 0.02, 60);
const big = vk === VEH.CAR;
const C = [0, big ? 0.85 : 0.75, 0];
const D = big ? 8.6 : 4.3;
// (yaw 0: from in front of it - it faces -Z; + round to its left side)
const VIEW = {
  q: [0.65, 0.2, D, C],
  side: [Math.PI / 2, 0.06, D, C],
  right: [-Math.PI / 2, 0.06, D, C],
  back: [Math.PI, 0.12, D, C],
  rq: [Math.PI - 0.7, 0.24, D, C],
  front: [0.001, 0.08, D, C],
  top: [0.4, 1.25, D, C],
  hands: big ? [2.5, 0.3, 1.5, [-0.38, 1.0, -0.4]] : [2.3, 0.5, 1.7, [0, 1.0, -0.3]],
  feet: big ? [1.2, 0.05, 2.6, [-0.4, 0.4, -0.5]] : [1.3, 0.1, 2.2, [0, 0.35, 0]],
  in: big ? [0.25, 0.12, 3.4, [0, 1.1, 0]] : [0.3, 0.2, 2.6, [0, 1.0, 0.2]],
  seat: big ? [2.0, 0.35, 3.2, [0, 0.9, 0.2]] : [2.0, 0.3, 2.8, [0, 0.9, 0.3]],
};
if (q.get('xray') === '1') {
  const glass = new THREE.MeshLambertMaterial({ color: 0x88aaff, transparent: true, opacity: 0.35, depthWrite: false });
  model.group.traverse((m) => {
    if (m.isMesh) {
      m.material = glass;
      m.renderOrder = 5;
    }
  });
}
// from the driver's own eyes, as the game has them (game/vehicles.js view): fp ahead, fpd down at the clocks, fpl / fpr
// to the sides, fpf down at the feet
const FP = { fp: [0, 0], fpd: [0, -0.45], fpl: [1.1, -0.2], fpr: [-1.1, -0.2], fpf: [0, -1.15], fpu: [0, -0.15] };
const fpCam = new THREE.PerspectiveCamera(75, CW / CH, 0.05, 200);
fpCam.rotation.order = 'YXZ';
function draw() {
  views.forEach((name, i) => {
    const x = (i % cols) * CW, y = H - (((i / cols) | 0) + 1) * CH;
    if (FP[name] && riders[0]) {
      riders[0].sv.headWorld(fpCam.position);
      fpCam.position.y += 0.085;
      fpCam.position.z -= 0.07;
      fpCam.rotation.set(FP[name][1] + +(q.get('pitch') || 0), FP[name][0], 0);
      renderer.setViewport(x, y, CW, CH);
      renderer.setScissor(x, y, CW, CH);
      renderer.render(scene, fpCam);
      return;
    }
    const [yaw, pitch, dist, t] = VIEW[name] || VIEW.q;
    persp.aspect = CW / CH;
    persp.updateProjectionMatrix();
    persp.position.set(t[0] - Math.sin(yaw) * Math.cos(pitch) * dist, t[1] + Math.sin(pitch) * dist, t[2] - Math.cos(yaw) * Math.cos(pitch) * dist);
    persp.lookAt(t[0], t[1], t[2]);
    renderer.setViewport(x, y, CW, CH);
    renderer.setScissor(x, y, CW, CH);
    renderer.render(scene, persp);
  });
}

// ---------------------------------------------------------------- clip check
// The rule of the other sandboxes (models-hold.js): a vertex is inside a model when the first face three of four rays
// from it meet is a back face. A body is skinned: its vertices are worked out on the CPU for the rays. The fists are
// left out of what counts (they are solid blocks closed round a grip: a grip inside one is how it is held).
const flagged = [];
if (q.get('clip') === '1') {
  const dbl = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const vparts = [];
  // (a pane of glass is one sheet: nothing is inside it, and a point behind it would count as inside)
  model.group.traverse((m) => m.isMesh && m.visible && visibleUp(m) && !/glass/.test(m.name || m.material?.name || '') && vparts.push(m));
  const vprox = vparts.map((m) => {
    const p = new THREE.Mesh(m.geometry, dbl);
    p.matrixWorld.copy(m.matrixWorld);
    p.matrixAutoUpdate = false;
    p.updateMatrixWorld = () => {};
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    p.userData.box = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld).expandByScalar(0.002);
    p.userData.name = m.name || m.parent?.name || 'part';
    return p;
  });
  const DIRS = [new THREE.Vector3(1, 0.31, 0.17), new THREE.Vector3(-0.23, 1, 0.41), new THREE.Vector3(0.37, -0.29, 1), new THREE.Vector3(-0.6, -0.55, -0.58)].map((d) => d.normalize());
  const ray = new THREE.Raycaster();
  const N = new THREE.Vector3(), nm = new THREE.Matrix3(), v = new THREE.Vector3();
  const inside = (pt, targets) => {
    let back = 0, depth = Infinity, what = '';
    for (const d of DIRS) {
      ray.set(pt, d);
      ray.near = 1e-5;
      ray.far = 2.5;
      const h = ray.intersectObjects(targets, false)[0];
      if (!h) continue;
      nm.getNormalMatrix(h.object.matrixWorld);
      if (N.copy(h.face.normal).applyMatrix3(nm).dot(d) > 0) {
        back++;
        if (h.distance < depth) {
          depth = h.distance;
          what = h.object.userData.name || '';
        }
      }
    }
    return back >= 3 ? [depth, what] : null;
  };
  const each = [];
  const worst = { d: 0, n: 0, what: '', who: '' };
  for (const r of riders) {
    const inst = r.sv._inst;
    const body = inst.mesh;
    const g = body.geometry, pos = g.attributes.position;
    const sk = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      body.getVertexPosition(i, v);
      v.applyMatrix4(body.matrixWorld);
      sk[i * 3] = v.x;
      sk[i * 3 + 1] = v.y;
      sk[i * 3 + 2] = v.z;
    }
    const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    const boneOf = (i) => {
      let b = 0, w = -1;
      for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > w) (w = sw.getComponent(i, k)), (b = si.getComponent(i, k));
      return inst.bones[b] ? inst.bones[b].name || 'bone' + b : '?';
    };
    const res = { seat: r.k, who: r.sv.character?.name || `survivor ${seed0 + r.k}`, bodyInVeh: { d: 0, n: 0, what: '' }, vehInBody: { d: 0, n: 0, what: '' }, grips: [] };
    // the body's vertices inside the vehicle (the fists aside)
    for (let i = 0; i < pos.count; i++) {
      const bone = boneOf(i);
      if (/^hand[LR]$/.test(bone)) continue;
      v.set(sk[i * 3], sk[i * 3 + 1], sk[i * 3 + 2]);
      const near = vprox.filter((p) => p.userData.box.containsPoint(v));
      if (!near.length) continue;
      const hit = inside(v, near);
      if (!hit) continue;
      res.bodyInVeh.n++;
      flagged.push(v.x, v.y, v.z);
      if (hit[0] > res.bodyInVeh.d) Object.assign(res.bodyInVeh, { d: hit[0], what: `${bone} in ${hit[1]} at ${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}` });
    }
    // the vehicle's vertices inside the body
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(sk, 3));
    geo.setIndex(g.index);
    geo.computeBoundingBox();
    const bodyM = new THREE.Mesh(geo, dbl);
    bodyM.updateMatrixWorld(true);
    for (const p of vprox) {
      if (!p.userData.box.intersectsBox(geo.boundingBox)) continue;
      const pp = p.geometry.attributes.position;
      for (let i = 0; i < pp.count; i++) {
        v.fromBufferAttribute(pp, i).applyMatrix4(p.matrixWorld);
        if (!geo.boundingBox.containsPoint(v)) continue;
        // (a grip or the rim under a fist is held, not clipped)
        if (r.k === 0 && model.grips.some((gr) => gr.getWorldPosition(N).distanceTo(v) < 0.1)) continue;
        const hit = inside(v, [bodyM]);
        if (!hit) continue;
        res.vehInBody.n++;
        flagged.push(v.x, v.y, v.z);
        if (hit[0] > res.vehInBody.d) Object.assign(res.vehInBody, { d: hit[0], what: `${p.userData.name} at ${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}` });
      }
    }
    // the driver's fists on the grips: how far the middle of each is from where it should close
    if (r.k === 0) {
      for (const [side, bi] of [['L', 11], ['R', 15]]) {
        const hand = inst.bones[bi];
        const grip = model.grips[side === 'L' ? 0 : 1];
        const a = hand.getWorldPosition(new THREE.Vector3());
        // (the fist's middle is a little way down the hand from the wrist)
        const mid = new THREE.Vector3(0, -0.075, 0).applyMatrix4(hand.matrixWorld);
        res.grips.push({ side, mm: mid.distanceTo(grip.getWorldPosition(new THREE.Vector3())) * 1000, wrist: a.distanceTo(grip.getWorldPosition(new THREE.Vector3())) * 1000 });
      }
    }
    each.push(res);
    for (const key of ['bodyInVeh', 'vehInBody']) if (res[key].d > worst.d) Object.assign(worst, { d: res[key].d, n: res[key].n, what: `${key}: ${res[key].what}`, who: res.who });
  }
  const mm = (r) => (r.n ? `${(r.d * 1000).toFixed(0)}mm ${r.what} (${r.n}v)` : '-');
  const text = each.map((e) => `seat ${e.seat} ${e.who}: body-in-vehicle ${mm(e.bodyInVeh)} | vehicle-in-body ${mm(e.vehInBody)}${e.grips.length ? ` | fists ${e.grips.map((g) => `${g.side} ${g.mm.toFixed(0)}mm`).join(' ')}` : ''}`).join('\n');
  window.__clip = { text, worst, each };
  info.textContent = text;
  if (q.get('dots') === '1' && flagged.length) {
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.Float32BufferAttribute(flagged, 3));
    const pts = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xff2020, size: 3, sizeAttenuation: false, depthTest: false }));
    pts.renderOrder = 20;
    scene.add(pts);
  }
}
function visibleUp(m) {
  for (let o = m; o; o = o.parent) if (!o.visible) return false;
  return true;
}
draw();
let tris = 0, calls = 0;
model.group.traverse((m) => {
  if (m.isMesh && visibleUp(m)) {
    calls++;
    tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
  }
});
window.__veh = { done: true, tris, calls };
if (!info.textContent) info.textContent = `${P.name}: ${Math.round(tris)} triangles in ${calls} meshes`;
