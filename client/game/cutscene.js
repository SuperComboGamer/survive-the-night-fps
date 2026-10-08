// The run's two cutscenes, played in the game's own engine with the game's own things: the crossing between the acts
// (the car, with the survivors in it, leaves the island with the horde behind it and drives the broken bridge to the
// mainland) and the take-off the run ends on. Like the splash's walk round the valley (menutour.js) each is a
// sequence of camera shots, a cut or a fade between them; unlike it, they run off the server's clock, so every
// client sees the same moment at the same time (shared/acts.js CROSSING, TAKEOFF_TIME).
//
// While one plays, Game hides the HUD and the hands, takes no input but the skip key, and puts its camera where the
// shot says (Game.update). The world behind it is the real one: the island for the first shots of the crossing, then
// - behind a cut to black and a loading card (LoadingCard), when the server says so - the mainland. Every camera is worked out from the world it is in (the road, the bridge's plan, where the city
// and the runway are), so a shot holds for any seed.
import * as THREE from 'three';
import { CROSSING, TAKEOFF_TIME, WORLD } from '../../shared/acts.js';
import { ZTYPE, ZANIM, ZOMBIE_DEFS, ZONE } from '../../shared/defs.js';
import { WATER_LEVEL, PHASE } from '../../shared/constants.js';
import { BRIDGE, DAMAGED } from '../../shared/bridge.js';
import { PROPS } from '../../shared/props.js';
import { COL, footprintContains } from '../../shared/collision.js';
import { createProp } from '../render/models/props.js';
import * as PropModels from '../render/models/props.js';
import { createSurvivor, createZombie, setZombieViewer } from '../render/models/characters.js';
import { defaultCharacter } from '../../shared/characters.js';
import { ACT } from '../../shared/protocol.js';

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const _v = new THREE.Vector3();
const _look = new THREE.Vector3();
const _q = [];

// The car as it drives: the quest car, repaired. { group, wheels } (wheels: what turns)
function driveCar() {
  if (PropModels.createDriveCar) return PropModels.createDriveCar(7);
  return { group: createProp('car', 7), wheels: [] };
}
// ...and the plane as it flies: { group, props } (props: its propellers)
export function flightPlane() {
  if (PropModels.createFlightPlane) return PropModels.createFlightPlane(7);
  return { group: createProp('plane_wreck', 7), props: [] };
}

// Where a survivor sits in the car (its frame: front to -Z): the seat cushions, the driver's first. A seated
// survivor's hips are SEAT_HIP over their feet (characters.js, the sitting pose), so they are put that far under one.
const SEATS = (PropModels.DRIVE_CAR_SEATS || [{ x: -0.38, y: 0.44, z: -0.14 }, { x: 0.38, y: 0.44, z: -0.14 }, { x: -0.38, y: 0.46, z: 0.62 }, { x: 0.38, y: 0.46, z: 0.62 }]).map((p) => [p.x, p.y, p.z]);
const SEAT_HIP = 0.42;
const WHEEL_R = 0.32;
const LETTERBOX = 0.115; // each bar, as a share of the screen's height
const ACT_SKIP = ACT.SKIP;

// The two props of the mainland that a cutscene moves, which the static world therefore leaves out (prop.live): the
// car the team came in, parked where the crossing stops it, and the plane - a wreck that the parts fitted to it
// show on, whole once they are all in, its propellers turning once the engines are started. Game keeps one of these
// per world.
export function liveProps(scene, world) {
  if (world.kind !== WORLD.MAINLAND) return null;
  const root = new THREE.Group();
  root.name = 'live-props';
  const place = (obj, at) => {
    obj.position.set(at.x, at.y, at.z);
    obj.rotation.y = at.ry;
    obj.traverse((o) => o.isMesh && (o.castShadow = o.receiveShadow = true));
    root.add(obj);
    return obj;
  };
  const park = world.props.find((p) => p.type === 'car' && p.live);
  const car = park ? place(driveCar().group, park) : null;
  const at = world.props.find((p) => p.type === 'plane_wreck' && p.live);
  // one plane that is the wreck and, mended, the one that flies (props.js createQuestPlane); a build without it has
  // the wreck and the whole plane as two models, one of them shown
  const quest = at && PropModels.createQuestPlane ? PropModels.createQuestPlane(at.seed) : null;
  let wreck = null;
  let plane = null;
  if (quest) {
    place(quest.group, at);
    plane = quest;
  } else if (at) {
    wreck = place(createProp('plane_wreck', at.seed), at);
    plane = flightPlane();
    place(plane.group, at).visible = false;
  }
  scene.add(root);
  let spin = 0;
  let fitted = '';
  return {
    plane,
    // g: the global state. cine: a cutscene is on (the crossing has a car of its own on the road)
    update(dt, g, cine) {
      if (car) car.visible = !(cine && g.phase === PHASE.CROSSING);
      if (!plane) return;
      const whole = !!g.suppliesDone || g.phase === PHASE.VICTORY;
      if (quest) {
        // (what has been fitted so far is on it: the global state's five counts)
        const key = `${g.supplies.join()}:${whole}`;
        if (key !== fitted) {
          fitted = key;
          quest.setParts(g.supplies);
          quest.setFixed(whole);
        }
      } else {
        wreck.visible = !whole;
        plane.group.visible = whole;
      }
      // the engines: turning over from the moment they are started, flat out once they are warm
      if (g.finale && (g.standWarm || g.escapeReady) && !cine) {
        spin += dt * (g.escapeReady ? 40 : 22);
        for (const pr of plane.props) pr.rotation.z = spin;
      }
    },
    dispose() {
      scene.remove(root);
    },
  };
}

// ---------------------------------------------------------------- the screen: bars, the fade, the skip line
class Screen {
  constructor() {
    const el = (cls, parent) => {
      const d = document.createElement('div');
      d.className = cls;
      parent.appendChild(d);
      return d;
    };
    this.root = el('cine', document.body);
    this.black = el('cine-black', this.root);
    this.top = el('cine-bar cine-top', this.root);
    this.bottom = el('cine-bar cine-bottom', this.root);
    this.title = el('cine-title', this.root);
    this.skip = el('cine-skip', this.root);
    this.top.style.height = this.bottom.style.height = `${LETTERBOX * 100}%`;
    document.body.classList.add('cine-on');
    this.fade = -1;
    this.text = null;
  }
  set(fade, skip = '', title = '') {
    const f = Math.round(fade * 100) / 100;
    if (f !== this.fade) this.black.style.opacity = this.fade = f;
    if (skip !== this.text) this.skip.textContent = this.text = skip;
    if (title !== this.titleText) {
      this.title.textContent = this.titleText = title;
      this.title.style.opacity = title ? 1 : 0;
    }
  }
  dispose() {
    document.body.classList.remove('cine-on');
    this.root.remove();
  }
}

