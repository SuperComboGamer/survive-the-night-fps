// The bridge to the mainland (shared/bridge.js is its plan), built as steel: BRIDGE.SPANS through-truss spans on
// concrete piers, standing in the sea from the bluff at the bridgehead out past the edge of the map. The cutscene
// between the acts drives the car across it (client/game/cutscene.js), and from the bridgehead it is what the team
// sees behind them for the rest of the run. Every span is a mesh per material, built once; the span nearest the
// mainland hangs from its pier, so it can be dropped into the water behind the car (setFall). It is a ruin from end
// to end: one span has lost a truss and half its deck, another has the top steel of one side down across a lane,
// diagonals have let go, cables hang parted, plates are gone, and what was driven onto it was left there.
//
// A span in its own frame: x runs along the bridge from its seaward pier (0) to its landward one (SPAN), y = 0 is
// the top of the roadway, z is across it. Nothing here has a collider: nobody walks on the bridge.
import * as THREE from 'three';
import { BRIDGE, DAMAGED } from '../../shared/bridge.js';
import { MeshBuilder, partsToGroup } from './materials.js';
import { createProp } from './models/props.js';

const { SPAN, PANEL, DECK, TRUSS, PIER, FALL } = BRIDGE;
const PANELS = SPAN / PANEL;
const SIDE = DECK / 2 + 0.35; // the trusses stand this far off the centre line
const SLAB = 0.42; // the roadway's concrete
const CELL = 2; // the roadway is laid in plates this long...
const LANES = [-3.45, -1.15, 1.15, 3.45]; // ...four across, their middles (each DECK / 4 wide)
const CHORD = 0.5; // a chord's section
const POST = 0.34;
const KERB = 0.28;
const PIER_FOOT = 22; // a pier goes this far down from the roadway (the sea bed is well under the water line)
const lerp = (a, b, t) => a + (b - a) * t;
const hash = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

// is the plate at (x along the span, lane) missing? holes: the plan's, in the span's frame
function gone(holes, x, lz) {
  for (const h of holes) if (Math.abs(x - h.x) < h.len / 2 && Math.abs(lz - h.lz) < h.w / 2) return true;
  return false;
}

