// Locomotion film strip: one zombie walking across the ground, rendered at fixed time steps into a grid.
// Also measures foot skating (how fast a foot slides while it is on the ground).
// Params:
//   ?film=T        zombie type (number);  ?seed=N  instance seed (picks the variant)
//   ?anim=N        ZANIM state (default WALK);  ?speed=F  ground speed (default: the type's speed)
//   ?frames=N      frames in the strip (12);  ?fdt=S  seconds between frames (default: one gait cycle)
//   ?cols=N        columns (6);  ?cam=side|front|q|back;  ?w=/?h= frame size in px;  ?t0=S start time
//   ?fixed=1       keep the zombie in place (no ground translation)
import * as THREE from 'three';
import { ZOMBIE_DEFS, ZANIM } from '../../shared/defs.js';
import { createZombie } from '../render/models/characters.js';

const q = new URLSearchParams(location.search);
const type = +q.get('film');
const def = ZOMBIE_DEFS[type];
const anim = q.has('anim') ? +q.get('anim') : ZANIM.WALK;
const speed = q.has('speed') ? +q.get('speed') : anim === ZANIM.WALK || anim === ZANIM.RUN ? def.speed : 0;
const frames = +(q.get('frames') || 12);
const cols = +(q.get('cols') || 6);
const W = +(q.get('w') || 300), H = +(q.get('h') || 380);
const cam = q.get('cam') || 'side';
const moving = q.get('fixed') !== '1';
const t0 = +(q.get('t0') || 2);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14171d);
scene.add(new THREE.HemisphereLight(0x9aa8bc, 0x1a1810, 1.6));
const key = new THREE.DirectionalLight(0xffe2c0, 2.4);
key.position.set(-5, 9, -6);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 30 });
scene.add(key, key.target);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ color: 0x2a2b26 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(400, 800, 0x4a4d44, 0x3a3c35);
grid.position.y = 0.002;
scene.add(grid);

const zb = createZombie(type, +(q.get('seed') || 1));
zb.object.traverse((o) => {
  if (o.isMesh) o.castShadow = true;
});
scene.add(zb.object);
const bones = {};
zb.object.traverse((o) => {
  if (o.isBone) bones[o.name] = o;
});

const camera = new THREE.PerspectiveCamera(30, W / H, 0.05, 100);
const dir = cam === 'front' ? new THREE.Vector3(0.1, 0.12, -1) : cam === 'back' ? new THREE.Vector3(0.1, 0.15, 1) : cam === 'q' ? new THREE.Vector3(-0.8, 0.25, -0.7) : new THREE.Vector3(-1, 0.1, 0);
dir.normalize();
const camDist = def.height * 2.6;

// step the zombie deterministically; it walks toward -z (its facing)
const STEP = 1 / 120;
let time = 0, pos = 0;
function step(dt) {
  zb._inst._seen = true; // pose every substep (the instance skips posing when it was not rendered)
  zb.update(dt, anim, speed, time);
  time += dt;
  if (moving) pos -= speed * dt;
  zb.object.position.set(0, 0, pos);
}
for (let i = 0; i < t0 / STEP; i++) step(STEP);

// gait cycle length in seconds, measured from how fast the instance's phase advances
const ph0 = zb._inst.phase;
step(STEP);
const dph = zb._inst.phase - ph0;
const cycleT = dph > 0 ? (Math.PI * 2 * STEP) / dph : 1;
const fdt = q.has('fdt') ? +q.get('fdt') : cycleT / frames;

// skate metric: horizontal foot speed while the foot is on the ground (lowest few cm of its travel)
const _v = new THREE.Vector3();
const track = { footL: [], footR: [] };
function sampleFeet() {
  zb.object.updateMatrixWorld(true);
  for (const n of ['footL', 'footR']) {
    bones[n].getWorldPosition(_v);
    track[n].push([_v.x, _v.y, _v.z, time]);
  }
}

const out = document.createElement('canvas');
const rows = Math.ceil(frames / cols);
out.width = W * cols;
out.height = H * rows + 44;
document.body.appendChild(out);
const ctx = out.getContext('2d');
ctx.fillStyle = '#000';
ctx.fillRect(0, 0, out.width, out.height);
ctx.font = '13px monospace';

for (let f = 0; f < frames; f++) {
  zb.object.updateMatrixWorld(true);
  const target = new THREE.Vector3(0, def.height * 0.5, pos);
  camera.position.copy(target).addScaledVector(dir, camDist);
  camera.lookAt(target);
  key.position.set(-5, 9, pos - 6);
  key.target.position.set(0, 0, pos);
  renderer.render(scene, camera);
  const x = (f % cols) * W, y = Math.floor(f / cols) * H;
  ctx.drawImage(renderer.domElement, x, y);
  ctx.fillStyle = '#9ab';
  ctx.fillText(`${f}  t=${time.toFixed(3)}`, x + 6, y + 16);
  const n = Math.max(1, Math.round(fdt / STEP));
  for (let i = 0; i < n; i++) {
    step(STEP);
    sampleFeet();
  }
}
// extra samples for the skate metric (4 cycles)
for (let i = 0; i < (cycleT * 4) / STEP; i++) {
  step(STEP);
  sampleFeet();
}

function skate(tr) {
  let minY = Infinity;
  for (const s of tr) minY = Math.min(minY, s[1]);
  let slid = 0, grounded = 0, maxSlide = 0;
  for (let i = 1; i < tr.length; i++) {
    const a = tr[i - 1], b = tr[i];
    if (b[1] > minY + 0.012 || a[1] > minY + 0.012) continue;
    const v = Math.hypot(b[0] - a[0], b[2] - a[2]) / (b[3] - a[3]);
    slid += v;
    grounded++;
    maxSlide = Math.max(maxSlide, v);
  }
  return { avg: grounded ? slid / grounded : 0, max: maxSlide, ground: grounded / tr.length };
}
const sL = skate(track.footL), sR = skate(track.footR);
const gv = zb._inst.gv ? Object.entries(zb._inst.gv).map(([k, v]) => `${k}=${+v.toFixed(2)}`).join(' ') : '';
const txt = `type ${def.name} anim ${anim} speed ${speed.toFixed(2)} cycle ${cycleT.toFixed(3)}s fdt ${fdt.toFixed(3)} limpSide ${zb._inst.limpSide} armSide ${zb._inst.armSide} ${gv}\n` +
  `skate L avg ${sL.avg.toFixed(3)} max ${sL.max.toFixed(2)} grounded ${(sL.ground * 100).toFixed(0)}%  ` +
  `R avg ${sR.avg.toFixed(3)} max ${sR.max.toFixed(2)} grounded ${(sR.ground * 100).toFixed(0)}%`;
ctx.fillStyle = '#dde';
txt.split('\n').forEach((l, i) => ctx.fillText(l, 8, H * rows + 16 + i * 16));
console.log(txt);
window.__film = { done: true, txt, skateL: sL, skateR: sR, zb, bones };
