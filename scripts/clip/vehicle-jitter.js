// Is a vehicle's motion smooth on screen? Runs the code that draws it - the shared simulation through the client's
// prediction, VehicleClient's pose and seat-eye view, the rider's body - on a stepped clock at 30, 60 and 144 frames a
// second and on an uneven clock with hitches, for keyboard steering (a turn held, taps, a weave) at a crawl and at
// speed, and for a rider who knows the road on a real route. And the same vehicle as another player draws it: the
// records the server sends twenty times a second (quantized as the wire has them), interpolated a tenth of a second
// in the past, its pose from what the record says of its speed and steering. No browser.
//
// Per frame it keeps the drawn yaw, lean, steering and position of the vehicle; the first-person camera's yaw, roll and
// place; the watcher's vehicle yaw, lean, steering, place and the rider's head. On each:
//   jump    the biggest change from one frame to the next (deg, or mm), per second of frame time: what it would be
//           over a second at that pace
//   pop     a frame step over 2.5 x both of its neighbours (deg or mm): something was put there, it did not go there
//   shake   accelerations that flip sign three times running (a wobble), per second, and the size of the biggest
//           (deg or mm, the smallest of its three, x dt^2)
// A turn that is smooth has none of either; its jump is only its speed of turning.
//
// usage: node scripts/clip/vehicle-jitter.js [--veh bike,moped,car] [--fps 30,60,144,uneven] [--only name] [--json]
import '../lib/headless-dom.js';
import { worldFor } from '../../shared/worlds.js';
import { ZONE_NAMES } from '../../shared/defs.js';
import { BTN, CMD_DT, SERVER_TICK_RATE, INTERP_DELAY } from '../../shared/constants.js';
import { COL, groundAt } from '../../shared/collision.js';
import { qpos, dqpos, qangle16, dqangle16, usePos } from '../../shared/protocol.js';
import { VEH, VEHICLES, vehicleGrid, questCar } from '../../shared/vehicles.js';
import { createPlayerState, copyPlayerState, simulatePlayer } from '../../shared/playersim.js';
import { Prediction } from '../../client/game/prediction.js';
import { VehicleClient, seatBody } from '../../client/game/vehicles.js';
import { createSurvivor } from '../../client/render/models/characters.js';
import * as THREE from 'three';
import { clearance, flood, makePilot } from '../vehicle-routes.js';

const KIND = { bike: VEH.BIKE, moped: VEH.MOPED, car: VEH.CAR };
export const JITTER_RATES = [30, 60, 144, 'uneven'];
const D = 180 / Math.PI;
const wrap = (a) => {
  a %= Math.PI * 2;
  return a > Math.PI ? a - Math.PI * 2 : a < -Math.PI ? a + Math.PI * 2 : a;
};

let _world = null;
function world() {
  if (_world) return _world;
  _world = worldFor(1337, 2);
  usePos(_world);
  vehicleGrid(_world);
  questCar(_world);
  return _world;
}
function runway(w) {
  const r = w.runway;
  let best = null, run = 0, from = 0;
  for (let z = r.z1 - 8; z >= r.z0 + 8; z -= 4) {
    const clear = !w.staticGrid.query(r.x, z, 8, []).some((q) => !(q.flags & COL.NOBLOCK) && q.y1 > w.heightAt(q.x, q.z) + 0.3);
    if (clear) {
      if (!run) from = z;
      run += 4;
      if (!best || run > best[1]) best = [from, run];
    } else run = 0;
  }
  return [r.x, best[0] - 6];
}

// frame lengths (s): steady, or uneven - a frame of 16 +- 4 ms, and every half a second one of 45 ms
function clock(fps, seconds) {
  const out = [];
  let t = 0, k = 0;
  let rs = 99;
  const rnd = () => ((rs = (Math.imul(rs, 1103515245) + 12345) | 0) >>> 0) / 4294967296;
  while (t < seconds) {
    const dt = fps === 'uneven' ? (k % 30 === 29 ? 0.045 : 0.0125 + rnd() * 0.008) : 1 / fps;
    out.push(dt);
    t += dt;
    k++;
  }
  return out;
}