// One span. sp: its entry in the plan; holes: the missing plates on it, in its frame; seed: what varies its rust.
function buildSpan(sp, holes, seed) {
  const b = new MeshBuilder(seed, { ao: false });
  const broken = sp.state === 'broken';
  const lost = sp.lost; // (the side of a broken span that is gone)
  // where the broken span has lost its side: the middle panels
  const B0 = 2 * PANEL;
  const B1 = SPAN - 2 * PANEL;
  const sideGone = (x, z) => broken && Math.sign(z) === lost && x > B0 && x < B1;
  // a damaged span: the top steel of one side is down across that side of the deck, between these
  const damaged = sp.state === 'damaged';
  const D0 = DAMAGED[0] * PANEL;
  const D1 = DAMAGED[1] * PANEL;
  const topGone = (x, sz) => damaged && sz === lost && x > D0 && x < D1;
  // ...and on any span a diagonal or two has let go: what is left of it hangs from its upper end
  const snapped = (i, sz) => (sp.snapped || []).some(([p, sd]) => p === i && sd === sz);

  // ---- the roadway: plates on stringers, kerbs along both edges
  for (let x = CELL / 2; x < SPAN; x += CELL) {
    for (const lz of LANES) {
      if (gone(holes, x, lz) || sideGone(x, lz)) continue;
      b.box('concrete', CELL, SLAB, DECK / 4, { p: [x, -SLAB / 2, lz] });
    }
  }
  for (const lz of [-3.45, -1.15, 1.15, 3.45]) {
    // stringers: where a plate is gone they are what is left to see, and what the car's wheels run over
    for (let x0 = 0; x0 < SPAN; x0 += PANEL) {
      if (sideGone(x0 + PANEL / 2, lz)) continue;
      b.box('rust', PANEL, 0.5, 0.22, { p: [x0 + PANEL / 2, -SLAB - 0.25, lz] });
    }
  }
  for (const sz of [-1, 1]) {
    for (let x0 = 0; x0 < SPAN; x0 += PANEL) {
      if (sideGone(x0 + PANEL / 2, sz)) continue;
      b.box('concrete', PANEL, KERB, 0.4, { p: [x0 + PANEL / 2, KERB / 2, sz * (DECK / 2 - 0.2)] });
    }
  }
  // rebar out of the broken edges of the plates round every hole
  let n = seed * 31;
  for (const h of holes) {
    for (const end of [-1, 1]) {
      for (let k = -2; k <= 2; k++) {
        const z = h.lz + (k / 2.5) * (h.w / 2);
        const x = h.x + end * (h.len / 2);
        const len = 0.5 + hash(n++) * 1.1;
        b.cylBetween('rust', [x, -SLAB / 2, z], [x - end * len, -SLAB / 2 - hash(n++) * 0.7, z + (hash(n++) - 0.5) * 0.3], 0.018, 0.018, 4);
      }
    }
  }

  // ---- floor beams across under every panel point, and the two trusses
  for (let i = 0; i <= PANELS; i++) {
    const x = i * PANEL;
    const half = broken && x > B0 && x < B1;
    // (under the lost side of a broken span the floor beam is torn off at the middle)
    if (half) b.box('rust', 0.3, 0.7, SIDE + 0.4, { p: [x, -SLAB - 0.6, -lost * (SIDE / 2 - 0.2)] });
    else b.box('rust', 0.3, 0.7, SIDE * 2 + 0.4, { p: [x, -SLAB - 0.6, 0] });
  }
  for (const sz of [-1, 1]) {
    const z = sz * SIDE;
    const there = (x) => !sideGone(x, sz);
    for (let i = 0; i < PANELS; i++) {
      const x0 = i * PANEL;
      const x1 = x0 + PANEL;
      const mid = (x0 + x1) / 2;
      if (!there(mid)) continue;
      b.box('rust', PANEL, CHORD + 0.1, CHORD, { p: [mid, -SLAB - 0.2, z] }); // bottom chord
      // the top chord runs between the end posts, which lean in from the piers
      const down = topGone(mid, sz);
      if (i > 0 && i < PANELS - 1 && !down) b.box('rust', PANEL, CHORD, CHORD, { p: [mid, TRUSS, z] });
      // diagonals: down towards the middle of the span (a Pratt truss), the end posts up from the bearings
      const [top, foot] = mid < SPAN / 2 ? [x0, x1] : [x1, x0];
      if (i === 0) b.beam('rust', [x0, -SLAB, z], [x1, TRUSS, z], CHORD, CHORD);
      else if (i === PANELS - 1) b.beam('rust', [x1, -SLAB, z], [x0, TRUSS, z], CHORD, CHORD);
      else if (down) b.beam('rust', [foot, -SLAB, z], [lerp(foot, top, 0.45), TRUSS * 0.4, z + sz * 0.8], POST * 0.7, POST * 0.7); // (bent out over the water)
      else if (snapped(i, sz)) b.beam('rust', [top, TRUSS, z], [lerp(top, foot, 0.3 + 0.2 * hash(seed + i)), TRUSS * 0.55, z + sz * 0.5], POST * 0.7, POST * 0.7);
      else b.beam('rust', [top, TRUSS, z], [foot, -SLAB, z], POST * 0.7, POST * 0.7);
    }
    for (let i = 1; i < PANELS; i++) {
      const x = i * PANEL;
      if (!there(x - 0.1) || !there(x + 0.1)) continue;
      if (topGone(x, sz)) {
        // (a post with nothing on top of it any more: buckled, leaning out)
        b.beam('rust', [x, -SLAB, z], [x + 0.6, TRUSS * (0.45 + 0.25 * hash(seed + i * 9)), z + sz * 1.1], POST, POST);
        b.box('rust', 1.1, 0.8, CHORD + 0.06, { p: [x, -SLAB + 0.1, z] });
        continue;
      }
      b.box('rust', POST, TRUSS + SLAB, POST, { p: [x, (TRUSS - SLAB) / 2, z] }); // verticals
      // gusset plates where the members meet
      b.box('rust', 1.1, 0.9, CHORD + 0.06, { p: [x, TRUSS - 0.1, z] });
      b.box('rust', 1.1, 0.8, CHORD + 0.06, { p: [x, -SLAB + 0.1, z] });
    }
    // the handrail inside the truss, a stretch of it missing here and there
    for (let i = 0; i < PANELS; i++) {
      const mid = i * PANEL + PANEL / 2;
      if (!there(mid) || hash(seed * 7 + i * 3 + sz) < 0.2) continue;
      b.box('rust', PANEL, 0.07, 0.07, { p: [mid, 1.05, sz * (DECK / 2 + 0.05)] });
      b.box('rust', PANEL, 0.05, 0.05, { p: [mid, 0.6, sz * (DECK / 2 + 0.05)] });
    }
    // a cable in a long sag along the top chord, from panel point to panel point (the lamps it fed are long dead)
    for (let i = 1; i < PANELS - 1; i += 2) {
      if (!there(i * PANEL) || !there((i + 2) * PANEL - 0.1) || topGone(i * PANEL + 1, sz) || topGone((i + 2) * PANEL - 1, sz)) continue;
      const a = [i * PANEL, TRUSS - 0.3, sz * (SIDE - 0.3)];
      const c = [(i + 2) * PANEL, TRUSS - 0.3, sz * (SIDE - 0.3)];
      const drop = 0.9 + hash(seed + i * 5 + sz) * 1.4;
      // (one in three has parted: its two ends hang straight down)
      if (hash(seed * 3 + i * 11 + sz) < 0.34) {
        for (const [e, dir] of [[a, 1], [c, -1]]) {
          const hang = 2.5 + hash(seed + e[0] + sz) * 4.5;
          b.tube('dark', [e, [e[0] + dir * 0.9, TRUSS - 0.3 - hang * 0.55, e[2] - sz * 0.15], [e[0] + dir * 1.1, TRUSS - 0.3 - hang, e[2] - sz * 0.25]], 0.035, 8, 4);
        }
      } else b.tube('dark', [a, [(a[0] + c[0]) / 2, TRUSS - 0.3 - drop, a[2]], c], 0.035, 10, 4);
    }
  }
  // top bracing: a strut across at every upper panel point, and an X between them
  for (let i = 1; i < PANELS; i++) {
    const x = i * PANEL;
    if (broken && x > B0 && x < B1) continue;
    if (damaged && x > D0 && x < D1) {
      // (the struts of the damaged span hang from the side that stands, their far ends down on the deck)
      b.beam('rust', [x, TRUSS, -lost * SIDE], [x + (hash(seed + i) - 0.5) * 3, 0.25, lost * (SIDE - 1.1 - hash(seed + i * 5) * 1.6)], 0.3, 0.36);
      continue;
    }
    b.box('rust', 0.3, 0.36, SIDE * 2, { p: [x, TRUSS + 0.05, 0] });
    if (i < PANELS - 1 && !(broken && x + PANEL > B0 && x + PANEL < B1) && !(damaged && x + PANEL > D0 && x < D1)) {
      b.beam('rust', [x, TRUSS, -SIDE], [x + PANEL, TRUSS, SIDE], 0.12, 0.12);
      b.beam('rust', [x, TRUSS, SIDE], [x + PANEL, TRUSS, -SIDE], 0.12, 0.12);
    }
  }
  // the portals at both ends: a deep strut the road goes under
  for (const x of [PANEL, SPAN - PANEL]) b.box('rust', 0.4, 1.3, SIDE * 2, { p: [x, TRUSS - 0.6, 0] });

  // ---- what a broken span has left of its lost side: the chords bent down towards the water, a slab hanging by
  // its steel, snapped cables
  if (broken) {
    const z = lost * SIDE;
    b.beam('rust', [B0, TRUSS, z], [B0 + 9, TRUSS - 6.5, z + lost * 1.2], CHORD, CHORD);
    b.beam('rust', [B1, TRUSS, z], [B1 - 7, TRUSS - 8, z + lost * 0.6], CHORD, CHORD);
    b.beam('rust', [B0, -SLAB - 0.2, z], [B0 + 11, -SLAB - 7.5, z + lost * 0.8], CHORD, CHORD + 0.1);
    b.beam('rust', [B1, -SLAB - 0.2, z], [B1 - 8, -SLAB - 5, z + lost * 0.4], CHORD, CHORD + 0.1);
    b.box('concrete', 7, SLAB, DECK / 4, { p: [B0 + 5.2, -2.6, lost * 2.3], r: [0, 0, -0.62] });
    b.box('concrete', 5, SLAB, DECK / 4, { p: [B1 - 3.6, -2.2, lost * 3.45], r: [0, 0.1, 0.7] });
    for (let k = 0; k < 9; k++) {
      const x = B0 + 2 + hash(seed + k) * (B1 - B0 - 4);
      b.cylBetween('rust', [x, -SLAB / 2, lost * 0.2], [x + (hash(k + 3) - 0.5) * 0.6, -SLAB / 2 - 0.3 - hash(k + 9) * 1.2, lost * (0.6 + hash(k + 5) * 0.9)], 0.018, 0.018, 4);
    }
    for (const [x, len] of [[B0 + 3, 5.5], [B1 - 2, 4], [SPAN / 2, 7]]) b.tube('dark', [[x, TRUSS, z * 0.2], [x + 0.4, TRUSS - len * 0.5, z * 0.3], [x + 0.2, TRUSS - len, z * 0.36]], 0.03, 8, 4);
  }

  // ---- a damaged span: the top chord of its fallen side lies along that side of the deck, one end still up
  if (damaged) {
    const z = lost * SIDE;
    b.beam('rust', [D0, TRUSS, z], [D0 + 6.5, 0.3, lost * 3.2], CHORD, CHORD);
    b.beam('rust', [D0 + 6.5, 0.3, lost * 3.2], [D1 - 3, 0.3, lost * 2.4], CHORD, CHORD);
    b.beam('rust', [D1, TRUSS, z], [D1 - 2.4, TRUSS - 4.6, z - lost * 0.5], CHORD, CHORD);
    for (let k = 0; k < 4; k++) b.box('rust', 1 + hash(seed + k) * 1.4, 0.04, 0.5 + hash(seed + k * 7) * 0.7, { p: [D0 + 3 + k * 4.4, 0.03, lost * (1.6 + hash(seed + k * 3) * 2.2)], r: [0, hash(k + seed) * 3, 0] });
  }

  // every span hangs a little between its piers, the broken one a lot: bend the lot
  const parts = b.build();
  for (const p of parts) {
    const pos = p.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) - sp.sag * Math.sin((Math.PI * Math.max(0, Math.min(SPAN, pos.getX(i)))) / SPAN));
    p.geometry.computeBoundingSphere();
  }
  return partsToGroup(parts, 'bridge-span');
}