// The card over the black between the crossing's two worlds: a blurred look at Port Calder and a spinner. Building
// the mainland holds the main thread for seconds, so the card has to be on screen before that starts (Game.onWorld
// waits for it), and its spinner turns on the compositor while the page is frozen.
const LOADING_ART = new URL('../ui/art/loading-mainland.jpg', import.meta.url).href;
// (into the browser's cache once the page is idle, long before the crossing: a deploy that changes only the client
// leaves a page that is playing on as it is, and the next server does not have this page's own files - the card would
// have no picture. Its sounds and the synth worker fall back to the procedural ones; this has nothing to fall back to)
if (typeof Image === 'function' && typeof setTimeout === 'function') {
  const fetchArt = () => {
    const img = new Image();
    img.src = LOADING_ART;
  };
  // (within 10 s even on a page that is never idle)
  if (typeof globalThis.requestIdleCallback === 'function') globalThis.requestIdleCallback(fetchArt, { timeout: 10_000 });
  else setTimeout(fetchArt, 5000);
}
class LoadingCard {
  constructor(parent, before) {
    const el = (tag, cls, p, text) => {
      const d = document.createElement(tag);
      d.className = cls;
      if (text) d.textContent = text;
      p.appendChild(d);
      return d;
    };
    this.root = document.createElement('div');
    this.root.className = 'cine-load';
    parent.insertBefore(this.root, before); // (under the letterbox bars and the skip line)
    const img = el('img', 'cine-load-art', this.root);
    img.alt = '';
    img.src = LOADING_ART;
    img.decode?.().catch(() => {}); // (decoded now, not in the frame it first shows)
    const mid = el('div', 'cine-load-mid', this.root);
    el('div', 'cine-load-spin', mid);
    el('div', 'cine-load-title', mid, 'Loading map 2');
    el('div', 'cine-load-sub', mid, 'The mainland · Port Calder');
    this.on = false;
    this.painted = false; // it has been on screen for a frame (what the world swap waits for)
    this.turn = 0;
    this.forced = false; // put up by the world swap ahead of the cut: it stays up until the mainland's first shot
  }
  // now: at once, without fading in (the swap is waiting on it)
  set(on, now = false) {
    if (now) this.forced = true;
    if (on === this.on) return;
    this.on = on;
    this.painted = false;
    this.root.classList.toggle('now', now);
    this.root.classList.toggle('on', on);
    const turn = ++this.turn;
    if (on) requestAnimationFrame(() => requestAnimationFrame(() => turn === this.turn && (this.painted = true)));
  }
}

// a road as a path: its points from index i0 on in direction dir, with the length so far at each
function roadPath(road, i0, dir) {
  const p = road.pts;
  const xs = [];
  const zs = [];
  const cum = [0];
  for (let i = i0; i >= 0 && i < p.length / 2; i += dir) {
    xs.push(p[i * 2]);
    zs.push(p[i * 2 + 1]);
    if (xs.length > 1) cum.push(cum[cum.length - 1] + Math.hypot(xs[xs.length - 1] - xs[xs.length - 2], zs[zs.length - 1] - zs[zs.length - 2]));
  }
  return { xs, zs, cum, len: cum[cum.length - 1] };
}
// the point s metres along it, `off` metres to the right of the way it runs: { x, z, yaw }
function onPath(path, s, off, out) {
  const { xs, zs, cum } = path;
  const last = xs.length - 1;
  s = Math.max(0, Math.min(path.len - 0.01, s));
  let i = 0;
  while (i < last - 1 && cum[i + 1] < s) i++;
  const seg = cum[i + 1] - cum[i] || 1;
  const t = (s - cum[i]) / seg;
  const tx = (xs[i + 1] - xs[i]) / seg;
  const tz = (zs[i + 1] - zs[i]) / seg;
  out.x = xs[i] + (xs[i + 1] - xs[i]) * t - tz * off;
  out.z = zs[i] + (zs[i + 1] - zs[i]) * t + tx * off;
  out.yaw = Math.atan2(-tx, -tz);
  return out;
}
// does anything solid (not a tree: none grows on a road) stand on the roadway at (x, z), where a car would hit it?
function roadBlocked(world, x, z) {
  const y = world.heightAt(x, z);
  for (const c of world.staticGrid.query(x, z, 2.2, _q)) {
    if (c.flags & (COL.NOBLOCK | COL.TREE)) continue;
    if (c.y1 > y + 0.35 && c.y0 < y + 1.6 && footprintContains(c, x, z, 1.3)) return true;
  }
  return false;
}

// a gull: a body and two wings that flap about its spine. Its faces are drawn from both sides by being there twice,
// so it takes the one-sided Lambert program the scene already has (nothing is compiled for it).
let gullGeo = null;
function gullParts() {
  if (gullGeo) return gullGeo;
  const wing = new THREE.BufferGeometry();
  // (the right wing, out along +X: root chord 0.26, tip 0.1, span 0.62, a little swept)
  const v = [0, 0, -0.12, 0.34, 0, -0.1, 0.62, 0, 0.02, 0.3, 0, 0.1, 0, 0, 0.14];
  wing.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  wing.setIndex([0, 4, 3, 0, 3, 1, 1, 3, 2, 0, 3, 4, 0, 1, 3, 1, 2, 3]);
  wing.computeVertexNormals();
  const body = new THREE.BoxGeometry(0.09, 0.08, 0.4);
  const mat = new THREE.MeshLambertMaterial({ color: 0xc9cdcb });
  return (gullGeo = { wing, body, mat });
}
function createGull() {
  const { wing, body, mat } = gullParts();
  const g = new THREE.Group();
  g.add(new THREE.Mesh(body, mat));
  const r = new THREE.Mesh(wing, mat);
  const l = new THREE.Mesh(wing, mat);
  l.scale.x = -1;
  g.add(r, l);
  return { group: g, r, l };
}

