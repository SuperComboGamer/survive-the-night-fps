// The run's two cutscenes, played in the game's own engine with the game's own things: the crossing between the acts
// (the car, with the survivors in it, leaves the island with the horde behind it and drives the broken bridge to the
// mainland) and the take-off the run ends on. Like the splash's walk round the valley (menutour.js) each is a
// sequence of camera shots, a cut or a fade between them; unlike it, they run off the server's clock, so every
// client sees the same moment at the same time (shared/acts.js CROSSING, TAKEOFF_TIME).
//
// While one plays, Game hides the HUD and the hands, takes no input but the skip key, and puts its camera where the
// shot says (Game.update). The world behind it is the real one: the island for the first shots of the crossing, then
// - behind a cut to black, when the server says so - the mainland, which is how the mainland gets loaded without a
// loading screen.
import * as THREE from 'three';
import { CROSSING, TAKEOFF_TIME, WORLD } from '../../shared/acts.js';
import { ZTYPE, ZANIM, SOUND } from '../../shared/defs.js';
import { WATER_LEVEL, PHASE } from '../../shared/constants.js';
import { BRIDGE } from '../../shared/bridge.js';
import { createProp } from '../render/models/props.js';
import * as PropModels from '../render/models/props.js';
import { createSurvivor, createZombie } from '../render/models/characters.js';
import { ACT } from '../../shared/protocol.js';

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;
const _v = new THREE.Vector3();
const _look = new THREE.Vector3();

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
const SEATS = PropModels.DRIVE_CAR_SEATS || [[-0.38, 0.44, -0.14], [0.38, 0.44, -0.14], [-0.38, 0.46, 0.62], [0.38, 0.46, 0.62]];
const SEAT_HIP = 0.42;
const WHEEL_R = 0.32;
const LETTERBOX = 0.115; // each bar, as a share of the screen's height
const ACT_SKIP = ACT.SKIP;
// the last span coming down is heard with what the engine has: a great tree going over, and timber breaking
const SPLASH_SOUND = SOUND.TREE_FALL;
const GROAN_SOUND = SOUND.WOOD_BREAK;

