// Character lineup sandbox.
// Params:
//   ?anim=N      freeze ZANIM state N (else cycles every 2s)
//   ?hit=1       draw hitbox cylinder + head sphere wireframes
//   ?only=T      show only zombie type T (number) close-up; ?only=surv for survivors
//   ?surv=1      survivor row with every weapon;  ?zombie=1 -> zombified survivors
//   ?cam=side|back|top   camera angle;  ?t=SECONDS fixed clock;  ?zoom=F
//   ?cats=1      the stray cat in every coat (cycles CANIM states);  ?cats=grid -> one per CANIM state
//   ?deer=1      the deer in every coat (cycles DANIM states);  ?deer=grid -> one per DANIM state (&coat=N);
//                ?deer=film&anim=2 -> six of them a sixth of a bound apart (&anim=1: of a walking stride);
//                &hit=1 draws the server's hitbox on each and prints where the middle of the skull is
//   ?pack=poses  survivors wearing the backpack: idle, walk, sprint, crouch, downed, seated (&cam=back|q|front, &yaw=deg)
//   ?pack=ground the backpack as it lies on the ground, from four sides
//   ?voice=L     survivors talking on voice chat at loudness L (0.02 shut .. 0.14 wide open); ?voice=talk -> a sentence
import * as THREE from 'three';
import { ZTYPE, ZOMBIE_DEFS, ZANIM, CANIM, ITEM } from '../../shared/defs.js';
import { createZombie, createSurvivor, modelStats, zombieVariants } from '../render/models/characters.js';
import { createCat, CAT_COATS } from '../render/models/cat.js';
import { createDeer, DEER_COATS } from '../render/models/deer.js';
import { DANIM, DEER, deerHitbox } from '../../shared/deer.js';
import { MeshBuilder } from '../render/models/skinning.js';
import { createPickup } from '../render/models/pickups.js';
MeshBuilder.debugNaN = true;
MeshBuilder.debugStats = new URLSearchParams(location.search).get('tstats') === '1';

const q = new URLSearchParams(location.search);
const info = document.getElementById('info');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d12);
scene.fog = new THREE.Fog(0x0b0d12, 18, 60);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.05, 200);

scene.add(new THREE.HemisphereLight(0x8a9ab0, 0x1a1810, q.get('bright') === '1' ? 2.5 : 1.1));
const key = new THREE.DirectionalLight(0xffe2c0, 2.2);
key.position.set(-6, 10, -8);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -16, right: 16, top: 12, bottom: -4, near: 1, far: 40 });
scene.add(key);
const rim = new THREE.DirectionalLight(0x6080ff, 1.2);
rim.position.set(4, 6, 10);
scene.add(rim);

if (q.get('night') === '1') {
  // game-like night: dim moonlight + flashlight from the camera
  scene.children.filter((o) => o.isLight).forEach((l) => (l.intensity *= 0.18));
  scene.fog = new THREE.FogExp2(0x05070a, 0.06);
  scene.background = new THREE.Color(0x05070a);
  const spot = new THREE.SpotLight(0xfff2d8, 60, 30, 0.5, 0.5, 1.6);
  spot.position.set(0, 0, 0);
  camera.add(spot);
  spot.target.position.set(0, -0.1, -1);
  camera.add(spot.target);
  scene.add(camera);
}
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshLambertMaterial({ color: 0x23241f }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(60, 60, 0x33352e, 0x2a2c26);
grid.position.y = 0.002;
scene.add(grid);

const showHit = q.get('hit') === '1';
const fixedAnim = q.has('anim') ? +q.get('anim') : -1;
const fixedT = q.has('t') ? +q.get('t') : -1;
const only = q.get('only');
const actors = [];

function hitbox(type, x, z) {
  const d = ZOMBIE_DEFS[type];
  const g = new THREE.Group();
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(d.radius, d.radius, d.height, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0x00ff66, wireframe: true, transparent: true, opacity: 0.35 }));
  cyl.position.y = d.height / 2;
  const hs = new THREE.Mesh(new THREE.SphereGeometry(d.headR, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff3030, wireframe: true }));
  hs.position.set(0, d.headY, -(d.headFwd || 0));
  g.add(cyl, hs);
  g.position.set(x, 0, z);
  scene.add(g);
  return g;
}