// ---------------------------------------------------------------- the crossing
// Its clock (s). Two shots on the island, a cut to black over which the worlds change, six on the bridge.
//   0          the dead pour down Route 9 after the car as it pulls away, seen from among them
//   CUT        from the verge further on: the car goes by, and then all of them do
//   OUT        black, on the thump of the tyres onto the bridge. The server sends the mainland CROSSING.SWAP s in
//              (it is black by then), the client builds it, and the picture comes back IN_FADE after it is up - at
//              BRIDGE_IN at the earliest, later on a machine that takes longer over the build. The shots after it run
//              off the server's clock all the same, so every client is in the same one: a slow one just joins the
//              first of them late.
const CUT = 3.6;
const OUT = 7.1;
const OUT_FADE = 0.22;
const BRIDGE_IN = CROSSING.SWAP + 0.9;
const IN_FADE = 0.45;
const SHOTS = [
  { at: BRIDGE_IN, name: 'approach' }, // off the side, high: the first spans, the sea a long way down
  { at: 13.4, name: 'damage' }, // on the deck: through the span whose top steel is down across a lane
  { at: 18.2, name: 'below' }, // from off its side and under it, coming up through the truss as the car goes by
  { at: 22.6, name: 'gap' }, // the broken span, from out over its missing side: the car creeps along what is left
  { at: 28.8, name: 'skyline' }, // alongside, rising: the mainland and what is left of Port Calder, out of the haze
  { at: 34.4, name: 'arrival' }, // from the bluff: off the last span, and it goes into the sea behind them
  { at: CROSSING.TIME, name: 'end' },
];
const FALL_AT = 37.0; // the last span starts to go
const FALL_FOR = 2.4;
const TOP_SPEED = 17; // m/s down Route 9
const HORDE = 54;
// The crossing is one morning from its first frame to its last, whatever hour the car left at: the sun well clear
// of the hills as it pulls away, a little higher as it comes off the bridge (Environment's cycle: 0 sunrise, 0.25
// noon). No shot of it is night, whichever way it looks.
const DAWN = [0.05, 0.085];
const CAM_BACK = 21; // shot one's camera starts this far behind the car, CAM_OFF m off the middle of the road
const CAM_OFF = -0.9;
const VERGE = 4.3; // ...and shot two's stands this far off it, on the verge
const LENS_ROOM = 1; // none of the dead runs nearer than this past either
const GULLS = 8;
const ROAD_NEED = 130; // m of clear road the island's two shots take
// what could be taken for the car in a shot the car has just left: no wreck of these stands by the second camera
const CAR_LIKE = new Set(['car', 'car_wreck', 'car_burnt', 'car_open', 'pickup_truck', 'van_wreck', 'camper', 'ambulance', 'police_car', 'taxi']);
// what the horde after the car is made of: [type, how many of every HORDE]. The rest are runners.
const HORDE_MIX = [[ZTYPE.WALKER, 14], [ZTYPE.DOG, 4], [ZTYPE.LEAPER, 3], [ZTYPE.SPITTER, 2], [ZTYPE.BOOMER, 2], [ZTYPE.BOSS_ABOMINATION, 1]];

export class Crossing {
  constructor(game) {
    this.g = game;
    this.t = 0;
    this.screen = new Screen();
    this.card = new LoadingCard(this.screen.root, this.screen.top);
    this.fov = 50;
    this.cycle = DAWN[0]; // the time of day the shot asks for (null: whatever the phase says)
    this.fogMul = 1;
    this.far = 0; // how far the static world is drawn (0: as the fog has it)
    this.skipSent = false;
    this.frame = 0;
    this.up = 0; // frames drawn since the mainland came up
    this.reveal = 0; // how far the picture is back from black after the worlds changed (0..1)
    const car = (this.car = driveCar());
    car.group.traverse((o) => o.isMesh && (o.castShadow = true));
    game.scene.add(car.group);
    this.pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
    this.roll = 0; // how far the wheels have turned
    this.last = null; // where the car was a frame ago (its speed, for the wheels and the engine)
    // the survivors in it: everybody in the game as the others see them - the survivor each chose to be (the player
    // list's character, as Entities draws a player's body), seated, this client's own at the wheel
    this.riders = [];
    const ids = [...game.players.keys()].sort((a, b) => (a === game.myId ? -1 : b === game.myId ? 1 : a - b)).slice(0, SEATS.length);
    if (!ids.length) ids.push(game.myId || 1);
    ids.forEach((id, k) => this.riders.push(this.seat(id, k)));
    this.horde = [];
    this.gulls = [];
    this.engine = game.audio.createLoop?.('car', 0, 0, 0) || null;
    this.rattle = null;
    this.onKey = (e) => {
      if (e.code !== 'Space' && e.code !== 'Enter') return;
      e.preventDefault();
      if (!this.skipSent) game.conn.action(ACT_SKIP);
      this.skipSent = true;
    };
    window.addEventListener('keydown', this.onKey, true);
    this.setWorld(game.world);
  }

  // a survivor in seat k of the car: player `id` as the character the player list says they are (the one their id
  // picks until it has said)
  seat(id, k) {
    const ch = this.g.lookOf(id) ?? defaultCharacter(id);
    const sv = createSurvivor(id * 31 + 7, ch);
    sv.setWeapon(0);
    const [x, y, z] = SEATS[k];
    sv.object.position.set(x, y - SEAT_HIP, z);
    if (sv._inst) sv._inst.sitW = 1; // (seated from its first frame: the pose is eased into, and nobody stands up through the roof)
    this.car.group.add(sv.object);
    return { sv, id, ch };
  }

  // the world the shots are in: the island first, then (Game.onWorld) the mainland
  setWorld(world) {
    this.world = world;
    this.clearHorde();
    this.last = null;
    if (world.kind === WORLD.ISLAND) this.planIsland(world);
    else this.planMainland(world);
  }
  worldChanged() {
    this.setWorld(this.g.world);
  }
  clearHorde() {
    for (const z of this.horde) {
      this.g.scene.remove(z.view.object);
      z.view.dispose();
    }
    this.horde.length = 0;
  }

