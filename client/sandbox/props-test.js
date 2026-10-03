// Visual gallery for environment art. URL params:
//   cat=props|trees|structures|pickups|textures|misc   (default props)
//   only=<name>   focus one prop/item (props: shows seeds 0..3 side by side; box=1 draws the size box)
//   seed, yaw (deg), pitch (deg), dist (m), bright=1 (neutral daylight), anim=1 (keep animating)
//   new=1 (props / structures / pickups: only the iteration-2 additions)
//   sheet: ?cat=sheet&set=props|pickups|structures&names=a,b,c (prop keys / ITEM keys / STRUCT keys)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { getTexture, TEXTURE_NAMES, setMaxAnisotropy } from '../render/textures.js';
import { MAT, vegetationTime } from '../render/materials.js';

const Q = new URLSearchParams(location.search);
const CAT = Q.get('cat') || 'props';
const ONLY = Q.get('only');
const BRIGHT = Q.get('bright') === '1';
const NEW_ONLY = Q.get('new') === '1';
// iteration-2 additions (for ?new=1)
const NEW_PROPS = ['duffel_bag', 'locker', 'cabinet', 'toolbox', 'fridge', 'log_pile', 'jersey_barrier', 'camper', 'school_bus', 'dump_truck', 'boom_gate', 'saw_table', 'gravel_pile', 'hunting_stand', 'billboard', 'motel_sign', 'satellite_dish', 'fence_chain'];
const NEW_STRUCTS = ['CAMPFIRE', 'WORKBENCH', 'DOOR'];
const NEW_ITEMS = ['FLARE', 'SCHEM_SHOTGUN', 'SCHEM_RIFLE', 'SCHEM_KEVLAR', 'SCHEM_EXPLOSIVES', 'SCHEM_METAL', 'TUNA', 'WALKIE', 'GRENADE', 'DECOY'];

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = BRIGHT ? 1.0 : 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);
setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());

const scene = new THREE.Scene();
const fogCol = BRIGHT ? 0x8a929a : 0x262a31;
scene.background = new THREE.Color(fogCol);
scene.fog = new THREE.FogExp2(fogCol, BRIGHT ? 0.004 : 0.012);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 600);
const controls = new OrbitControls(camera, renderer.domElement);

const hemi = new THREE.HemisphereLight(BRIGHT ? 0xdde4ee : 0x8894b0, BRIGHT ? 0x4a4236 : 0x2a2219, BRIGHT ? 2.2 : 1.5);
scene.add(hemi);
const sun = new THREE.DirectionalLight(BRIGHT ? 0xffffff : 0xffb070, BRIGHT ? 2.4 : 1.9);
sun.position.set(-30, BRIGHT ? 50 : 22, -40);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = sun.shadow.camera.bottom = -60;
sun.shadow.camera.right = sun.shadow.camera.top = 60;
sun.shadow.camera.far = 200;
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.03;
scene.add(sun);

