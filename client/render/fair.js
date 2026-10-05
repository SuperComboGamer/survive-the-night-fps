// What moves and what lights up at the Tri-County Fair: the Ferris wheel and its gondolas, the carousel's horses
// and canopy, the bulbs on both and on the strings over the midway, the lettering on the entrance arch.
// The frames, the platform, the deck and the stalls are ordinary parts of the static world (shared/fair.js); this
// is drawn on top of them from the same numbers, and every seat is put where seatPos has it for the ride clock
// the game hands in, so a rider (placed by the same function) sits in what is drawn.
// Everything is built once with the world and stays in the scene, lit or not: no material is first drawn in play.
import * as THREE from 'three';
import { CMD_RATE } from '../../shared/constants.js';
import { WHEEL, CAROUSEL, seatPos } from '../../shared/fair.js';

const TAU = Math.PI * 2;
const WT = WHEEL.period * CMD_RATE;
const CT = CAROUSEL.period * CMD_RATE;
// faded fairground paint
const RED = 0x9a3a2e;
const CREAM = 0xd8ccae;
const TEAL = 0x3f7f7a;
const GOLD = 0xc79a3c;
const STEEL = 0x6f7478;
const DARK = 0x2a2623;
const GONDOLA = [RED, GOLD, TEAL, CREAM];
const HORSE = [0xd9d2c0, 0x4a3a30, 0xb8a078, 0x2c2a2c];
// the bulbs: warm white, and the colours a fair strings between them
const BULBS = [0xffe2a8, 0xff6a4a, 0xffe2a8, 0x6ac8ff, 0xffe2a8, 0x8be07a, 0xffe2a8, 0xffc23a];
const BULB_OFF = 0.08; // a dead bulb is dull glass
const BULB_ON = 3; // a lit one is brighter than white: the bloom pass makes its glow
// Lit bulbs are lights, and a light shows through haze that hides everything around it: they are drawn without the
// scene's fog and dim with distance by this length instead (m), so the wheel is a ring of sparks from across the
// valley. Dead ones are not drawn at all beyond BULB_SEEN, where the haze would have taken them.
const BULB_REACH = 140;
const BULB_SEEN = 70;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _c = new THREE.Color();
const _seat = { x: 0, y: 0, z: 0 };

// Collects pieces into one geometry with a colour per vertex.
class Pieces {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.col = [];
  }
  // geo placed at (x, y, z), turned by (rx, ry, rz) in XYZ order, in colour `hex`
  add(geo, hex, x, y, z, rx = 0, ry = 0, rz = 0) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'XYZ')), _s);
    const p = g.attributes.position;
    const n = g.attributes.normal;
    _c.set(hex);
    for (let i = 0; i < p.count; i++) {
      _p.fromBufferAttribute(p, i).applyMatrix4(_m);
      this.pos.push(_p.x, _p.y, _p.z);
      _p.fromBufferAttribute(n, i).applyQuaternion(_q);
      this.nrm.push(_p.x, _p.y, _p.z);
      this.col.push(_c.r, _c.g, _c.b);
    }
    if (g !== geo) g.dispose();
    geo.dispose();
    return this;
  }
  box(hex, x, y, z, sx, sy, sz, rx, ry, rz) {
    return this.add(new THREE.BoxGeometry(sx, sy, sz), hex, x, y, z, rx, ry, rz);
  }
  // a bar from a to b
  bar(hex, ax, ay, az, bx, by, bz, t) {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    const g = new THREE.BoxGeometry(t, len, t);
    _q.setFromUnitVectors(_p.set(0, 1, 0), new THREE.Vector3(dx / len, dy / len, dz / len));
    _e.setFromQuaternion(_q, 'XYZ');
    return this.add(g, hex, (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, _e.x, _e.y, _e.z);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    return g;
  }
}