// a pier: a concrete shaft down into the sea, a cap under the bearings, cutwaters at the water line
function buildPier(seed) {
  const b = new MeshBuilder(seed, { ao: false });
  b.box('concrete', PIER + 1, 1.2, SIDE * 2 + 2.6, { p: [0, -SLAB - 1.6, 0] });
  b.box('concrete', PIER, PIER_FOOT, SIDE * 2 + 1.2, { p: [0, -SLAB - 2.2 - PIER_FOOT / 2, 0] });
  for (const sz of [-1, 1]) b.cyl('concrete', PIER / 2, PIER / 2, PIER_FOOT, 8, { p: [0, -SLAB - 2.2 - PIER_FOOT / 2, sz * (SIDE + 0.6)] });
  // rust run down the concrete from every bearing, years of it
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 5; k++) {
      const len = 2.5 + hash(seed * 5 + k + sx) * 7;
      b.box('rust', 0.03, len, 0.25 + hash(seed + k * 3 + sx) * 0.7, { p: [sx * (PIER / 2 + 0.012), -SLAB - 2.2 - len / 2, (hash(seed + k * 13 + sx * 2) - 0.5) * SIDE * 2] });
    }
  }
  return partsToGroup(b.build(), 'bridge-pier');
}

// The island the bridge comes from, as it is seen from the bridge: a dark shape in the haze at its far end
function buildIsland(x, z) {
  const geo = new THREE.SphereGeometry(1, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const a = Math.atan2(pos.getZ(i), pos.getX(i));
    const k = 1 + 0.16 * Math.sin(a * 3 + 1.3) + 0.1 * Math.sin(a * 7 + 0.4);
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * (0.7 + 0.3 * Math.sin(a * 2 + 2.1) ** 2), pos.getZ(i) * k);
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x1c241d }));
  mesh.scale.set(420, 74, 620);
  mesh.position.set(x - 360, -3, z);
  mesh.name = 'bridge-island';
  return mesh;
}