  // The island's shots run down Route 9, away from the breakdown: a stretch of ROAD_NEED m with nothing standing on
  // it (a roadblock, a queue of wrecks at the checkpoint), on whichever side of the breakdown has one, starting far
  // enough from the car the team could not have fixed any sooner that it is behind the camera (the one in the shot
  // is the same car, running). The horde is put down on that stretch behind it.
  planIsland(world) {
    const hw = world.highway;
    const p = hw.pts;
    const n = p.length / 2;
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < n; i++) {
      const d = (p[i * 2] - world.car.x) ** 2 + (p[i * 2 + 1] - world.car.z) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    const c = { x: 0, z: 0, yaw: 0 };
    // (a wreck on the verge beside the second camera reads as the car, stopped, once the car has gone by: the
    // stretch, and the verge that camera stands on, are picked so that none is in its picture)
    const wrecks = world.props.filter((pr) => CAR_LIKE.has(pr.type) && Math.hypot(pr.x - world.car.x, pr.z - world.car.z) > 4);
    const wreckBy = (x, z, r) => wrecks.some((pr) => (pr.x - x) ** 2 + (pr.z - z) ** 2 < r * r);
    const cutRun = this.carRun(CUT);
    let pick = null;
    let first = null;
    // (the way with more road ahead of it first)
    for (const dir of best < n / 2 ? [1, -1] : [-1, 1]) {
      const path = roadPath(hw, best, dir);
      for (let start = 62; start <= 182 && !pick; start += 10) {
        if (path.len < start + ROAD_NEED) break;
        let clear = true;
        for (let s = start - 30; s <= start + ROAD_NEED - 4 && clear; s += 2) clear = !roadBlocked(world, onPath(path, s, 0, c).x, c.z);
        if (!clear) continue;
        first ||= { path, start, verge: VERGE };
        for (const verge of [VERGE, -VERGE]) {
          const at = onPath(path, start + cutRun + 12, verge, c);
          if (wreckBy(at.x, at.z, 24)) continue;
          const back = onPath(path, start + cutRun - 8, verge * 0.6, c);
          if (!wreckBy(back.x, back.z, 17)) pick ||= { path, start, verge };
        }
      }
      if (pick) break;
    }
    // (no such stretch on this island: the first clear one; none of those either: the longer way, as it is)
    pick ||= first || { path: roadPath(hw, best, best < n / 2 ? 1 : -1), start: 62, verge: VERGE };
    this.road = pick.path;
    this.s0 = pick.start; // where the car is as the first shot opens
    this.verge = pick.verge; // which verge the second camera stands on
    const rnd = (k) => {
      const s = Math.sin((world.seed % 1000) * 12.9898 + k * 78.233) * 43758.5453;
      return s - Math.floor(s);
    };
    // who is in the crowd
    const types = [];
    for (const [type, count] of HORDE_MIX) for (let k = 0; k < count; k++) types.push(type);
    while (types.length < HORDE) types.push(ZTYPE.RUNNER);
    const half = hw.width + 2.4; // the roadway and its verges (no tree stands this near the highway)
    // (not through either camera: whoever would run over one runs past it)
    const verge = this.verge;
    const keepOff = (off) => {
      for (const at of [verge, CAM_OFF]) if (Math.abs(off - at) < LENS_ROOM) off = at + (at === verge ? -Math.sign(verge) * LENS_ROOM : off < at ? -LENS_ROOM : LENS_ROOM);
      return off;
    };
    types.forEach((type, k) => {
      const def = ZOMBIE_DEFS[type];
      const boss = !!def.boss;
      const fast = def.speed > 3.5;
      const view = createZombie(type, k * 7 + 3);
      view.object.traverse((o) => o.isMesh && (o.castShadow = true));
      this.g.scene.add(view.object);
      if (view.member) this.g.crowd?.add(view.member);
      this.horde.push({
        view,
        // shot one: where it is behind the car as it opens (the quick ones up at the bumper, the slow ones already
        // dropping back, the big one a long way behind), and how fast it comes
        back: boss ? 30 : fast ? 3.4 + rnd(k + 20) ** 1.3 * 21 : 10 + rnd(k + 20) * 20,
        off: boss ? 0.4 : keepOff((rnd(k + 40) * 2 - 1) * half),
        v: def.speed * (boss ? 1.3 : 0.94 + rnd(k + 60) * 0.16),
        // shot two: how far behind the car it is at the cut
        gap: boss ? 46 : fast ? 4 + rnd(k + 80) ** 1.4 * 24 : 24 + rnd(k + 80) * 22,
        anim: def.speed > 3 || boss ? ZANIM.RUN : ZANIM.WALK,
        weave: rnd(k + 100) * 6.28,
      });
    });
  }

  // The mainland's shots are on the bridge. Each drives the car over a stretch of it picked off the plan: the
  // first spans out of the haze, through the span whose top steel is down, past a pier seen from the water,
  // along what is left of the broken span, towards the skyline, and off the last span onto the bluff, where it
  // stops and the span behind it goes into the sea.
  planMainland(world) {
    const br = world.bridge;
    const S = BRIDGE.SPAN;
    const bs = br.spans[br.broken];
    const ds = br.spans[br.damaged] || br.spans[Math.min(br.spans.length - 1, br.broken + 2)];
    const park = world.props.find((pr) => pr.type === 'car' && pr.live) || { x: br.x1 + 24, y: br.deckY, z: br.z, ry: -Math.PI / 2 };
    this.park = park;
    const bx = bs.x0 - br.x0; // (how far along the bridge the broken span begins)
    const dx = ds.x0 - br.x0;
    this.stretch = {
      approach: [14, Math.max(60, dx - 6)],
      damage: [dx - 4, dx + DAMAGED[1] * BRIDGE.PANEL + 18],
      below: [bx - S + 6, bx - 8], // (the span before the broken one)
      gap: [bx - 6, bx + S + 8],
      skyline: [br.len - 2 * S + 4, br.len - S - 4],
      arrival: [br.len - S + 10, br.len + Math.hypot(park.x - br.x1, park.z - br.z)],
    };
    this.lost = br.lost;
    this.fell = ds.lost || 1;
    this.ds = ds;
    const city = world.city || world.zoneById?.[ZONE.CITY] || { x: br.x1 + 380, z: br.z };
    this.city = { x: city.x, y: world.heightAt(city.x, city.z), z: city.z };
    this.g.bridge?.setFall(0);
    this.rattle ||= this.g.audio.createLoop?.('handcar', 0, 0, 0) || null;
    this.up = 0;
    // gulls over the bridge
    if (!this.gulls.length) {
      for (let k = 0; k < GULLS; k++) {
        const gull = createGull();
        this.g.scene.add(gull.group);
        this.gulls.push({ ...gull, r0: 9 + (k * 5.3) % 17, h: BRIDGE.TRUSS + 2.5 + ((k * 3.7) % 9), w: (k % 2 ? 1 : -1) * (0.3 + ((k * 0.17) % 0.3)), ph: k * 1.9 });
      }
    }
  }