function addZombie(type, seed, x, z, y = 0) {
  const zb = createZombie(type, seed);
  zb.object.position.set(x, y, z);
  zb.object.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  scene.add(zb.object);
  if (q.get('headless') === '1') zb.setHeadless(true);
  if (q.has('legs')) zb.setLegs?.(+q.get('legs')); // &legs=1|2|3: legs shot off (types that have them to lose)
  if (showHit) hitbox(type, x, z).position.y = y ? y - ZOMBIE_DEFS[type].headY : 0;
  actors.push({ kind: 'z', type, obj: zb, x, z });
  return zb;
}

const survWeapons = [ITEM.AK47, ITEM.SHOTGUN, ITEM.HUNTING_RIFLE, ITEM.PISTOL, ITEM.BAT, ITEM.MACHETE, ITEM.KNIFE, ITEM.SPIKED_BAT, ITEM.HAMMER, ITEM.MOLOTOV, 0, ITEM.PIPEBOMB, ITEM.FLARE, ITEM.GRENADE, ITEM.DECOY, ITEM.FLARE_GUN];
function addSurvivor(seed, item, x, z, zombie) {
  const s = createSurvivor(seed);
  s.setWeapon(item);
  if (zombie) s.setZombie(true);
  s.object.position.set(x, 0, z);
  s.object.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  scene.add(s.object);
  if (showHit) {
    const g = new THREE.Group();
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.8, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0x00ff66, wireframe: true, transparent: true, opacity: 0.35 }));
    cyl.position.y = 0.9;
    const hs = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff3030, wireframe: true }));
    hs.position.y = 1.62;
    g.add(cyl, hs);
    g.position.set(x, 0, z);
    scene.add(g);
  }
  actors.push({ kind: 's', obj: s, x, z, item });
  return s;
}

function addCat(coat, x, z, fixed) {
  const c = createCat(coat, coat * 7 + 1);
  c.object.position.set(x, 0, z);
  c.object.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  scene.add(c.object);
  actors.push({ kind: 'c', obj: c, x, z, fixed });
  return c;
}

// a deer: coat 0-1 a doe, 2 the buck. fixed: a DANIM state it holds (else they all cycle)
const DEER_STATES = [DANIM.IDLE, DANIM.WALK, DANIM.RUN, DANIM.GRAZE, DANIM.DEAD];
function addDeer(coat, x, z, fixed) {
  const d = createDeer(coat === 2 ? 1 : coat << 1, coat * 7 + 1);
  d.object.scale.setScalar(1); // (the hitbox is drawn for one of average size)
  d.object.position.set(x, 0, z);
  d.object.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  scene.add(d.object);
  const a = { kind: 'd', obj: d, x, z, fixed };
  if (showHit) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x00ff66, wireframe: true, transparent: true, opacity: 0.35 });
    a.cyl = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 16, 1, true), mat);
    a.head = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff3030, wireframe: true }));
    scene.add(a.cyl, a.head);
  }
  actors.push(a);
  return d;
}

