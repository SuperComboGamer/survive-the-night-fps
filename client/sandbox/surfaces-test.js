// Look-dev for building surfaces and vehicles, built through the real StaticWorld (merged geometry, static
// material variants, window joinery). URL params:
//   set=walls|roofs|floors|cars   (default walls)
//   only=<material or prop name>  frame one swatch
//   sun=<azimuth>,<elevation> in degrees (default 35,32: raking light from the upper left)
//   flash=1   night: no sun, a flashlight at the camera
//   dist, yaw, pitch (deg), h (camera target height)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { getTexture, setMaxAnisotropy } from '../render/textures.js';
import { StaticWorld } from '../render/staticworld.js';

const Q = new URLSearchParams(location.search);
const SET = Q.get('set') || 'walls';
const ONLY = Q.get('only');
const FLASH = Q.get('flash') === '1';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);
setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());

const scene = new THREE.Scene();
const sky = FLASH ? 0x05070a : 0x8a929a;
scene.background = new THREE.Color(sky);
scene.fog = new THREE.FogExp2(sky, FLASH ? 0.02 : 0.003);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.05, 600);
const controls = new OrbitControls(camera, renderer.domElement);
scene.add(camera);

scene.add(new THREE.HemisphereLight(0xc8d4e4, 0x4a4236, FLASH ? 0.06 : 1.1));
const [az, el] = (Q.get('sun') || '35,32').split(',').map((v) => THREE.MathUtils.degToRad(+v));
const sun = new THREE.DirectionalLight(0xfff4e2, FLASH ? 0 : 2.0);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.camera.left = sun.shadow.camera.bottom = -70;
sun.shadow.camera.right = sun.shadow.camera.top = 70;
sun.shadow.camera.far = 400;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
if (FLASH) {
  const spot = new THREE.SpotLight(0xfff1d0, 60, 40, 0.42, 0.5, 1.6);
  spot.position.set(0.25, -0.2, 0);
  spot.target.position.set(0, 0, -5);
  camera.add(spot, spot.target);
}

const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ map: getTexture('ground_dirt', 100, 100) }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// ------------------------------------------------------------------ swatches (a fake world for StaticWorld)
const GAP = 11;
const parts = [];
const props = [];
const names = [];
const box = (mat, x, y, z, sx, sy, sz, r = {}) => parts.push({ shape: 'box', mat, x, y, z, sx, sy, sz, rx: r.rx || 0, ry: r.ry || 0, rz: r.rz || 0 });

if (SET === 'walls') {
  // an 8 x 3.4 m wall with a window, a return wall and a roof edge above it
  ['clapboard', 'brick', 'planks', 'barn', 'logwall', 'concrete', 'stone', 'tin', 'tin_rust', 'charred', 'metal', 'rust'].forEach((mat, i) => {
    const x = i * GAP;
    names.push(mat);
    box(mat, x, 1.7, 0, 8, 3.4, 0.25);
    box('glass', x - 1.6, 1.75, 0, 1.2, 1.3, 0.25);
    box(mat, x + 4.125, 1.7, -2, 0.25, 3.4, 4);
    box(mat === 'brick' || mat === 'concrete' ? 'concrete' : 'tin', x, 3.5, -0.9, 8.7, 0.14, 3, { rx: 0.18 });
  });
} else if (SET === 'roofs') {
  ['shingles', 'tin', 'tin_rust', 'planks', 'concrete'].forEach((mat, i) => {
    const x = i * GAP;
    names.push(mat);
    box('planks', x, 1.2, 0, 8, 2.4, 0.2);
    box(mat, x, 3.4, -2.6, 8.6, 0.12, 6.4, { rx: 0.42 });
  });
} else if (SET === 'floors') {
  ['concrete', 'dockwood', 'planks', 'stone', 'tin', 'metal'].forEach((mat, i) => {
    const x = i * GAP;
    names.push(mat);
    box(mat, x, 0.1, 0, 8, 0.2, 8);
    box(mat, x, 0.6, -4.1, 8, 1.2, 0.2);
  });
} else {
  ['car', 'car_wreck', 'car_wreck', 'car_wreck', 'car_wreck', 'pickup_truck', 'pickup_truck', 'school_bus', 'camper', 'dump_truck', 'tractor', 'dumpster', 'fuel_tank', 'gas_pump', 'fridge', 'locker', 'barrel'].forEach((type, i) => {
    names.push(type);
    props.push({ type, x: i * GAP, y: 0, z: 0, ry: Math.PI * 0.72, seed: i });
  });
}
const world = { parts, props, openings: [], heightAt: () => 0 };
const sw = new StaticWorld(scene, world);
sw.update(new THREE.Vector3(), 1e6);

// ------------------------------------------------------------------ framing
const idx = ONLY ? Math.max(0, names.indexOf(ONLY)) : -1;
const cx = idx >= 0 ? idx * GAP : ((names.length - 1) * GAP) / 2;
const target = new THREE.Vector3(cx, +(Q.get('h') ?? 1.6), 0);
const yaw = THREE.MathUtils.degToRad(+(Q.get('yaw') ?? 0));
const pitch = THREE.MathUtils.degToRad(+(Q.get('pitch') ?? 4));
const dist = +(Q.get('dist') ?? (idx >= 0 ? 7 : names.length * GAP * 0.62));
camera.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * dist, target.y + Math.sin(pitch) * dist, target.z + Math.cos(yaw) * Math.cos(pitch) * dist);
controls.target.copy(target);
controls.update();
sun.target.position.copy(target);
sun.position.set(target.x - Math.sin(az) * Math.cos(el) * 150, Math.sin(el) * 150, target.z + Math.cos(az) * Math.cos(el) * 150);

const hud = document.getElementById('hud');
hud.innerHTML = ['walls', 'roofs', 'floors', 'cars'].map((s) => `<a href="?set=${s}">${s}</a>`).join('') + names.map((n) => `<a href="?set=${SET}&only=${n}">${n}</a>`).join('');
if (Q.get('nohud') === '1') hud.style.display = 'none';

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
