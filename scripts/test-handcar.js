// The handcars on the railway, against the real server in-process (shared/handcar.js, server/handcar.js):
//  - every valley has one or two, each standing on open line that a car and its rider can run the length of
//    without anything solid in the way, beside the depot's platform and off the Route 9 crossing
//  - [E] on a car seats a survivor on it, one to a car; W works the lever towards where they look and the car
//    runs faster than a sprint, Shift faster still on stamina, S brakes it, left alone it coasts to a stop, and
//    it stops at the end of its stretch of line (the train, a tunnel mouth)
//  - while the lever is worked the weapon does nothing, coasting it fires
//  - Space (and [E], which the client sends as Space) takes the rider off over the side with the car's speed, and
//    the car rolls on without them; a blow knocks them off; the dead on the line are knocked out of its way
//  - two cars on one stretch run into each other and part
//  - a rider on a laggy link: the client's prediction of every command is the server's result, and the server
//    only rebases it when it gets on
// usage: node scripts/test-handcar.js [seed] (VERBOSE=1: the numbers behind each check)
import { Game } from '../server/game.js';
import { C2S, S2C, ACT, SNAP, ENT, HCAR_AT, PROTOCOL_VERSION, Writer, Reader, qangle16, qpitch, writeInput } from '../shared/protocol.js';
import { BTN, SERVER_TICK_RATE, SPRINT_SPEED, STAMINA_MAX } from '../shared/constants.js';
import { ITEM, ZTYPE, ZONE } from '../shared/defs.js';
import { HANDCAR, handcars, linePoint, carFrame } from '../shared/handcar.js';
import { readSnapshot, readHeader, readGlobal, readSelf, readEntities, readEvents } from '../client/net/decode.js';
import { Connection } from '../client/net/connection.js';
import { Prediction } from '../client/game/prediction.js';
import { createWorld } from '../shared/world.js';
import { createPlayerState, copyPlayerState } from '../shared/playersim.js';
import { groundAt, resolveBody } from '../shared/collision.js';

