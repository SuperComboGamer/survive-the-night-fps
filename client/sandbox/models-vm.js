// Viewmodel / world-weapon sandbox (loaded by models-test.js when ?vm= or ?ww= is present).
//   ?vm=ITEMID | ?vm=claws | ?vm=all (grid of every item)
//   &act=fire|reload|melee|heavy|throw|use|ads|sprint|walk|crouch|jump
//   &use=ITEMID  with act=use: the consumable being used (food shows the tin instead of the medkit)
//   &t=SECONDS   freeze the clock at this time after the action starts (deterministic screenshot)
//   &orbit=yaw,pitch,dist[,tx,ty,tz]  view the viewmodel from an orbiting camera
//   &hide=L|R|LR hide an arm (inspect the other hand's grip); &hidegun hides the weapon
//   &wcam=yaw,pitch,dist[,tx,ty,tz]  camera orbiting a point in WEAPON space (yaw 0 = from behind, pi/2 = gun's right side)
//   &ortho=halfHeight  orthographic camera (with &wcam)
//   &clip=nx,ny,nz,d   clip everything on the far side of a weapon-space plane (keeps n.p + d >= 0)
//   &crop=x,y,h        magnify part of a 16:9 view: left, top and height in units of the screen height
//   &light=game  in-game viewmodel lighting (midday) instead of the bright studio lights (&ldir=x,y,z its direction)
//   ?ww=1        world weapon lineup (&item=ID one of them, &view=back)
//   ?vm=hands    the hand poses side by side (&poses=a,b,.. which, &yaw= &pitch= &cd= the camera)
//   &ts=a,b,c    a grid of the same item frozen at several times
//   &act=talk    the walkie-talkie keyed;  &wall=M  a wall that far ahead of the eye (the tuck off it, Game.weaponClearance)
// clip checking (docs/object-clipping.md):
//   &clip=1      measure how far the hands, the sleeves and the item pass into each other: window.__clip, one per view:
//                { handInItem, itemInHand, rInL: { d (m), a, b (the parts), n (vertices inside), p (the deepest, view
//                space) }, nearZ, inverted, text }. Counts only what the camera sees. (&clip=nx,ny,nz,d is the plane)
//   &dots=1      with &clip=1: mark every vertex found inside
//   &xray=1      the item (and a used prop) see-through, drawn over the hands
//   &zoom=fov,x,y,z  from the eye, narrowed onto a point (view space)
//   &zh=R|L,fov  from the eye, narrowed onto that hand wherever the animation has it
//   &oh=R|L,yaw,pitch,dist  an outside camera orbiting that hand
//   window.__hands  { R, L }: each hand's grip center (view space) once posed, for a camera fixed on a hand
//   &hp=pose:{json}  override (part of) a hand pose, or add one (several allowed); with &rpose= / &lpose= to use it
// the stray cat (?vm=cat): in both arms (ViewModel.holdCat); &act=pet strokes it, &coat=N its coat. The clip check
//   counts the cat (as its skinned mesh is posed) as the item
// nunchucks (?vm=57): &nk=SCRIPT plays their moves instead of &act (nk-script.js: guard, draw, idle, whip, backhand,
//   eight, smash, lunge, sweep, retreat, heavy1..3, combo, combo2, flourish, carry); &hit=flesh|bone|wood|metal|dirt
//   lands every blow on that (default: they miss). &t / &ts are seconds after the script starts, as for an &act.
import * as THREE from 'three';
import { ITEM, ITEM_DEFS, WEAPONS } from '../../shared/defs.js';
import { ViewModel, createWorldWeapon, worldWeaponTris, viewModelTris, handTris, VM_DEBUG } from '../render/models/weapons.js';
import { createCat } from '../render/models/cat.js';
import { nkScript } from './nk-script.js';
// tuning overrides: &hip=x,y,z,rx,ry,rz (current item hip pose) / &claw=x,y,z,rx,ry,rz / &cq=rx,ry,rz
const params = new URLSearchParams(location.search);
if (params.has('ads')) {
  // &ads=fov,z: the aimed view's field of view and how far down the view axis the sight sits (adsFov, adsZ)
  const [fov, z] = params.get('ads').split(',').map(Number);
  const id = parseInt(params.get('vm'), 10);
  if (VM_DEBUG.VM[id]) {
    if (fov) VM_DEBUG.VM[id].adsFov = fov;
    if (z) VM_DEBUG.VM[id].adsZ = z;
  }
}
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
// &fgr=pitch,roll,yaw,x,y,z[,open] : the flare gun's reload pose change; &fgq=fx,fy,fz,px,py,pz : the loading hand (camera space)
if (params.has('fgr')) {
  const v = params.get('fgr').split(',').map(Number);
  Object.assign(VM_DEBUG.FG_RELOAD, { pitch: v[0], roll: v[1], yaw: v[2], x: v[3], y: v[4], z: v[5] });
  if (v.length > 6) {
    // &fgr=...,open: how far the barrel tips
    VM_DEBUG.FG_RELOAD.open = v[6];
  }
}
if (params.has('fgq')) {
  const v = params.get('fgq').split(',').map(Number);
  VM_DEBUG.FG_RELOAD.q = VM_DEBUG.handQ(-1, v.slice(0, 3), v.slice(3, 6));
}
// &thumb=pose:x1,y1,z1,x2,y2,z2 : thumb segment directions (hand space) of a hand pose
if (params.has('thumb')) {
  const [k, v] = params.get('thumb').split(':');
  const n = v.split(',').map(Number);
  VM_DEBUG.HAND_POSES[k].thumb = [n.slice(0, 3), n.slice(3, 6)];
}
// &hp=pose:{"curl":[[..]x4],"thumb":[[..],[..]],"center":[x,y,z]} : override (part of) a hand pose, or add one (with
// &rpose= / &lpose= to put it on the item)
for (const s of params.getAll('hp')) {
  const i = s.indexOf(':'), k = s.slice(0, i);
  VM_DEBUG.HAND_POSES[k] = { ...(VM_DEBUG.HAND_POSES[k] || VM_DEBUG.HAND_POSES.grip), ...JSON.parse(s.slice(i + 1)) };
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
  const poses = params.has('poses') ? params.get('poses').split(',') : ['grip', 'support', 'pinch', 'open', 'claw']; // &poses=a,b,...: which poses to line up
  const yaw = parseFloat(params.get('yaw') || '0');
  const pitch = parseFloat(params.get('pitch') || '0'); // &pitch=: tip the hands toward the camera
  poses.forEach((p, i) => {
    for (const side of [1, -1]) {
      const m = new THREE.Mesh(getHandGeoForDebug(p, side), p === 'claw' ? cmat : mat);
      m.position.set((i - (poses.length - 1) / 2) * 0.25, side > 0 ? 0.12 : -0.12, 0);
      m.rotation.set(pitch, yaw, 0, 'YXZ');
      scene.add(m);
      // grip center marker
      const c = new THREE.Mesh(new THREE.SphereGeometry(0.005), new THREE.MeshBasicMaterial({ color: 0x00ff00 }));
      c.position.copy(m.userData.center || new THREE.Vector3());
      m.add(c);
    }
  });
  cam.position.set(0, 0, parseFloat(params.get('cd') || '0.9')); // &cd=: camera distance
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
  const longIds = [ITEM.AK47, ITEM.M4A1, ITEM.MP5, ITEM.SHOTGUN, ITEM.DB_SHOTGUN, ITEM.HUNTING_RIFLE, ITEM.CROSSBOW, ITEM.FLAMETHROWER, ITEM.AT_RIFLE, ITEM.RPG, ITEM.BAT, ITEM.SPIKED_BAT];
  const shortIds = [ITEM.PISTOL, ITEM.FLARE_GUN, ITEM.KNIFE, ITEM.MACHETE, ITEM.HAMMER, ITEM.NUNCHAKU, ITEM.MOLOTOV, ITEM.PIPEBOMB, ITEM.FLARE, ITEM.GRENADE, ITEM.DECOY];
  const lines = [];
  const place = (id, x, z) => {
    const w = createWorldWeapon(id);
    if (id === ITEM.MOLOTOV || id === ITEM.PIPEBOMB || id === ITEM.FLARE || id === ITEM.GRENADE || id === ITEM.DECOY) {
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
  const single = vmParam === 'claws' || vmParam === 'cat' ? vmParam : parseInt(vmParam, 10) || 0;
  const list = all
    ? [ITEM.AK47, ITEM.M4A1, ITEM.MP5, ITEM.SHOTGUN, ITEM.DB_SHOTGUN, ITEM.HUNTING_RIFLE, ITEM.CROSSBOW, ITEM.FLAMETHROWER, ITEM.AT_RIFLE, ITEM.RPG, ITEM.PISTOL, ITEM.FLARE_GUN, ITEM.KNIFE, ITEM.BAT, ITEM.SPIKED_BAT, ITEM.MACHETE, ITEM.HAMMER, ITEM.NUNCHAKU, ITEM.MOLOTOV, ITEM.PIPEBOMB, ITEM.FLARE, ITEM.GRENADE, ITEM.DECOY, 'claws']
    : times
      ? times.map(() => single)
      : [single];
  const views = list.map((id, vi) => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0c10);
    const cam = params.has('ortho') ? new THREE.OrthographicCamera(-1, 1, 1, -1, 0.001, 100) : new THREE.PerspectiveCamera(68, 1, 0.01, 100);
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
    } else if (params.has('zoom')) {
      // &zoom=fov,tx,ty,tz: still from the player's eye, but narrowed onto a point (a close look at a grip)
      const [fov, tx, ty, tz] = params.get('zoom').split(',').map(Number);
      cam.fov = fov;
      cam.lookAt(tx, ty, tz);
    }
    if (id === 'claws') vm.setItem(0, { claws: true });
    else if (id === 'cat') {
      vm.setItem(ITEM.PISTOL); // (what is put away under it)
      vm.holdCat(createCat(+(params.get('coat') || 0), 3, true));
    } else vm.setItem(id);
    if (params.get('xray') === '1') {
      // &xray=1: the item (and the use prop) see-through, drawn over the hands, so a finger inside it shows
      const glass = new THREE.MeshLambertMaterial({ color: 0x88aaff, transparent: true, opacity: 0.38, depthWrite: false });
      for (const o of [...(vm.cur ? vm.cur.root.children : []), vm.kit, ...(vm.cat ? [vm.cat._inst.mesh] : [])]) {
        o.material = glass;
        o.renderOrder = 5;
      }
    }
    return { id, scene, cam, vm, acted: false, stopAt: times ? times[vi] : null };
  });

  const state = { speed: 0, sprint: false, onGround: true, crouch: false, aiming: false, lookDX: 0, lookDY: 0, time: 0 };
  if (act === 'walk') state.speed = 4.3;
  if (act === 'sprint') {
    state.speed = 7;
    state.sprint = true;
  }
  if (act === 'ads') state.aiming = true;
  if (act === 'talk') state.talk = true; // (the walkie-talkie keyed)
  if (act === 'pet') state.pet = true; // (the cat in our arms, stroked)
  if (params.has('wall')) state.wallDist = +params.get('wall'); // &wall=m: a wall that far ahead (the tuck)
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
  // &nk=: the nunchucks' moves, as the game would give them to the rig
  const nk = params.has('nk') ? nkScript(params.get('nk'), params.get('hit') || '') : null;
  if (nk && nk.crouch) state.crouch = true;
  if (nk) for (const v of views) if (v.vm.nk) v.vm.nk.core.noIdle = params.get('nk') !== 'idle';
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
        const period = act === 'use' ? 3.4 : act === 'reload' ? Math.max(3.4, (WEAPONS[v.id]?.reload || 0) + 0.6) : 1.2; // (the anti-tank rifle's reload is 6 s)
        const k = Math.floor(since / period);
        if (since >= 0 && k !== v.lastK) {
          v.lastK = k;
          trigger(v);
        }
      }
      if (v.stopAt !== null && simT > PRE + v.stopAt) continue;
      if (nk && v.vm.nk) {
        const t = simT - PRE;
        for (v.nkAt = v.nkAt || 0; v.nkAt < nk.events.length && nk.events[v.nkAt].t <= t + 1e-6; v.nkAt++) {
          const e = nk.events[v.nkAt];
          if (e.swing !== undefined) v.vm.nkSwing(e.swing);
          if (e.hit) v.vm.nkHit(e.hit.kind, 0, 0.15, 1, e.hit.power);
          if (e.flourish) v.vm.nkFlourish();
          if (e.set) Object.assign(state, e.set);
        }
        state.nkWind = nk.wind(t);
      }
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
      if (v.cam.isOrthographicCamera) {
        const hh = +params.get('ortho') || 0.1;
        v.cam.top = hh;
        v.cam.bottom = -hh;
        v.cam.left = -hh * v.cam.aspect;
        v.cam.right = hh * v.cam.aspect;
      }
      if (v.vm.fov && !params.has('orbit') && !params.has('zoom') && !wcam && !v.cam.isOrthographicCamera) v.cam.fov = v.vm.fov; // (the aimed view narrows: ViewModel.fov)
      if (crop) {
        // the frame as a 16:9 screen would show it, magnified to the region (x, y, height; units of screen height)
        const tileAspect = v.cam.aspect;
        v.cam.aspect = 16 / 9;
        v.cam.setViewOffset(1000 * v.cam.aspect, 1000, crop[0] * 1000, crop[1] * 1000, crop[2] * 1000 * tileAspect, crop[2] * 1000);
      }
      v.cam.updateProjectionMatrix();
      if (wcam) placeWeaponCam(v);
      renderer.setViewport(x, y, tw, th);
      renderer.setScissor(x, y, tw, th);
      if (params.has('zh')) {
        // &zh=R|L,fov: from the eye, narrowed onto that hand (its grip center), wherever the animation has it
        const [side, fov] = params.get('zh').split(',');
        const arm = side === 'L' ? v.vm.armL : v.vm.armR;
        v.scene.updateMatrixWorld(true);
        const c = arm.wrist.localToWorld(arm.gripCenter(new THREE.Vector3()));
        v.cam.fov = +fov || 24;
        v.cam.lookAt(c);
        v.cam.updateProjectionMatrix();
      }
      if (params.has('oh')) {
        // &oh=R|L,yaw,pitch,dist: an outside camera orbiting that hand (the far side of a grip)
        const [side, yaw, pitch, dist] = params.get('oh').split(',');
        const arm = side === 'L' ? v.vm.armL : v.vm.armR;
        v.scene.updateMatrixWorld(true);
        const c = arm.wrist.localToWorld(arm.gripCenter(new THREE.Vector3()));
        v.cam.position.set(Math.sin(+yaw) * Math.cos(+pitch), Math.sin(+pitch), Math.cos(+yaw) * Math.cos(+pitch)).multiplyScalar(+dist || 0.3).add(c);
        v.cam.lookAt(c);
      }
      // (nunchucks: the view goes with the strikes, as in the game)
      if (nk && v.vm.nk && !params.has('orbit') && !params.has('zoom') && !wcam && !params.has('zh') && !params.has('oh')) v.cam.rotation.set(v.vm.nk.core.kick.x, v.vm.nk.core.kick.y, v.vm.nk.core.kick.z, 'YXZ');
      if (hideArm === 'L' || hideArm === 'LR') v.vm.armL.setVisible(false);
      if (hideArm === 'R' || hideArm === 'LR') v.vm.armR.setVisible(false);
      if (params.has('hidegun') && v.vm.cur) v.vm.cur.root.visible = false; // &hidegun: hands only
      renderer.render(v.scene, v.cam);
    });
  }

  // weapon-space inspection camera and clip plane (&wcam / &clip)
  const crop = params.has('crop') ? params.get('crop').split(',').map(Number) : null; // &crop=x,y,size: magnify part of the frame (fractions)
  const wcam = params.has('wcam') ? params.get('wcam').split(',').map(Number) : null;
  // (&clip=1 is the clip check below; four numbers are a plane)
  const clipLocal = params.has('clip') && params.get('clip').split(',').length === 4 ? params.get('clip').split(',').map(Number) : null;
  const clipPlane = new THREE.Plane();
  if (clipLocal) renderer.localClippingEnabled = true;
  function placeWeaponCam(v) {
    const [yaw, pitch, dist, tx = 0, ty = 0, tz = 0] = wcam;
    const root = v.vm.weaponRoot;
    v.vm.group.updateMatrixWorld(true);
    const tgt = new THREE.Vector3(tx, ty, tz);
    const pos = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(dist).add(tgt);
    root.localToWorld(tgt);
    root.localToWorld(pos);
    v.cam.position.copy(pos);
    const up = Math.abs(Math.sin(pitch)) > 0.99 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
    v.cam.up.copy(up.transformDirection(root.matrixWorld));
    v.cam.lookAt(tgt);
    if (clipLocal) {
      clipPlane.set(new THREE.Vector3(clipLocal[0], clipLocal[1], clipLocal[2]).normalize(), clipLocal[3]).applyMatrix4(root.matrixWorld);
      v.scene.traverse((o) => {
        if (o.material && !o.material.clippingPlanes) {
          o.material.clippingPlanes = [clipPlane];
          o.material.side = THREE.DoubleSide;
          o.material.needsUpdate = true;
        }
      });
    }
  }

  const mz = new THREE.Vector3();
  const lines = views.map((v) => `${v.id === 'claws' ? 'CLAWS' : NAMES[v.id] || v.id}: vm ${v.id === 'claws' || v.id === 'cat' ? 0 : viewModelTris(v.id)} tris`);
  lines.push(`hand ${handTris()} tris (per hand pose)`);
  info.textContent = `act=${act || 'idle'} ${times ? 'ts=' + times.join(',') : freezeT !== null ? 't=' + freezeT : ''}\n` + (times ? lines[0] : lines.join('\n'));

  if (freezeT !== null) {
    const total = PRE + (times ? Math.max(...times) : freezeT);
    const n = Math.round(total / DT);
    for (let i = 0; i < n; i++) step(DT);
    render();
    views[0].vm.getMuzzle(mz);
    // where each hand's grip center is (window.__hands: for a fixed camera on a hand, the same before and after a change)
    {
      const v = views[0];
      v.scene.updateMatrixWorld(true);
      const at = (arm) => (arm.visible ? arm.wrist.localToWorld(arm.gripCenter(new THREE.Vector3())).toArray().map((x) => +x.toFixed(4)) : null);
      window.__hands = { R: at(v.vm.armR), L: at(v.vm.armL) };
    }
    info.textContent += `\nmuzzle(0): ${mz.x.toFixed(3)}, ${mz.y.toFixed(3)}, ${mz.z.toFixed(3)}`;
    if (params.get('clip') === '1') {
      // &clip=1: how far the hands and the item pass into each other (see clipReport)
      window.__clip = views.map((v) => clipReport(v));
      info.textContent += '\n' + window.__clip.map((c, i) => `clip[${i}] ` + c.text).join('\n');
      // &dots=1: mark every vertex found inside the other model
      if (params.get('dots') === '1') {
        for (const v of views) {
          if (!v.flagged) continue;
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.Float32BufferAttribute(v.flagged, 3));
          const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xff2020, size: 3, sizeAttenuation: false, depthTest: false }));
          pts.renderOrder = 20;
          v.scene.add(pts);
        }
        render();
      }
    }
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