const zoom = q.has('zoom') ? +q.get('zoom') : 1;
let target = new THREE.Vector3(0, 1.2, 0);
let dist = 14;
if (q.has('deer')) {
  const film = q.get('deer') === 'film';
  const grid = film || q.get('deer') === 'grid';
  const n = film ? 6 : grid ? DEER_STATES.length : DEER_COATS;
  const coat = q.has('coat') ? +q.get('coat') : 0;
  const col = q.get('cam') === 'side';
  for (let i = 0; i < n; i++) {
    const o = (i - (n - 1) / 2) * (col ? 2.4 : 1.5);
    addDeer(grid ? coat : i, col ? 0 : -o, col ? o : 0, film ? DEER_STATES[fixedAnim] : grid ? DEER_STATES[i] : undefined);
    if (film) actors[actors.length - 1].lead = i / 6; // (of a gait cycle)
  }
  target.set(0, 0.7, 0);
  dist = n * (col ? 2.1 : 1.5);
} else if (q.has('cats')) {
  const grid = q.get('cats') === 'grid';
  const n = grid ? 4 : CAT_COATS;
  const coat = q.has('coat') ? +q.get('coat') : 0;
  const col = q.get('cam') === 'side';
  for (let i = 0; i < n; i++) {
    const o = (i - (n - 1) / 2) * (col ? 0.9 : 0.7);
    addCat(grid ? coat : i, col ? 0 : o, col ? o : 0, grid ? i : undefined);
  }
  target.set(0, 0.18, 0);
  dist = n * 0.62;
} else if (q.get('pack') === 'poses') {
  // the poses a worn backpack has to sit right in (entities.js: downed is crouched, raised and tipped forward)
  const poses = ['idle', 'walk', 'sprint', 'crouch', 'downed', 'seated'];
  const n = poses.length;
  poses.forEach((pose, i) => {
    const s = addSurvivor(i + 2, ITEM.PISTOL, (i - (n - 1) / 2) * 1.8, 0, false);
    s.setBackpack(true);
    actors[actors.length - 1].pose = pose;
  });
  target.set(0, 0.95, 0);
  dist = 11;
} else if (q.get('pack') === 'ground') {
  for (let i = 0; i < 4; i++) {
    const g = createPickup(ITEM.BACKPACK);
    g.position.set((i - 1.5) * 0.7, 0, 0);
    g.rotation.y = (i * Math.PI) / 2 + 0.5;
    g.traverse((o) => o.isMesh && (o.castShadow = o.receiveShadow = true));
    scene.add(g);
  }
  target.set(0, 0.22, 0);
  dist = 3.2;
} else if (q.get('surv') === '1' || only === 'surv') {
  const zombie = q.get('zombie') === '1';
  const list = q.has('items') ? q.get('items').split(',').map(Number) : only === 'surv' ? survWeapons.slice(0, 4) : survWeapons;
  const n = list.length;
  for (let i = 0; i < n; i++) addSurvivor(i + 1, list[i], (i - (n - 1) / 2) * 1.3, 0, zombie);
  target.set(0, 1.0, 0);
  dist = n <= 4 ? 5.5 : 12;
} else if (q.has('variants')) {
  // one instance per cached variant of a type (?from=A&to=B picks a range)
  const t = +q.get('variants');
  const nv = zombieVariants(t);
  const v0 = q.has('from') ? +q.get('from') : 0, v1 = q.has('to') ? Math.min(nv - 1, +q.get('to')) : nv - 1;
  const n = v1 - v0 + 1;
  for (let v = v0; v <= v1; v++) {
    let seed = 1;
    while ((((seed >>> 0) * 2654435761) >>> 0) % nv !== v) seed++;
    addZombie(t, seed, (v - v0 - (n - 1) / 2) * 1.1, 0);
  }
  target.set(0, 1.0, 0);
  dist = Math.max(3, n * 1.25);
} else if (q.has('stress')) {
  // performance: N mixed zombies in a grid, all animating
  const N = +q.get('stress') || 80;
  const types = [0, 0, 0, 0, 1, 1, 3, 4, 5, 6];
  const side = Math.ceil(Math.sqrt(N));
  for (let i = 0; i < N; i++) addZombie(types[i % types.length], i + 1, ((i % side) - side / 2) * 1.6, Math.floor(i / side) * 1.6);
  target.set(0, 1, side * 0.6);
  dist = side * 2.2;
} else if (q.has('grid')) {
  // one instance per ZANIM state, side by side
  const g = q.get('grid');
  const isSurv = g === 'surv' || g === 'zsurv';
  const t = isSurv ? ZTYPE.WALKER : +g;
  const d = ZOMBIE_DEFS[t];
  const sp = isSurv ? 1.4 : Math.max(1.4, d.radius * 2.6);
  for (let i = 0; i < 9; i++) {
    let a;
    const col = q.get('cam') === 'side';
    const gx = col ? 0 : (4 - i) * sp, gz = col ? (i - 4) * sp : 0;
    if (isSurv) a = addSurvivor(i + 1, +(q.get('item') || ITEM.AK47), gx, gz, g === 'zsurv');
    else a = addZombie(t, i * 5 + 1, gx, gz, t === ZTYPE.BAT ? 1.2 : 0);
    actors[actors.length - 1].fixed = i;
  }
  target.set(0, isSurv ? 0.9 : t === ZTYPE.BAT ? 1.2 : d.height * 0.5, 0);
  dist = sp * 5.2;
} else if (only !== null) {
  const t = +only;
  const d = ZOMBIE_DEFS[t];
  const n = t === ZTYPE.WALKER ? 4 : t === ZTYPE.RUNNER ? 3 : 2;
  const sp = Math.max(1.3, d.radius * 3);
  for (let i = 0; i < n; i++) addZombie(t, i * 7 + 1, (i - (n - 1) / 2) * sp, 0, t === ZTYPE.BAT ? 1.4 : 0);
  target.set(0, t === ZTYPE.BAT ? 1.4 : d.height * 0.55, 0);
  dist = Math.max(3, d.height * 2.2 + n * sp * 0.6);
} else {
  const row1 = [[ZTYPE.WALKER, 1], [ZTYPE.WALKER, 2], [ZTYPE.RUNNER, 3], [ZTYPE.SPITTER, 4], [ZTYPE.LEAPER, 5], [ZTYPE.ROPER, 6], [ZTYPE.BOOMER, 7], [ZTYPE.BAT, 8]];
  row1.forEach(([t, s], i) => addZombie(t, s, (i - 3.5) * 1.5, -1.5, t === ZTYPE.BAT ? 1.5 : 0));
  const row2 = [[ZTYPE.BOSS_BRUTE, 13], [ZTYPE.TANK, 9], [ZTYPE.BOSS_ABOMINATION, 10], [ZTYPE.BOSS_HIVEQUEEN, 11], [ZTYPE.BOSS_BLOATER, 14]];
  row2.forEach(([t, s], i) => addZombie(t, s, (i - 2) * 3.8, 3.5));
  for (let i = 0; i < 2; i++) addZombie(ZTYPE.DOG, i * 3 + 1, 6.4 + i * 1.3, -1.5);
  addZombie(ZTYPE.BOSS_ALPHA, 15, 11.5, 2.0);
  addZombie(ZTYPE.SHADE, 12, 9.2, -1.5);
  // front row: a survivor holding each weapon
  const wl = [ITEM.KNIFE, ITEM.BAT, ITEM.SPIKED_BAT, ITEM.MACHETE, ITEM.HAMMER, ITEM.PISTOL, ITEM.SHOTGUN, ITEM.AK47, ITEM.HUNTING_RIFLE, ITEM.MOLOTOV, ITEM.PIPEBOMB];
  wl.forEach((it, i) => addSurvivor(i + 1, it, (i - (wl.length - 1) / 2) * 1.05, -4.2, false));
  target.set(0, 1.4, -0.5);
  dist = 16;
}
dist /= zoom;
const cam = q.get('cam') || 'front';
if (q.has('ty')) target.y = +q.get('ty');
if (q.has('tx')) target.x = +q.get('tx');
function placeCamera() {
  const dir = cam === 'top2' ? new THREE.Vector3(0.3, 1.0, -0.6) : cam === 'q' ? new THREE.Vector3(0.8, 0.22, -1) : cam === 'side' ? new THREE.Vector3(-1, 0.12, 0) : cam === 'back' ? new THREE.Vector3(0.2, 0.25, 1) : cam === 'top' ? new THREE.Vector3(0, 1.4, -0.4) : new THREE.Vector3(0.18, only === null && !q.has('grid') && !q.has('surv') && !q.has('variants') && !q.has('stress') ? 0.42 : 0.16, -1);
  dir.normalize();
  camera.position.copy(target).addScaledVector(dir, dist);
  camera.lookAt(target);
}
placeCamera();

