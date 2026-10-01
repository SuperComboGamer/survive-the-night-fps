// Viewmodel / world-weapon sandbox (loaded by models-test.js when ?vm= or ?ww= is present).
//   ?vm=ITEMID | ?vm=claws | ?vm=all (grid of every item)
//   &act=fire|reload|melee|heavy|throw|use|ads|sprint|walk|crouch|jump
//   &use=ITEMID  with act=use: the consumable being used (food shows the tin instead of the medkit)
//   &t=SECONDS   freeze the clock at this time after the action starts (deterministic screenshot)
//   &orbit=yaw,pitch,dist[,tx,ty,tz]  view the viewmodel from an orbiting camera
//   &hide=L|R|LR hide an arm (inspect the other hand's grip)
//   &light=game  in-game viewmodel lighting (midday) instead of the bright studio lights
//   ?ww=1        world weapon lineup
import * as THREE from 'three';
import { ITEM, ITEM_DEFS, WEAPONS } from '../../shared/defs.js';
import { ViewModel, createWorldWeapon, worldWeaponTris, viewModelTris, handTris, VM_DEBUG } from '../render/models/weapons.js';
// tuning overrides: &hip=x,y,z,rx,ry,rz (current item hip pose) / &claw=x,y,z,rx,ry,rz / &cq=rx,ry,rz
const params = new URLSearchParams(location.search);
if (params.has('hip')) {
  const v = params.get('hip').split(',').map(Number);
  const id = parseInt(params.get('vm'), 10);
  if (VM_DEBUG.VM[id]) VM_DEBUG.VM[id].hip = v;
}
if (params.has('cq')) {
  // &cq=rx,ry,rz: left-hand Euler on the charging handle during the reload
  const id = parseInt(params.get('vm'), 10);
  if (VM_DEBUG.VM[id]) VM_DEBUG.VM[id].chargeQ = params.get('cq').split(',').map(Number);
}
// &rg= / &lg=px,py,pz,fx,fy,fz,nx,ny,nz: right / left grip point, finger direction and palm normal (weapon space)
// &pole=rx,ry,rz,lx,ly,lz: elbow pole vectors; &rpose= / &lpose=: hand pose names
{
  const id = parseInt(params.get('vm'), 10);
  const cfg = VM_DEBUG.VM[id];
  const nums = (k) => params.get(k).split(',').map(Number);
  if (cfg && params.has('rg')) {
    const v = nums('rg');
    cfg.rGrip = { p: v.slice(0, 3), q: VM_DEBUG.handQ(1, v.slice(3, 6), v.slice(6, 9)) };
  }
  if (cfg && params.has('lg')) {
    const v = nums('lg');
    cfg.lGrip = { ...cfg.lGrip, p: v.slice(0, 3), q: VM_DEBUG.handQ(-1, v.slice(3, 6), v.slice(6, 9)) };
  }
  if (cfg && params.has('pole')) {
    const v = nums('pole');
    cfg.poleR = new THREE.Vector3(v[0], v[1], v[2]);
    cfg.poleL = new THREE.Vector3(v[3], v[4], v[5]);
  }
  if (cfg && params.has('rpose')) cfg.rPose = params.get('rpose');
  if (cfg && params.has('lpose')) cfg.lGrip = { ...cfg.lGrip, pose: params.get('lpose') };
}
// &thumb=pose:x1,y1,z1,x2,y2,z2 : thumb segment directions (hand space) of a hand pose
if (params.has('thumb')) {
  const [k, v] = params.get('thumb').split(':');
  const n = v.split(',').map(Number);
  VM_DEBUG.HAND_POSES[k].thumb = [n.slice(0, 3), n.slice(3, 6)];
}
// &mat=glove:r,g,b;trim:r,g,b;... : hand / sleeve material colors
if (params.has('mat')) {
  for (const kv of params.get('mat').split(';')) {
    const [k, v] = kv.split(':');
    if (VM_DEBUG.HAND_MAT[k]) VM_DEBUG.HAND_MAT[k].color = v.split(',').map(Number);
  }
}
if (params.has('claw')) {
  const v = params.get('claw').split(',').map(Number);
  for (let i = 0; i < 6; i++) VM_DEBUG.CLAW_IDLE[i] = v[i];
}

