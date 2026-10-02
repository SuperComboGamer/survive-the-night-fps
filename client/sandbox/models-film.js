// Locomotion film strip: one zombie walking across the ground, rendered at fixed time steps into a grid.
// Also measures foot skating (how fast a foot slides while it is on the ground).
// Params:
//   ?film=T        zombie type (number);  ?seed=N  instance seed (picks the variant)
//   ?anim=N        ZANIM state (default WALK);  ?speed=F  ground speed (default: the type's speed)
//   ?frames=N      frames in the strip (12);  ?fdt=S  seconds between frames (default: one gait cycle)
//   ?cols=N        columns (6);  ?cam=side|front|q|back|top;  ?w=/?h= frame size in px;  ?t0=S start time
//   ?fixed=1       keep the zombie in place (no ground translation)
//   ?dist=M  ?ty=M  camera distance and the height it looks at (default: from the type's height)
//   ?hurt=1        take a hit on the first frame (flinch);  ?vox=K  vocalize on the first frame (0 growl, 1 scream, 2 roar)
//   ?legs=B        legs shot off (1 left, 2 right, 3 both: it crawls);  ?fall=1  ...on the first frame, not before it
//                  (also prints where the head centre is: the server's crawler hitbox has it CRAWL_HEAD_FWD ahead)
import * as THREE from 'three';
import { ZOMBIE_DEFS, ZANIM } from '../../shared/defs.js';
import { createZombie } from '../render/models/characters.js';
import { DOG_SOLES } from '../render/models/dog.js';

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
const legs = +(q.get('legs') || 0), fall = q.get('fall') === '1';
if (legs && !fall) zb.setLegs?.(legs);
// the zombie rig is detached (bones aren't in the scene graph); feet are read from the solved skinning pose.
// A quadruped (the dog) has scene-graph bones: its four paw soles hang off the wrist / hock bones
const inst = zb._inst;
const quad = inst.X.footL === undefined;
const FEET = quad ? { fpL: 0, fpR: 0, hhL: 0, hhR: 0 } : { footL: inst.X.footL, footR: inst.X.footR };
if (quad) {
  for (const n in FEET) {
    const sole = new THREE.Object3D();
    sole.position.set(...DOG_SOLES[n.slice(0, 2)]);
    inst.bones[inst.X[n]].add(sole);
    FEET[n] = sole;
  }
}
function footWorld(idx, out) {
  if (quad) return idx.getWorldPosition(out);
  if (inst.poseDirty) {
    inst._solve();
    inst.poseDirty = true; // still upload it at render time
  }
  const W = inst.world, o = idx * 12;
  inst.mesh.updateWorldMatrix(true, false);
  return out.set(W[o + 9], W[o + 10], W[o + 11]).applyMatrix4(inst.mesh.matrixWorld);
}

const camera = new THREE.PerspectiveCamera(30, W / H, 0.05, 100);
const dir = cam === 'front' ? new THREE.Vector3(0.1, 0.12, -1) : cam === 'back' ? new THREE.Vector3(0.1, 0.15, 1) : cam === 'q' ? new THREE.Vector3(-0.8, 0.25, -0.7) : cam === 'top' ? new THREE.Vector3(0.01, 1, 0.15) : new THREE.Vector3(-1, 0.1, 0);
dir.normalize();
const camDist = +(q.get('dist') || def.height * 2.6);
const camY = +(q.get('ty') || def.height * 0.5);

// step the zombie deterministically; it walks toward -z (its facing)
const STEP = 1 / 120;
let time = 0, pos = 0;
if (!moving) zb._inst.wScale = 0; // treadmill: feet must slide back, so no world-space foot pinning
function step(dt) {
  zb._inst._seen = true; // pose every substep (the instance skips posing when it was not rendered)
  if (moving) pos -= speed * dt;
  zb.object.position.set(0, 0, pos); // placed before update(), as the game does
  zb.update(dt, anim, speed, time);
  time += dt;
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
const track = Object.fromEntries(Object.keys(FEET).map((n) => [n, []]));
function sampleFeet() {
  zb.object.updateMatrixWorld(true);
  for (const n in FEET) {
    footWorld(FEET[n], _v);
    track[n].push([_v.x, _v.y, _v.z, time]);
  }
}

const out = document.createElement('canvas');
const rows = Math.ceil(frames / cols);
out.width = W * cols;
out.height = H * rows + 60;
document.body.appendChild(out);
const ctx = out.getContext('2d');
ctx.fillStyle = '#000';
ctx.fillRect(0, 0, out.width, out.height);
ctx.font = '13px monospace';

if (q.has('hurt')) zb.hurt();
if (q.has('vox')) zb.vocalize(+q.get('vox'));
if (legs && fall) zb.setLegs?.(legs, true);
const head = { y: 0, z: 0, n: 0, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity };
for (let f = 0; f < frames; f++) {
  zb.object.updateMatrixWorld(true);
  const target = new THREE.Vector3(0, camY, pos);
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
    // the head centre, relative to the entity (y up, z < 0 ahead of it)
    if (!inst.headCenter || !inst.anchorWorld) continue;
    inst.anchorWorld(inst.headCenter, _v);
    inst.poseDirty = true; // still upload it at render time
    const hz = _v.z - pos;
    head.y += _v.y;
    head.z += hz;
    head.n++;
    head.y0 = Math.min(head.y0, _v.y);
    head.y1 = Math.max(head.y1, _v.y);
    head.z0 = Math.min(head.z0, hz);
    head.z1 = Math.max(head.z1, hz);
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
const skates = Object.keys(FEET).map((n) => [n, skate(track[n])]);
const sL = skates[0][1], sR = skates[1][1];
const gv = zb._inst.gv ? Object.entries(zb._inst.gv).map(([k, v]) => `${k}=${+v.toFixed(2)}`).join(' ') : '';
const txt = `type ${def.name} anim ${anim} speed ${speed.toFixed(2)} cycle ${cycleT.toFixed(3)}s fdt ${fdt.toFixed(3)} limpSide ${zb._inst.limpSide} armSide ${zb._inst.armSide} ${gv}\n` +
  'skate ' + skates.map(([n, s]) => `${n} avg ${s.avg.toFixed(3)} max ${s.max.toFixed(2)} grounded ${(s.ground * 100).toFixed(0)}%`).join('  ') +
  `\nhead y ${(head.y / head.n).toFixed(3)} (${head.y0.toFixed(2)}..${head.y1.toFixed(2)}) z ${(head.z / head.n).toFixed(3)} (${head.z0.toFixed(2)}..${head.z1.toFixed(2)})`;
ctx.fillStyle = '#dde';
txt.split('\n').forEach((l, i) => ctx.fillText(l, 8, H * rows + 16 + i * 16));
console.log(txt);
window.__film = { done: true, txt, skateL: sL, skateR: sR, zb };