const seed = +(process.argv[2] || 1);
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info !== '' ? `: ${info}` : ''}`);
  if (!ok) fails.push(name);
};
const f1 = (v) => v.toFixed(1);
const SEC = SERVER_TICK_RATE;
const EPS = 1e-4;
const AT = 3; // a car's entity record: where it is on the line (HCF.AT), who rides it (HCF.RIDER)
const RIDER = 4;

// ================================================================ where they stand
{
  let counts = [0, 0, 0];
  let blocked = [];
  let platform = 0;
  let crossing = 0;
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 12, 13];
  const P = { x: 0, y: 0, z: 0, tx: 0, tz: 1, len: 1, slope: 0 };
  for (const sd of seeds) {
    const world = createWorld(sd);
    const cars = handcars(world);
    counts[Math.min(2, cars.length)]++;
    const m = world.rail.main;
    // the whole stretch: a car's width at its deck and a rider's body over it, all the way along
    for (const c of cars) {
      for (let f = c.lo; f <= c.hi; f += 0.5) {
        linePoint(m, f, P);
        for (const [r, y0, h, at] of [[HANDCAR.halfW, 0.35, 0.4, [-HANDCAR.half + HANDCAR.halfW, 0, HANDCAR.half - HANDCAR.halfW]], [0.35, HANDCAR.deck, 1.8, [-HANDCAR.stand]]]) {
          for (const off of at) {
            const pos = { x: P.x + P.tx * off, y: P.y + y0, z: P.z + P.tz * off };
            const x0 = pos.x;
            const z0 = pos.z;
            resolveBody(world, pos, r, h, true);
            if (Math.hypot(pos.x - x0, pos.z - z0) > 0.02) blocked.push(`seed ${sd} car ${cars.indexOf(c) + 1} at ${f1(f)} (${f1(Math.hypot(pos.x - x0, pos.z - z0))} m)`);
          }
        }
      }
    }
    // the depot's car beside its platform, the other off the Route 9 crossing
    const d = world.zoneById[ZONE.STATION];
    if (d && cars[0] && Math.hypot(carFrame(m, cars[0].at, {}).x - d.x, carFrame(m, cars[0].at, {}).z - d.z) < 20) platform++;
    const hwy = world.rail.crossings.find((c) => c.kind === 2);
    if (hwy && cars.some((c) => Math.abs(c.at - hwy.i) < 12)) crossing++;
  }
  check('every valley has one or two handcars', counts[0] === 0, `${counts[1]} with one, ${counts[2]} with two, of ${seeds.length}`);
  check('nothing solid stands in the way of a car or its rider anywhere on its stretch of line', blocked.length === 0, blocked.slice(0, 4).join('; '));
  check('a car stands beside the depot platform, and one off the Route 9 crossing', platform === seeds.length && crossing >= seeds.length - 2, `${platform} at the depot, ${crossing} at the crossing, of ${seeds.length}`);
}

function newGame(opts = {}) {
  const game = new Game({ seed, godMode: true, dayLength: 36000, themes: false, log: () => {}, ...opts });
  game.debugCommands = true;
  return game;
}

// a client that takes what the server sends as the real one does, and plays without predicting
function client(game, name) {
  const c = { name, id: 0, net: { tick: 0, ack: 0 }, global: null, self: {}, store: { ents: new Map(), onCreate() {}, onRemove() {}, onUpdate() {} }, seq: 0, sounds: [] };
  const nop = () => {};
  c.handler = new Proxy({}, { get: (t, k) => t[k] || nop });
  c.conn = {
    send(bytes) {
      const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
      const t = r.u8();
      if (t === S2C.WELCOME) c.id = r.u16();
      else if (t === S2C.SNAPSHOT) {
        readSnapshot(r, c);
        if (r.left) throw new Error(`${name}: ${r.left} trailing snapshot bytes`);
      }
    },
  };
  c.session = game.onOpen(c.conn);
  const w = new Writer(64);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str(name);
  game.onMessage(c.session, w.bytes().slice());
  c.p = () => game.players.get(c.id);
  c.act = (act, v) => {
    const w2 = new Writer(16);
    w2.u8(C2S.ACTION);
    w2.u8(act);
    if (v !== undefined) w2.u8(v);
    game.onMessage(c.session, w2.bytes().slice());
  };
  c.chat = (text) => {
    const w2 = new Writer(64);
    w2.u8(C2S.CHAT);
    w2.str(text);
    game.onMessage(c.session, w2.bytes().slice());
  };
  c.input = (buttons = 0, yaw = 0, pitch = 0) => {
    const w2 = new Writer(64);
    w2.u8(C2S.INPUT);
    w2.u16(game.tick & 0xffff);
    w2.u8(0);
    const cmds = [];
    for (let i = 0; i < 3; i++) {
      c.seq = (c.seq + 1) & 0xffff;
      cmds.push({ seq: c.seq, buttons, qyaw: qangle16(yaw), qpitch: qpitch(pitch), slot: 255 });
    }
    writeInput(w2, cmds);
    game.onMessage(c.session, w2.bytes().slice());
  };
  c.car = (id) => c.store.ents.get(id);
  return c;
}

const put = (game, p, x, z) => {
  const s = p.state;
  s.ride = 0;
  s.cart = 0;
  s.x = x;
  s.z = z;
  s.y = groundAt(game.world, x, z, 200, 0.3);
  s.vx = s.vy = s.vz = 0;
  s.onGround = 1;
};
const yawAlong = (tx, tz) => Math.atan2(-tx, -tz); // the view yaw that looks along (tx, tz)

// ================================================================ riding one
{
  const game = newGame();
  const A = client(game, 'Ann');
  const B = client(game, 'Ben');
  for (const z of [...game.zombies]) game.removeEntity(z);
  game.zombies.length = 0;
  game.zm.maintainT = 1e9; // (nothing wanders in while this runs)
  const a = A.p();
  const b = B.p();
  const s = a.state;
  const world = game.world;
  const m = world.rail.main;
  const cars = game.handcars.cars;
  const runs = handcars(world);
  const run = runs[0];
  const car = cars[0];
  const P = { x: 0, y: 0, z: 0, tx: 0, tz: 1, len: 1, slope: 0 };
  const F = { x: 0, y: 0, z: 0, yaw: 0 };
  check('the game puts its handcars on the line', cars.length === runs.length && cars.length > 0 && cars.every((e) => e && e.v === 0 && !e.rider), `${cars.length} cars`);
  let ab = 0;
  let bb = 0;
  const run1 = (ticks, fn) => {
    for (let i = 0; i < ticks; i++) {
      const [btn, yaw] = fn ? fn(i) : [ab, s.yaw];
      A.input(btn, yaw);
      B.input(bb, b.state.yaw);
      game.update();
    }
  };
  // Ann beside the car, looking at it; Ben further off
  carFrame(m, car.s, F);
  linePoint(m, car.s, P);
  put(game, a, F.x + P.tz * 2.2, F.z - P.tx * 2.2);
  s.yaw = Math.atan2(-(F.x - s.x), -(F.z - s.z));
  put(game, b, F.x + P.tz * 9, F.z - P.tx * 9);
  run1(3);
  B.act(ACT.HANDCAR, 0);
  run1(3);
  check('a car out of reach cannot be got onto', b.state.cart === 0 && !car.rider);
  A.act(ACT.HANDCAR, 0);
  run1(3);
  check('[E] beside a car puts a survivor on its deck, behind the lever', s.cart === 1 && car.rider === a.id && Math.abs(s.y - (P.y + HANDCAR.deck)) < 0.05 && A.self.cart === 1, `on car ${s.cart}, ${(s.y - P.y).toFixed(2)} m over the bed`);
  check('...and everybody sees who is on it', B.car(car.id)?.q[RIDER] === a.id);
  put(game, b, F.x + P.tz * 2.2, F.z - P.tx * 2.2);
  b.state.yaw = Math.atan2(-(F.x - b.state.x), -(F.z - b.state.z));
  run1(2);
  B.act(ACT.HANDCAR, 0);
  run1(3);
  check('one survivor to a car', b.state.cart === 0 && car.rider === a.id);
  put(game, b, game.world.car.x, game.world.car.z);
  // ---- the lever: towards where they look along the line (away from the other car, if it is on this stretch)
  const mate = cars.find((e, k) => k > 0 && e && runs[k].run === run.run);
  const dir = mate ? Math.sign(car.s - mate.s) : car.s - run.lo > run.hi - car.s ? -1 : 1;
  const look = () => {
    linePoint(m, s.cartS, P);
    return yawAlong(P.tx * dir, P.tz * dir);
  };
  const s0 = car.s;
  let fastest = 0;
  run1(6 * SEC, () => [BTN.FWD, look()]);
  fastest = Math.abs(s.cartV);
  check('W works the lever, and the car runs faster than a sprint the way they look', fastest > SPRINT_SPEED + 1 && Math.sign(s.cartV) === dir && Math.abs(car.s - s0) > 30 && s.cart === 1, `${f1(fastest)} m/s after 6 s (a sprint is ${SPRINT_SPEED}), ${f1(Math.abs(car.s - s0))} m down the line`);
  check('...with the rider on the deck all the way, and the car on the wire with them', Math.abs(s.y - (linePoint(m, s.cartS - HANDCAR.stand, P).y + HANDCAR.deck)) < EPS && Math.abs(B.car(car.id).q[AT] / HCAR_AT - car.s) < (Math.abs(car.v) * 2) / SEC + 0.05); // (far off, it is sent every other tick)
  const st0 = s.stamina;
  run1(3 * SEC, () => [BTN.FWD | BTN.SPRINT, look()]);
  check('Shift works it hard: faster still, on stamina', Math.abs(s.cartV) > fastest + 1.5 && s.stamina < st0 - 30, `${f1(Math.abs(s.cartV))} m/s, stamina ${Math.round(st0)} -> ${Math.round(s.stamina)} of ${STAMINA_MAX}`);
  // ---- no shooting with both hands on the lever; coasting, yes
  s.weapons[1] = ITEM.PISTOL;
  s.mags[1] = 12;
  s.slot = 1;
  s.switchT = 0;
  const fc = s.fireCount;
  run1(SEC, (i) => [BTN.FWD | (i % 4 < 2 ? BTN.ATTACK : 0), look()]);
  const firedPumping = s.fireCount !== fc;
  const fc2 = s.fireCount;
  run1(SEC, (i) => [i % 4 < 2 ? BTN.ATTACK : 0, look()]);
  check('the weapon does nothing while the lever is worked, and fires again coasting', !firedPumping && s.fireCount !== fc2, `${(s.fireCount - fc2 + 256) % 256} shots coasting`);
  // ---- left alone it coasts, slowing
  const v0 = Math.abs(s.cartV);
  const c0 = car.s;
  run1(4 * SEC, () => [0, look()]);
  const v1 = Math.abs(s.cartV);
  check('left alone, it coasts on and slows', v1 < v0 - 1 && v1 > 3 && Math.abs(car.s - c0) > 15, `${f1(v0)} -> ${f1(v1)} m/s over ${f1(Math.abs(car.s - c0))} m in 4 s`);
  run1(SEC, () => [BTN.BACK, look()]);
  check('S brakes it', Math.abs(s.cartV) < v1 - 3, `${f1(v1)} -> ${f1(Math.abs(s.cartV))} m/s in 1 s`);
  // ---- to the end of the stretch
  let ends = 0;
  for (let i = 0; i < 90 * SEC && s.cart === 1; i++) {
    run1(1, () => [BTN.FWD, look()]);
    if (car.s <= run.lo + 1e-6 || car.s >= run.hi - 1e-6) ends++;
    if (ends > SEC) break;
  }
  const end = dir > 0 ? run.hi : run.lo;
  check(`it stops at the end of its stretch (${dir > 0 ? 'the high end' : 'the low end'}), and stays there however hard it is worked`, Math.abs(car.s - end) < 1e-6 && s.cartV === 0 && s.cart === 1, `${f1(car.s)} of ${f1(run.lo)}..${f1(run.hi)}`);
  // ---- back up to speed, then off over the side
  run1(4 * SEC, () => [BTN.BACK, look()]);
  const vOff = s.cartV;
  linePoint(m, s.cartS, P);
  const side = yawAlong(P.tz, -P.tx); // looking to the right of the line
  run1(1, () => [BTN.JUMP, side]);
  const onAir = s.cart === 0 && s.vy > 0;
  const along = s.vx * P.tx + s.vz * P.tz;
  run1(2 * SEC, () => [0, side]);
  const lat = (s.x - F.x) * P.tz - (s.z - F.z) * P.tx;
  void lat;
  carFrame(m, car.s, F);
  const away = (s.x - F.x) * P.tz - (s.z - F.z) * P.tx;
  check('Space takes the rider off over the side they look to, with the speed the car had', onAir && Math.abs(along - vOff) < 0.5 && away > 1 && s.onGround === 1 && !car.rider, `${f1(Math.abs(vOff))} m/s along the line as they leave, landed ${f1(away)} m to that side`);
  const cs = car.s;
  run1(2 * SEC);
  const rolled = Math.abs(car.s - cs);
  for (let i = 0; i < 60 * SEC && car.v !== 0; i++) game.update();
  check('...and the car rolls on without them until it stops', rolled > 2 && car.v === 0, `${f1(rolled)} m in the next 2 s, then stood after ${f1(Math.abs(car.s - cs))} m`);
  // ---- a blow knocks the rider off
  carFrame(m, car.s, F);
  linePoint(m, car.s, P);
  put(game, a, F.x + P.tz * 2, F.z - P.tx * 2);
  s.yaw = Math.atan2(-(F.x - s.x), -(F.z - s.z));
  run1(2);
  A.act(ACT.HANDCAR, 0);
  run1(2);
  const on = s.cart === 1;
  game.zm.knock(a, s.x + 1, s.z, 8, 4, 0.3);
  run1(4);
  check('a blow that knocks a survivor off their feet knocks them off the car', on && s.cart === 0 && !car.rider);
  // ---- the dead on the line
  put(game, a, F.x + P.tz * 2, F.z - P.tx * 2);
  s.yaw = Math.atan2(-(F.x - s.x), -(F.z - s.z));
  run1(2);
  A.act(ACT.HANDCAR, 0);
  run1(2);
  const way = car.s - run.lo > run.hi - car.s ? -1 : 1;
  const lookW = () => {
    linePoint(m, s.cartS, P);
    return yawAlong(P.tx * way, P.tz * way);
  };
  run1(5 * SEC, () => [BTN.FWD, lookW()]);
  linePoint(m, car.s + way * 25, P);
  const z = game.zm.spawn(ZTYPE.WALKER, P.x, P.z, { horde: true });
  z.x = P.x;
  z.z = P.z;
  z.y = P.y;
  const hp0 = z.hp;
  const v2 = Math.abs(s.cartV);
  let struck = -1;
  for (let i = 0; i < 6 * SEC && struck < 0; i++) {
    run1(1, () => [BTN.FWD, lookW()]);
    if (z.hp < hp0 || z.dead) struck = i;
  }
  run1(SEC, () => [BTN.FWD, lookW()]);
  linePoint(m, car.s, P);
  const zLat = Math.abs((z.x - P.x) * P.tz - (z.z - P.z) * P.tx);
  check('a walker on the line is knocked out of the way of a car at speed', struck >= 0 && (z.dead || zLat > HANDCAR.halfW) && s.cart === 1, `${f1(v2)} m/s, ${z.dead ? 'killed' : `${Math.round(hp0 - z.hp)} damage, knocked ${f1(zLat)} m off the middle of the line`}`);
  game.removeEntity(z);
  game.zombies.length = 0;
  run1(SEC, () => [BTN.JUMP, side]);
  run1(SEC);

  // ---- two cars on one stretch
  const other = cars.findIndex((e, k) => k > 0 && e && runs[k].run === runs[0].run);
  if (other > 0) {
    const c2 = cars[other];
    for (let i = 0; i < 60 * SEC && car.v !== 0; i++) game.update();
    // Ann on car 1, driven at car 2 standing still
    carFrame(m, car.s, F);
    linePoint(m, car.s, P);
    put(game, a, F.x + P.tz * 2, F.z - P.tx * 2);
    s.yaw = Math.atan2(-(F.x - s.x), -(F.z - s.z));
    run1(2);
    A.act(ACT.HANDCAR, 0);
    run1(2);
    const to = Math.sign(c2.s - car.s);
    const lookC = () => {
      linePoint(m, s.cartS, P);
      return yawAlong(P.tx * to, P.tz * to);
    };
    let met = -1;
    let closest = Infinity;
    let vHit = 0;
    for (let i = 0; i < 120 * SEC && met < 0; i++) {
      run1(1, () => [BTN.FWD, lookC()]);
      closest = Math.min(closest, Math.abs(c2.s - car.s));
      if (c2.v !== 0) {
        met = i;
        vHit = Math.abs(s.cartV);
      }
    }
    const pushed = Math.abs(c2.v);
    check('a car driven into another standing on its stretch hits it and sets it rolling, and they never overlap', met >= 0 && closest >= HANDCAR.half * 2 && pushed > 1 && Math.abs(s.cartS - car.s) < EPS, `${f1(pushed)} m/s into the one it hit, ${f1(vHit)} m/s left in its own, ${closest.toFixed(2)} m between their middles at the closest`);
    run1(SEC, () => [BTN.JUMP, side]);
  } else check('(this valley has no two cars on one stretch)', true);
}

// ================================================================ a rider on a laggy link
// The real Prediction and Connection against the server with every message LAG ms late each way (+ jitter), as
// scripts/test-fair.js does it: the rider gets on, works the lever up to speed, hard, coasts, brakes, looks about
// and jumps off.
function laggy(LAG, JIT) {
  let rs = 777;
  const rnd = () => ((rs = (Math.imul(rs, 1103515245) + 12345) | 0) >>> 0) / 4294967296;
  const game = newGame();
  let now = 0;
  const toClient = [];
  const toServer = [];
  const push = (q, bytes) => q.push([Math.max(now + LAG + rnd() * JIT, q.length ? q[q.length - 1][0] : 0), bytes]);
  const c = { net: { tick: 0, ack: 0 }, self: {}, global: null, ents: new Map(), id: 0, pred: null, rebases: 0 };
  const store = { ents: c.ents, onCreate() {}, onRemove() {}, onUpdate() {} };
  const handler = new Proxy({}, { get: () => () => {} });
  const session = game.onOpen({ send: (bytes) => push(toClient, bytes.slice()) });
  const conn = new Connection({});
  conn.open = true;
  conn.ws = { readyState: 1, send: (bytes) => push(toServer, bytes.slice()), close() {} };
  const w = new Writer(64);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str('laggy');
  game.onMessage(session, w.bytes().slice());
  const predAt = new Map();
  const onClientMessage = (buf) => {
    const r = new Reader(buf);
    const t = r.u8();
    if (t === S2C.WELCOME) {
      c.id = r.u16();
      c.pred = new Prediction(createWorld(r.u32()));
    } else if (t === S2C.SNAPSHOT) {
      const flags = readHeader(r, c.net);
      if (flags & SNAP.GLOBAL) c.global = readGlobal(r, c.global);
      const sync = readSelf(r, c.self, flags);
      readEntities(r, store, c.net.tick, flags);
      if (sync) {
        c.rebases++;
        c.pred.reconcile(c.net.ack, c.self);
        predAt.clear();
      } else c.pred.confirm(c.net.ack);
      readEvents(r, handler, flags, c.ents);
      if (r.left) throw new Error(`${r.left} trailing bytes in a snapshot`);
    }
  };
  const rtt = Math.ceil(((2 * LAG + JIT) / 1000) * SEC);
  const window = 2 * rtt + 4;
  const WHEN = { board: 3 * SEC, jump: 30 * SEC, end: 34 * SEC };
  const P = { x: 0, y: 0, z: 0, tx: 0, tz: 1, len: 1, slope: 0 };
  let frame = 0;
  let checks = 0;
  let late = 0;
  let lateRebases = 0;
  let rodeAt = -1;
  let offAt = -1;
  let top = 0;
  let placed = false;
  let dir = 1;
  for (let tick = 0; tick < WHEN.end; tick++) {
    const p = game.players.get(c.id);
    if (game.zombies.length) {
      for (const z of [...game.zombies]) game.removeEntity(z);
      game.zombies.length = 0;
    }
    for (let fr = 0; fr < 60 / SEC; fr++) {
      now = (frame * 1000) / 60;
      while (toClient.length && toClient[0][0] <= now) onClientMessage(toClient.shift()[1]);
      while (toServer.length && toServer[0][0] <= now) game.onMessage(session, toServer.shift()[1]);
      if (c.pred && c.pred.hasServerState) {
        const ps = c.pred.state;
        const riding = !!ps.cart;
        // works the lever along the line, hard for a stretch, coasts, brakes, looks about a little, and jumps
        const t = tick / SEC;
        let buttons = 0;
        if (riding) buttons = t < 12 ? BTN.FWD : t < 16 ? BTN.FWD | BTN.SPRINT : t < 22 ? 0 : t < 24 ? BTN.BACK : BTN.FWD;
        if (tick >= WHEN.jump && tick < WHEN.jump + 2) buttons = BTN.JUMP;
        let yaw = frame * 0.01;
        if (riding) {
          linePoint(c.pred.world.rail.main, ps.cartS, P);
          yaw = yawAlong(P.tx * dir, P.tz * dir) + Math.sin(frame / 50) * 0.6;
        }
        const before = c.pred.seq;
        c.pred.step(1 / 60, buttons, yaw, 0, () => {});
        if (c.pred.seq !== before) predAt.set(c.pred.seq, copyPlayerState(createPlayerState(), c.pred.state));
        for (let out; (out = c.pred.takeOutbox(1 / 60)); ) conn.sendInput(c.net.tick - 2, 0, out, c.pred.hash(out));
        if (riding && rodeAt < 0) rodeAt = tick;
        if (!riding && rodeAt >= 0 && offAt < 0) offAt = tick;
        top = Math.max(top, Math.abs(ps.cartV));
      }
      frame++;
    }
    if (!p) {
      game.update();
      continue;
    }
    if (!placed && game.handcars.cars[0]) {
      placed = true;
      const car = game.handcars.cars[0];
      const runs = handcars(game.world);
      const run = runs[0];
      // (away from the other car, if it is on this stretch: running into it is something the client cannot know)
      const mate = game.handcars.cars.find((e, k) => k > 0 && e && runs[k].run === run.run);
      dir = mate ? Math.sign(car.s - mate.s) : car.s - run.lo > run.hi - car.s ? -1 : 1;
      const F = carFrame(game.world.rail.main, car.s, {});
      linePoint(game.world.rail.main, car.s, P);
      put(game, p, F.x + P.tz * 2, F.z - P.tx * 2);
    }
    if (tick === WHEN.board) conn.action(ACT.HANDCAR, 0);
    const rebasesBefore = c.rebases;
    const seqBefore = p.lastSeq;
    game.update();
    const settled = tick > 2 * SEC && (tick < WHEN.board || tick > WHEN.board + window) && (tick < WHEN.jump || tick > WHEN.jump + window);
    if (settled && c.rebases !== rebasesBefore) lateRebases++;
    const mine = p.lastSeq !== seqBefore && predAt.get(p.lastSeq);
    if (mine) {
      checks++;
      const s = p.state;
      const err = Math.max(Math.abs(mine.x - s.x), Math.abs(mine.y - s.y), Math.abs(mine.z - s.z), Math.abs(mine.cartS - s.cartS), Math.abs(mine.cartV - s.cartV), Math.abs(mine.cart - s.cart), Math.abs(mine.stamina - s.stamina));
      if (err > 1e-9 && settled) {
        late++;
        if (process.env.VERBOSE) console.log(`  tick ${tick} (${(tick / SEC).toFixed(2)} s) seq ${p.lastSeq}: server`, JSON.stringify({ x: s.x, y: s.y, z: s.z, cart: s.cart, cartS: s.cartS, cartV: s.cartV, st: s.stamina, vx: s.vx, og: s.onGround }), 'client', JSON.stringify({ x: mine.x, y: mine.y, z: mine.z, cart: mine.cart, cartS: mine.cartS, cartV: mine.cartV, st: mine.stamina, vx: mine.vx, og: mine.onGround }));
      }
    }
    for (const k of predAt.keys()) if (((p.lastSeq - k) & 0xffff) < 0x8000) predAt.delete(k);
  }
  const p = game.players.get(c.id);
  const ok = late === 0 && lateRebases === 0 && checks > WHEN.end / 3 && rodeAt > 0 && offAt >= WHEN.jump && offAt <= WHEN.jump + 3 && p.state.cart === 0 && top > SPRINT_SPEED;
  check(`a rider at ${LAG} ms each way (+${JIT} jitter): the prediction is the server's result, and it only rebases as they get on`, ok, `${checks} commands checked, ${late} disagreed, ${lateRebases} late rebases of ${c.rebases}, top speed ${f1(top)} m/s; Space takes them off ${offAt - WHEN.jump} ticks later`);
}
laggy(0, 0);
laggy(100, 30);
laggy(250, 120);

console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(' | ')}` : '\nall handcar checks passed');
process.exit(fails.length ? 1 : 0);