const stateNames = Object.keys(ZANIM);
const stats = modelStats();
const statTxt = stats.map((s) => `${String(s.type).padEnd(10)} v${s.variant} tris=${s.tris}${s.cal ? ' k=' + s.cal.k.toFixed(3) + ' dz=' + s.cal.dz.toFixed(3) : ''}`).join('\n');
console.log('model stats\n' + statTxt);

// ?voice=talk: a loudness envelope like speech - syllables about 5 a second, words with short gaps, a pause every 4 s
function sentence(t) {
  if (t % 4 > 3) return 0;
  const word = Math.sin(t * 2.3) + 0.6 * Math.sin(t * 3.7);
  return word < -0.7 ? 0.004 : 0.035 + 0.1 * Math.max(0, Math.sin(t * 31)) * (0.6 + 0.4 * Math.sin(t * 1.7));
}

let lastNow = performance.now();
const perf = { n: 0, upd: 0, rnd: 0 };
let time = 0;
const tmp = new THREE.Vector3();
function frame() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastNow) / 1000);
  lastNow = now;
  time += dt;
  const T = fixedT >= 0 ? fixedT : time;
  const cycleIdx = fixedAnim >= 0 ? fixedAnim : Math.floor(time / 2) % 9;
  const tu0 = performance.now();
  for (const a of actors) {
    const anim = a.fixed !== undefined ? a.fixed : q.has('stress') ? (a.x > 0 ? 1 : 2) : cycleIdx;
    if (a.kind === 'd') {
      const da = a.fixed !== undefined ? a.fixed : DEER_STATES[fixedAnim >= 0 ? fixedAnim : Math.floor(time / 3) % DEER_STATES.length];
      const speed = da === DANIM.WALK ? DEER.walk : da === DANIM.RUN ? DEER.run : 0;
      if (a.lead && !a.led) {
        a.led = true;
        const cycle = (da === DANIM.RUN ? 4.6 : 1.25) / speed; // (the strides of DeerInstance.update)
        for (let i = 0; i < 300 + Math.round(a.lead * cycle * 600); i++) a.obj.update(i < 300 ? 1 / 60 : 1 / 600, da, speed, 0, true);
      }
      if (fixedT >= 0) {
        if (!a.warm) {
          a.warm = true;
          for (let i = 0; i < Math.round(fixedT * 60); i++) a.obj.update(1 / 60, da, speed, i / 60, true);
        }
        a.obj.update(0, da, speed, fixedT, true);
      } else a.obj.update(dt, da, speed, T, true);
      a.obj.anchorWorld(a.obj.object.userData.head, tmp);
      a.skull = [tmp.y, a.z - tmp.z];
      if (a.cyl) {
        const hb = deerHitbox(0, da);
        a.cyl.scale.set(hb.r, hb.top, hb.r);
        a.cyl.position.set(a.x, hb.top / 2, a.z);
        a.head.scale.setScalar(hb.headR);
        a.head.position.set(a.x + hb.hx, hb.headY, a.z + hb.hz);
        a.cyl.visible = a.head.visible = da !== DANIM.DEAD;
      }
    } else if (a.kind === 'c') {
      const ca = a.fixed !== undefined ? a.fixed : fixedAnim >= 0 ? fixedAnim : Math.floor(time / 2) % 4;
      const speed = ca === CANIM.WALK ? 0.8 : ca === CANIM.RUN ? 5.4 : 0;
      if (fixedT >= 0) {
        if (!a.warm) {
          a.warm = true;
          for (let i = 0; i < Math.round(fixedT * 60); i++) a.obj.update(1 / 60, ca, speed, i / 60);
        }
        a.obj.update(0, ca, speed, fixedT);
      } else a.obj.update(dt, ca, speed, T);
    } else if (a.kind === 'z') {
      const d = ZOMBIE_DEFS[a.type];
      const speed = anim === ZANIM.WALK ? Math.min(d.speed, 2.2) : anim === ZANIM.RUN ? d.speed * 1.4 : 0;
      if (fixedT >= 0) {
        // simulate up to fixed time deterministically on first frames
        if (!a.warm) {
          a.warm = true;
          for (let i = 0; i < Math.round(fixedT * 60); i++) a.obj.update(1 / 60, anim, speed, i / 60);
        }
        a.obj.update(0, anim, speed, fixedT);
      } else a.obj.update(dt, anim, speed, T);
      if (q.get('flash') === '1' && (fixedT >= 0 || Math.floor(time * 2) % 3 === 0)) a.obj.flash(1);
    } else {
      const s = a.obj;
      const st = {
        speed: anim === ZANIM.WALK ? 4.3 : anim === ZANIM.RUN ? 7 : anim === ZANIM.EAT ? 2 : 0,
        sprint: anim === ZANIM.RUN, crouch: anim === ZANIM.EAT, pitch: anim === ZANIM.ATTACK ? 0.4 : anim === ZANIM.STAGGER ? -0.4 : 0,
        onGround: anim !== ZANIM.AIRBORNE, reloading: anim === ZANIM.SPECIAL, dead: anim === ZANIM.DEAD, time: T,
        voice: q.get('voice') === 'talk' ? sentence(T) : +(q.get('voice') || 0),
      };
      if (a.pose) {
        const p = a.pose;
        Object.assign(st, { speed: p === 'walk' ? 4.3 : p === 'sprint' ? 7.5 : p === 'downed' ? 0.4 : 0, sprint: p === 'sprint', crouch: p === 'crouch' || p === 'downed', pitch: p === 'downed' ? 0.9 : 0, onGround: true, reloading: false, dead: false, sit: p === 'seated' });
        s.object.rotation.order = 'YXZ';
        s.object.rotation.x = p === 'downed' ? -1.3 : 0;
        s.object.rotation.y = ((+q.get('yaw') || 0) * Math.PI) / 180; // (&yaw=90: side on to a front camera)
        s.object.position.y = p === 'downed' ? 0.18 : p === 'seated' ? 0.45 : 0;
      }
      if (anim === ZANIM.ATTACK && Math.floor(time * 1.5) !== a.lastF) {
        a.lastF = Math.floor(time * 1.5);
        s.fire();
        if (a.item === ITEM.MOLOTOV || a.item === ITEM.PIPEBOMB || a.item === ITEM.GRENADE || a.item === ITEM.DECOY) s.throwAnim();
        else s.melee();
      }
      if (fixedT >= 0) {
        if (!a.warm) {
          a.warm = true;
          for (let i = 0; i < Math.round(fixedT * 60); i++) s.update(1 / 60, { ...st, time: i / 60, voice: q.get('voice') === 'talk' ? sentence(i / 60) : st.voice });
        }
        s.update(0, { ...st, time: fixedT });
      } else s.update(dt, st);
    }
  }
  info.textContent = q.has('deer') ? 'deer: ' + (q.get('deer') === 'grid' ? 'IDLE WALK RUN GRAZE DEAD (left to right)' : q.get('deer') === 'film' ? 'a gait cycle in sixths' : 'doe, grey doe, buck') + '   skull [height, ahead]: ' + actors.map((a) => a.skull.map((v) => v.toFixed(2)).join(' ')).join(' | ') : q.has('cats') ? `cat: ${q.get('cats') === 'grid' ? 'IDLE WALK RUN SIT (left to right)' : Object.keys(CANIM)[fixedAnim >= 0 ? fixedAnim : Math.floor(time / 2) % 4]}   t=${T.toFixed(2)}` : (q.has('grid') ? 'IDLE WALK RUN ATTACK SPECIAL AIRBORNE STAGGER DEAD EAT (left to right)' : `anim: ${stateNames[cycleIdx]} (${cycleIdx})`) + `   t=${T.toFixed(2)}` + (q.get('stats') === '1' ? '\n' + statTxt : '');
  const tu1 = performance.now();
  renderer.render(scene, camera);
  if (q.has('stress')) {
    perf.n++;
    perf.upd += tu1 - tu0;
    perf.rnd += performance.now() - tu1;
    if (perf.n === 120) {
      console.log(`stress ${actors.length} zombies: update ${(perf.upd / perf.n).toFixed(2)} ms/frame, render(cpu) ${(perf.rnd / perf.n).toFixed(2)} ms/frame, calls ${renderer.info.render.calls}, tris ${renderer.info.render.triangles}`);
    }
  }
  requestAnimationFrame(frame);
}
frame();
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
void tmp;
window.__actors = actors; window.__THREE = THREE;