// ground
const groundTex = getTexture('ground_forest', 60, 60);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), new THREE.MeshLambertMaterial({ map: groundTex }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const labelsEl = document.getElementById('labels');
const labels = [];
function label(text, pos) {
  const el = document.createElement('div');
  el.className = 'lbl';
  el.textContent = text;
  labelsEl.appendChild(el);
  labels.push({ el, pos: pos.clone() });
}
const hud = document.getElementById('hud');
hud.innerHTML = ['props', 'trees', 'structures', 'pickups', 'misc', 'textures'].map((c) => `<a href="?cat=${c}">${c}</a>`).join('') + ` <span id="info"></span>`;
const info = document.getElementById('info');

function shadowAll(o) {
  o.traverse((c) => {
    if (c.isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
}
function frame(center, dist, yawDeg = 200, pitchDeg = 22) {
  const yaw = THREE.MathUtils.degToRad(+(Q.get('yaw') ?? yawDeg));
  const pitch = THREE.MathUtils.degToRad(+(Q.get('pitch') ?? pitchDeg));
  const d = +(Q.get('dist') ?? dist);
  if (Q.get('tx') !== null) center = new THREE.Vector3(+Q.get('tx'), +(Q.get('ty') ?? 1), +(Q.get('tz') ?? 0));
  camera.position.set(center.x + Math.sin(yaw) * Math.cos(pitch) * d, center.y + Math.sin(pitch) * d, center.z + Math.cos(yaw) * Math.cos(pitch) * d);
  controls.target.copy(center);
  controls.update();
}
function sizeBox(size, x, z) {
  const g = new THREE.BoxGeometry(size[0], size[1], size[2]);
  const e = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: 0x40ff60 }));
  e.position.set(x, size[1] / 2, z);
  scene.add(e);
}

let t0 = performance.now();
const errors = [];
addEventListener('error', (e) => errors.push(e.message));

async function setup() {
  if (CAT === 'sheet') return setupSheet();
  if (CAT === 'textures') return setupTextures();
  if (CAT === 'props') return setupProps();
  if (CAT === 'trees') return setupTrees();
  if (CAT === 'structures') return setupStructures();
  if (CAT === 'pickups') return setupPickups();
  if (CAT === 'misc') return setupMisc();
}

// ------------------------------------------------------------------ textures
function setupTextures() {
  scene.fog = null;
  hemi.intensity = 0;
  sun.intensity = 0;
  ground.visible = false;
  scene.background = new THREE.Color(0x3a3a3a);
  const names = TEXTURE_NAMES().filter((n) => !ONLY || n.includes(ONLY));
  const cols = ONLY ? Math.ceil(Math.sqrt(names.length)) : 10;
  const tileN = +(Q.get('tile') || 1); // tile=3 shows each texture repeated 3x3 (seam check)
  const t = performance.now();
  names.forEach((n, i) => {
    const tex = tileN > 1 ? getTexture(n, tileN, tileN) : getTexture(n);
    const img = tex.image;
    const asp = img.width / img.height;
    const h = asp >= 1 ? 1 / asp : 1, w = asp >= 1 ? 1 : asp;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }));
    const x = (i % cols) * 1.15, y = -Math.floor(i / cols) * 1.3;
    m.position.set(x, y, 0);
    scene.add(m);
    label(n, new THREE.Vector3(x, y + 0.56, 0));
  });
  console.log(`generated ${names.length} textures in ${(performance.now() - t).toFixed(0)}ms`);
  const rows = Math.ceil(names.length / cols);
  const cx = ((cols - 1) * 1.15) / 2, cy = (-(rows - 1) * 1.3) / 2;
  camera.position.set(cx, cy, Math.max(cols, rows * 1.3) * 1.05);
  controls.target.set(cx, cy, 0);
  controls.update();
}