// The scenarios: what is held at time t (s), given the predicted state. 'pilot' rides a real route.
const SCEN = {
  'hold-slow': { secs: 5, keys: (t, sp) => (t < 1.2 ? (sp < 4 ? BTN.FWD : 0) : (sp < 4 ? BTN.FWD : 0) | BTN.RIGHT) },
  'hold-fast': { secs: 7, keys: (t) => BTN.FWD | BTN.SPRINT | (t > 4 && t < 5.6 ? BTN.RIGHT : 0) },
  'tap-fast': { secs: 7.5, keys: (t) => BTN.FWD | BTN.SPRINT | (t > 4 && (t * 1000) % 250 < 80 ? BTN.RIGHT : 0) },
  weave: { secs: 7.5, keys: (t) => BTN.FWD | BTN.SPRINT | (t > 3.5 ? (Math.floor(t / 0.45) % 2 ? BTN.LEFT : BTN.RIGHT) : 0) },
  pilot: { secs: 12, pilot: true },
};
const MEASURE_FROM = { 'hold-slow': 1, 'hold-fast': 3.6, 'tap-fast': 3.6, weave: 3.2, pilot: 1 };

// a fake of the bits of Game that VehicleClient's pose and view touch
function fakeGame(w) {
  return {
    world: w,
    scene: { add() {}, remove() {} },
    camera: { position: new THREE.Vector3() },
    viewDist: 1e9,
    input: { yaw: 0, pitch: 0 },
    time: 0,
    eyeH: 1.6,
    debugCam: null,
    cine: null,
    selfBody: null,
    prediction: null,
  };
}