function signTexture() {
  const cv = document.createElement('canvas');
  cv.width = 1024;
  cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = '#7d2f26';
  g.fillRect(0, 0, 1024, 128);
  g.strokeStyle = '#d9c9a0';
  g.lineWidth = 6;
  g.strokeRect(9, 9, 1006, 110);
  g.fillStyle = '#e6d8b0';
  g.font = 'bold 78px Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('TRI-COUNTY FAIR', 512, 68);
  // years of weather
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(${40 + Math.floor(Math.sin(i * 12.9898) * 20 + 20)}, 30, 24, ${0.05 + (Math.abs(Math.sin(i * 78.233)) % 1) * 0.12})`;
    const x = Math.abs(Math.sin(i * 3.17)) * 1024;
    const y = Math.abs(Math.sin(i * 7.31)) * 128;
    g.fillRect(x, y, 2 + (i % 7) * 3, 1 + (i % 3));
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export class FairView {
  constructor(scene, world) {
    this.scene = scene;
    const f = (this.fair = world.fair);
    this.group = new THREE.Group();
    this.group.name = 'fair';
    this.paint = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.lamps = []; // every group of bulbs: { meshes, mats, x, y, z (about where it is, in the world) }
    const sign = signTexture();
    this.signMat = new THREE.MeshLambertMaterial({ map: sign, emissiveMap: sign, emissive: 0xffe0b0, emissiveIntensity: 0 }); // (lit by its bulbs)
    this.wireMat = new THREE.LineBasicMaterial({ color: 0x1a1816 });
    this.lit = -1;
    // in the place's frame
    const frame = (this.frame = new THREE.Group());
    frame.position.set(f.x, f.y, f.z);
    frame.rotation.y = f.ry;
    this.group.add(frame);
    this.buildWheel(frame);
    this.buildCarousel(frame);
    this.buildSign(frame);
    this.buildStrings();
    scene.add(this.group);
    this.update(0, 0, 0, null);
  }

  mesh(geo, mat, parent) {
    const m = new THREE.Mesh(geo, mat);
    m.matrixAutoUpdate = true;
    parent.add(m);
    return m;
  }

  // Bulbs: small eight-sided lamps. at: [x, y, z] list in the parent's frame; (lx, ly, lz): about where the group
  // is, in the place's frame. They are two sets that take turns being the brighter one, so the lights chase.
  bulbs(at, parent, size, lx, ly, lz) {
    const f = this.fair;
    const sets = [new Pieces(), new Pieces()];
    at.forEach(([x, y, z], i) => sets[i & 1].add(new THREE.OctahedronGeometry(size), BULBS[i % BULBS.length], x, y, z));
    const mats = sets.map(() => new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
    const meshes = sets.map((s, i) => this.mesh(s.build(), mats[i], parent));
    this.lamps.push({ meshes, mats, x: f.x + f.c * lx + f.s * lz, y: f.y + ly, z: f.z - f.s * lx + f.c * lz });
  }

  buildWheel(frame) {
    const W = WHEEL;
    // the wheel turns about its axle (the frame's Z) in this group
    const wheel = (this.wheel = new THREE.Group());
    wheel.position.set(W.x, W.hub, W.z);
    frame.add(wheel);
    const p = new Pieces();
    const lamps = [];
    const SPOKES = W.n * 2;
    for (const side of [-1, 1]) {
      const z = side * W.half;
      p.add(new THREE.TorusGeometry(W.r, 0.09, 6, 48), RED, 0, 0, z);
      p.add(new THREE.TorusGeometry(W.r * 0.55, 0.06, 5, 32), CREAM, 0, 0, z);
      p.add(new THREE.CylinderGeometry(0.7, 0.7, 0.12, 16), GOLD, 0, 0, z, Math.PI / 2);
      for (let k = 0; k < SPOKES; k++) {
        const a = (k / SPOKES) * TAU;
        const sx = Math.sin(a);
        const sy = -Math.cos(a);
        p.bar(k & 1 ? CREAM : RED, sx * 0.6, sy * 0.6, z, sx * W.r, sy * W.r, z, 0.09);
        for (let j = 1; j <= 6; j++) lamps.push([sx * (0.8 + j * 1.12), sy * (0.8 + j * 1.12), z + side * 0.09]);
      }
      for (let k = 0; k < 48; k++) {
        const a = ((k + 0.5) / 48) * TAU;
        lamps.push([Math.sin(a) * (W.r + 0.02), -Math.cos(a) * (W.r + 0.02), z + side * 0.12]);
      }
    }
    // the bars the gondolas hang from, rim to rim
    for (let k = 0; k < W.n; k++) {
      const a = (k / W.n) * TAU;
      p.add(new THREE.CylinderGeometry(0.06, 0.06, W.half * 2, 6), STEEL, Math.sin(a) * W.r, -Math.cos(a) * W.r, 0, Math.PI / 2);
    }
    this.mesh(p.build(), this.paint, wheel);
    this.bulbs(lamps, wheel, 0.12, W.x, W.hub, W.z);
    // the gondolas hang level whatever the wheel does: each is put where its seat is, every frame. Origin: the
    // middle of its floor, where a rider's feet are.
    this.gondolas = [];
    for (let k = 0; k < W.n; k++) {
      const col = GONDOLA[k % GONDOLA.length];
      const g = new Pieces();
      const w = 1.5; // across the wheel (x)
      const d = 1.2; // along the axle (z): open to the platform (-z), the bench against the back
      const cz = -0.15; // (the rider sits on the bench, so the tub's middle is a little in front of them)
      g.box(DARK, 0, -0.04, cz, w, 0.08, d);
      g.box(col, 0, 0.4, cz + d / 2, w, 0.8, 0.06);
      g.box(col, -w / 2, 0.4, cz, 0.06, 0.8, d);
      g.box(col, w / 2, 0.4, cz, 0.06, 0.8, d);
      g.box(col, -w / 2 + 0.2, 0.3, cz - d / 2, 0.4, 0.6, 0.06);
      g.box(col, w / 2 - 0.2, 0.3, cz - d / 2, 0.4, 0.6, 0.06);
      g.box(CREAM, 0, 0.42, cz + d / 2 - 0.27, w - 0.12, 0.07, 0.5); // the bench
      for (const sx of [-1, 1]) g.bar(STEEL, sx * (w / 2 - 0.05), 0.8, cz, 0, W.hang, 0, 0.06);
      g.box(col, 0, W.hang + 0.1, cz, w + 0.3, 0.06, d + 0.3); // a little roof
      this.gondolas.push(this.mesh(g.build(), this.paint, this.group));
    }
  }

  buildCarousel(frame) {
    const C = CAROUSEL;
    // everything that turns, about the drum
    const turn = (this.carousel = new THREE.Group());
    turn.position.set(C.x, C.deck, C.z);
    frame.add(turn);
    const p = new Pieces();
    const lamps = [];
    // the canopy: a striped cone on a rim, and the turning floor under the horses
    const SEG = 16;
    const R = C.rim + 0.3;
    const top = C.top - C.deck;
    for (let k = 0; k < SEG; k++) {
      const a0 = (k / SEG) * TAU;
      const a1 = ((k + 1) / SEG) * TAU;
      const tri = new THREE.BufferGeometry();
      tri.setAttribute('position', new THREE.Float32BufferAttribute([0, top + 1.5, 0, Math.sin(a0) * R, top, Math.cos(a0) * R, Math.sin(a1) * R, top, Math.cos(a1) * R], 3));
      tri.computeVertexNormals();
      p.add(tri, k & 1 ? CREAM : RED, 0, 0, 0);
      // (and its underside, which is what a rider sees)
      const under = new THREE.BufferGeometry();
      under.setAttribute('position', new THREE.Float32BufferAttribute([0, top + 1.5, 0, Math.sin(a1) * R, top, Math.cos(a1) * R, Math.sin(a0) * R, top, Math.cos(a0) * R], 3));
      under.computeVertexNormals();
      p.add(under, k & 1 ? 0x8f8672 : 0x5e2a22, 0, 0, 0);
      // the valance hanging from its edge
      p.box(k & 1 ? RED : CREAM, Math.sin((a0 + a1) / 2) * R * 0.985, top - 0.18, Math.cos((a0 + a1) / 2) * R * 0.985, 2 * R * Math.sin(Math.PI / SEG), 0.36, 0.05, 0, (a0 + a1) / 2);
      lamps.push([Math.sin(a0) * R, top - 0.42, Math.cos(a0) * R], [Math.sin((a0 + a1) / 2) * R, top - 0.42, Math.cos((a0 + a1) / 2) * R]);
    }
    p.add(new THREE.CylinderGeometry(0.16, 0.16, 0.5, 8), GOLD, 0, top + 1.6, 0);
    p.add(new THREE.CylinderGeometry(C.rim - 0.5, C.rim - 0.5, 0.04, 24), 0x5a4632, 0, 0.03, 0);
    for (let k = 0; k < 8; k++) lamps.push([Math.sin((k / 8) * TAU) * 0.82, top - 0.5, Math.cos((k / 8) * TAU) * 0.82]);
    this.mesh(p.build(), this.paint, turn);
    this.bulbs(lamps, turn, 0.09, C.x, C.top, C.z);
    // the horses, each on its pole: they rise and fall, so each is its own mesh. Origin: where a rider's feet are
    // (the saddle is a seat's height above that); a horse faces the way it goes.
    this.horses = [];
    for (let j = 0; j < C.n; j++) {
      const h = new Pieces();
      const coat = HORSE[j % HORSE.length];
      const trim = GONDOLA[(j + 1) % GONDOLA.length];
      h.box(coat, 0, 0.2, 0, 0.36, 0.42, 1.25); // body
      h.box(trim, 0, 0.43, 0.05, 0.4, 0.06, 0.5); // saddle
      h.box(coat, 0, 0.55, -0.62, 0.26, 0.62, 0.3, 0.5); // neck
      h.box(coat, 0, 0.86, -0.88, 0.22, 0.26, 0.5, 0.25); // head
      h.box(DARK, 0, 0.62, -0.5, 0.06, 0.5, 0.12, 0.5); // mane
      h.box(DARK, 0, 0.2, 0.72, 0.08, 0.5, 0.1, -0.5); // tail
      for (const sx of [-1, 1]) {
        h.box(coat, sx * 0.12, -0.2, -0.42, 0.1, 0.55, 0.1, -0.5); // forelegs, galloping
        h.box(coat, sx * 0.12, -0.2, 0.46, 0.1, 0.55, 0.1, 0.45);
      }
      h.add(new THREE.CylinderGeometry(0.025, 0.025, top + 0.6, 6), GOLD, 0, top / 2 - 0.3, -0.5); // the pole, up through the canopy
      const m = this.mesh(h.build(), this.paint, turn);
      const a = (j / C.n) * TAU;
      m.position.set(Math.sin(a) * C.r, C.sit, Math.cos(a) * C.r);
      m.rotation.y = a - Math.PI / 2;
      this.horses.push(m);
    }
  }

  // the lettering on the entrance arch, both faces of it
  buildSign(frame) {
    const geo = new THREE.PlaneGeometry(9.5, 1.1);
    for (const side of [-1, 1]) {
      const m = this.mesh(geo, this.signMat, frame);
      m.position.set(0, 4.775, -28 + side * 0.125);
      m.rotation.y = side < 0 ? Math.PI : 0;
    }
    const lamps = [];
    for (let k = 0; k <= 16; k++) for (const side of [-1, 1]) lamps.push([-4.6 + k * 0.575, 5.46, -28 + side * 0.16]);
    this.bulbs(lamps, frame, 0.09, 0, 5, -28);
  }

  // the strings over the midway (world coordinates): a sagging wire and a bulb every 0.8 m of it
  buildStrings() {
    const lamps = [];
    const wire = [];
    for (const [x0, y0, z0, x1, y1, z1] of this.fair.strings) {
      const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
      const n = Math.max(3, Math.round(len / 0.8));
      const sag = Math.min(0.45, len * 0.05);
      let px = x0;
      let py = y0;
      let pz = z0;
      for (let k = 1; k <= n; k++) {
        const u = k / n;
        const x = x0 + (x1 - x0) * u;
        const y = y0 + (y1 - y0) * u - sag * 4 * u * (1 - u);
        const z = z0 + (z1 - z0) * u;
        wire.push(px, py, pz, x, y, z);
        if (k < n) lamps.push([x, y - 0.1, z]);
        px = x;
        py = y;
        pz = z;
      }
    }
    this.bulbs(lamps, this.group, 0.085, 0, 4, -6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
    this.group.add(new THREE.LineSegments(g, this.wireMat));
  }

  // clock: the ride clock to draw (commands, with a fraction). lit: 0 dark .. 1 the generator runs. cam: the eye.
  update(clock, lit, time, cam) {
    const f = this.fair;
    this.wheel.rotation.z = (((clock % WT) + WT) % WT) / WT * TAU;
    for (let k = 0; k < this.gondolas.length; k++) {
      const g = this.gondolas[k];
      seatPos(f, k, clock, _seat);
      g.position.set(_seat.x, _seat.y, _seat.z);
      g.rotation.y = f.ry;
    }
    const u = (((clock % CT) + CT) % CT) / CT;
    this.carousel.rotation.y = u * TAU;
    for (let j = 0; j < this.horses.length; j++) this.horses[j].position.y = CAROUSEL.sit + CAROUSEL.bob * Math.sin(u * TAU * CAROUSEL.bobs + j * Math.PI);
    // the bulbs: dead, or the two sets swapping which is the brighter once a second
    const beat = 0.5 + 0.5 * Math.sin(time * TAU);
    for (const l of this.lamps) {
      const d = cam ? Math.hypot(l.x - cam.x, l.y - cam.y, l.z - cam.z) : 0;
      const on = BULB_ON * Math.exp(-d / BULB_REACH);
      for (let i = 0; i < 2; i++) {
        l.mats[i].color.setScalar(BULB_OFF + (on * (0.55 + 0.45 * (i ? 1 - beat : beat)) - BULB_OFF) * lit);
        l.meshes[i].visible = lit > 0 || d < BULB_SEEN;
      }
    }
    this.signMat.emissiveIntensity = lit * 0.75;
    // dark, and further off than anything is drawn (viewDist: the game's, with the haze): none of it is drawn. Lit,
    // its bulbs and its sign carry through the haze from across the valley, and all of it stays.
    this.group.visible = lit > 0 || !cam || Math.hypot(f.x - cam.x, f.z - cam.z) < (this.viewDist ?? 1e9) + 70;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => o.geometry?.dispose());
    this.signMat.map.dispose();
    for (const m of [this.paint, this.signMat, this.wireMat, ...this.lamps.flatMap((l) => l.mats)]) m.dispose();
  }
}