// ------------------------------------------------------------------ props
async function setupProps() {
  const { PROPS } = await import('../../shared/props.js');
  const { createProp } = await import('../render/models/props.js');
  const tStart = performance.now();
  if (ONLY) {
    const def = PROPS[ONLY];
    const seeds = Q.get('seed') !== null ? [+Q.get('seed')] : [0, 1, 2, 3];
    const gap = def.size[0] + 1.2;
    seeds.forEach((s, i) => {
      const g = createProp(ONLY, s);
      const x = (i - (seeds.length - 1) / 2) * gap;
      g.position.set(x, 0, 0);
      shadowAll(g);
      scene.add(g);
      if (Q.get('box') === '1') sizeBox(def.size, x, 0);
      label(`${ONLY} s${s} (${countTris(g)} tris)`, new THREE.Vector3(x, def.size[1] + 0.3, 0));
    });
    const span = Math.max(def.size[1], def.size[2], seeds.length * gap * 0.6);
    frame(new THREE.Vector3(0, def.size[1] * 0.45, 0), span * 1.6 + 1.5);
  } else {
    const names = Object.keys(PROPS).filter((n) => !NEW_ONLY || NEW_PROPS.includes(n));
    const big = names.filter((n) => Math.max(...PROPS[n].size) > 4.5);
    const small = names.filter((n) => !big.includes(n));
    const cols = 9;
    small.forEach((n, i) => {
      const g = createProp(n, 0);
      const x = ((i % cols) - (cols - 1) / 2) * 4, z = Math.floor(i / cols) * 4.5;
      g.position.set(x, 0, z);
      shadowAll(g);
      scene.add(g);
      label(n, new THREE.Vector3(x, PROPS[n].size[1] + 0.25, z));
    });
    big.forEach((n, i) => {
      const g = createProp(n, 0);
      const x = (i - (big.length - 1) / 2) * 9, z = 30;
      g.position.set(x, 0, z);
      shadowAll(g);
      scene.add(g);
      label(n, new THREE.Vector3(x, PROPS[n].size[1] + 0.3, z));
    });
    frame(new THREE.Vector3(0, 1, 14), 42, 180, 30);
  }
  console.log(`props built in ${(performance.now() - tStart).toFixed(0)}ms`);
}
function countTris(o) {
  let n = 0;
  o.traverse((c) => {
    if (c.isMesh) n += (c.geometry.index ? c.geometry.index.count : c.geometry.attributes.position.count) / 3;
  });
  return n | 0;
}