export function runOne(name, vkName, fps) {
  const sc = SCEN[name];
  const vk = KIND[vkName];
  const P = VEHICLES[vk];
  const w = world();
  // where it sets out
  let x0, z0, yaw0 = 0, pilot = null;
  if (sc.pilot) {
    const cl = (world._cl ||= clearance(w));
    const zn = w.zones.find((q) => ZONE_NAMES[q.id] === 'Port Calder');
    const raw = flood(w, cl, w.start.x, w.start.z, vk === VEH.CAR ? 1.1 : 0.75, vk).path(zn.x, zn.z);
    pilot = makePilot(w, vk, raw.slice(40), cl, 1);
    [x0, z0] = pilot.path[0];
    yaw0 = pilot.yaw0;
  } else [x0, z0] = runway(w);
  const mk = () => {
    const s = createPlayerState();
    s.drive = 1;
    s.driveK = vk;
    s.x = x0;
    s.z = z0;
    s.y = groundAt(w, x0, z0, 200, 0.25, false);
    s.dyaw = yaw0;
    s.dfuel = P.tank || 0;
    s.onGround = 1;
    return s;
  };
  // the driver's client
  const pred = new Prediction(w);
  pred.hasServerState = true;
  copyPlayerState(pred.state, mk());
  copyPlayerState(pred.prev, pred.state);
  const g = fakeGame(w);
  g.prediction = pred;
  const vc = new VehicleClient(g);
  // (VehicleClient.attach wants the game's audio: the entity's view is put together here as attach does it)
  const attach = (id) => {
    const e = { id, vk, tint: 2, rx: x0, ry: pred.state.y, rz: z0, q: new Int32Array(9) };
    e.veh = { model: new VC_MODEL(vk, 2), x: x0, y: pred.state.y, z: z0, yaw: yaw0, vf: 0, steer: 0, roll: 0, pitch: 0, lean: 0, tilt: 0, dy: 0, vy: 0, acc: 0, lastVf: 0, col: null, loop: null, state: 1, seats: [1, 0, 0, 0], skidT: 0, smokeT: 0, idle: 0 };
    vc.pose(e, 0, x0, e.ry, z0, yaw0, 0, 0, true);
    return e;
  };
  const mine = attach(1);
  vc.mine = mine;
  vc.myK = 0;
  vc.mountK = 1;
  vc.lastYaw = yaw0;
  g.input.yaw = yaw0;
  g.input.pitch = P.two ? -0.2 : -0.04;
  const sv = createSurvivor(3);
  g.selfBody = sv;
  sv.setHide(2);
  const pose = {};
  // the server, and what it sends
  const srv = mk();
  const recs = []; // per tick: { t, x, y, z, yaw, q4 }
  let cmdN = 0;
  // the watcher's client
  const other = attach(2);
  const sv2 = createSurvivor(4);
  const pose2 = {};
  const samples = [];
  const series = {};
  const put = (k, v) => (series[k] ||= []).push(v);
  const dts = clock(fps, sc.secs);
  let t = 0, clientTick = 0;
  const rp = { x: 0, y: 0, z: 0 };
  const head = new THREE.Vector3();
  for (const dt of dts) {
    t += dt;
    g.time = t;
    const s = pred.state;
    const sp = Math.hypot(s.vx, s.vz);
    let keys;
    if (pilot) {
      const st = pilot.step({ x: s.x, z: s.z, yaw: s.dyaw, vx: s.vx, vz: s.vz, steer: s.dsteer });
      keys = (st.thr > 0 ? BTN.FWD : st.thr < 0 ? BTN.BACK : 0) | (st.turn > 0 ? BTN.RIGHT : st.turn < 0 ? BTN.LEFT : 0) | (vk === VEH.BIKE ? BTN.SPRINT : 0);
    } else keys = sc.keys(t, sp);
    const before = pred.pending.length;
    const n = pred.step(dt, keys, g.input.yaw, g.input.pitch, () => {});
    // the same commands, on the server
    const cmds = pred.pending.slice(pred.pending.length - n);
    void before;
    for (const c of cmds) {
      simulatePlayer(srv, c, w, null);
      if (++cmdN % (60 / SERVER_TICK_RATE) === 0) {
        const vf = -srv.vx * Math.sin(srv.dyaw) - srv.vz * Math.cos(srv.dyaw);
        const spq = Math.max(-126, Math.min(126, Math.round(vf * 2) * 2));
        const stq = Math.max(-124, Math.min(124, Math.round(srv.dsteer * 25) * 4));
        recs.push({ t: cmdN / (60 / SERVER_TICK_RATE), x: dqpos(qpos(srv.x)), y: dqpos(qpos(srv.y)), z: dqpos(qpos(srv.z)), yaw: wrap(dqangle16(qangle16(srv.dyaw))), sp: spq / 4, st: stq / 100 });
      }
    }
    pred.takeOutbox(dt, true);
    // ---- the driver's own view (VehicleClient.update, for ours)
    pred.renderPos(dt, rp);
    const a = pred.alpha, p0 = pred.prev;
    const yaw = p0.drive ? p0.dyaw + wrap(s.dyaw - p0.dyaw) * a : s.dyaw;
    const steer = p0.drive ? p0.dsteer + (s.dsteer - p0.dsteer) * a : s.dsteer;
    const vfOf = (q) => -q.vx * Math.sin(q.dyaw) - q.vz * Math.cos(q.dyaw);
    const vf = process.env.LEGACY || !p0.drive ? vfOf(s) : vfOf(p0) + (vfOf(s) - vfOf(p0)) * a; // (as game/vehicles.js update)
    vc.pose(mine, dt, rp.x, rp.y, rp.z, yaw, vf, steer, false);
    sv.object.position.set(rp.x, rp.y, rp.z);
    sv.object.rotation.set(0, g.input.yaw, 0);
    const ride = seatBody(mine.veh.model, vk, 0, sv, pose);
    sv.update(dt, { sit: true, sitNow: 1, reach: ride.reach, feet: ride.feet, sitT: ride.sitT, sitK: ride.sitK, sitSplay: ride.sitSplay, sitLean: ride.sitLean, sitTwist: ride.sitTwist, speed: 0, pitch: 0, onGround: true, dead: false, time: t });
    vc.view(dt, rp, mine, s);
    const m = mine.veh.model;
    put('yaw', m.group.rotation.y);
    put('lean', m.body.rotation.z);
    put('steer', mine.veh.steer);
    put('pos', [m.group.position.x, m.group.position.y, m.group.position.z]);
    put('camYaw', g.input.yaw);
    put('camRoll', vc.eye.roll);
    put('camPos', [vc.eye.x, vc.eye.y, vc.eye.z]);
    // ---- the watcher's: records a tick old by the time they come, drawn INTERP_DELAY in the past
    clientTick += dt * SERVER_TICK_RATE;
    while (samples.length < recs.length && recs[samples.length].t <= clientTick - 1) samples.push(recs[samples.length]);
    if (samples.length >= 2) {
      const rt = clientTick - INTERP_DELAY * SERVER_TICK_RATE - 1;
      let i = samples.length - 2;
      while (i > 0 && samples[i].t > rt) i--;
      const A = samples[i], B = samples[i + 1];
      const f = Math.max(0, Math.min(1, (rt - A.t) / (B.t - A.t)));
      const ox = A.x + (B.x - A.x) * f, oy = A.y + (B.y - A.y) * f, oz = A.z + (B.z - A.z) * f;
      const oyaw = A.yaw + wrap(B.yaw - A.yaw) * f;
      const last = samples[samples.length - 1];
      // (as game/vehicles.js does: the steering interpolated with the place - LEGACY=1: as it was, the newest record's)
      const st = process.env.LEGACY ? last.st : A.st + (B.st - A.st) * f;
      if (process.env.LEGACY) vc.pose(other, dt, ox, oy, oz, oyaw, last.sp, st, false);
      else vc.pose(other, dt, ox, oy, oz, oyaw, last.sp, st, false, true);
      sv2.object.position.set(ox, oy, oz);
      sv2.object.rotation.set(0, oyaw, 0);
      const r2 = seatBody(other.veh.model, vk, 0, sv2, pose2);
      sv2.update(dt, { sit: true, sitNow: 1, reach: r2.reach, feet: r2.feet, sitT: r2.sitT, sitK: r2.sitK, sitSplay: r2.sitSplay, sitLean: r2.sitLean, speed: 0, pitch: 0, onGround: true, dead: false, time: t });
      const om = other.veh.model;
      sv2.headWorld(head);
      put('oYaw', om.group.rotation.y);
      put('oLean', om.body.rotation.z);
      put('oSteer', other.veh.steer);
      put('oPos', [om.group.position.x, om.group.position.y, om.group.position.z]);
      put('oHead', [head.x, head.y, head.z]);
    } else {
      for (const k of ['oYaw', 'oLean', 'oSteer']) put(k, NaN);
      for (const k of ['oPos', 'oHead']) put(k, [NaN, NaN, NaN]);
    }
    put('dt', dt);
  }
  return analyse(series, MEASURE_FROM[name] || 0);
}