  // the server's clock: how far into the crossing it is (Game reads it off the global state)
  sync(t) {
    if (this.pin === undefined && Math.abs(t - this.t) > 0.35) this.t = t;
  }

  // the car at s metres from the island's end of the bridge; past the abutment, on along the ground to where it parks
  carOnBridge(s, out) {
    const br = this.world.bridge;
    if (s <= br.len) return br.carAt(Math.max(0, s), out);
    const park = this.park;
    const run = Math.hypot(park.x - br.x1, park.z - br.z);
    const k = smooth(0, 1, (s - br.len) / run);
    out.x = lerp(br.x1, park.x, k);
    out.z = lerp(br.z + br.laneAt(br.x1), park.z, k);
    out.y = lerp(br.deckY, park.y, k);
    out.yaw = Math.atan2(Math.sin(park.ry) * k + Math.sin(-Math.PI / 2) * (1 - k), Math.cos(park.ry) * k + Math.cos(-Math.PI / 2) * (1 - k));
    return out;
  }

  // is (x, z) on the deck clear of every wreck on it (with `pad` to spare)? A camera on the roadway asks.
  deckClear(x, z, pad = 0.9) {
    const br = this.world.bridge;
    for (const w of br.wrecks) {
      const [wide, , long] = PROPS[w.type]?.size || [2, 0, 5];
      // (a wreck stands along the bridge, near enough: its length is along x)
      if (Math.abs(x - w.x) < long / 2 + pad && Math.abs(z - (br.z + w.lz)) < wide / 2 + pad) return false;
    }
    return true;
  }

  // how far down Route 9 the car is, t seconds in (m from where it stood as the shot opened): it pulls away at
  // 4 m/s and is doing TOP_SPEED by the cut
  carRun(t) {
    const ta = Math.min(t, 2.9);
    return 4 * ta + 2.25 * ta * ta + Math.max(0, t - 2.9) * TOP_SPEED;
  }