// ------------------------------------------------------------------ vegetation
async function setupTrees() {
  const V = await import('../render/models/vegetation.js');
  const trees = V.getTreeVariants();
  const bushes = V.getBushVariants();
  const rocks = V.getRockVariants();
  const grass = V.getGrassPatch();
  const dummy = new THREE.Object3D();
  const inst = (parts, transforms) => {
    for (const p of parts) {
      const im = new THREE.InstancedMesh(p.geometry, p.material, transforms.length);
      transforms.forEach((t, i) => {
        dummy.position.set(t[0], 0, t[1]);
        dummy.rotation.set(0, t[2] || 0, 0);
        dummy.scale.setScalar(t[3] || 1);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      });
      im.castShadow = true;
      im.receiveShadow = true;
      scene.add(im);
    }
  };
  for (const v of [...trees, ...bushes, ...rocks, { name: 'grass', parts: [grass] }])
    for (const p of v.parts) {
      const a = p.geometry.attributes.position.array;
      for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) { console.error('NaN in', v.name, p.name || p.material.name, i); break; }
    }
  const tris = (parts) => parts.reduce((s, p) => s + (p.geometry.index ? p.geometry.index.count : p.geometry.attributes.position.count) / 3, 0) | 0;
  if (ONLY === 'forest') {
    const r = mulberry(5);
    const per = trees.map(() => []);
    for (let k = 0; k < 160; k++) {
      const vi = Math.floor(r() * trees.length);
      per[vi].push([(r() - 0.5) * 110, 10 + r() * 90, r() * 6.28, 0.75 + r() * 0.5]);
    }
    trees.forEach((t, i) => inst(t.parts, per[i]));
    const bper = bushes.map(() => []);
    for (let k = 0; k < 200; k++) bper[Math.floor(r() * bushes.length)].push([(r() - 0.5) * 60, r() * 50, r() * 6.28, 0.7 + r() * 0.6]);
    bushes.forEach((b, i) => inst(b.parts, bper[i]));
    const gt = [];
    for (let k = 0; k < 1500; k++) gt.push([(r() - 0.5) * 40, -10 + r() * 30, r() * 6.28, 0.7 + r() * 0.6]);
    inst([grass], gt);
    frame(new THREE.Vector3(0, 4, 10), 26, 180, 8);
  } else {
    trees.forEach((t, i) => {
      const x = (i - (trees.length - 1) / 2) * 9;
      inst(t.parts, [[x, 0, 0.3, 1]]);
      label(`${t.name} h${t.height} r${t.radius} (${tris(t.parts)})`, new THREE.Vector3(x, t.height + 0.5, 0));
    });
    bushes.forEach((b, i) => {
      const x = (i - 1) * 4 - 16;
      inst(b.parts, [[x, -12, 0.5, 1]]);
      label(`${b.name} (${tris(b.parts)})`, new THREE.Vector3(x, 1.6, -12));
    });
    rocks.forEach((b, i) => {
      const x = (i - 1) * 5 + 2;
      inst(b.parts, [[x, -12, 0.5, 1]]);
      label(`${b.name} r${b.radius} (${tris(b.parts)})`, new THREE.Vector3(x, 2.2, -12));
    });
    const gt = [];
    const r = mulberry(3);
    for (let k = 0; k < 250; k++) gt.push([14 + (r() - 0.5) * 8, -12 + (r() - 0.5) * 6, r() * 6.28, 0.7 + r() * 0.6]);
    inst([grass], gt);
    label(`grass (${tris([grass])})`, new THREE.Vector3(14, 1, -12));
    frame(new THREE.Vector3(0, 8, -2), 48, 180, 12);
  }
}
function mulberry(s) {
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ structures
async function setupStructures() {
  const { STRUCT, STRUCT_DEFS } = await import('../../shared/defs.js');
  const S = await import('../render/models/structures.js');
  const types = Object.entries(STRUCT).filter(([n]) => (!ONLY || n === ONLY) && (!NEW_ONLY || NEW_STRUCTS.includes(n)));
  const stages = [1, 0.5, 0.15];
  types.forEach(([name, id], row) => {
    const z = row * 4.5;
    stages.forEach((hp, k) => {
      const g = S.createStructure(id);
      S.setStructureDamage(g, hp);
      g.position.set((k - 1.5) * 4.2, 0, z);
      shadowAll(g);
      scene.add(g);
      label(`${name} ${hp}`, new THREE.Vector3((k - 1.5) * 4.2, STRUCT_DEFS[id].sy + 0.3, z));
    });
    const gh = S.createGhost(id);
    gh.userData.setValid(row % 2 === 0);
    gh.position.set(1.5 * 4.2, 0, z);
    scene.add(gh);
    label(`${name} ghost`, new THREE.Vector3(1.5 * 4.2, STRUCT_DEFS[id].sy + 0.3, z));
    if (id === STRUCT.TORCH || id === STRUCT.CAMPFIRE) {
      // flame anchor marker on each stage
      for (const g of scene.children.filter((c) => c.userData.structType === id && c.position.z === z)) {
        const fl = new THREE.Mesh(new THREE.SphereGeometry(0.06), new THREE.MeshBasicMaterial({ color: 0xffaa00 }));
        g.updateMatrixWorld();
        g.userData.flameAnchor.getWorldPosition(fl.position);
        scene.add(fl);
      }
    }
    if (id === STRUCT.DOOR) {
      // mock building wall with a 1.4 m doorway around each door (checks the fit)
      for (let k = 0; k < 4; k++) scene.add(doorwayMock((k - 1.5) * 4.2, z));
    }
  });
  frame(new THREE.Vector3(0, 1.2, ONLY ? 0 : 13), ONLY ? 9 : 26, 180, ONLY ? 18 : 28);
}

function doorwayMock(x, z) {
  const g = new THREE.Group();
  const m = new THREE.MeshLambertMaterial({ map: getTexture('clapboard', 0.5, 0.5), color: 0x8a8580 });
  const ow = 1.4, oh = 2.2, H = 3, W = 1.3, T = 0.2;
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(W, H, T), m);
    w.position.set(x + s * (ow / 2 + W / 2), H / 2, z);
    g.add(w);
  }
  const top = new THREE.Mesh(new THREE.BoxGeometry(ow, H - oh, T), m);
  top.position.set(x, oh + (H - oh) / 2, z);
  g.add(top);
  g.traverse((c) => c.isMesh && ((c.castShadow = true), (c.receiveShadow = true)));
  return g;
}