// jump / pop / shake of each signal, from `from` seconds on
function analyse(series, from) {
  const dts = series.dt;
  let t0 = 0, i0 = 0;
  while (i0 < dts.length && t0 < from) t0 += dts[i0++];
  const out = {};
  for (const k of Object.keys(series)) {
    if (k === 'dt') continue;
    const raw = series[k].slice(i0);
    const vec = Array.isArray(raw[0]);
    const ang = !vec;
    // a frame's step: an angle's (deg, wrapped) or a point's (mm, length - a shake is on each axis)
    const steps = [];
    for (let i = 1; i < raw.length; i++) {
      if (vec) steps.push([0, 1, 2].map((a) => (raw[i][a] - raw[i - 1][a]) * 1000 || 0));
      else steps.push([Number.isFinite(raw[i]) && Number.isFinite(raw[i - 1]) ? wrap(raw[i] - raw[i - 1]) * D : NaN]);
    }
    const dt = dts.slice(i0 + 1);
    let jump = 0, pop = 0, flips = 0, shake = 0;
    const axes = steps[0]?.length || 1;
    for (let i = 0; i < steps.length; i++) {
      const mag = Math.hypot(...steps[i]);
      if (Number.isFinite(mag)) jump = Math.max(jump, mag / dt[i]);
      if (i > 0 && i < steps.length - 1) {
        // (by speed, not step: a long frame's step is long)
        const a = Math.hypot(...steps[i - 1]) * (dt[i] / dt[i - 1]), c = Math.hypot(...steps[i + 1]) * (dt[i] / dt[i + 1]);
        if (mag > 2.5 * Math.max(a, c) && mag > (ang ? 0.05 : 2)) {
          if (mag > pop && process.env.POPTRACE === k) console.log('POP', k, i, 'steps', a.toFixed(1), mag.toFixed(1), c.toFixed(1), 'dt', dt[i - 1], dt[i], dt[i + 1]);
          pop = Math.max(pop, mag);
        }
      }
    }
    // accelerations (per axis): sign flipping three times running
    for (let ax = 0; ax < axes; ax++) {
      const acc = [];
      for (let i = 1; i < steps.length; i++) acc.push(steps[i][ax] / dt[i] - steps[i - 1][ax] / dt[i - 1] || 0);
      const eps = ang ? 0.5 : 20; // deg/s or mm/s of change in a frame below which it is nothing
      for (let i = 2; i < acc.length; i++) {
        const [p, q, r] = [acc[i - 2], acc[i - 1], acc[i]];
        if (Math.abs(p) > eps && Math.abs(q) > eps && Math.abs(r) > eps && Math.sign(p) !== Math.sign(q) && Math.sign(q) !== Math.sign(r)) {
          flips++;
          shake = Math.max(shake, Math.min(Math.abs(p), Math.abs(q), Math.abs(r)) * dt[i]); // (a change of speed, x the frame: deg or mm)
        }
      }
    }
    const secs = dt.reduce((s, x) => s + x, 0) || 1;
    out[k] = { jump, pop, shake, flips: flips / secs, unit: ang ? 'deg' : 'mm' };
  }
  return out;
}

