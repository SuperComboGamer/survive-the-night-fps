// What vehicles cost the server and the wire (docs/performance.md), in node alone: the real server in-process on the
// mainland with eight survivors and a night's dead about them.
//   - a tick with everybody on foot, then with all eight driving (eight vehicles round a ring), then with two cars
//     full of them: mean, p99, worst, and what of it is the vehicles' own (Vehicles.update)
//   - the bytes a second a watcher is sent for one vehicle driven past them (near: every tick; far: every other),
//     and for one standing: nothing
// usage: node scripts/vehicle-bench.js [seed] [--json]
import { C2S, S2C, ACT, VACT, PROTOCOL_VERSION, Writer } from '../shared/protocol.js';
import { BTN, SERVER_TICK_RATE } from '../shared/constants.js';
import { ZTYPE } from '../shared/defs.js';
import { VEH, VSTATE, VEHICLES } from '../shared/vehicles.js';
import { groundAt } from '../shared/collision.js';
import { mainlandGame } from './vehicle-seats.js';

const seed = +(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 1337);
const SEC = SERVER_TICK_RATE;
const N = 8;
const { game, cs } = mainlandGame(seed, N);
const V = game.vehicles;
const w = game.world;
const r = w.runway;
const mid = [r.x, (r.z0 + r.z1) / 2 - 40];
// (what each client is sent: counted)
for (const c of cs) {
  c.bytes = 0;
  const send = c.conn.send;
  c.conn.send = (b) => {
    if (b[0] === S2C.SNAPSHOT) c.bytes += b.length;
    send(b);
  };
}
const put = (p, x, z) => {
  const s = p.state;
  V.drop(p);
  s.x = x;
  s.z = z;
  s.y = groundAt(w, x, z, 200, 0.3);
  s.vx = s.vy = s.vz = 0;
  game.fillHistory(p);
};
const dead = (n) => {
  for (const z of [...game.zombies]) game.removeEntity(z);
  game.zombies.length = 0;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    game.zm.spawn(i % 5 === 0 ? ZTYPE.RUNNER : ZTYPE.WALKER, mid[0] + Math.sin(a) * (60 + (i % 7) * 6), mid[1] + Math.cos(a) * (60 + (i % 7) * 6), { horde: true });
  }
};
const measure = (ticks, input) => {
  const ms = [];
  let veh = 0;
  const upd = V.update.bind(V);
  V.update = () => {
    const t = performance.now();
    upd();
    veh += performance.now() - t;
  };
  for (let i = 0; i < ticks; i++) {
    cs.forEach((c, k) => {
      const [b, yaw] = input(k, i);
      c.input(b, yaw);
    });
    const t = performance.now();
    game.update();
    ms.push(performance.now() - t);
  }
  V.update = upd;
  ms.sort((a, b) => a - b);
  return { mean: ms.reduce((a, b) => a + b, 0) / ms.length, p99: ms[Math.floor(ms.length * 0.99)], worst: ms[ms.length - 1], vehicles: veh / ticks };
};
const out = {};
// ---- on foot: eight survivors walking a ring, 100 of the dead after them
cs.forEach((c, k) => put(c.p(), mid[0] + (k - 3.5) * 2, mid[1]));
dead(100);
for (let i = 0; i < 2 * SEC; i++) measure(1, () => [0, 0]); // (warm)
out.foot = measure(30 * SEC, (k, i) => [BTN.FWD, i * 0.02 + k]);
// ---- everybody driving: four cars and four mopeds round the same ground
const vs = [];
cs.forEach((c, k) => {
  const vk = k % 2 ? VEH.MOPED : VEH.CAR;
  const P = VEHICLES[vk];
  const e = V.make(vk, mid[0] + ((k >> 1) - 1.5) * 5, mid[1] + (k % 2 ? 8 : -8), 0, { state: VSTATE.OK, need: 0, fuel: P.tank, hp: P.hp });
  vs.push(e);
  put(c.p(), e.x - P.halfW - 0.8, e.z);
});
measure(2, () => [0, 0]);
cs.forEach((c, k) => c.act(ACT.VEHICLE, VACT.ENTER, vs[k].id));
measure(3, () => [0, 0]);
dead(100);
out.driving = measure(30 * SEC, (k, i) => [BTN.FWD | ((i >> 5) % 3 === 0 ? BTN.LEFT : (i >> 5) % 3 === 1 ? BTN.RIGHT : 0), 0]);
out.inSeats = cs.filter((c) => c.p().state.drive).length;
for (const e of vs) for (const P of [VEHICLES[e.vk]]) (e.hp = P.hp), (e.state = VSTATE.OK);
// ---- the wire: one vehicle driven past a watcher who stands still, the dead put away
for (const z of [...game.zombies]) game.removeEntity(z);
game.zombies.length = 0;
for (const c of cs) V.drop(c.p());
for (const e of [...V.list]) if (vs.includes(e)) {
  V.unpark(e);
  game.removeEntity(e);
}
const watch = cs[0];
const wire = (vk, far) => {
  const P = VEHICLES[vk];
  cs.forEach((c, k) => put(c.p(), mid[0] + 300 + k * 3, mid[1] + 200)); // (everybody else out of the way, and still)
  put(watch.p(), mid[0] + (far ? 70 : 12), mid[1]);
  const e = V.make(vk, mid[0], mid[1] + 60, 0, { state: VSTATE.OK, need: 0, fuel: P.tank, hp: P.hp });
  const d = cs[1];
  put(d.p(), e.x - P.halfW - 0.8, e.z);
  for (let i = 0; i < 4; i++) {
    cs.forEach((c) => c.input(0, 0));
    game.update();
  }
  // standing: what a parked one costs
  let b0 = watch.bytes;
  for (let i = 0; i < 5 * SEC; i++) {
    cs.forEach((c) => c.input(0, 0));
    game.update();
  }
  const still = (watch.bytes - b0) / 5;
  d.act(ACT.VEHICLE, VACT.ENTER, e.id);
  for (let i = 0; i < 4; i++) {
    cs.forEach((c) => c.input(0, 0));
    game.update();
  }
  // driven: up and down past the watcher, weaving
  b0 = watch.bytes;
  const T = 12;
  for (let i = 0; i < T * SEC; i++) {
    cs.forEach((c) => c.input(c === d ? BTN.FWD | ((i >> 4) % 4 === 0 ? BTN.LEFT : (i >> 4) % 4 === 2 ? BTN.RIGHT : 0) : 0, 0));
    game.update();
  }
  const moving = (watch.bytes - b0) / T;
  V.drop(d.p());
  V.unpark(e);
  game.removeEntity(e);
  // the driver's own body is a player moving through the watcher's view either way: on foot it costs this
  put(d.p(), mid[0], mid[1] + 60);
  b0 = watch.bytes;
  for (let i = 0; i < T * SEC; i++) {
    cs.forEach((c) => c.input(c === d ? BTN.FWD | BTN.SPRINT : 0, 0));
    game.update();
  }
  const walker = (watch.bytes - b0) / T;
  return { still, moving, walker };
};
out.wire = {};
for (const [name, vk] of [['car', VEH.CAR], ['moped', VEH.MOPED], ['bicycle', VEH.BIKE]]) {
  out.wire[name] = { near: wire(vk, false), far: wire(vk, true) };
}
if (process.argv.includes('--json')) console.log(JSON.stringify(out));
else {
  const f = (v) => v.toFixed(3);
  console.log(`seed ${seed}, the mainland, ${N} survivors, 100 of the dead after them (ms a tick; the budget is 50)`);
  console.log(`  everybody on foot           mean ${f(out.foot.mean)}  p99 ${f(out.foot.p99)}  worst ${f(out.foot.worst)}   (vehicles' own share: ${f(out.foot.vehicles)})`);
  console.log(`  all ${out.inSeats} driving (4 cars, 4 mopeds) mean ${f(out.driving.mean)}  p99 ${f(out.driving.p99)}  worst ${f(out.driving.worst)}   (vehicles' own share: ${f(out.driving.vehicles)})`);
  console.log('what a watcher is sent, snapshot bytes a second (an empty snapshot each tick is in all of them):');
  for (const [name, r2] of Object.entries(out.wire)) {
    for (const d of ['near', 'far']) {
      const x = r2[d];
      console.log(`  a ${name.padEnd(7)} ${d === 'near' ? '12 m off' : '70 m off'}: standing ${x.still.toFixed(0)} B/s, driven past ${x.moving.toFixed(0)} B/s (its driver sprinting past on foot instead: ${x.walker.toFixed(0)} B/s)  ->  ${(x.moving - x.still).toFixed(0)} B/s for a moving vehicle and its driver, ${(x.moving - x.walker).toFixed(0)} B/s more than a runner`);
    }
  }
}
void C2S;
void PROTOCOL_VERSION;
void Writer;
