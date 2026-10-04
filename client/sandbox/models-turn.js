// Turnaround sheets (loaded by models-test.js when ?turn= is present): characters frozen in a pose and seen from
// several sides at once, one row per subject, for before/after comparisons of the character models. Uses nothing but
// createSurvivor(seed) / createZombie(type, seed), so the same page works on an older tree (scripts/clip/turnaround.js
// lends it there).
//   ?turn=LIST       subjects, comma separated: s:N a survivor (seed N), sz:N the same survivor turned, z:T[:SEED] a
//                    zombie of ZTYPE T (the seed picks its variant)
//   &views=LIST      columns: front, q (three-quarter), side, back, head (a close-up of the face), headside (of the
//                    profile), top. Default front,side,back,head
//   &cell=W,H        each cell's size in px (default 300,440)
//   &anim=N          the zombies' ZANIM state (default IDLE); &walk=1 survivors mid-stride
//   &t=S             the clock (default 1.3 s)
//   &item=ID         what the survivors hold (default nothing)
//   &night=1         dim moonlight and a torch from the camera instead of the studio lights
//   &label=0         no subject labels
// window.__turn = { subjects: [{ label, tris }], done: true } once drawn.
import * as THREE from 'three';
import { ZTYPE, ZOMBIE_DEFS, ZANIM } from '../../shared/defs.js';
import * as CHARS from '../render/models/characters.js';

const q = new URLSearchParams(location.search);
if (q.get('nojaw')) globalThis.__nojaw = 1;
const info = document.getElementById('info');
const subjects = (q.get('turn') || 's:0').split(',').map((s) => s.trim()).filter(Boolean);
const views = (q.get('views') || 'front,side,back,head').split(',');
const [CW, CH] = (q.get('cell') || '300,440').split(',').map(Number);
const T = +(q.get('t') ?? 1.3);
const anim = q.has('anim') ? +q.get('anim') : ZANIM.IDLE;
const night = q.get('night') === '1';
const W = CW * views.length, H = CH * subjects.length;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.setScissorTest(true);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = night ? 1.6 : 1.25;
document.body.appendChild(renderer.domElement);
document.body.style.overflow = 'hidden';

function makeScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(night ? 0x07090d : 0x2a2d33);
  if (night) {
    scene.add(new THREE.HemisphereLight(0x5a6a8a, 0x101008, 0.5));
    const moon = new THREE.DirectionalLight(0x9ab0d8, 0.5);
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
  const ground = new THREE.Mesh(new THREE.CircleGeometry(4, 32), new THREE.MeshLambertMaterial({ color: night ? 0x15160f : 0x3a3b34 }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  return scene;
}

const DT = 1 / 60;
const rows = [];
for (const spec of subjects) {
  const [kind, a, b] = spec.split(':');
  const scene = makeScene();
  let obj, height, width, head, label, tris = 0, update;
  if (kind === 's' || kind === 'sz') {
    const seed = +a;
    const sv = CHARS.createSurvivor(seed);
    if (kind === 'sz') sv.setZombie(true);
    if (q.has('item')) sv.setWeapon(+q.get('item'));
    obj = sv.object;
    const walk = q.get('walk') === '1';
    update = (dt, time) => sv.update(dt, { speed: walk ? 1.6 : 0, sprint: false, crouch: false, pitch: 0, onGround: true, reloading: false, dead: false, time });
    height = 1.85;
    width = 0.9;
    head = () => sv.object.userData.head.getWorldPosition(new THREE.Vector3());
    label = (kind === 'sz' ? 'turned ' : '') + (sv.character?.name || `survivor ${seed}`);
  } else {
    const type = +a;
    const def = ZOMBIE_DEFS[type];
    let seed = b !== undefined ? +b : 1;
    if (kind === 'zv') {
      // zv:T:V - variant V of type T (the seed that picks it, as createZombie does)
      const nv = CHARS.zombieVariants?.(type) || 1;
      for (seed = 1; (((seed >>> 0) * 2654435761) >>> 0) % nv !== +b % nv; seed++);
    }
    const z = CHARS.createZombie(type, seed);
    obj = z.object;
    const speed = anim === ZANIM.WALK ? Math.min(def.speed, 2.2) : anim === ZANIM.RUN ? def.speed * 1.4 : 0;
    update = (dt, time) => z.update(dt, anim, speed, time, true);
    height = Math.max(def.height, def.headY + def.headR) * 1.04;
    width = Math.max(def.radius * 2.4, height * 0.45);
    head = () => (z.anchorWorld ? z.anchorWorld(z.object.userData.head, new THREE.Vector3()) : new THREE.Vector3(0, def.headY, 0));
    label = def.name + (b !== undefined ? (kind === 'zv' ? ` v${b}` : ` #${b}`) : '');
    if (type === ZTYPE.BAT) obj.position.y = 1.2;
  }
  scene.add(obj);
  obj.traverseVisible((m) => { // (what is drawn: not the hidden worn backpack)
    if (m.isMesh && m.geometry?.index) tris += m.geometry.index.count / 3;
  });
  // run the clock up to T so the pose is deterministic
  let time = 0;
  for (let i = 0, n = Math.round(T / DT); i < n; i++) {
    time += DT;
    update(DT, time);
  }
  scene.updateMatrixWorld(true);
  rows.push({ scene, obj, height, width, head: head(), label, tris, headR: kind === 's' || kind === 'sz' ? 0 : ZOMBIE_DEFS[+a].headR });
}

const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 60);
const persp = new THREE.PerspectiveCamera(22, CW / CH, 0.01, 60);
const DIRS = { front: [0, 0.05], q: [-0.75, 0.12], side: [-Math.PI / 2, 0.03], back: [Math.PI, 0.08], top: [-0.5, 0.9] };
rows.forEach((r, ri) => {
  views.forEach((v, ci) => {
    const x = ci * CW, y = H - (ri + 1) * CH;
    renderer.setViewport(x, y, CW, CH);
    renderer.setScissor(x, y, CW, CH);
    let cam;
    if (v === 'head' || v === 'headside' || v === 'hips' || v === 'hand') {
      // yaw 0 = in front (the models face -Z). hips: a close look at the waist and the crotch; hand: at the right hand
      const yaw = v === 'head' ? -0.35 : v === 'headside' ? -Math.PI / 2 : v === 'hand' ? 0.9 : -0.25;
      const d = v === 'hips' ? 1.4 : v === 'hand' ? 0.6 : Math.max(0.7, r.height * 0.42, (r.headR || 0) * 5); // (far enough for a boss's head, or a big dog's)
      const t = r.head.clone();
      t.y -= r.height * 0.02;
      if (v === 'hips') t.set(0, r.height * 0.5, 0);
      if (v === 'hand') t.set(0.2, r.height * 0.47, 0);
      persp.aspect = CW / CH;
      persp.updateProjectionMatrix();
      persp.position.set(t.x - Math.sin(yaw) * d, t.y + d * 0.08, t.z - Math.cos(yaw) * d);
      persp.lookAt(t);
      cam = persp;
    } else {
      const [yaw, pitch] = DIRS[v] || DIRS.front;
      const half = Math.max(r.height * 0.54, (r.width * CH) / CW / 2 * 1.1);
      ortho.left = (-half * CW) / CH;
      ortho.right = (half * CW) / CH;
      ortho.top = half;
      ortho.bottom = -half;
      ortho.updateProjectionMatrix();
      // (what flies is framed where it flies)
      const c = new THREE.Vector3(r.obj.position.x, r.obj.position.y ? r.obj.position.y - r.height * 0.1 : r.height * 0.5, r.obj.position.z);
      ortho.position.set(c.x - Math.sin(yaw) * Math.cos(pitch) * 20, c.y + Math.sin(pitch) * 20, c.z - Math.cos(yaw) * Math.cos(pitch) * 20);
      ortho.lookAt(c);
      cam = ortho;
    }
    renderer.render(r.scene, cam);
  });
});

if (q.get('label') !== '0') {
  // labels: a DOM overlay over each row's first cell
  rows.forEach((r, ri) => {
    const d = document.createElement('div');
    d.textContent = `${r.label}  ·  ${r.tris} tris`;
    d.style.cssText = `position:fixed;left:6px;top:${ri * CH + 4}px;font:600 13px system-ui,sans-serif;color:#eee;text-shadow:0 1px 2px #000;z-index:3`;
    document.body.appendChild(d);
  });
}
info.textContent = '';
window.__turn = { subjects: rows.map((r) => ({ label: r.label, tris: r.tris })), done: true };