const info = document.getElementById('info');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
renderer.setScissorTest(true);

function makeLights(scene, cam) {
  if (params.get('light') === 'game') {
    // approximates the in-game viewmodel lights at midday (renderer.vmHemi / vmDir) + ACES
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    scene.add(new THREE.HemisphereLight(0xadb6ba, 0x33302a, 0.96));
    const dir = new THREE.DirectionalLight(0xf4e8d6, 1.08);
    const ld = (params.get('ldir') || '-0.4,1,0.6').split(',').map(Number); // &ldir=x,y,z: light direction
    dir.position.set(ld[0], ld[1], ld[2]);
    cam.add(dir, dir.target);
    return;
  }
  scene.add(new THREE.HemisphereLight(0x9aa4b4, 0x1a140e, 0.8));
  const key = new THREE.DirectionalLight(0xffd2a0, 1.6);
  key.position.set(1.5, 2, 1);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8090b0, 0.35);
  rim.position.set(-2, 1, -1);
  scene.add(rim);
  const spot = new THREE.SpotLight(0xfff2dd, 2.5, 30, 0.55, 0.6, 1.0);
  spot.position.set(0.25, 0.05, 0.4);
  spot.target.position.set(0.05, -0.1, -5);
  cam.add(spot, spot.target);
}

function backdrop(scene) {
  const g = new THREE.PlaneGeometry(60, 30);
  const m = new THREE.MeshLambertMaterial({ color: 0x1b1e1a });
  const p = new THREE.Mesh(g, m);
  p.position.set(0, 0, -12);
  scene.add(p);
  const gr = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshLambertMaterial({ color: 0x23201a }));
  gr.rotation.x = -PI2;
  gr.position.y = -1.6;
  scene.add(gr);
}
const PI2 = Math.PI / 2;

const NAMES = {};
for (const k in ITEM) NAMES[ITEM[k]] = k;