// ------------------------------------------------------------------ clip check (&clip=1)
// Every mesh here is a union of closed shells, so a vertex of one model is inside another when the first face a ray
// from it meets is a back face. Each vertex casts four rays; three or more back faces = inside, and the shortest of
// those exits is how deep it sits. Reports, in mm, the deepest hand / sleeve vertex inside the item, the deepest item
// vertex inside a hand or sleeve, the hands inside each other, and how close anything comes to the camera.
function clipReport(v) {
  v.scene.updateMatrixWorld(true);
  const shown = (o) => {
    for (; o; o = o.parent) if (!o.visible) return false;
    return true;
  };
  const arms = [];
  for (const [side, arm] of [['R', v.vm.armR], ['L', v.vm.armL]]) {
    for (const st in arm.sets) {
      const s = arm.sets[st];
      if (shown(s.upper)) arms.push({ name: side + '.upper', side, m: s.upper });
      if (shown(s.fore)) arms.push({ name: side + '.fore', side, m: s.fore });
      for (const p in s.hands) if (shown(s.hands[p])) arms.push({ name: side + '.hand', side, m: s.hands[p] });
    }
  }
  const items = [];
  if (v.vm.cur) for (const m of v.vm.cur.root.children) if (m.isMesh && shown(m)) items.push({ name: 'item.' + (Object.keys(v.vm.cur.parts).find((k) => v.vm.cur.parts[k] === m) || '?'), m });
  if (shown(v.vm.kit)) items.push({ name: 'kit', m: v.vm.kit });
  if (v.vm.cat && shown(v.vm.cat.object)) {
    // the cat in our arms: its skinned mesh as it is posed now, baked into a plain one
    const sk = v.vm.cat._inst.mesh;
    sk.skeleton.update();
    const src = sk.geometry.attributes.position;
    const out = new Float32Array(src.count * 3);
    const t = new THREE.Vector3();
    for (let i = 0; i < src.count; i++) sk.getVertexPosition(i, t).toArray(out, i * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
    g.setIndex(sk.geometry.index);
    const m = new THREE.Mesh(g);
    m.matrixWorld.copy(sk.matrixWorld);
    items.push({ name: 'cat', m });
  }
  const dbl = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const proxy = (e) => {
    const p = new THREE.Mesh(e.m.geometry, dbl);
    p.matrixWorld.copy(e.m.matrixWorld);
    p.matrixAutoUpdate = false;
    p.updateMatrixWorld = () => {};
    e.box = new THREE.Box3().setFromBufferAttribute(e.m.geometry.attributes.position).applyMatrix4(e.m.matrixWorld);
    e.p = p;
    return e;
  };
  arms.forEach(proxy);
  items.forEach(proxy);
  const DIRS = [new THREE.Vector3(1, 0.31, 0.17), new THREE.Vector3(-0.23, 1, 0.41), new THREE.Vector3(0.37, -0.29, 1), new THREE.Vector3(-0.6, -0.55, -0.58)].map((d) => d.normalize());
  const ray = new THREE.Raycaster();
  const P = new THREE.Vector3(), N = new THREE.Vector3(), nm = new THREE.Matrix3();
  // deepest vertex of `from` inside the union of `into` (each entry: { name, m, p, box })
  // only what the camera can see counts (the upper arms and the stocks reach behind the eye)
  v.cam.updateMatrixWorld(true);
  v.cam.updateProjectionMatrix();
  const S = new THREE.Vector3();
  const onScreen = (p) => {
    S.copy(p).project(v.cam);
    return S.z > -1 && S.z < 1 && Math.abs(S.x) <= 1 && Math.abs(S.y) <= 1;
  };
  const probe = (from, into) => {
    let best = { d: 0, a: '', b: '', n: 0 };
    const targets = into.map((e) => e.p);
    for (const f of from) {
      const pos = f.m.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        P.fromBufferAttribute(pos, i).applyMatrix4(f.m.matrixWorld);
        if (!onScreen(P)) continue;
        const near = into.filter((e) => e.box.containsPoint(P));
        if (!near.length) continue;
        let back = 0, depth = Infinity, who = '';
        for (const d of DIRS) {
          ray.set(P, d);
          ray.near = 1e-5;
          ray.far = 1;
          const h = ray.intersectObjects(near.map((e) => e.p), false)[0];
          if (!h) continue;
          nm.getNormalMatrix(h.object.matrixWorld);
          N.copy(h.face.normal).applyMatrix3(nm);
          if (N.dot(d) > 0) {
            back++;
            if (h.distance < depth) {
              depth = h.distance;
              who = into[targets.indexOf(h.object)].name;
            }
          }
        }
        if (back >= 3) {
          best.n++;
          (v.flagged || (v.flagged = [])).push(P.x, P.y, P.z);
          if (depth > best.d) best = { d: depth, a: f.name, b: who, n: best.n, p: P.toArray().map((x) => +x.toFixed(3)) };
        }
      }
    }
    return best;
  };
  // sanity: rays from far outside must meet a front face first; a part modelled inside out shows up here (and then
  // the numbers above it can't be trusted)
  let insideOut = 0;
  {
    const bb = new THREE.Box3();
    for (const e of items) bb.union(e.box);
    const c = bb.getCenter(new THREE.Vector3()), rad = bb.getSize(new THREE.Vector3()).length();
    for (let i = 0; i < 400; i++) {
      const u = (i + 0.5) / 400, th = i * 2.39996, z = 1 - 2 * u, s = Math.sqrt(1 - z * z);
      const d = new THREE.Vector3(Math.cos(th) * s, z, Math.sin(th) * s);
      const o = c.clone().addScaledVector(d, rad);
      // aim at a jittered point inside the box
      const tgt = new THREE.Vector3(bb.min.x + ((i * 0.618) % 1) * (bb.max.x - bb.min.x), bb.min.y + ((i * 0.381) % 1) * (bb.max.y - bb.min.y), bb.min.z + ((i * 0.7548) % 1) * (bb.max.z - bb.min.z));
      ray.set(o, tgt.sub(o).normalize());
      ray.near = 0;
      ray.far = rad * 3;
      const h = ray.intersectObjects(items.map((e) => e.p), false)[0];
      if (!h) continue;
      nm.getNormalMatrix(h.object.matrixWorld);
      if (N.copy(h.face.normal).applyMatrix3(nm).dot(ray.ray.direction) > 0) insideOut++;
    }
  }
  const r = {
    inverted: insideOut,
    handInItem: probe(arms, items),
    itemInHand: probe(items, arms),
    rInL: probe(arms.filter((e) => e.side === 'R'), arms.filter((e) => e.side === 'L')),
  };
  // nearest approach to the camera (view space z; the near plane is at -0.01)
  let nearZ = -Infinity;
  v.cam.updateMatrixWorld(true);
  const inv = v.cam.matrixWorldInverse.copy(v.cam.matrixWorld).invert();
  for (const e of [...arms.filter((a) => a.name.endsWith('hand')), ...items]) {
    const pos = e.m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) nearZ = Math.max(nearZ, P.fromBufferAttribute(pos, i).applyMatrix4(e.m.matrixWorld).applyMatrix4(inv).z);
  }
  r.nearZ = nearZ;
  const mm = (b) => (b.n ? `${(b.d * 1000).toFixed(1)}mm ${b.a}>${b.b} (${b.n}v) @${b.p}` : '-');
  r.text = (insideOut ? `INSIDE-OUT FACES (${insideOut}/400 outside rays) | ` : '') + `hand-in-item ${mm(r.handInItem)} | item-in-hand ${mm(r.itemInHand)} | R-in-L ${mm(r.rInL)} | near ${(-nearZ * 1000).toFixed(0)}mm`;
  return r;
}
void ITEM_DEFS;