import { VehicleModel as VC_MODEL } from '../../client/render/models/vehicles.js';

// the worst of every run
export function survey({ vehs = ['bike', 'moped', 'car'], rates = JITTER_RATES, only = null } = {}) {
  const rows = [];
  for (const v of vehs) {
    for (const name of Object.keys(SCEN)) {
      if (only && !only.includes(name)) continue;
      for (const fps of rates) rows.push({ veh: v, name, fps, r: runOne(name, v, fps) });
    }
  }
  return rows;
}

const SIGS = [['steer', 'lean', 'yaw', 'pos', 'camYaw', 'camRoll', 'camPos'], ['oSteer', 'oLean', 'oYaw', 'oPos', 'oHead']];
export function worstBy(rows, veh) {
  const w = {};
  for (const row of rows) {
    if (veh && row.veh !== veh) continue;
    for (const [k, v] of Object.entries(row.r)) {
      const o = (w[k] ||= { jump: 0, pop: 0, shake: 0, flips: 0, unit: v.unit, at: '' });
      if (v.shake > o.shake) (o.shake = v.shake), (o.at = `${row.name}@${row.fps}`);
      o.flips = Math.max(o.flips, v.flips);
      o.pop = Math.max(o.pop, v.pop);
      o.jump = Math.max(o.jump, v.jump);
    }
  }
  return w;
}

if (process.argv[1] && process.argv[1].endsWith('vehicle-jitter.js')) {
  const arg = (k, d) => {
    const i = process.argv.indexOf(`--${k}`);
    return i > 0 ? process.argv[i + 1] : d;
  };
  const vehs = arg('veh', 'bike,moped,car').split(',');
  const rates = arg('fps', '30,60,144,uneven').split(',').map((x) => (x === 'uneven' ? x : +x));
  const only = arg('only', null)?.split(',') || null;
  const t0 = Date.now();
  const rows = survey({ vehs, rates, only });
  if (process.argv.includes('--json')) console.log(JSON.stringify(rows));
  for (const v of vehs) {
    const w = worstBy(rows, v);
    console.log(`\n${v} (worst over ${Object.keys(SCEN).filter((n) => !only || only.includes(n)).join(', ')} at ${rates.join(', ')} fps)`);
    console.log('signal     shake (per s, worst)        pop        jump/s        worst shake at');
    for (const k of [...SIGS[0], ...SIGS[1]]) {
      const o = w[k];
      if (!o) continue;
      console.log(`${k.padEnd(9)} ${o.flips.toFixed(1).padStart(6)}/s ${o.shake.toFixed(2).padStart(8)} ${o.unit}  ${o.pop.toFixed(2).padStart(7)} ${o.unit}  ${o.jump.toFixed(0).padStart(7)} ${o.unit}/s   ${o.at}`);
    }
  }
  console.log(`\n(${Math.round((Date.now() - t0) / 1000)} s)`);
}

// (one row a run: node scripts/clip/vehicle-jitter.js --rows --veh bike --fps 60)
if (process.argv.includes('--rows')) {
  const arg = (k, d) => {
    const i = process.argv.indexOf(`--${k}`);
    return i > 0 ? process.argv[i + 1] : d;
  };
  const rows = survey({ vehs: arg('veh', 'bike').split(','), rates: arg('fps', '60').split(',').map((x) => (x === 'uneven' ? x : +x)) });
  const ks = (arg('sig', 'steer,lean,camRoll,camPos,oSteer,oLean,oHead')).split(',');
  console.log('run'.padEnd(26) + ks.map((k) => k.padStart(16)).join(''));
  for (const r of rows) console.log(`${r.veh} ${r.name}@${r.fps}`.padEnd(26) + ks.map((k) => `${r.r[k].flips.toFixed(1)}/s ${r.r[k].shake.toFixed(2)}`.padStart(16)).join(''));
}