export class BridgeView {
  constructor(scene, world) {
    const br = (this.plan = world.bridge);
    this.scene = scene;
    const root = (this.group = new THREE.Group());
    root.name = 'bridge';
    this.spans = [];
    br.spans.forEach((sp, k) => {
      const holes = br.holes.filter((h) => h.x >= sp.x0 && h.x < sp.x1).map((h) => ({ x: h.x - sp.x0, lz: h.lz, len: h.len, w: h.w }));
      const g = buildSpan(sp, holes, world.seed + k * 17);
      // (the span that falls turns about the top of its seaward pier: its group's own origin)
      g.position.set(sp.x0, br.deckY, br.z);
      root.add(g);
      this.spans.push(g);
      const pier = buildPier(world.seed + k);
      pier.position.set(sp.x0, br.deckY, br.z);
      root.add(pier);
    });
    // what stands on it: the wrecks the car threads between
    for (const w of br.wrecks) {
      const p = createProp(w.type, w.seed);
      p.position.set(w.x, br.deckY + br.deckSag(w.x), br.z + w.lz);
      p.rotation.y = w.ry;
      root.add(p);
    }
    root.add(buildIsland(br.x0, br.z));
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.receiveShadow = true;
      o.castShadow = o.parent.name === 'bridge-span';
    });
    root.updateMatrixWorld(true);
    this.fall = -1;
    this.setFall(1); // as the team finds it once they are over: the last span in the water
    scene.add(root);
  }

  // how far the span nearest the mainland has come down, 0 standing .. 1 in the water (the cutscene drops it)
  setFall(k) {
    if (k === this.fall) return;
    this.fall = k;
    const g = this.spans[0];
    g.rotation.z = -k * FALL;
    g.updateMatrixWorld(true);
  }

  // where the landward end of the falling span is now (for the splash as it goes in)
  fallEnd(out) {
    const g = this.spans[0];
    return out.set(SPAN, 0, 0).applyMatrix4(g.matrixWorld);
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.isMesh && (o.parent?.name === 'bridge-span' || o.parent?.name === 'bridge-pier' || o.name === 'bridge-island')) o.geometry.dispose();
    });
  }
}