// ------------------------------------------------------------------ hand poses
if (params.get('vm') === 'hands') {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0d10);
  const cam = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.01, 50);
  scene.add(cam);
  makeLights(scene, cam);
  const { getHandGeoForDebug } = await import('../render/models/weapons.js');
  const mat = (await import('../render/models/skinning.js')).getViewArmMaterial();
  const cmat = (await import('../render/models/skinning.js')).getViewCharMaterial();
  const poses = ['grip', 'support', 'pinch', 'open', 'claw'];
  const yaw = parseFloat(params.get('yaw') || '0');
  poses.forEach((p, i) => {
    for (const side of [1, -1]) {
      const m = new THREE.Mesh(getHandGeoForDebug(p, side), p === 'claw' ? cmat : mat);
      m.position.set(-0.5 + i * 0.25, side > 0 ? 0.12 : -0.12, 0);
      m.rotation.y = yaw;
      scene.add(m);
      // grip center marker
      const c = new THREE.Mesh(new THREE.SphereGeometry(0.005), new THREE.MeshBasicMaterial({ color: 0x00ff00 }));
      c.position.copy(m.userData.center || new THREE.Vector3());
      m.add(c);
    }
  });
  cam.position.set(0, 0, 0.9);
  cam.lookAt(0, 0, 0);
  info.textContent = 'hand poses: ' + poses.join(', ') + ' (top: right hand, bottom: left)';
  renderer.setViewport(0, 0, innerWidth, innerHeight);
  renderer.setScissor(0, 0, innerWidth, innerHeight);
  renderer.render(scene, cam);
} else if (params.has('ww')) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0d10);
  const cam = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.01, 50);
  scene.add(cam);
  makeLights(scene, cam);
  const table = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.05, 1.4), new THREE.MeshLambertMaterial({ color: 0x3a2e22 }));
  table.position.y = -0.025;
  scene.add(table);
  const only = params.has('item') ? parseInt(params.get('item'), 10) : 0;
  const longIds = [ITEM.AK47, ITEM.M4A1, ITEM.MP5, ITEM.SHOTGUN, ITEM.DB_SHOTGUN, ITEM.HUNTING_RIFLE, ITEM.BAT, ITEM.SPIKED_BAT];
  const shortIds = [ITEM.PISTOL, ITEM.KNIFE, ITEM.MACHETE, ITEM.HAMMER, ITEM.MOLOTOV, ITEM.PIPEBOMB, ITEM.FLARE];
  const lines = [];
  const place = (id, x, z) => {
    const w = createWorldWeapon(id);
    if (id === ITEM.MOLOTOV || id === ITEM.PIPEBOMB || id === ITEM.FLARE) {
      w.rotation.set(-PI2, 0, 0); // lie down, top toward -Z
      w.position.set(x, 0.035, z);
    } else {
      w.rotation.set(-PI2, -PI2, 0); // barrel toward +X, right side facing up
      w.position.set(x, 0.03, z);
    }
    scene.add(w);
    const mz = w.getObjectByName('muzzle');
    if (mz) mz.add(new THREE.Mesh(new THREE.SphereGeometry(0.008), new THREE.MeshBasicMaterial({ color: 0xff2200 })));
    if (w.userData.leftHand) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.01), new THREE.MeshBasicMaterial({ color: 0x00aaff }));
      s.position.copy(w.userData.leftHand);
      w.add(s);
    }
    w.add(new THREE.Mesh(new THREE.SphereGeometry(0.008), new THREE.MeshBasicMaterial({ color: 0x33ff33 })));
    lines.push(`${NAMES[id]}: ${worldWeaponTris(id)} tris`);
    return w;
  };
  if (only) {
    place(only, 0, 0);
    const s = params.get('view') === 'back' ? -1 : 1;
    cam.position.set(0, 0.75, 0.02 * s);
    cam.lookAt(0, 0, 0);
  } else {
    longIds.forEach((id, i) => place(id, -0.7, -0.6 + i * 0.17));
    shortIds.forEach((id, i) => place(id, 0.55, -0.55 + i * 0.17));
    cam.position.set(0, 2.1, 0.12);
    cam.lookAt(0, 0, 0.0);
  }
  info.textContent = 'World weapons (green = grip origin, red = muzzle, blue = leftHand)\n' + lines.join('\n');
  const loop = () => {
    renderer.setViewport(0, 0, innerWidth, innerHeight);
    renderer.setScissor(0, 0, innerWidth, innerHeight);
    renderer.render(scene, cam);
    requestAnimationFrame(loop);
  };
  loop();
} else {
  // ------------------------------------------------------------------ viewmodel(s)
  const vmParam = params.get('vm');
  const hideArm = params.get('hide'); // &hide=L|R|LR: hide an arm to inspect the other hand's grip
  const act = params.get('act') || '';
  // &ts=a,b,c : grid of the same item frozen at several times
  const times = params.has('ts') ? params.get('ts').split(',').map(Number) : null;
  const freezeT = times ? 0 : params.has('t') ? parseFloat(params.get('t')) : null;
  const all = vmParam === 'all';
  const single = vmParam === 'claws' ? 'claws' : parseInt(vmParam, 10) || 0;
  const list = all
    ? [ITEM.AK47, ITEM.M4A1, ITEM.MP5, ITEM.SHOTGUN, ITEM.DB_SHOTGUN, ITEM.HUNTING_RIFLE, ITEM.PISTOL, ITEM.KNIFE, ITEM.BAT, ITEM.SPIKED_BAT, ITEM.MACHETE, ITEM.HAMMER, ITEM.MOLOTOV, ITEM.PIPEBOMB, ITEM.FLARE, 'claws']
    : times
      ? times.map(() => single)
      : [single];
  const views = list.map((id, vi) => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0c10);
    const cam = new THREE.PerspectiveCamera(68, 1, 0.01, 100);
    scene.add(cam);
    makeLights(scene, cam);
    backdrop(scene);
    const vm = new ViewModel();
    scene.add(vm.group);
    if (params.has('orbit')) {
      // &orbit=yaw,pitch,dist[,tx,ty,tz]: inspect the viewmodel from outside the player's eye
      const [yaw, pitch, dist, tx = 0.08, ty = -0.12, tz = -0.32] = params.get('orbit').split(',').map(Number);
      const tgt = new THREE.Vector3(tx, ty, tz);
      cam.position.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(dist).add(tgt);
      cam.lookAt(tgt);
    }
    if (id === 'claws') vm.setItem(0, { claws: true });
    else vm.setItem(id);
    return { id, scene, cam, vm, acted: false, stopAt: times ? times[vi] : null };
  });

  const state = { speed: 0, sprint: false, onGround: true, crouch: false, aiming: false, lookDX: 0, lookDY: 0, time: 0 };
  if (act === 'walk') state.speed = 4.3;
  if (act === 'sprint') {
    state.speed = 7;
    state.sprint = true;
  }
  if (act === 'ads') state.aiming = true;
  if (act === 'crouch') {
    state.crouch = true;
    state.speed = 2;
  }

  function trigger(v) {
    const id = v.id;
    const w = WEAPONS[id];
    switch (act) {
      case 'fire':
        v.vm.fire();
        break;
      case 'reload':
        if (w && w.reloadEach) v.vm.reload(w.reload, true);
        else v.vm.reload(w ? w.reload : 2, false);
        break;
      case 'melee':
        v.vm.melee(false);
        break;
      case 'heavy':
        v.vm.melee(true);
        break;
      case 'throw':
        v.vm.throwItem();
        break;
      case 'use':
        v.vm.useItem(2.0, +(params.get('use') || 0));
        break;
    }
  }
  const pulsed = ['fire', 'reload', 'melee', 'heavy', 'throw', 'use'].includes(act);
  const PRE = 0.6; // let the draw anim finish
  let simT = 0;
  let lastTrig = -1;
  const DT = 1 / 60;

  function step(dt) {
    simT += dt;
    state.time = simT;
    if (act === 'jump') state.onGround = Math.sin(simT * 2) > -0.2;
    if (act === 'look') state.lookDX = Math.sin(simT * 3) * 0.03;
    for (const v of views) {
      if (pulsed) {
        const since = simT - PRE;
        const period = act === 'reload' || act === 'use' ? 3.4 : 1.2;
        const k = Math.floor(since / period);
        if (since >= 0 && k !== v.lastK) {
          v.lastK = k;
          trigger(v);
        }
      }
      if (v.stopAt !== null && simT > PRE + v.stopAt) continue;
      v.vm.update(dt, state);
    }
    void lastTrig;
  }

  function render() {
    const W = innerWidth, H = innerHeight;
    const n = views.length;
    const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
    const rows = Math.ceil(n / cols);
    const tw = Math.floor(W / cols), th = Math.floor(H / rows);
    views.forEach((v, i) => {
      const c = i % cols, r = (i / cols) | 0;
      const x = c * tw, y = H - (r + 1) * th;
      v.cam.aspect = tw / th;
      v.cam.updateProjectionMatrix();
      renderer.setViewport(x, y, tw, th);
      renderer.setScissor(x, y, tw, th);
      if (hideArm === 'L' || hideArm === 'LR') v.vm.armL.setVisible(false);
      if (hideArm === 'R' || hideArm === 'LR') v.vm.armR.setVisible(false);
      renderer.render(v.scene, v.cam);
    });
  }

  const mz = new THREE.Vector3();
  const lines = views.map((v) => `${v.id === 'claws' ? 'CLAWS' : NAMES[v.id] || v.id}: vm ${v.id === 'claws' ? 0 : viewModelTris(v.id)} tris`);
  lines.push(`hand ${handTris()} tris (per hand pose)`);
  info.textContent = `act=${act || 'idle'} ${times ? 'ts=' + times.join(',') : freezeT !== null ? 't=' + freezeT : ''}\n` + (times ? lines[0] : lines.join('\n'));

  if (freezeT !== null) {
    const total = PRE + (times ? Math.max(...times) : freezeT);
    const n = Math.round(total / DT);
    for (let i = 0; i < n; i++) step(DT);
    render();
    views[0].vm.getMuzzle(mz);
    info.textContent += `\nmuzzle(0): ${mz.x.toFixed(3)}, ${mz.y.toFixed(3)}, ${mz.z.toFixed(3)}`;
  } else {
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      step(dt);
      render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  window.__views = views;
}
void ITEM_DEFS;
