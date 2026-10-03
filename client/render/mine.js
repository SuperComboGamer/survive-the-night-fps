// The Shaft Nine scene: builds a stop's meshes the first time it is needed, shows only the stop the player is in, and
// animates what moves - the cage elevator and its gates, the ride down the shaft, the box, the debris, the lamps' flicker.
// update() hands back the light sources of the stop (the scene's light pool picks the nearest) and the atmosphere profile.
import * as THREE from 'three';
import { MINE_STOPS, PERKS, BOX_POOL, CAGE_RECT, STOP_X0, STOP_Z0, POOL_DEPTH } from '../../shared/mine.js';
import { MINE } from '../../shared/minedefs.js';
import { ITEM, ITEM_DEFS } from '../../shared/defs.js';
import { createWorldWeapon } from './models/weapons.js';
import { buildStop } from './mineprops.js';
import { STYLE, glowTexture, rockTexture, rockNormal, Mesher, col, rng } from './minegeo.js';

const EL = MINE.ELEV;
const ease = (t) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));

// atmosphere of each stop (Environment.setMine); the yard keeps the real night sky
const PROFILES = {
  surface: { fog: 0x1c2640, fogD: 0.006, hemiSky: 0x6c7fb8, hemiGround: 0x262a38, hemi: 1.1, exposure: 1.5, sky: true },
  tunnels: { fog: 0x060403, fogD: 0.024, hemiSky: 0x5a4430, hemiGround: 0x1a1008, hemi: 0.55, exposure: 1.9 },
  flooded: { fog: 0x03090b, fogD: 0.0105, hemiSky: 0x3a7470, hemiGround: 0x0a1a18, hemi: 0.6, exposure: 1.9 },
  crystal: { fog: 0x150c34, fogD: 0.0115, hemiSky: 0x6a48c8, hemiGround: 0x160c30, hemi: 0.75, exposure: 1.8 },
  magma: { fog: 0x0e0608, fogD: 0.0185, hemiSky: 0x8a3418, hemiGround: 0x241008, hemi: 0.7, exposure: 1.8 },
  ride: { fog: 0x060504, fogD: 0.05, hemiSky: 0x4a3a2c, hemiGround: 0x120c08, hemi: 0.5, exposure: 1.9 },
};

function latticeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 64, 64);
  x.strokeStyle = '#fff';
  x.lineWidth = 5;
  x.beginPath();
  for (let k = -64; k <= 128; k += 32) {
    x.moveTo(k, 0);
    x.lineTo(k + 64, 64);
    x.moveTo(k + 64, 0);
    x.lineTo(k, 64);
  }
  x.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function bandTexture() {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#6a6a6a';
  x.fillRect(0, 0, 8, 128);
  x.fillStyle = '#3a3a3a';
  for (let y = 0; y < 128; y += 32) x.fillRect(0, y, 8, 4);
  x.fillStyle = '#a89020';
  x.fillRect(0, 60, 8, 6);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// a price / name plate
function plateTexture(lines, color = '#e8dcc0', bg = '#14100c') {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const x = c.getContext('2d');
  x.fillStyle = bg;
  x.fillRect(0, 0, 256, 96);
  x.strokeStyle = color;
  x.lineWidth = 3;
  x.strokeRect(3, 3, 250, 90);
  x.fillStyle = color;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.font = 'bold 30px sans-serif';
  x.fillText(lines[0], 128, lines[1] ? 32 : 48);
  if (lines[1]) {
    x.font = 'bold 34px sans-serif';
    x.fillStyle = '#ffd24a';
    x.fillText(lines[1], 128, 68);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class MineScene {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.root = new THREE.Group();
    this.root.name = 'mine';
    scene.add(this.root);
    this.rockTex = rockTexture(512);
    this.rockTex.repeat.set(1, 1);
    this.rockNormal = rockNormal(512);
    this.glowTex = glowTexture();
    this.mats = {
      lit: new THREE.MeshLambertMaterial({ vertexColors: true, map: this.rockTex, normalMap: this.rockNormal, normalScale: new THREE.Vector2(1.4, 1.4), side: THREE.DoubleSide }),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
      add: new THREE.MeshBasicMaterial({ vertexColors: true, map: this.glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    };
    this.latticeTex = latticeTexture();
    this.latticeMat = new THREE.MeshLambertMaterial({ color: 0x555a5c, map: this.latticeTex, alphaTest: 0.5, side: THREE.DoubleSide });
    this.steelMat = new THREE.MeshLambertMaterial({ color: 0x3d4640 });
    this.stops = new Array(world.mine.stops.length).fill(null);
    this.cur = 0;
    this.sources = [];
    this.build(0);
    this.makeCage();
    this.makeTube();
    this.liquidMats = [];
    this.elevKey = -1;
    this.elevT0 = 0;
    this.elevState = EL.AWAY;
    this.rideLen = 8;
    this.boxItem = -1;
    this.profile = null;
    this.lampSrc = []; // scratch for update()
    this.wasRiding = false;
  }

  // ---------------------------------------------------------------- building
  build(i) {
    if (this.stops[i]) return this.stops[i];
    const stop = this.world.mine.stops[i];
    const t0 = performance.now();
    const built = buildStop(stop, this.mats);
    const view = { stop, group: built.group, sources: built.sources, buys: [], gates: [], leaves: null, liquids: [] };
    this.root.add(built.group);
    built.group.visible = false;
    this.liquids(view);
    this.landing(view);
    this.buys(view);
    this.debris(view);
    this.stops[i] = view;
    console.log(`[mine] stop ${stop.id}: ${built.group.userData.tris | 0} tris, ${built.lamps} lamps, ${(performance.now() - t0).toFixed(0)} ms`);
    return view;
  }

  liquids(view) {
    const stop = view.stop;
    for (const l of stop.liquids) {
      let geo;
      if (l.r) {
        const [x0, z0, x1, z1] = l.r;
        geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
        geo.rotateX(-Math.PI / 2);
        geo.translate((x0 + x1) / 2, l.y, (z0 + z1) / 2);
      } else {
        geo = new THREE.CircleGeometry(1, 40);
        geo.rotateX(-Math.PI / 2);
        geo.scale(l.e[2], 1, l.e[3]);
        geo.translate(l.e[0], l.y, l.e[1]);
      }
      const pos = geo.attributes.position;
      const uv = geo.attributes.uv;
      for (let k = 0; k < pos.count; k++) uv.setXY(k, pos.getX(k) / 5, pos.getZ(k) / 5);
      let mat;
      if (l.kind === 'lava') {
        mat = new THREE.MeshBasicMaterial({ color: 0xff7a24, map: this.rockTex });
        mat.userData.lava = true;
      } else {
        mat = new THREE.MeshBasicMaterial({ color: l.color, transparent: true, opacity: l.kind === 'lake' ? 0.92 : 0.78, map: this.rockTex, depthWrite: false });
        mat.userData.water = true;
      }
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = 2;
      m.frustumCulled = false;
      view.group.add(m);
      view.liquids.push(m);
    }
  }

  // the landing leaves across the opening, and the signal lamps
  landing(view) {
    view.landings = [];
    const red = new THREE.MeshBasicMaterial({ color: 0xff2a10 });
    const green = new THREE.MeshBasicMaterial({ color: 0x30ff60 });
    const bulb = new THREE.SphereGeometry(0.09, 8, 6);
    // one landing at the arrival shaft, one at the exit
    for (const [x, z] of [[0, 0], [view.stop.exit.lx, view.stop.exit.lz]]) {
      const g = new THREE.Group();
      g.position.set(x, 0, z + 1.7);
      const mk = (side) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(1.75, 2.9, 0.06), this.latticeMat);
        m.position.set(side * 0.875, 1.45, 0);
        m.userData.side = side;
        g.add(m);
        return m;
      };
      const L = { leaves: [mk(-1), mk(1)], red: new THREE.Mesh(bulb, red), green: new THREE.Mesh(bulb, green) };
      L.red.position.set(-2.2, 2.6, 0.2);
      L.green.position.set(2.2, 2.6, 0.2);
      g.add(L.red, L.green);
      view.group.add(g);
      view.landings.push(L);
    }
    // the beacon over the exit shaft once the cage is there: a tall green beam you can see across the stop
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.9, 40, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0x14a040, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    beam.position.set(view.stop.exit.lx, 20, view.stop.exit.lz + 2.2);
    beam.visible = false;
    view.group.add(beam);
    view.beacon = beam;
  }

  // wall guns, perk machines and the box
  buys(view) {
    const stop = view.stop;
    for (const b of stop.buys) {
      const g = new THREE.Group();
      g.position.set(b.x - stop.ox, 0, b.z - stop.oz);
      g.rotation.y = b.yaw;
      if (b.kind === 'gun') {
        const d = ITEM_DEFS[b.a];
        const board = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.8, 0.06), new THREE.MeshLambertMaterial({ color: 0x2a2018 }));
        board.position.set(0, 1.5, -0.38);
        g.add(board);
        const w = createWorldWeapon(b.a);
        w.scale.setScalar(1.25);
        w.rotation.y = Math.PI / 2;
        w.position.set(0, 1.5, -0.28);
        g.add(w);
        const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.36), new THREE.MeshBasicMaterial({ map: plateTexture([d.name.toUpperCase(), `${b.cost}`]) }));
        plate.position.set(0, 0.88, -0.34);
        g.add(plate);
        view.buys.push({ b, group: g, kind: 'gun' });
      } else if (b.kind === 'perk') {
        const perk = PERKS.find((p) => p.bit === b.a);
        const c = col(perk.color.replace('#', '0x') * 1 || 0xffffff);
        const hex = parseInt(perk.color.slice(1), 16);
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.1, 0.6), new THREE.MeshLambertMaterial({ color: hex, emissive: hex, emissiveIntensity: 0.12 }));
        body.position.set(0, 1.05, -0.2);
        g.add(body);
        const front = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), new THREE.MeshBasicMaterial({ map: plateTexture([perk.name.toUpperCase(), `${perk.cost}`], '#fff', '#101010') }));
        front.position.set(0, 1.5, 0.11);
        g.add(front);
        const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ color: hex }));
        glow.position.set(0, 0.7, 0.11);
        g.add(glow);
        void c;
        view.sources.push({ x: b.x, y: 1.3, z: b.z, color: hex, intensity: 0.8, base: 0.8, flick: 0, phase: 0 });
        view.buys.push({ b, group: g, kind: 'perk' });
      } else {
        const crate = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.8, 0.8), new THREE.MeshLambertMaterial({ color: 0x4a3420 }));
        crate.position.set(0, 0.4, -0.1);
        g.add(crate);
        const seam = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.08), new THREE.MeshBasicMaterial({ color: 0x40e0c0 }));
        seam.position.set(0, 0.8, 0.31);
        g.add(seam);
        const q = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.25), new THREE.MeshBasicMaterial({ map: plateTexture(['MYSTERY BOX', `${950}`], '#40e0c0') }));
        q.position.set(0, 0.45, 0.31);
        g.add(q);
        // the beam, and the gun that spins above it
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 9, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0x1a8070, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        beam.position.set(0, 4.5, -0.1);
        beam.visible = false;
        g.add(beam);
        const hold = new THREE.Group();
        hold.position.set(0, 1.6, 0.1);
        g.add(hold);
        view.buys.push({ b, group: g, kind: 'box', beam, hold, shown: -1, seam });
        view.sources.push({ x: b.x, y: 1.2, z: b.z, color: 0x40e0c0, intensity: 0, base: 0, flick: 0, phase: 0, box: true });
      }
      view.group.add(g);
    }
  }

  // the debris that stands in the way of a locked area
  debris(view) {
    const stop = view.stop;
    const r = rng(stop.index * 13 + 5);
    for (const gt of stop.gates) {
      const [x0, z0, x1, z1] = gt.rect;
      const g = new THREE.Group();
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      const M = new Mesher();
      const w = x1 - x0;
      const d = z1 - z0;
      for (let k = 0; k < 16; k++) {
        const x = cx + (r() - 0.5) * w;
        const z = cz + (r() - 0.5) * d;
        const y = 0.3 + r() * 2.4;
        if (k % 3) M.box(x, y, z, 0.15, 0.2 + r() * 0.15, Math.max(w, d) * (0.5 + r() * 0.5), col(0x4e3a26), r() * 3.14 + (w > d ? 0 : 1.57));
        else M.box(x, 0.4 + r() * 0.5, z, 0.7 + r() * 0.8, 0.6 + r() * 0.8, 0.7 + r() * 0.8, col(0x3c3630), r() * 3);
      }
      M.box(cx, 1.5, cz, w * 0.95, 2.8, d * 0.95, col(0x2a2018));
      const mesh = new THREE.Mesh(M.build(), this.mats.lit);
      mesh.frustumCulled = false;
      g.add(mesh);
      // its price
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.42), new THREE.MeshBasicMaterial({ map: plateTexture([gt.name.toUpperCase().slice(0, 18), `${gt.cost}`]), side: THREE.DoubleSide }));
      const horizontal = d > w; // the opening runs along z: the plate faces along x
      plate.position.set(horizontal ? cx - (w / 2 + 0.01) : cx, 1.8, horizontal ? cz : cz + (d / 2 + 0.01));
      void horizontal;
      plate.position.set(cx, 1.9, cz);
      plate.rotation.y = w > d ? 0 : Math.PI / 2;
      g.add(plate);
      const plate2 = plate.clone();
      plate2.rotation.y += Math.PI;
      g.add(plate2);
      view.group.add(g);
      view.gates.push({ gt, group: g });
    }
  }

  // ---------------------------------------------------------------- the cage and the shaft ride
  makeCage() {
    const g = new THREE.Group();
    this.cage = g;
    const steel = this.steelMat;
    const hx = (CAGE_RECT[2] - CAGE_RECT[0]) / 2;
    const cz = (CAGE_RECT[1] + CAGE_RECT[3]) / 2;
    const hz = (CAGE_RECT[3] - CAGE_RECT[1]) / 2;
    const add = (geo, mat, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };
    add(new THREE.BoxGeometry(hx * 2, 0.16, hz * 2), new THREE.MeshLambertMaterial({ color: 0x2a2e2c }), 0, -0.08, cz);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(new THREE.BoxGeometry(0.12, 2.6, 0.12), steel, sx * hx, 1.3, cz + sz * hz);
    add(new THREE.BoxGeometry(hx * 2 + 0.2, 0.14, hz * 2 + 0.2), steel, 0, 2.62, cz);
    add(new THREE.BoxGeometry(hx * 2, 0.5, 0.06), steel, 0, 0.25, cz - hz); // solid lower back
    const side = (w, x, z, ry) => {
      const m = add(new THREE.PlaneGeometry(w, 2.4), this.latticeMat, x, 1.3, z);
      m.rotation.y = ry;
      m.scale.set(1, 1, 1);
      return m;
    };
    side(hz * 2, -hx, cz, Math.PI / 2);
    side(hz * 2, hx, cz, Math.PI / 2);
    side(hx * 2, 0, cz - hz, 0);
    // crosshead and the chains up
    add(new THREE.BoxGeometry(2.7, 0.3, 0.4), steel, 0, 2.9, cz);
    for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.05, 3, 0.05), new THREE.MeshLambertMaterial({ color: 0x222222 }), sx * 0.8, 4.4, cz);
    this.cageLamp = add(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffa850 }), 0, 2.4, cz);
    this.cageSource = { x: 0, y: 2.2, z: 0, color: 0xffa64a, intensity: 0.9, base: 0.9, flick: 1, phase: 1 };
    g.visible = false;
    this.root.add(g);
  }

  makeTube() {
    const g = new THREE.Group();
    this.tube = g;
    const tex = bandTexture();
    tex.repeat.set(1, 12);
    this.tubeTex = tex;
    const mat = new THREE.MeshLambertMaterial({ map: tex, color: 0x8a7a68, side: THREE.DoubleSide });
    const w = 2.3;
    const z0 = -1.6;
    const z1 = 1.78;
    const H = 90;
    const walls = [
      [[-w, -H, z0], [-w, -H, z1], [-w, H, z1], [-w, H, z0]],
      [[w, -H, z1], [w, -H, z0], [w, H, z0], [w, H, z1]],
      [[w, -H, z0], [-w, -H, z0], [-w, H, z0], [w, H, z0]],
      [[-w, -H, z1], [w, -H, z1], [w, H, z1], [-w, H, z1]],
    ];
    const geo = new THREE.BufferGeometry();
    const p = [];
    const uv = [];
    for (const q of walls) {
      for (const k of [0, 1, 2, 0, 2, 3]) {
        p.push(...q[k]);
        uv.push(k === 1 || k === 2 ? 1 : 0, k >= 2 ? 1 : 0);
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    g.add(mesh);
    this.tubeMat = mat;
    // the lamps that stream past (a column of them moved down by the ride)
    const lamps = new THREE.Group();
    const lg = new THREE.BoxGeometry(0.3, 0.16, 0.16);
    const lm = new THREE.MeshBasicMaterial({ color: 0xffa850 });
    this.tubeLampMat = lm;
    for (let k = -8; k <= 8; k++) {
      const m = new THREE.Mesh(lg, lm);
      m.position.set(k % 2 ? 1.95 : -1.95, k * 8, -1.5);
      lamps.add(m);
    }
    this.tubeLamps = lamps;
    g.add(lamps);
    // the closed landing leaves across the front
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.75, 180, 0.06), this.latticeMat);
      m.position.set(s * 0.875, 0, 1.7);
      g.add(m);
    }
    this.tubeSource = { x: 0, y: 1.5, z: 0, color: 0xffa850, intensity: 0, base: 0, flick: 0, phase: 0 };
    g.visible = false;
    this.root.add(g);
  }

  // ---------------------------------------------------------------- per frame
  // g: the global state (stop, elev, elevT, rideLen, gates, box), time: seconds, boxItem: the item the box offers, pos: the player
  update(dt, time, g, pos, boxItem) {
    const world = this.world;
    // the stop the player is in follows where they stand (a teleport in the middle of the ride, a new run)
    let ci = this.cur;
    for (let i = 0; i < world.mine.stops.length; i++) {
      const s = world.mine.stops[i];
      if (pos.x >= s.ox + STOP_X0 && pos.x < s.ox + STOP_X0 + 124 && pos.z >= s.oz + STOP_Z0 && pos.z < s.oz + STOP_Z0 + 108) ci = i;
    }
    if (ci !== this.cur || !this.stops[ci]) this.build(ci);
    this.cur = ci;
    const view = this.stops[ci];
    const st = view.stop;
    // elevator state: a local clock started when the state changed (the server only tells us now and then)
    const es = g.elev ?? EL.AWAY;
    if (es !== this.elevState) {
      this.elevState = es;
      this.elevT0 = time - (g.elevT ?? 0) * (es === EL.RIDING ? g.rideLen || 8 : es === EL.ARRIVING ? MINE.ARRIVE_TIME : MINE.GATE_TIME);
      this.rideLen = g.rideLen || 8;
    }
    const et = time - this.elevT0;
    const riding = es === EL.RIDING;
    // which stop shows
    for (let i = 0; i < this.stops.length; i++) if (this.stops[i]) this.stops[i].group.visible = i === ci && !riding;
    this.tube.visible = riding;
    this.cage.visible = es !== EL.AWAY;
    const at = g.elevAt ? 1 : 0; // the cage is at the exit shaft (a round cleared) or the arrival one
    const cageX = at ? st.exit.x : st.ox;
    const cageZ = at ? st.exit.z : st.oz;
    this.cage.position.set(cageX, 0, cageZ);
    this.tube.position.set(cageX, 0, cageZ);
    // the cage's height: it comes up from below
    let cy = 0;
    if (es === EL.ARRIVING) cy = -26 * (1 - ease(et / MINE.ARRIVE_TIME));
    if (riding) cy = Math.sin(time * 41) * 0.012 + Math.sin(time * 17) * 0.01;
    this.cage.position.y = cy;
    // gates
    let open = 0;
    if (es === EL.OPEN) open = 1;
    else if (es === EL.CLOSING) open = 1 - ease(et / MINE.GATE_TIME);
    else if (es === EL.OPENING) open = ease(et / MINE.GATE_TIME);
    view.landings.forEach((L, i) => {
      const o = i === at ? open : 0;
      for (const l of L.leaves) l.position.x = l.userData.side * (0.875 + 1.45 * o);
      L.red.visible = o < 0.5;
      L.green.visible = o >= 0.5;
    });
    // the exit's beacon and lamp: lit while the cage waits there
    const waiting = at === 1 && es !== EL.AWAY && g.mstate === MINE.STATE.CLEAR;
    view.beacon.visible = waiting;
    view.beacon.material.opacity = 0.3 + 0.12 * Math.sin(time * 3);
    for (const s of view.sources) if (s.exit) s.base = waiting ? 1.1 : 0;
    // debris
    for (const d of view.gates) d.group.visible = !((g.gates >> (st.index * 3 + d.gt.index)) & 1);
    // the box
    const bs = g.box ?? 0;
    for (const b of view.buys) {
      if (b.kind !== 'box') continue;
      b.beam.visible = bs !== 0;
      const showItem = bs === 1 ? BOX_POOL[Math.floor(time * 9) % BOX_POOL.length] : bs === 2 ? boxItem : 0;
      if (showItem !== b.shown) {
        b.shown = showItem;
        while (b.hold.children.length) b.hold.remove(b.hold.children[0]);
        if (showItem) {
          const w = createWorldWeapon(showItem);
          w.scale.setScalar(1.5);
          w.rotation.y = Math.PI / 2;
          b.hold.add(w);
        }
      }
      b.hold.position.y = 1.6 + Math.sin(time * 3) * 0.08;
      if (bs === 1) b.hold.rotation.y = time * 6;
      else b.hold.rotation.y = 0;
      const src = view.sources.find((s) => s.box);
      if (src) src.base = bs ? 1.1 : 0;
    }
    // liquids
    for (const m of view.liquids) {
      const mat = m.material;
      if (mat.userData.lava) {
        mat.map = this.rockTex;
        mat.color.setRGB(1.6 + Math.sin(time * 1.3) * 0.15, 0.55 + Math.sin(time * 0.9) * 0.08, 0.1);
      }
    }
    this.rockTex.offset.set(time * 0.012, time * 0.008);
    // sources: the stop's own, flickering, plus the cage lantern, plus the shaft's strobe
    const out = this.lampSrc;
    out.length = 0;
    for (const s of view.sources) {
      if (!s.base) continue;
      let f = 1;
      if (s.flick === 1) f = 0.8 + Math.sin(time * 9 + s.phase) * 0.1 + Math.sin(time * 23 + s.phase * 2) * 0.1;
      else if (s.flick === 2) f = 0.5 + 0.5 * Math.max(0, Math.sin(time * 4 + s.phase));
      s.intensity = s.base * f;
      out.push(s);
    }
    if (es !== EL.AWAY) {
      const cs = this.cageSource;
      cs.x = cageX;
      cs.z = cageZ + 0.2;
      cs.y = cy + 2.2;
      cs.intensity = cs.base * (0.85 + Math.sin(time * 7) * 0.08);
      out.push(cs);
    }
    if (riding) {
      const ts = this.tubeSource;
      const u = Math.min(1, et / this.rideLen);
      const speed = 14 * Math.min(1, Math.min(u * 6, (1 - u) * 6));
      this.shaftY = ((this.shaftY || 0) + speed * dt) % 16;
      this.tubeLamps.position.y = -this.shaftY;
      this.tubeTex.offset.y = (this.tubeTex.offset.y + speed * dt / 10.7) % 1;
      ts.x = cageX + 1.8;
      ts.z = cageZ - 0.8;
      ts.y = 1.6;
      ts.base = 1;
      // a lamp passes every 8 m: the strobe
      ts.intensity = 0.15 + 1.6 * Math.max(0, Math.sin((this.shaftY / 8) * Math.PI * 2 + 1.0)) ** 6 * (speed > 1 ? 1 : 0);
      out.push(ts);
      // the colour of the lining follows the depth
      const a = MINE_STOPS[st.index].depth;
      const nextIdx = (st.index + 1) % MINE_STOPS.length;
      const b = MINE_STOPS[nextIdx].depth;
      const depth = a + (b - a) * u;
      const dk = Math.min(3, Math.max(0, depth / 130));
      this.tubeMat.color.set([0x8a7a68, 0x8a8a84, 0x6a647a, 0x7a4a38][Math.min(3, Math.floor(dk))]);
      this.tubeLampMat.color.set(depth < 90 ? 0xffa850 : depth < 180 ? 0xd8f0ff : depth < 285 ? 0xc9b0ff : 0xff8a40);
    }
    // the profile of the air
    this.profile = riding ? PROFILES.ride : PROFILES[st.id];
    return out;
  }

  // the power-ups lying about (ENT.CACHE entities with ctype >= POWER_CT): a spinning glowing token each, from a small pool
  powerups(caches, time) {
    if (!this.pw) {
      this.pw = [];
      this.pwCols = [0x40a0ff, 0xff3030, 0xffd24a, 0xff7a20];
      for (let k = 0; k < 6; k++) {
        const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.28), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        m.visible = false;
        this.root.add(m);
        this.pw.push(m);
      }
    }
    let n = 0;
    for (const e of caches) {
      if (e.ctype < MINE.POWER_CT || n >= this.pw.length) continue;
      const m = this.pw[n++];
      m.visible = true;
      m.material.color.setHex(this.pwCols[(e.ctype - MINE.POWER_CT) & 3]);
      m.position.set(e.q[0] / 64, e.q[1] / 64 + 0.9 + Math.sin(time * 3 + n) * 0.1, e.q[2] / 64);
      m.rotation.y = time * 2.5;
    }
    for (; n < this.pw.length; n++) this.pw[n].visible = false;
  }

  // prompt / label helpers used by the HUD
  buyAt(stopIdx, buyIdx) {
    return this.world.mine.stops[stopIdx]?.buys[buyIdx] || null;
  }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((o) => {
      o.geometry?.dispose?.();
      const m = o.material;
      if (m) for (const x of Array.isArray(m) ? m : [m]) (x.map?.dispose?.(), x.dispose?.());
    });
    this.rockTex.dispose();
    this.rockNormal.dispose();
  }
}

export { STYLE, PROFILES, POOL_DEPTH, ITEM };