  // One frame: moves the clock on, puts the car where the shot has it and `cam` where the shot looks from.
  // (pin: look-dev - the clock held at that moment, whatever the server's says)
  update(dt, cam) {
    this.t += dt;
    const pinned = this.pin !== undefined;
    if (pinned) this.t = this.pin;
    this.frame++;
    const t = this.t;
    const g = this.g;
    const w = this.world;
    const P = this.pose;
    let fade = 0;
    let title = '';
    this.cycle = lerp(DAWN[0], DAWN[1], clamp01(t / CROSSING.TIME));
    this.fogMul = 1;
    this.far = 0;
    if (w.kind === WORLD.ISLAND) {
      const run = this.carRun(t);
      onPath(this.road, this.s0 + run, 0, P);
      P.y = w.heightAt(P.x, P.z);
      P.pitch = 0;
      const c = { x: 0, z: 0, yaw: 0 };
      const cutRun = this.carRun(CUT);
      const camS = this.s0 + cutRun + 12; // (shot two: the verge the car is about to pass)
      if (t < CUT) {
        // low on the road among them, moving up it: the dead come past the lens on both sides after the car
        onPath(this.road, this.s0 - CAM_BACK + t * 1.4, CAM_OFF, c);
        cam.position.set(c.x, w.heightAt(c.x, c.z) + 0.8 + t * 0.06, c.z);
        _look.set(P.x, P.y + 1.1, P.z);
        this.fov = 50;
      } else {
        // down on the verge further on, looking back up the road: the car comes at it and is gone past, and behind it
        // the whole road is full of them, the first of them going by as the picture cuts
        onPath(this.road, camS, this.verge, c);
        cam.position.set(c.x, w.heightAt(c.x, c.z) + 0.75, c.z);
        const back = onPath(this.road, camS - 30, Math.sign(this.verge) * 0.4, { x: 0, z: 0, yaw: 0 });
        _look.set(back.x, w.heightAt(back.x, back.z) + 1.25, back.z);
        this.fov = 40;
      }
      cam.lookAt(_look);
      // (a hand-held camera: they are running past it)
      cam.position.y += Math.sin(t * 23) * 0.012 + Math.sin(t * 13.7) * 0.01;
      cam.rotation.z += Math.sin(t * 9.1) * 0.004;
      fade = Math.max(smooth(0.5, 0, t), smooth(OUT - OUT_FADE, OUT, t));
      this.far = 280;
      const cx = cam.position.x;
      const cz = cam.position.z;
      // (the dead are drawn as this shot's camera sees them: the far copy of a body past its range, the near one by the lens)
      setZombieViewer(cx, cam.position.y, cz);
      this.horde.forEach((z, k) => {
        // (in the second shot they are the ones on its tail as the picture cut: it skips where the car left the rest)
        const zs = t < CUT ? this.s0 - z.back + z.v * t : this.s0 + cutRun - z.gap + z.v * (t - CUT);
        onPath(this.road, zs, z.off + Math.sin(t * 1.3 + z.weave) * 0.35, c);
        const o = z.view.object;
        o.position.set(c.x, w.heightAt(c.x, c.z), c.z);
        o.rotation.y = c.yaw;
        // the far ones are posed every other frame
        const farOff = (c.x - cx) ** 2 + (c.z - cz) ** 2 > 40 * 40;
        if (!farOff || ((this.frame + k) & 1) === 0) z.view.update(farOff ? dt * 2 : dt, z.anim, z.v, t, true);
      });
      if (t >= OUT && !pinned && !this.thumped) {
        // (the cut is on the sound of the tyres onto the bridge's first joint)
        this.thumped = true;
        g.audio.playLocal?.('deck_thump', { volume: 1.6 });
      }
    } else {
      this.up++;
      const br = w.bridge;
      const D = BRIDGE.DECK;
      this.fogMul = 0.5;
      this.far = 520;
      let k = 0;
      while (k < SHOTS.length - 2 && SHOTS[k + 1].at <= t) k++;
      const shot = SHOTS[k];
      const u = clamp01((t - shot.at) / (SHOTS[k + 1].at - shot.at));
      const [s0, s1] = this.stretch[shot.name];
      // (along the broken span it slows to a crawl and picks up again; coming off the bridge it brakes to a stop)
      const ease = shot.name === 'gap' ? u * 0.55 + 0.45 * (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u)) : shot.name === 'arrival' ? 1 - (1 - u) * (1 - u) : u;
      this.carOnBridge(lerp(s0, s1, ease), P);
      const lz = P.z - br.z;
      if (shot.name === 'approach') {
        // high off the side of the bridge: the trusses going away into the haze, the sea a long way down
        const mid = br.x0 + (s0 + s1) / 2;
        cam.position.set(mid - 6 + u * 9, br.deckY + 13 - u * 2.5, br.z - 33);
        _look.set(P.x + 20, br.deckY + 2.5, br.z);
        this.fov = 44;
      } else if (shot.name === 'damage') {
        // on the roadway past the fallen steel, low, on the side it fell: the chord lying along the deck, the struts
        // hanging, the car coming through under them in the lane that is left
        const ds = this.ds;
        let cx = ds.x0 + DAMAGED[1] * BRIDGE.PANEL + 9;
        let cy = br.deckY + 0.55;
        let czz = br.z + this.fell * 1.7;
        if (!this.deckClear(cx, czz)) czz = br.z + this.fell * 0.2;
        if (!this.deckClear(cx, czz)) cy = br.deckY + 3; // (a wreck stands there after all: look over it)
        cam.position.set(cx + u * 1.5, cy + br.deckSag(cx), czz);
        _look.set(lerp(ds.x0 + DAMAGED[0] * BRIDGE.PANEL, P.x, 0.6), br.deckY + 1.6, br.z + lz * 0.5);
        this.fov = 43;
      } else if (shot.name === 'below') {
        // From off the side its lane is on, close in, and from under the deck: the girders and the floor beams over
        // the lens, the pier behind, the car a long way up the span - and the camera comes up past the level of the
        // roadway as the car comes on, so that it goes by whole, through the truss, the far truss and the sea beyond
        // it. (From down at the water the kerb and the bottom chord hid all of it but its roof.)
        const side = lz < 0 ? -1 : 1;
        const rise = smooth(0.05, 0.62, u);
        cam.position.set(br.x0 + lerp(s0, s1, 0.7), br.deckY + lerp(-3.4, 1.15, rise), br.z + side * (D / 2 + 8.5));
        _look.set(P.x + 1.2, br.deckY + lerp(0.1, 0.75, rise), br.z + lz);
        this.fov = 34;
        this.fogMul = 1.5; // (the island it has come from is a shape in the haze behind it, no more)
      } else if (shot.name === 'gap') {
        // out over the missing side of the broken span, looking back across the hole at the lane that is left
        const bs = br.spans[br.broken];
        cam.position.set(lerp(bs.x0 + 20, bs.x0 + 30, u), br.deckY + 2.2, br.z + this.lost * (D / 2 + 9));
        _look.set(P.x + 2, P.y + 0.5, P.z);
        this.fov = 36;
      } else if (shot.name === 'skyline') {
        // alongside it, out off the bridge on the city's side and rising: the truss going by in front, and beyond it
        // the mainland - what is left of Port Calder standing out of the haze, the smoke over it, the sun behind
        const side = this.city.z >= br.z ? 1 : -1;
        cam.position.set(P.x - 27 + u * 5, br.deckY + 3.4 + u * 7.5, br.z + side * (D / 2 + 5 + u * 3));
        _look.set(this.city.x, this.city.y + 20 - u * 4, this.city.z);
        // (the car kept in the picture, down in its corner)
        _look.lerp(_v.set(P.x + 40, br.deckY + 2, br.z + side * 4), 0.1);
        this.fov = lerp(35, 30, u);
        this.fogMul = lerp(0.2, 0.075, smooth(0, 0.7, u));
        this.far = 1100;
      } else {
        // from the bluff, beside the road off the bridge: the car comes off the last span and stops, and the span goes
        const ax = br.x1 + 30;
        const az = br.z + 9.5;
        cam.position.set(ax, Math.max(br.deckY, w.heightAt(ax, az)) + 1.5, az);
        _look.set(lerp(P.x, br.x1 - 26, smooth(0.5, 0.75, u)), br.deckY + lerp(0.9, -1.5, smooth(0.6, 1, u)), br.z);
        this.fov = 41;
        this.fogMul = 0.34;
      }
      cam.lookAt(_look);
      // the bridge moves under it: a judder on the shots that stand on it
      if (shot.name === 'damage') cam.position.y += Math.sin(t * 31) * 0.006 + Math.sin(t * 17.3) * 0.004;
      // out of black once the mainland is up and has drawn (a couple of frames), and not before the shot is due
      if (pinned) this.reveal = t >= BRIDGE_IN ? 1 : 0;
      else if (this.up > 3 && t >= BRIDGE_IN) this.reveal = Math.min(1, this.reveal + Math.min(dt, 0.05) / IN_FADE);
      fade = Math.max(1 - this.reveal, smooth(CROSSING.TIME - 0.5, CROSSING.TIME, t));
      if (this.reveal > 0 && !this.thumped2 && !pinned) {
        this.thumped2 = true;
        g.audio.playLocal?.('deck_thump', { volume: 1.2 });
      }
      // the last span: it hangs for a moment after the car is off it, groaning, then it goes, hinged on its pier
      const fall = clamp01((t - FALL_AT) / FALL_FOR);
      g.bridge?.setFall(fall * fall);
      if (!pinned && t >= FALL_AT - 1.1 && !this.groaned) {
        this.groaned = true;
        g.audio.playLocal?.('bridge_groan');
      }
      if (!pinned && t >= FALL_AT + 0.75 && !this.fellSound) {
        // (the sound's own bang is the bearings going; a second on, as the deck meets the water, its crash)
        this.fellSound = true;
        g.audio.playLocal?.('bridge_fall');
      }
      if (fall > 0 && fall < 1 && g.bridge) {
        const end = g.bridge.fallEnd(_v);
        if (end.y < WATER_LEVEL + 1 && !this.splashed) {
          this.splashed = true;
          for (let i = -5; i <= 5; i++) {
            g.effects.splash(end.x - 4, WATER_LEVEL, br.z + i * 1.1, 2.4);
            g.effects.splash(end.x - 22 + i * 3, WATER_LEVEL, br.z + (i % 2 ? 5.2 : -5.2), 1.8);
          }
          g.camShake = 1.6;
        }
      }
      if (t < BRIDGE_IN + 3 && this.reveal > 0.5) title = 'THE NARROWS BRIDGE';
      // the tyres over the joints in the deck (every other panel point, harder on the ones over a pier)
      const joint = Math.floor((P.x - br.x0) / (BRIDGE.PANEL * 2));
      if (this.joint !== undefined && joint === this.joint + 1 && P.x < br.x1 && fade < 0.5 && !pinned) {
        const d = cam.position.distanceTo(_v.set(P.x, P.y, P.z));
        const overPier = joint % (BRIDGE.SPAN / (BRIDGE.PANEL * 2)) === 0;
        g.audio.playLocal?.('deck_thump', { volume: (overPier ? 1 : 0.5) * clamp01(1.15 - d / 70) });
      }
      this.joint = joint;
      // the gulls, wheeling over where the car is
      this.gulls.forEach((gl) => {
        const a = t * gl.w + gl.ph;
        const gx = P.x + 16 + Math.cos(a) * gl.r0;
        const gz = br.z + Math.sin(a) * gl.r0 * 0.8;
        gl.group.position.set(gx, br.deckY + gl.h + Math.sin(t * 0.6 + gl.ph) * 1.2, gz);
        gl.group.rotation.set(0, Math.atan2(Math.sin(a) * gl.w, -Math.cos(a) * gl.w * 0.8), Math.sign(gl.w) * 0.3); // (nose along its circle, banked into it)
        // a few beats, then a glide
        const beat = Math.sin(t * 7.5 + gl.ph * 3) * (0.25 + 0.45 * smooth(-0.2, 0.4, Math.sin(t * 0.9 + gl.ph)));
        gl.r.rotation.z = beat;
        gl.l.rotation.z = -beat;
        gl.group.visible = fade < 1;
      });
    }
    // between the two worlds: black, the engine still running, and the loading card over it from the cut until the
    // mainland's first shot comes up
    if (w.kind === WORLD.ISLAND && t >= OUT) fade = 1;
    this.card.set(w.kind === WORLD.ISLAND ? t >= OUT - OUT_FADE || this.card.forced : this.reveal === 0);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    // the car, its wheels, and the people in it
    const car = this.car.group;
    car.position.set(P.x, P.y, P.z);
    car.rotation.set(0, P.yaw, 0);
    const moved = this.last ? Math.hypot(P.x - this.last.x, P.z - this.last.z) : 0;
    const speed = dt > 0 && moved < 4 ? Math.min(30, moved / dt) : this.speed || 0; // (a cut is no burst of speed)
    this.speed = speed;
    this.last = { x: P.x, z: P.z };
    if (moved < 4) this.roll += moved / WHEEL_R;
    for (const wl of this.car.wheels) wl.rotation.x = -this.roll;
    this.riders.forEach((r, k) => {
      // (the player list can say who somebody is after the cutscene began: a list that came late, a rejoin)
      const ch = g.lookOf(r.id) ?? r.ch;
      if (ch !== r.ch) {
        this.car.group.remove(r.sv.object);
        r.sv.dispose();
        r = this.riders[k] = this.seat(r.id, k);
      }
      r.sv.update(dt, { speed: 0, sit: true, onGround: true, pitch: 0, time: t + k * 0.37 });
    });
    // the engine, by how fast it is going; on the bridge, the deck plates under the wheels
    if (this.engine) {
      this.engine.setPosition(P.x, P.y + 0.6, P.z);
      this.engine.setRate(0.62 + speed * 0.034);
      this.engine.setVolume((fade >= 1 ? 0.45 : 1) * (0.55 + speed * 0.028));
    }
    if (this.rattle) {
      this.rattle.setPosition(P.x, P.y, P.z);
      this.rattle.setRate(0.7 + speed * 0.04);
      this.rattle.setVolume(w.kind === WORLD.MAINLAND && fade < 1 && P.x < w.bridge.x1 ? Math.min(0.7, speed * 0.05) : 0);
    }
    const gl = g.global;
    const can = t >= CROSSING.SKIP_AFTER;
    this.screen.set(fade, !can ? '' : this.skipSent ? `Skipping when everyone has asked · ${gl.skips || 0} / ${gl.skipNeed || 1}` : `[Space] skip${gl.skips ? ` · ${gl.skips} / ${gl.skipNeed}` : ''}`, title);
    return fade;
  }

  // The crossing is over: the car stays where it stopped (Game keeps it as the bridgehead's parked car).
  dispose() {
    window.removeEventListener('keydown', this.onKey, true);
    this.screen.dispose();
    this.engine?.stop();
    this.rattle?.stop();
    this.clearHorde();
    for (const gl of this.gulls) this.g.scene.remove(gl.group);
    for (const r of this.riders) {
      this.car.group.remove(r.sv.object);
      r.sv.dispose();
    }
    this.g.scene.remove(this.car.group);
    this.g.bridge?.setFall(1);
  }
}