// ------------------------------------------------------------------ pickups
async function setupPickups() {
  const { ITEM, ITEM_DEFS } = await import('../../shared/defs.js');
  const P = await import('../render/models/pickups.js');
  const items = Object.entries(ITEM).filter(([n, id]) => id !== 0 && (!ONLY || n === ONLY) && (!NEW_ONLY || NEW_ITEMS.includes(n)));
  const cols = 10;
  items.forEach(([name, id], i) => {
    const g = P.createPickup(id);
    const x = ((i % cols) - (cols - 1) / 2) * 0.9, z = Math.floor(i / cols) * 1.0;
    g.position.set(x, 0, z);
    shadowAll(g);
    scene.add(g);
    label(ITEM_DEFS[id]?.name || name, new THREE.Vector3(x, 0.45, z));
  });
  const rows = Math.ceil(items.length / cols);
  frame(new THREE.Vector3(0, 0, (rows - 1) / 2), ONLY ? 1.4 : 7.5, 180, 40);
}

// ------------------------------------------------------------------ misc
async function setupMisc() {
  if (ONLY === 'plane') {
    // ?cat=misc&only=plane : the supply-drop plane, hung 6 m up so it can be orbited from below
    const { createCargoPlane } = await import('../render/models/plane.js');
    const plane = createCargoPlane();
    plane.position.y = 6;
    shadowAll(plane);
    scene.add(plane);
    frame(new THREE.Vector3(0, 6, 0), 48, 215, 18);
    return;
  }
  const { PROJ } = await import('../../shared/defs.js');
  const M = await import('../render/models/misc.js');
  const crate = M.createSupplyCrate();
  crate.position.set(-3, 0, 0);
  shadowAll(crate);
  scene.add(crate);
  label('supply crate', new THREE.Vector3(-3, 1.5, 0));
  const crate2 = M.createSupplyCrate();
  crate2.position.set(-8, 0, 2);
  crate2.userData.parachute.visible = false;
  shadowAll(crate2);
  scene.add(crate2);
  label('landed crate', new THREE.Vector3(-8, 1.5, 2));
  Object.entries(PROJ).forEach(([n, id], i) => {
    if (id === PROJ.ROPE) return;
    const p = M.createProjectile(id);
    p.position.set(1 + i * 1.3, 0.6, 0);
    scene.add(p);
    label(n, new THREE.Vector3(1 + i * 1.3, 1.2, 0));
  });
  frame(new THREE.Vector3(-1, 2.5, 0), 14, 200, 14);
}