// The two props of the mainland that a cutscene moves, which the static world therefore leaves out (prop.live): the
// car the team came in, parked where the crossing stops it, and the plane - a wreck until every part is in it,
// then whole, its propellers turning once the engines are started. Game keeps one of these per world.
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
  const wreck = at ? place(createProp('plane_wreck', at.seed), at) : null;
  const plane = at ? flightPlane() : null;
  if (plane) place(plane.group, at).visible = false;
  scene.add(root);
  let spin = 0;
  return {
    plane,
    // g: the global state. cine: a cutscene is on (the crossing has a car of its own on the road)
    update(dt, g, cine) {
      if (car) car.visible = !(cine && g.phase === PHASE.CROSSING);
      if (!plane) return;
      const whole = !!g.suppliesDone || g.phase === PHASE.VICTORY;
      wreck.visible = !whole;
      plane.group.visible = whole;
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

// ---------------------------------------------------------------- the crossing
// Its shots, by the cutscene's clock (s). The first two are on the island; the cut to black between ISLAND_OUT and
// MAINLAND_IN is where the worlds change (CROSSING.SWAP is inside it).
const ISLAND_CUT = 3.4; // from the low shot behind the horde to the one the car drives up to
const ISLAND_OUT = 6.4; // black by here
const MAINLAND_IN = 9.2; // ...and the bridge from here
// [from, to, the car's place on the bridge at each end (m from the island's end; see Crossing.plan), name]
const SHOTS = [
  { at: MAINLAND_IN, name: 'approach' },
  { at: 14.2, name: 'deck' },
  { at: 19.2, name: 'below' },
  { at: 24.4, name: 'gap' },
  { at: 31.4, name: 'skyline' },
  { at: 34.6, name: 'arrival' },
  { at: CROSSING.TIME, name: 'end' },
];
const FALL_AT = 37.0; // the last span starts to go
const FALL_FOR = 2.3;
const HORDE = 14;

export class Crossing {
  constructor(game) {
    this.g = game;
    this.t = 0;
    this.screen = new Screen();
    this.fov = 50;
    this.cycle0 = game.env.cycle; // the hour the car left at: the island's shots keep it
    this.cycle = this.cycle0; // the time of day the shot asks for (null: whatever the phase says)
    this.fogMul = 1;
    this.far = 0; // how far the static world is drawn (0: as the fog has it)
    this.skipSent = false;
    const car = (this.car = driveCar());
    car.group.traverse((o) => o.isMesh && (o.castShadow = true));
    game.scene.add(car.group);
    this.pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
    this.roll = 0; // how far the wheels have turned
    this.last = null; // where the car was a frame ago (its speed, for the wheels and the engine)
    // the survivors in it: everybody in the game, as the others see them (Entities draws a player by their id)
    this.riders = [];
    const ids = [...game.players.keys()].sort((a, b) => (a === game.myId ? -1 : b === game.myId ? 1 : a - b)).slice(0, SEATS.length);
    if (!ids.length) ids.push(game.myId || 1);
    ids.forEach((id, k) => {
      const sv = createSurvivor(id * 31 + 7);
      sv.setWeapon(0);
      const [x, y, z] = SEATS[k];
      sv.object.position.set(x, y - SEAT_HIP, z);
      car.group.add(sv.object);
      this.riders.push(sv);
    });
    this.horde = [];
    this.engine = game.audio.createLoop?.('generator', 0, 0, 0) || null;
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

  // the world the shots are in: the island first, then (Game.onWorld) the mainland
  setWorld(world) {
    this.world = world;
    for (const z of this.horde) {
      this.g.scene.remove(z.view.object);
      z.view.dispose();
    }
    this.horde.length = 0;
    this.last = null;
    if (world.kind === WORLD.ISLAND) this.planIsland(world);
    else this.planMainland(world);
  }
  worldChanged() {
    this.setWorld(this.g.world);
  }

  // The island's shots run down Route 9 from the breakdown, away from the car the team could not have fixed any
  // sooner (it stays where it stood, behind the camera: the one in the shot is the same car, running).
  planIsland(world) {
    const hw = world.highway;
    const p = hw.pts;
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < p.length / 2; i++) {
      const d = (p[i * 2] - world.car.x) ** 2 + (p[i * 2 + 1] - world.car.z) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    // the way with more road ahead of it
    const dir = best < p.length / 4 ? 1 : -1;
    this.road = roadPath(hw, best, dir);
    const rnd = (k) => {
      const s = Math.sin((world.seed % 1000) * 12.9898 + k * 78.233) * 43758.5453;
      return s - Math.floor(s);
    };
    for (let k = 0; k < HORDE; k++) {
      const type = rnd(k) < 0.7 ? ZTYPE.RUNNER : ZTYPE.WALKER;
      const view = createZombie(type, k * 7 + 3);
      this.g.scene.add(view.object);
      this.horde.push({ view, s0: -14 + rnd(k + 20) * 30, off: (rnd(k + 40) - 0.5) * 6.4, v: type === ZTYPE.RUNNER ? 5.4 + rnd(k + 60) * 1.4 : 2.1 + rnd(k + 60) * 0.5, anim: type === ZTYPE.RUNNER ? ZANIM.RUN : ZANIM.WALK });
    }
  }

  // The mainland's shots are on the bridge. Each drives the car over a stretch of it picked off the plan: the
  // first spans out of the haze, past a wreck, over a pier, through the broken span, towards the skyline, and off
  // the last span onto the bluff, where it stops beside the road and the span behind it goes into the water.
  planMainland(world) {
    const br = world.bridge;
    const first = br.wrecks.find((w) => w.x - br.x0 > 110) || br.wrecks[0];
    const bs = br.spans[br.broken];
    const park = world.props.find((pr) => pr.type === 'car') || { x: br.x1 + 26, y: br.deckY, z: br.z + 2, ry: -Math.PI / 2 };
    this.park = park;
    this.stretch = {
      approach: [18, 78],
      deck: [first ? first.x - br.x0 - 40 : 130, first ? first.x - br.x0 + 22 : 190],
      below: [bs.x1 - br.x0 + 34, bs.x1 - br.x0 + 92], // (the span after the broken one, seen from the water)
      gap: [bs.x0 - br.x0 - 6, bs.x1 - br.x0 + 8],
      skyline: [br.len - 2 * BRIDGE.SPAN + 6, br.len - BRIDGE.SPAN - 6],
      arrival: [br.len - BRIDGE.SPAN + 12, br.len + Math.hypot(park.x - br.x1, park.z - br.z)],
    };
    // (the broken span is seen from its lost side, across the gap)
    this.lost = br.lost;
    this.g.bridge?.setFall(0);
    this.rattle ||= this.g.audio.createLoop?.('handcar', 0, 0, 0) || null;
  }

  // the server's clock: how far into the crossing it is (Game reads it off the global state)
  sync(t) {
    if (this.pin === undefined && Math.abs(t - this.t) > 0.35) this.t = t;
  }

  // the car at s metres from the island's end of the bridge; past the abutment, on along the ground to where it parks
  carOnBridge(s, out) {
    const br = this.world.bridge;
    if (s <= br.len) return br.carAt(s, out);
    const park = this.park;
    const run = Math.hypot(park.x - br.x1, park.z - br.z);
    const k = smooth(0, 1, (s - br.len) / run);
    out.x = lerp(br.x1, park.x, k);
    out.z = lerp(br.z + br.laneAt(br.x1), park.z, k);
    out.y = lerp(br.deckY, park.y, k);
    out.yaw = Math.atan2(Math.sin(park.ry) * k + Math.sin(-Math.PI / 2) * (1 - k), Math.cos(park.ry) * k + Math.cos(-Math.PI / 2) * (1 - k));
    return out;
  }

  // One frame: moves the clock on, puts the car where the shot has it and `cam` where the shot looks from.
  // (pin: look-dev - the clock held at that moment, whatever the server's says)
  update(dt, cam) {
    this.t += dt;
    if (this.pin !== undefined) this.t = this.pin;
    const t = this.t;
    const g = this.g;
    const w = this.world;
    const P = this.pose;
    let fade = 0;
    let title = '';
    this.cycle = this.cycle0;
    this.fogMul = 1;
    this.far = 0;
    if (w.kind === WORLD.ISLAND) {
      // the car pulls away: 4 m/s as the shot opens, up to 17
      const ta = Math.min(t, 2.9);
      const s = 16 + 4 * ta + 2.25 * ta * ta + Math.max(0, t - 2.9) * 17;
      onPath(this.road, s, 0, P);
      P.y = w.heightAt(P.x, P.z);
      P.pitch = 0;
      const c = { x: 0, z: 0, yaw: 0 };
      if (t < ISLAND_CUT) {
        // low on the road just past where the car stood, the horde coming by on both sides
        onPath(this.road, 5 + t * 0.5, -1.6, c);
        cam.position.set(c.x, w.heightAt(c.x, c.z) + 0.55 + t * 0.05, c.z);
        _look.set(P.x, P.y + 0.9, P.z);
        this.fov = 52;
      } else {
        // on the verge well down the road: the car comes up to it, the dead a long way behind and not giving up
        onPath(this.road, 122, 3.4, c);
        cam.position.set(c.x, w.heightAt(c.x, c.z) + 1.25, c.z);
        _look.set(P.x, P.y + 0.8, P.z);
        this.fov = 34;
      }
      cam.lookAt(_look);
      fade = Math.max(smooth(0.6, 0, t), smooth(ISLAND_OUT - 0.7, ISLAND_OUT, t));
      this.far = 260;
      for (const z of this.horde) {
        const zs = z.s0 + z.v * t;
        onPath(this.road, zs, z.off, c);
        z.view.object.position.set(c.x, w.heightAt(c.x, c.z), c.z);
        z.view.object.rotation.y = c.yaw;
        z.view.update(dt, z.anim, z.v, t, true);
      }
    } else {
      // the morning after: the sun is just up over the mainland as the car crosses, and climbs as it goes
      this.cycle = lerp(0.008, 0.05, smooth(MAINLAND_IN, CROSSING.TIME, t));
      this.fogMul = 0.5;
      this.far = 520;
      let k = 0;
      while (k < SHOTS.length - 2 && SHOTS[k + 1].at <= t) k++;
      const shot = SHOTS[k];
      const u = Math.max(0, Math.min(1, (t - shot.at) / (SHOTS[k + 1].at - shot.at)));
      const [s0, s1] = this.stretch[shot.name];
      const br = w.bridge;
      // (through the gap it slows to a crawl and picks up again; coming off the bridge it brakes to a stop)
      const ease = shot.name === 'gap' ? u * 0.55 + 0.45 * (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u)) : shot.name === 'arrival' ? 1 - (1 - u) * (1 - u) : u;
      this.carOnBridge(lerp(s0, s1, ease), P);
      const lz = P.z - br.z;
      const D = BRIDGE.DECK;
      if (shot.name === 'approach') {
        // high off the side of the bridge: the trusses going away into the haze, the sea a long way down
        cam.position.set(br.x0 + 64 + u * 9, br.deckY + 12 - u * 2, br.z - 31);
        _look.set(P.x + 22, br.deckY + 2.5, br.z);
        this.fov = 44;
      } else if (shot.name === 'deck') {
        // on the roadway ahead of it, at the height of its bumper, as it comes round a wreck
        const ahead = br.carAt(s1 + 9, { x: 0, y: 0, z: 0, yaw: 0 });
        cam.position.set(ahead.x, ahead.y + 0.42, br.z - Math.sign(lz || 1) * (D / 2 - 0.9));
        _look.set(P.x, P.y + 0.75, P.z);
        this.fov = 40;
      } else if (shot.name === 'below') {
        // from down by the water, beside a pier: the whole height of the thing, and the car small on top of it
        cam.position.set(lerp(br.x0 + s0, br.x0 + s1, 0.42), WATER_LEVEL + 1.3, br.z + 44);
        _look.set(P.x, br.deckY - 1, br.z);
        this.fov = 38;
      } else if (shot.name === 'gap') {
        // out over the missing side of the broken span, looking back across the hole at the lane that is left
        const bs = br.spans[br.broken];
        cam.position.set(lerp(bs.x0 + 20, bs.x0 + 30, u), br.deckY + 2.2, br.z + this.lost * (D / 2 + 9));
        _look.set(P.x + 2, P.y + 0.5, P.z);
        this.fov = 36;
      } else if (shot.name === 'skyline') {
        // over the roof from behind: the mainland, and what is left of Port Calder, coming up out of the fog
        cam.position.set(P.x - 7.5, P.y + 2.9 + u * 0.6, P.z + 1.4);
        _look.set(P.x + 60, P.y + 7, br.z + (w.city.z - br.z) * 0.25);
        this.fov = 47;
        this.fogMul = lerp(0.42, 0.26, u);
        this.far = 700;
      } else {
        // from the bluff, beside the road off the bridge: the car comes off the last span and stops, and the span goes
        cam.position.set(br.x1 + 30, br.deckY + 1.5, br.z + 9.5);
        _look.set(lerp(P.x, br.x1 - 26, smooth(0.55, 0.8, u)), br.deckY + lerp(0.9, -1.5, smooth(0.6, 1, u)), br.z);
        this.fov = 41;
        this.fogMul = 0.34;
      }
      cam.lookAt(_look);
      // the bridge moves under it: a judder on the roadway shots
      if (shot.name === 'deck' || shot.name === 'skyline') cam.position.y += Math.sin(t * 31) * 0.006 + Math.sin(t * 17.3) * 0.004;
      // cuts: out of black as the bridge comes up, and a few frames of it at the end
      fade = Math.max(smooth(MAINLAND_IN + 1.3, MAINLAND_IN, t), smooth(CROSSING.TIME - 0.5, CROSSING.TIME, t));
      // the last span: it hangs for a moment after the car is off it, then it goes, hinged on its pier
      const fall = Math.max(0, Math.min(1, (t - FALL_AT) / FALL_FOR));
      g.bridge?.setFall(fall * fall);
      if (fall > 0 && fall < 1 && g.bridge) {
        const end = g.bridge.fallEnd(_v);
        if (end.y < WATER_LEVEL + 1 && !this.splashed) {
          this.splashed = true;
          for (let i = -4; i <= 4; i++) g.effects.splash(end.x - 4, WATER_LEVEL, br.z + i * 1.2, 2.2);
          g.audio.play?.(SPLASH_SOUND, { x: end.x, y: WATER_LEVEL, z: br.z });
          g.camShake = 1.4;
        }
        if (!this.groaned) {
          this.groaned = true;
          g.audio.play?.(GROAN_SOUND, { x: br.x1 - 20, y: br.deckY, z: br.z });
        }
      }
      if (t < MAINLAND_IN + 2.6 && t > MAINLAND_IN - 0.4) title = 'THE NARROWS BRIDGE';
    }
    // between the two worlds: black, the engine still running
    if (t >= ISLAND_OUT && (w.kind === WORLD.ISLAND || t < MAINLAND_IN)) fade = 1;
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    // the car, its wheels, and the people in it
    const car = this.car.group;
    car.position.set(P.x, P.y, P.z);
    car.rotation.set(0, P.yaw, 0);
    const moved = this.last ? Math.hypot(P.x - this.last.x, P.z - this.last.z) : 0;
    const speed = dt > 0 ? Math.min(30, moved / dt) : 0;
    this.last = { x: P.x, z: P.z };
    this.roll += moved / WHEEL_R;
    for (const wl of this.car.wheels) wl.rotation.x = -this.roll;
    this.riders.forEach((sv, k) => sv.update(dt, { speed: 0, sit: true, onGround: true, pitch: 0, time: t + k * 0.37 }));
    // the engine, by how fast it is going; on the bridge, the deck plates under the wheels
    const vol = fade >= 1 ? 0.5 : 1;
    if (this.engine) {
      this.engine.setPosition(P.x, P.y + 0.6, P.z);
      this.engine.setRate(0.85 + speed * 0.055);
      this.engine.setVolume(vol * (0.6 + speed * 0.03));
    }
    if (this.rattle) {
      this.rattle.setPosition(P.x, P.y, P.z);
      this.rattle.setRate(0.7 + speed * 0.04);
      this.rattle.setVolume(w.kind === WORLD.MAINLAND && fade < 1 && P.x < w.bridge.x1 ? Math.min(1, speed * 0.07) : 0);
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
    for (const z of this.horde) {
      this.g.scene.remove(z.view.object);
      z.view.dispose();
    }
    for (const sv of this.riders) {
      this.car.group.remove(sv.object);
      sv.dispose();
    }
    this.g.scene.remove(this.car.group);
    this.g.bridge?.setFall(1);
  }
}

// ---------------------------------------------------------------- the take-off
// The plane is warm and somebody has taken it up: it runs down the runway, lifts, and the airfield and the dead on
// it fall away behind. Three shots in TAKEOFF_TIME seconds, then the end screen.
const ROTATE_AT = 5.4; // s: the wheels leave the ground
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
  }
  worldChanged() {}
  sync(t) {
    if (Math.abs(t - this.t) > 0.35) this.t = t;
  }
  update(dt, cam) {
    this.t += dt;
    if (this.pin !== undefined) this.t = this.pin; // (look-dev)
    const t = Math.min(this.t, TAKEOFF_TIME);
    const p = this.plane.group;
    const car = this.g.world.car;
    // down the runway (north: -Z), faster and faster; then up
    const run = 0.5 * 5.2 * Math.min(t, ROTATE_AT) ** 2 + Math.max(0, t - ROTATE_AT) * 5.2 * ROTATE_AT;
    const air = Math.max(0, t - ROTATE_AT);
    const climb = 1.4 * air * air + 2.2 * air;
    p.position.set(this.home.x, this.home.y + climb, this.home.z - run);
    p.rotation.set(Math.min(0.2, air * 0.13), car.ry, Math.sin(t * 1.9) * 0.012 * Math.min(1, air));
    this.spin += dt * 46;
    for (const pr of this.plane.props) pr.rotation.z = this.spin;
    if (t < 3.6) {
      // off the wing tip as it starts to roll
      cam.position.set(this.home.x + 13, this.home.y + 1.6, this.home.z - 9 - t * 1.5);
      _look.set(p.position.x, p.position.y + 1.8, p.position.z - 2);
      this.fov = 42;
    } else if (t < 7.2) {
      // on the runway ahead of it, low: it comes at the camera and goes over it
      cam.position.set(this.home.x + 4.5, this.home.y + 0.6, this.home.z - 128);
      _look.set(p.position.x, p.position.y + 1.6, p.position.z);
      this.fov = 36;
    } else {
      // from behind and above: the runway, the airfield and the mainland going away under it
      cam.position.set(p.position.x + 9, p.position.y + 5.5, p.position.z + 21);
      _look.set(p.position.x, p.position.y + 1, p.position.z - 30);
      this.fov = 50;
    }
    cam.lookAt(_look);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    if (this.loop) {
      this.loop.setPosition(p.position.x, p.position.y + 2, p.position.z);
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
  }
}