// ---------------------------------------------------------------- the take-off
// The plane is warm and somebody has taken it up. Four shots in TAKEOFF_TIME seconds, then the end screen:
//   0          off its nose as the engines come up and it starts to roll, the dead coming down the runway behind it
//   RUN_CUT    low on the runway behind it, among the dead as they go after it: it gathers speed, and leaves them
//   OVER_CUT   low on the centre line ahead: it rotates and goes over the lens, wheels up
//   AWAY_CUT   from off its wing in the air: the airfield falling away under it, Port Calder beyond, and it banks
//              away over the mainland
const RUN_CUT = 3.2;
const OVER_CUT = 6.0;
const AWAY_CUT = 9.2;
const ROTATE_AT = 7.4; // s: the wheels leave the ground
const ACCEL = 4.2; // m/s2 down the runway
const STRIP_DEAD = 26; // the dead drawn on the runway behind it, whatever the stand left of the game's own
const RUN_CAM = -3.4; // the second shot's camera: this far off the runway's centre line
export class Takeoff {
  // plane: { group, props } (Game's own: the repaired plane, standing where the wreck stood)
  constructor(game, plane) {
    this.g = game;
    this.t = 0;
    this.plane = plane;
    this.screen = new Screen();
    this.fov = 45;
    this.cycle = null;
    this.fogMul = 0.6;
    this.far = 520;
    this.spin = 0;
    this.home = plane.group.position.clone();
    this.loop = game.audio.createLoop?.('plane', this.home.x, this.home.y + 2, this.home.z) || null;
    const w = game.world;
    const city = w.city || w.zoneById?.[ZONE.CITY] || { x: this.home.x - 600, z: this.home.z };
    this.city = { x: city.x, z: city.z };
    // which way the city is from the runway: the last shot looks that way, and the plane banks towards it
    this.west = Math.sign(city.x - this.home.x) || -1;
    // the dead it leaves behind: the game's own, wherever the stand left them; a few more on the runway if those
    // are not there (the plane is taken up with the runway clear, so there may be none in sight)
    this.dead = [];
    for (let k = 0; k < STRIP_DEAD; k++) {
      const type = k % 3 ? ZTYPE.RUNNER : ZTYPE.WALKER;
      const view = createZombie(type, k * 11 + 5);
      view.object.traverse((o) => o.isMesh && (o.castShadow = true));
      game.scene.add(view.object);
      if (view.member) game.crowd?.add(view.member);
      // (behind the plane, the width of the runway: the quick ones nearest its tail - and none of them down the line
      // the second shot looks along, from where the plane stood to where it has got to)
      let off = (k % 2 ? 1 : -1) * (0.8 + ((k * 2.3) % 8.4));
      if (off > RUN_CAM - 1.5 && off < 0.4) off = off < RUN_CAM / 2 ? RUN_CAM - 1.5 - (RUN_CAM / 2 - off) : 0.4 + (off - RUN_CAM / 2) * 0.6;
      this.dead.push({ view, x: this.home.x + off, z: this.home.z + (type === ZTYPE.RUNNER ? 9 : 16) + ((k * 7.7) % 30), v: ZOMBIE_DEFS[type].speed * (0.9 + ((k * 0.37) % 0.3)), anim: type === ZTYPE.RUNNER ? ZANIM.RUN : ZANIM.WALK });
    }
  }
  worldChanged() {}
  sync(t) {
    if (this.pin === undefined && Math.abs(t - this.t) > 0.35) this.t = t;
  }
  update(dt, cam) {
    this.t += dt;
    if (this.pin !== undefined) this.t = this.pin; // (look-dev)
    const t = Math.min(this.t, TAKEOFF_TIME);
    const p = this.plane.group;
    const w = this.g.world;
    const car = w.car;
    const H = this.home;
    // down the runway (north: -Z), faster and faster; then up, and a bank away towards the city
    const run = 0.5 * ACCEL * Math.min(t, ROTATE_AT) ** 2 + Math.max(0, t - ROTATE_AT) * ACCEL * ROTATE_AT;
    const air = Math.max(0, t - ROTATE_AT);
    const climb = 1.1 * air * air + 2.4 * air;
    const bank = smooth(1.6, 5, air) * 0.3 * -this.west; // (a left bank is a positive roll for a nose to -Z)
    p.position.set(H.x + this.west * smooth(1.6, 6, air) * 9, H.y + climb, H.z - run);
    p.rotation.set(Math.min(0.21, smooth(-0.5, 1.4, t - ROTATE_AT + 0.5) * 0.21), car.ry + bank * 0.35, bank + Math.sin(t * 1.9) * 0.012 * Math.min(1, air));
    this.spin += dt * 46;
    for (const pr of this.plane.props) pr.rotation.z = this.spin;
    const P = p.position;
    this.fogMul = 0.6;
    this.far = 520;
    if (t < RUN_CUT) {
      // off its nose, low: the propellers, the whole of it, and behind it what is coming down the runway
      cam.position.set(H.x + 7.5, H.y + 1.2, H.z - 17 - t * 0.8);
      _look.set(P.x, P.y + 1.7, P.z + 2);
      this.fov = 44;
    } else if (t < OVER_CUT) {
      // on the runway where it stood, among the dead, at the height of their heads: they go past the lens after it
      // on both sides, and over them it is away down the strip
      const u = (t - RUN_CUT) / (OVER_CUT - RUN_CUT);
      cam.position.set(H.x + RUN_CAM, H.y + 1.95 + u * 0.35, H.z + 13 - u * 5);
      _look.set(P.x, P.y + 1.5, P.z);
      this.fov = 42;
    } else if (t < AWAY_CUT) {
      // on the runway ahead of it, down on the centre line: it comes at the lens, lifts, and goes over it
      const over = 0.5 * ACCEL * ROTATE_AT ** 2 + 18; // (where it is a few metres up)
      cam.position.set(H.x + 1.35, H.y + 0.45, H.z - over); // (between its nose wheel and a main wheel)
      _look.set(P.x, P.y + 1.4, P.z);
      this.fov = 40;
    } else {
      // from out off its wing and above it, on the side away from the city: the airfield going away below, the
      // city and its smoke beyond, and the plane banking off over all of it
      const u = (t - AWAY_CUT) / (TAKEOFF_TIME - AWAY_CUT);
      cam.position.set(P.x - this.west * (24 + u * 6), P.y + 7 + u * 3, P.z + 16);
      _look.set(P.x + this.west * 30, P.y - 5, P.z - 22);
      this.fov = 46;
      this.fogMul = 0.18;
      this.far = 1100;
    }
    cam.lookAt(_look);
    if (t < AWAY_CUT) cam.position.y += Math.sin(t * 29) * 0.008 * Math.min(1, run / 30); // (the ground shakes as it goes by)
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    // the dead: after it down the runway, and left there (near or far copies by this shot's camera)
    setZombieViewer(cam.position.x, cam.position.y, cam.position.z);
    this.dead.forEach((z, k) => {
      const zz = z.z - z.v * t;
      const o = z.view.object;
      o.position.set(z.x, w.heightAt(z.x, zz), zz);
      o.rotation.y = 0;
      const farOff = (z.x - cam.position.x) ** 2 + (zz - cam.position.z) ** 2 > 40 * 40;
      if (!farOff || ((k + Math.round(t * 60)) & 1) === 0) z.view.update(farOff ? dt * 2 : dt, z.anim, z.v, t, true);
    });
    if (this.loop) {
      this.loop.setPosition(P.x, P.y + 2, P.z);
      this.loop.setRate(0.9 + Math.min(1, t / ROTATE_AT) * 0.5);
      this.loop.setVolume(1);
    }
    const fade = Math.max(smooth(0.5, 0, this.t), smooth(TAKEOFF_TIME - 0.9, TAKEOFF_TIME, this.t));
    this.screen.set(fade);
    return fade;
  }
  dispose() {
    this.screen.dispose();
    this.loop?.stop();
    for (const z of this.dead) {
      this.g.scene.remove(z.view.object);
      z.view.dispose();
    }
  }
}