// ------------------------------------------------------------------ contact sheet: one auto-framed viewport per object
// ?cat=sheet&set=props|pickups|structures|misc&page=0&cols=4&rows=3&seed=0
let sheetCells = null;
async function setupSheet() {
  const set = Q.get('set') || 'props';
  const cols = +(Q.get('cols') || 4), rows = +(Q.get('rows') || 3);
  const page = +(Q.get('page') || 0);
  const seed = +(Q.get('seed') || 0);
  let items = [];
  if (set === 'props') {
    const { PROPS } = await import('../../shared/props.js');
    const { createProp } = await import('../render/models/props.js');
    let names = Object.keys(PROPS);
    if (NEW_ONLY) names = NEW_PROPS;
    if (Q.get('names')) names = Q.get('names').split(',');
    items = names.map((n) => ({ name: n, make: () => createProp(n, seed) }));
  } else if (set === 'pickups') {
    const { ITEM, ITEM_DEFS } = await import('../../shared/defs.js');
    const P = await import('../render/models/pickups.js');
    const want = Q.get('names') ? Q.get('names').split(',') : NEW_ONLY ? NEW_ITEMS : null;
    items = Object.entries(ITEM).filter(([n, id]) => id && (!want || want.includes(n))).map(([n, id]) => ({ name: ITEM_DEFS[id]?.name || n, make: () => P.createPickup(id) }));
  } else if (set === 'structures') {
    const { STRUCT } = await import('../../shared/defs.js');
    const S = await import('../render/models/structures.js');
    const want = Q.get('names') ? Q.get('names').split(',') : NEW_ONLY ? NEW_STRUCTS : null;
    for (const [n, id] of Object.entries(STRUCT).filter(([n]) => !want || want.includes(n)))
      for (const hp of [1, 0.5, 0.15])
        items.push({ name: `${n} ${hp}`, make: () => { const g = S.createStructure(id); S.setStructureDamage(g, hp); return g; } });
  }
  const per = cols * rows;
  items = items.slice(page * per, page * per + per);
  sheetCells = items.map((it, i) => {
    const obj = it.make();
    shadowAll(obj);
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const el = document.createElement('div');
    el.className = 'lbl';
    el.style.transform = 'none';
    el.textContent = `${it.name}  [${size.x.toFixed(2)} ${size.y.toFixed(2)} ${size.z.toFixed(2)}] ${countTris(obj)}t`;
    labelsEl.appendChild(el);
    return { obj, size, center, el, col: i % cols, row: Math.floor(i / cols) };
  });
  renderer.setScissorTest(true);
}
function renderSheet() {
  const cols = +(Q.get('cols') || 4), rows = +(Q.get('rows') || 3);
  const W = innerWidth, H = innerHeight, cw = W / cols, ch = H / rows;
  const yaw = THREE.MathUtils.degToRad(+(Q.get('yaw') ?? 215)), pitch = THREE.MathUtils.degToRad(+(Q.get('pitch') ?? 20));
  camera.aspect = cw / ch;
  camera.updateProjectionMatrix();
  for (const c of sheetCells) {
    scene.add(c.obj);
    const r = Math.max(c.size.length() * 0.5, 0.2);
    const d = (r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * (+(Q.get('zoom') || 1));
    camera.position.set(c.center.x + Math.sin(yaw) * Math.cos(pitch) * d, c.center.y + Math.sin(pitch) * d, c.center.z + Math.cos(yaw) * Math.cos(pitch) * d);
    camera.lookAt(c.center);
    sun.position.set(c.center.x - 30, c.center.y + (BRIGHT ? 50 : 22), c.center.z - 40);
    sun.target.position.copy(c.center);
    sun.target.updateMatrixWorld();
    const x = c.col * cw, y = H - (c.row + 1) * ch;
    renderer.setViewport(x, y, cw, ch);
    renderer.setScissor(x, y, cw, ch);
    renderer.render(scene, camera);
    scene.remove(c.obj);
    c.el.style.left = `${x + 4}px`;
    c.el.style.top = `${c.row * ch + 4}px`;
  }
}

// ------------------------------------------------------------------ loop
function updateLabels() {
  const w = innerWidth, h = innerHeight;
  const v = new THREE.Vector3();
  for (const l of labels) {
    v.copy(l.pos).project(camera);
    if (v.z > 1) {
      l.el.style.display = 'none';
      continue;
    }
    l.el.style.display = '';
    l.el.style.left = `${((v.x + 1) / 2) * w}px`;
    l.el.style.top = `${((1 - v.y) / 2) * h}px`;
  }
}
function loop() {
  vegetationTime.value = (performance.now() - t0) / 1000;
  if (sheetCells) renderSheet();
  else {
    renderer.render(scene, camera);
    updateLabels();
  }
  requestAnimationFrame(loop);
}
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
setup()
  .then(() => {
    loop();
    setTimeout(() => {
      info.textContent = `draw calls ${renderer.info.render.calls}, tris ${renderer.info.render.triangles}, programs ${renderer.info.programs.length}`;
      console.log(info.textContent, errors.length ? 'ERRORS: ' + errors.join(' | ') : '');
    }, 500);
  })
  .catch((e) => {
    console.error('setup failed', e);
    info.textContent = 'setup failed: ' + e.message;
  });
