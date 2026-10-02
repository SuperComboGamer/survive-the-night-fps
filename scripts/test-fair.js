// The Tri-County Fair, against the real server in-process (shared/fair.js, server/fair.js):
//  - the place is on the map with its generator, its drum and both rides, and the seats are where a survivor can
//    get at them
//  - the generator: it takes a portion of Flamethrower Fuel from the backpack of whoever starts it, the drum takes
//    more up to a full tank, it runs dry, and holding [E] again shuts it off with what is left still in it
//  - while it runs it is a noise the idle dead come to from NOISE.FAIR metres, and its light holds a Shade
//  - the rides: a seat carries its rider round, a rider can jump out (the game's fall damage), a blow or a rope
//    takes them off, a wheel that stops leaves them where they are, and the dead in a seat go round with it
//  - a rider on a laggy link: the client's prediction of every command is the server's result, and the server
//    only rebases it when it gets on, when the generator starts or stops and when it gets off
// usage: node scripts/test-fair.js [seed] (VERBOSE=1: the numbers behind each check)
import { Game } from '../server/game.js';
import { C2S, S2C, ACT, SNAP, ENT, HOLD, FAIR_GEN_ID, FAIR_TANK_ID, PROTOCOL_VERSION, Writer, Reader, playerRide, qangle16, qpitch, writeInput } from '../shared/protocol.js';
import { BTN, SERVER_TICK_RATE, CMD_RATE, NOISE, PHASE, PLAYER_MAX_HP, INTERACT_REACH } from '../shared/constants.js';
import { ITEM, NOTIFY, ZONE, ZTYPE, ZANIM } from '../shared/defs.js';
import { WHEEL, CAROUSEL, GEN, RIDE_SEATS, seatPos, seatRise, seatLow } from '../shared/fair.js';
import { readSnapshot, readHeader, readGlobal, readSelf, readEntities, readEvents } from '../client/net/decode.js';
import { Connection } from '../client/net/connection.js';
import { Prediction } from '../client/game/prediction.js';
import { createWorld } from '../shared/world.js';
import { createPlayerState, copyPlayerState } from '../shared/playersim.js';
import { groundAt } from '../shared/collision.js';

const seed = +(process.argv[2] || 4242);
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info !== '' ? `: ${info}` : ''}`);
  if (!ok) fails.push(name);
};
const f1 = (v) => v.toFixed(1);
const TICK = 1 / SERVER_TICK_RATE;
const EPS = 1e-4; // (a state the server has just sent is rounded to what went on the wire)

function newGame(opts = {}) {
  const game = new Game({ seed, godMode: true, dayLength: 36000, themes: false, log: () => {}, ...opts });
  game.debugCommands = true;
  return game;
}

// a client that takes what the server sends as the real one does, and plays without predicting
function client(game, name) {
  const c = { name, id: 0, net: { tick: 0, ack: 0 }, global: null, self: {}, store: { ents: new Map(), onCreate() {}, onRemove() {}, onUpdate() {} }, notes: [], seq: 0 };
  const nop = () => {};
  c.handler = new Proxy({ notify: (m, a) => c.notes.push([m, a]) }, { get: (t, k) => t[k] || nop });
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
  c.act = (act, v, wide) => {
    const w2 = new Writer(16);
    w2.u8(C2S.ACTION);
    w2.u8(act);
    if (v !== undefined) wide ? w2.u16(v) : w2.u8(v);
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
    writeInput(w2, cmds); // (no fingerprint: this client gets the server's state every tick)
    game.onMessage(c.session, w2.bytes().slice());
  };
  c.noted = (msg) => c.notes.some(([m]) => m === msg);
  c.fair = () => [...c.store.ents.values()].find((e) => e.kind === ENT.FAIR);
  return c;
}

// the place's own frame -> the world
const at = (f, lx, lz) => [f.x + f.c * lx + f.s * lz, f.z - f.s * lx + f.c * lz];
const put = (game, p, x, z) => {
  const s = p.state;
  s.ride = 0;
  s.x = x;
  s.z = z;
  s.y = groundAt(game.world, x, z, 200, 0.3);
  s.vx = s.vy = s.vz = 0;
  s.onGround = 1;
};
const fuelOf = (p) => p.inv.reduce((n, x) => n + (x && x.item === ITEM.AMMO_FUEL ? x.count : 0), 0);
const give = (p, n) => {
  p.inv.fill(null);
  if (n) p.inv[0] = { item: ITEM.AMMO_FUEL, count: n };
  p.invDirty = true;
};

// ================================================================ the place
{
  const world = createWorld(seed);
  const f = world.fair;
  const zn = world.zoneById[ZONE.FAIR];
  check('the fair is on the map, with its generator and its drum', !!f && !!zn && !!f.gen && !!f.tank && f.lamps.length > 3 && f.strings.length > 5, f ? `${f.lamps.length} lamps, ${f.strings.length} strings of bulbs` : '');
  const top = { x: 0, y: 0, z: 0 };
  let high = -Infinity;
  let low = Infinity;
  for (let t = 0; t < WHEEL.period * CMD_RATE; t += 7) {
    seatPos(f, 0, t, top);
    high = Math.max(high, top.y - f.y);
    low = Math.min(low, top.y - f.y);
  }
  check('the wheel stands about 18 m tall and its gondolas come down to the platform', WHEEL.hub + WHEEL.r > 17 && WHEEL.hub + WHEEL.r < 19.5 && Math.abs(low - WHEEL.deck) < 0.15 && high > 14, `top of the rim ${f1(WHEEL.hub + WHEEL.r)} m, a rider's feet ${low.toFixed(2)} .. ${f1(high)} m`);
  // every seat keeps clear of the next one, and of the ground, all the way round
  const a = { x: 0, y: 0, z: 0 };
  const b = { x: 0, y: 0, z: 0 };
  let gap = Infinity;
  let under = Infinity;
  for (let t = 0; t < WHEEL.period * CMD_RATE; t += 11) {
    for (let seat = 0; seat < RIDE_SEATS; seat++) {
      seatPos(f, seat, t, a);
      under = Math.min(under, a.y - world.heightAt(a.x, a.z));
      const next = seat < WHEEL.n ? (seat + 1) % WHEEL.n : WHEEL.n + ((seat - WHEEL.n + 1) % CAROUSEL.n);
      seatPos(f, next, t, b);
      gap = Math.min(gap, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
    }
  }
  check('seats keep clear of one another and of the ground all the way round', gap > 2 && under > 0.2, `${gap.toFixed(2)} m between seats, ${under.toFixed(2)} m over the ground`);
  let boardable = 0;
  for (let seat = 0; seat < WHEEL.n; seat++) if (seatLow(f, seat, 0)) boardable++;
  check('at any moment a gondola or two is at the platform', boardable >= 1 && boardable <= 2, `${boardable} of ${WHEEL.n}, within ${seatRise(f, 0, 0).toFixed(2)} m of it at the bottom`);
}

// ================================================================ the dead get in everywhere a survivor can stand
// The valley's flow fields (server/nav.js) lead from the road outside the gate to a survivor at the generator, in a
// stall, on the carousel's deck and on the wheel's platform.
{
  const game = newGame();
  const f = game.world.fair;
  const [ox, oz] = at(f, 0, -45);
  const out = { x: 0, z: 0, cost: 0 };
  const spots = { 'the generator shed': [16.2, 9.6], 'a stall': [-8, -12.4], "the carousel's deck": [CAROUSEL.x + 3.8, CAROUSEL.z], "the wheel's platform": [WHEEL.x - 3, WHEEL.z - 0.8] };
  const bad = [];
  let worst = 0;
  for (const [name, [lx, lz]] of Object.entries(spots)) {
    const [x, z] = at(f, lx, lz);
    game.nav.computeField('fair', x, z);
    const ok = game.nav.flowDir('fair', ox, oz, out) && out.cost < 1e8;
    if (!ok) bad.push(name);
    else worst = Math.max(worst, out.cost / 10 / Math.hypot(x - ox, z - oz));
    game.nav.removeField('fair');
  }
  check('the dead find their way in to a survivor at the generator, in a stall, on the carousel and on the wheel\'s platform', !bad.length, bad.length ? `no way to ${bad.join(', ')}` : `the longest way round is ${worst.toFixed(2)} times the straight line`);
}

// ================================================================ the generator
{
  const game = newGame();
  const A = client(game, 'Ann');
  const B = client(game, 'Ben');
  const a = A.p();
  const f = game.world.fair;
  const fair = game.fair;
  const run = (ticks, fn) => {
    for (let i = 0; i < ticks; i++) {
      A.input(fn ? fn(i) : 0);
      B.input(0);
      game.update();
    }
  };
  run(3);
  check('the fair is in every client\'s view from the start, its generator off', !!A.fair() && A.fair().q[3] === 0 && !!B.fair());
  // at the generator, as near as the prompt is offered
  const [gx, gz] = at(f, 16.6, 10.1);
  put(game, a, gx, gz);
  run(2);
  give(a, 0);
  A.notes.length = 0;
  A.act(ACT.HOLD_BEGIN, FAIR_GEN_ID, true);
  run(2);
  check('a dry tank and no fuel in the backpack: no hold, and the survivor is told', !a.hold && A.noted(NOTIFY.NOT_ENOUGH) && !fair.running);
  give(a, GEN.portion + 5);
  A.act(ACT.HOLD_BEGIN, FAIR_GEN_ID, true);
  run(2);
  check('with a portion of fuel the hold starts', a.hold?.kind === HOLD.FAIR_START && A.self.holdKind === HOLD.FAIR_START);
  run(Math.ceil(GEN.hold * SERVER_TICK_RATE) - 6);
  const early = fair.running;
  run(8);
  check(`...and ${GEN.hold} s of it starts the generator on that portion`, !early && fair.running && fuelOf(a) === 5 && Math.abs(fair.fuel * TICK - GEN.burn) < 1 && A.noted(NOTIFY.FAIR_ON) && B.noted(NOTIFY.FAIR_ON), `${fuelOf(a)} fuel left in the backpack, ${f1(fair.fuel * TICK)} s in the tank`);
  // what a client makes of the entity: running, the ride clock, the fuel left
  const clockOf = (c) => {
    const q = c.fair().q;
    const v = q[4] | (q[5] << 8) | (q[6] << 16);
    return q[3] ? (c.net.tick - v) & 0xffffff : v;
  };
  const fuelLeft = (c) => {
    const q = c.fair().q;
    const v = q[7] | (q[8] << 8);
    return q[3] ? (v - c.net.tick) & 0xffff : v;
  };
  run(40);
  check('every client is told it runs, and reads the ride clock and the fuel off its ticks', B.fair().q[3] === 1 && clockOf(B) * 3 === fair.clock && fuelLeft(B) === fair.fuel, `clock ${clockOf(B)} ticks, ${f1(fuelLeft(B) * TICK)} s of fuel`);
  // topping up at the drum
  const [tx, tz] = at(f, 17.2, 8.2);
  put(game, a, tx, tz);
  run(2);
  give(a, GEN.portion * 6);
  const room = Math.floor((GEN.tank - fair.fuel * TICK) / GEN.burn); // whole portions the tank still takes
  for (let i = 0; i < 6; i++) {
    A.act(ACT.INTERACT, FAIR_TANK_ID, true);
    run(4);
  }
  const portions = 6 - fuelOf(a) / GEN.portion;
  check('the drum takes portions until the tank is full, and no more', portions === room && room === 3 && fair.fuel * TICK <= GEN.tank, `${portions} portions went in: ${f1(fair.fuel * TICK)} of ${GEN.tank} s`);
  check('...and the survivor is told when it is', A.noted(NOTIFY.FAIR_FULL));
  // shutting it off
  put(game, a, gx, gz);
  run(2);
  const clock0 = fair.clock;
  A.act(ACT.HOLD_BEGIN, FAIR_GEN_ID, true);
  run(2);
  const kind = a.hold?.kind;
  run(Math.ceil(GEN.hold * SERVER_TICK_RATE) + 2);
  const left = fair.fuel;
  check('holding [E] on a running generator shuts it off, with what is left still in the tank', kind === HOLD.FAIR_STOP && !fair.running && left > 0 && B.fair().q[3] === 0 && A.noted(NOTIFY.FAIR_OFF), `${f1(left * TICK)} s left`);
  run(40);
  check('...and the rides stand where they stopped', fair.clock > clock0 && fair.clock === clockOf(B) * 3 && fuelLeft(B) === left, `clock ${fair.clock} commands`);
  // started again on what is in the tank, and left to run dry
  give(a, 0);
  A.act(ACT.HOLD_BEGIN, FAIR_GEN_ID, true);
  run(Math.ceil(GEN.hold * SERVER_TICK_RATE) + 4);
  check('fuel left in the tank starts it without any in the backpack', fair.running);
  fair.fuel = 40; // (two seconds of it)
  fair.sync();
  B.notes.length = 0;
  run(60);
  check('a tank that runs dry stops it, and everyone is told', !fair.running && fair.fuel === 0 && B.noted(NOTIFY.FAIR_DRY) && B.fair().q[3] === 0);
  // out of reach: nothing
  const [ox, oz] = at(f, 10, 9);
  put(game, a, ox, oz);
  give(a, 100);
  run(2);
  A.act(ACT.HOLD_BEGIN, FAIR_GEN_ID, true);
  A.act(ACT.INTERACT, FAIR_TANK_ID, true);
  run(3);
  check('from outside the shed neither the generator nor the drum can be worked', !a.hold && fuelOf(a) === 100);

  // ---------------------------------------------------------------- the noise, and the light
  for (const z of [...game.zombies]) game.removeEntity(z);
  game.zombies.length = 0;
  const far = (d) => {
    // an idle walker d metres from the middle of the fair, the way the hills allow
    for (let k = 0; k < 64; k++) {
      const ang = (k / 64) * Math.PI * 2;
      const x = f.x + Math.sin(ang) * d;
      const z = f.z + Math.cos(ang) * d;
      if (Math.max(Math.abs(x), Math.abs(z)) > 300 || game.world.isDeepWater(x, z)) continue;
      // (not in another place's yard: put down among its buildings, a walker can be boxed in where it stands)
      if (game.world.zones.some((zn) => Math.hypot(zn.x - x, zn.z - z) < zn.flat + 4)) continue;
      const zb = game.zm.spawn(ZTYPE.WALKER, x, z);
      if (zb) {
        zb.x = x;
        zb.z = z;
        return zb;
      }
    }
    return null;
  };
  // (the survivors out of the way, so nothing has anybody to chase)
  for (const c of [A, B]) put(game, c.p(), game.world.car.x, game.world.car.z);
  const near = far(NOISE.FAIR - 30);
  const beyond = far(NOISE.FAIR + 25);
  for (const z of [near, beyond]) if (z) z.target = z.alertT = 0;
  run(GEN.noiseEvery * SERVER_TICK_RATE + 5);
  const quiet = (!near || near.alertT <= 0) && (!beyond || beyond.alertT <= 0);
  fair.start(null);
  const heard = [];
  for (let i = 0; i < GEN.noiseEvery * SERVER_TICK_RATE + 5; i++) {
    run(1);
    if (near && near.alertT > 0 && !heard.length) heard.push(Math.hypot(near.alertX - f.x, near.alertZ - f.z));
  }
  check(`a running fair is heard ${NOISE.FAIR} m off and no further, a silent one not at all`, quiet && !!near && heard.length > 0 && heard[0] < 8 && (!beyond || beyond.alertT <= 0 || beyond.target), near ? `a walker ${NOISE.FAIR - 30} m off heads for a spot ${heard.length ? f1(heard[0]) : '?'} m from the middle of the fair` : 'no room for a walker');
  // it keeps coming for as long as the music plays
  let kept = 0;
  let d0 = near ? Math.hypot(near.x - f.x, near.z - f.z) : 0;
  for (let i = 0; i < 20 * SERVER_TICK_RATE; i++) {
    run(1);
    if (near && !near.dead && near.alertT > 0) kept++;
  }
  const d1 = near && !near.dead ? Math.hypot(near.x - f.x, near.z - f.z) : d0;
  check('...and the dead that heard it keep walking to it while it plays', kept > 19 * SERVER_TICK_RATE && d1 < d0 - 8, `${f1(d0 - d1)} m nearer after 20 s`);
  // the light: a Shade on the midway at night
  game.phase = PHASE.NIGHT;
  const [mx, mz] = at(f, 0.5, -8);
  const shade = game.zm.spawn(ZTYPE.SHADE, mx, mz);
  shade.x = mx;
  shade.z = mz;
  shade.y = game.world.heightAt(mx, mz);
  const [wx, wz] = at(f, 60, 60);
  const dark = game.zm.spawn(ZTYPE.SHADE, wx, wz);
  dark.x = wx;
  dark.z = wz;
  const litOn = game.zm.isLit(shade);
  const litFar = game.zm.isLit(dark);
  fair.stop(null);
  const litOff = game.zm.isLit(shade);
  check('the lights of a running fair hold a Shade on the midway, and only there, and only while it runs', litOn && !litFar && !litOff);
  fair.start(null);
  run(4);
  const frozen = shade.anim === ZANIM.FROZEN;
  fair.stop(null);
  run(Math.ceil(0.4 * SERVER_TICK_RATE));
  check('...it stands frozen in them, and moves again when the generator dies', frozen && shade.anim !== ZANIM.FROZEN);
  game.phase = PHASE.DAY;
}

// ================================================================ the rides
{
  const game = newGame({ godMode: false });
  const A = client(game, 'Ann');
  const B = client(game, 'Ben');
  const a = A.p();
  const b = B.p();
  const s = a.state;
  const f = game.world.fair;
  const fair = game.fair;
  for (const z of [...game.zombies]) game.removeEntity(z);
  game.zombies.length = 0;
  game.zm.maintainT = 1e9; // (nothing wanders in while this runs)
  const seat = { x: 0, y: 0, z: 0 };
  let aBtn = 0;
  const run = (ticks, fn) => {
    for (let i = 0; i < ticks; i++) {
      A.input(fn ? fn(i) : aBtn);
      B.input(0);
      game.update();
    }
  };
  const lowest = () => {
    let best = 0;
    for (let k = 1; k < WHEEL.n; k++) if (seatRise(f, k, fair.clock) < seatRise(f, best, fair.clock)) best = k;
    return best;
  };
  // beside the platform, in front of the bottom of the wheel
  const stand = () => put(game, a, ...at(f, WHEEL.x + 0.3, WHEEL.z - 2.2));
  stand();
  put(game, b, ...at(f, WHEEL.x - 0.5, WHEEL.z - 2.4));
  run(3);
  const g0 = lowest();
  const top = (g0 + WHEEL.n / 2) % WHEEL.n;
  A.act(ACT.RIDE, top);
  run(4);
  check('a gondola up in the air cannot be got into', s.ride === 0, `${f1(seatRise(f, top, fair.clock))} m above the platform`);
  A.act(ACT.RIDE, g0);
  run(4);
  seatPos(f, g0, fair.clock, seat);
  check('[E] on the gondola at the platform seats a survivor in it', s.ride === g0 + 1 && Math.hypot(s.x - seat.x, s.y - seat.y, s.z - seat.z) < EPS && s.crouch === 1 && A.self.ride === g0 + 1);
  check('...and the rest of the team sees which seat', playerRide(B.store.ents.get(A.id).q[5]) === g0 + 1);
  B.act(ACT.RIDE, g0);
  run(4);
  check('a seat that is taken is taken', b.state.ride === 0);
  B.act(ACT.RIDE, WHEEL.n + 2);
  run(4);
  check('a horse on the far side of the fair is out of reach', b.state.ride === 0);
  // walking, crouching, sprinting: the seat keeps them
  run(20, () => BTN.FWD | BTN.SPRINT);
  check('nothing a rider presses but Space moves them out of the seat', s.ride === g0 + 1 && Math.hypot(s.x - seat.x, s.z - seat.z) < EPS);
  // the generator starts under them
  fair.start(null);
  const y0 = s.y;
  let off = 0;
  let peak = -Infinity;
  for (let i = 0; i < (WHEEL.period / 2) * SERVER_TICK_RATE; i++) {
    run(1);
    seatPos(f, g0, s.rideT, seat);
    off = Math.max(off, Math.hypot(s.x - seat.x, s.y - seat.y, s.z - seat.z), Math.abs(s.rideT - fair.clock) / CMD_RATE);
    peak = Math.max(peak, s.y);
  }
  check('the wheel carries its rider up: half a turn later they are at the top', s.ride === g0 + 1 && off < 0.2 && s.y - y0 > WHEEL.r * 2 - 0.3, `${f1(s.y - y0)} m up after ${WHEEL.period / 2} s, never more than ${off.toFixed(3)} off the seat or the wheel's clock (m, s)`);
  // the dead under the wheel cannot reach the top (Ben waits at the car, out of it)
  put(game, b, game.world.car.x, game.world.car.z);
  const hp0 = a.hp;
  const zs = [];
  for (let k = 0; k < 5; k++) {
    const [zx, zz] = at(f, WHEEL.x - 2 + k, WHEEL.z - 3);
    const z = game.zm.spawn(ZTYPE.WALKER, zx, zz, { horde: true });
    z.x = zx;
    z.z = zz;
    zs.push(z);
  }
  fair.stop(null);
  const yTop = s.y;
  run(8 * SERVER_TICK_RATE);
  check('a wheel that stops leaves its rider where they are, out of reach of the dead underneath', s.ride === g0 + 1 && Math.abs(s.y - yTop) < EPS && a.hp === hp0 && zs.every((z) => !z.dead), `${f1(s.y - f.y)} m up, ${zs.filter((z) => z.target === a.id).length} of ${zs.length} walkers after them, health ${Math.round(a.hp)}`);
  // ...and can at the bottom
  fair.start(null);
  let bit = -1;
  for (let i = 0; i < WHEEL.period * SERVER_TICK_RATE && bit < 0; i++) {
    run(1);
    if (a.hp < hp0) bit = seatRise(f, g0, s.rideT);
  }
  check('...and a rider coming past the ground is clawed at', bit >= 0 && bit < 3, bit >= 0 ? `first blood with the gondola ${f1(bit)} m above the platform` : 'never hurt in a whole turn');
  for (const z of zs) game.removeEntity(z);
  game.zombies.length = 0;
  // jumping out at the top
  a.hp = PLAYER_MAX_HP;
  a.downed = false;
  s.downed = 0;
  let turn = 0;
  while (seatRise(f, g0, s.rideT) < WHEEL.r * 2 - 0.5 && turn++ < WHEEL.period * SERVER_TICK_RATE) run(1);
  fair.stop(null);
  run(2);
  const drop = s.y - groundAt(game.world, s.x, s.z, s.y, 0.2);
  A.input(BTN.JUMP);
  B.input(0);
  game.update();
  const offNow = s.ride === 0;
  run(4 * SERVER_TICK_RATE);
  const v = Math.sqrt(2 * 16 * drop);
  check('Space gets a rider out wherever the gondola is: from the top that is the game\'s fall damage', offNow && s.onGround === 1 && Math.abs(PLAYER_MAX_HP - a.hp - (v - 13) * 6) < 6, `a ${f1(drop)} m drop cost ${Math.round(PLAYER_MAX_HP - a.hp)} health`);
  // a blow takes a rider off, a rope too
  a.hp = PLAYER_MAX_HP;
  stand();
  run(4);
  A.act(ACT.RIDE, lowest());
  run(2);
  const rode = s.ride;
  game.zm.knock(a, s.x + 1, s.z, 8, 4, 0.3);
  run(2);
  const knocked = rode > 0 && s.ride === 0;
  run(2 * SERVER_TICK_RATE);
  stand();
  run(4);
  A.act(ACT.RIDE, lowest());
  run(2);
  const rode2 = s.ride;
  s.pulled = 1;
  s.pullX = s.x + 10;
  s.pullZ = s.z;
  s.pullY = s.y;
  run(2);
  check('a blow that knocks a survivor off their feet knocks them out of the seat, and a roper pulls them out', knocked && rode2 > 0 && s.ride === 0);
  s.pulled = 0;
  // the carousel
  run(SERVER_TICK_RATE);
  const h0 = WHEEL.n + 3;
  seatPos(f, h0, fair.clock, seat);
  put(game, a, seat.x + f.c * 1.2, seat.z - f.s * 1.2);
  run(2);
  A.act(ACT.RIDE, h0);
  run(2);
  fair.start(null);
  const from = { x: s.x, z: s.z };
  let swing = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < CAROUSEL.period * SERVER_TICK_RATE; i++) {
    run(1);
    swing = Math.max(swing, Math.hypot(s.x - from.x, s.z - from.z));
    lo = Math.min(lo, s.y);
    hi = Math.max(hi, s.y);
  }
  check('a carousel horse carries its rider round once in a turn, bobbing', s.ride === h0 + 1 && Math.abs(swing - CAROUSEL.r * 2) < 0.2 && Math.hypot(s.x - from.x, s.z - from.z) < 0.3 && Math.abs(hi - lo - CAROUSEL.bob * 2) < 0.05, `${f1(swing)} m across, ${(hi - lo).toFixed(2)} m of rise and fall, back where it started after ${CAROUSEL.period} s`);
  // shooting from the saddle
  s.weapons[1] = ITEM.PISTOL;
  s.mags[1] = 12;
  s.slot = 1;
  s.switchT = 0;
  run(4);
  const shots0 = s.fireCount;
  run(1, () => BTN.ATTACK);
  run(3);
  check('a rider can shoot', s.fireCount === (shots0 + 1) % 256 && s.mags[1] === 11 && s.ride === h0 + 1);
  // the link stalls: no commands for two seconds, and the horse goes on without them. The rider's reading of the
  // ride clock is kept within half a second of the ride's, so they are still on their horse when the commands return
  let behind = 0;
  for (let i = 0; i < 2 * SERVER_TICK_RATE; i++) {
    B.input(0);
    game.update();
    behind = Math.max(behind, (fair.clock - s.rideT) / CMD_RATE);
  }
  run(3);
  seatPos(f, h0, fair.clock, seat);
  check('a rider whose commands stop coming for 2 s is kept within half a second of their horse', behind > 0.4 && behind <= 0.55 && Math.abs(s.rideT - fair.clock) <= CMD_RATE / 2 && Math.hypot(s.x - seat.x, s.z - seat.z) < 1.3, `${behind.toFixed(2)} s behind at the most, ${((fair.clock - s.rideT) / CMD_RATE).toFixed(2)} s once they come again`);
  // the dead stay in the saddle
  game.killPlayer(a, { kind: 3 });
  const dead = { x: s.x, z: s.z };
  run(2 * SERVER_TICK_RATE);
  seatPos(f, h0, fair.clock, seat);
  check('a rider who dies stays slumped in the seat and goes round with it', !a.alive && s.ride === h0 + 1 && Math.hypot(s.x - seat.x, s.z - seat.z) < EPS && Math.hypot(s.x - dead.x, s.z - dead.z) > 1);
  run(6 * SERVER_TICK_RATE);
  check('...until they rise somewhere else, and the seat is free again', a.alive && a.zombie && s.ride === 0 && !fair.rider(h0), `alive ${a.alive}, turned ${a.zombie}, seat ${s.ride}, phase ${game.phase}`);
}

// ================================================================ a rider on a laggy link
// The real Prediction and Connection against the server with every message LAG ms late each way (+ jitter), as
// scripts/test-netsync.js does it. The rider gets on the carousel (the faster ride), the generator is started and
// stopped under them, they look around and fire, and jump off.
function laggy(LAG, JIT) {
  let rs = 777;
  const rnd = () => ((rs = (Math.imul(rs, 1103515245) + 12345) | 0) >>> 0) / 4294967296;
  const game = newGame();
  const f = game.world.fair;
  const fair = game.fair;
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
  let jump = 0; // the furthest the smoothed view of our own position moved in one frame (m)
  const view = { x: 0, y: 0, z: 0 };
  const last = { x: 0, y: 0, z: 0 };
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
  const seat = { x: 0, y: 0, z: 0 };
  const h0 = WHEEL.n + 1;
  const SEC = SERVER_TICK_RATE;
  const rtt = Math.ceil(((2 * LAG + JIT) / 1000) * SERVER_TICK_RATE);
  const window = 2 * rtt + 4;
  // what happens when (ticks): each is something the client cannot predict, with a catch-up window after it
  const AT = { board: 3 * SEC, start: 6 * SEC, stop: 20 * SEC, restart: 24 * SEC, jump: 40 * SEC, end: 44 * SEC };
  const events = [AT.board, AT.start, AT.stop, AT.restart];
  let frame = 0;
  let checks = 0;
  let late = 0;
  let lateRebases = 0;
  let steady = 0; // the most the view moved in a frame while the ride turned steadily
  let fired = 0;
  let offAt = -1;
  let rodeAt = -1;
  let placed = false;
  for (let tick = 0; tick < AT.end; tick++) {
    const p = game.players.get(c.id);
    for (let fr = 0; fr < 60 / SERVER_TICK_RATE; fr++) {
      now = (frame * 1000) / 60;
      while (toClient.length && toClient[0][0] <= now) onClientMessage(toClient.shift()[1]);
      while (toServer.length && toServer[0][0] <= now) game.onMessage(session, toServer.shift()[1]);
      if (c.pred && c.pred.hasServerState) {
        const riding = !!c.pred.state.ride;
        // looks around, fires now and then, and presses Space at the end
        const buttons = (riding && frame % 90 === 0 ? BTN.ATTACK : 0) | (tick >= AT.jump && tick < AT.jump + 2 ? BTN.JUMP : 0);
        const before = c.pred.seq;
        c.pred.step(1 / 60, buttons, frame * 0.02, Math.sin(frame / 40) * 0.5, (evs) => {
          for (const ev of evs) if (ev.type === 'fire') fired++;
        });
        if (c.pred.seq !== before) predAt.set(c.pred.seq, copyPlayerState(createPlayerState(), c.pred.state));
        for (let out; (out = c.pred.takeOutbox(1 / 60)); ) conn.sendInput(c.net.tick - 2, 0, out, c.pred.hash(out));
        c.pred.renderPos(1 / 60, view);
        const d = Math.hypot(view.x - last.x, view.y - last.y, view.z - last.z);
        const settled = events.every((e) => tick < e || tick - e > window + 12);
        if (riding && settled && tick < AT.jump) steady = Math.max(steady, d);
        if (tick >= AT.board) jump = Math.max(jump, d);
        last.x = view.x;
        last.y = view.y;
        last.z = view.z;
        if (riding && rodeAt < 0) rodeAt = tick;
        if (!riding && rodeAt >= 0 && offAt < 0) offAt = tick;
      }
      frame++;
    }
    if (!p) {
      game.update();
      continue;
    }
    if (!placed) {
      placed = true;
      // on the deck beside the horse, with a pistol in hand
      seatPos(f, h0, 0, seat);
      put(game, p, seat.x + f.c * 1.1, seat.z - f.s * 1.1);
      p.state.weapons[1] = ITEM.PISTOL;
      p.state.mags[1] = 12;
      p.state.slot = 1;
    }
    if (tick === AT.board) conn.action(ACT.RIDE, h0);
    if (tick === AT.start || tick === AT.restart) fair.start(null);
    if (tick === AT.stop) fair.stop(null);
    const rebasesBefore = c.rebases;
    const seqBefore = p.lastSeq;
    game.update();
    const settled = tick > 2 * SEC && events.every((e) => tick < e || tick - e > window) && (tick < AT.jump || tick > AT.jump + window);
    if (settled && c.rebases !== rebasesBefore) lateRebases++;
    const mine = p.lastSeq !== seqBefore && predAt.get(p.lastSeq);
    if (mine) {
      checks++;
      const s = p.state;
      const err = Math.max(Math.abs(mine.x - s.x), Math.abs(mine.y - s.y), Math.abs(mine.z - s.z), Math.abs(mine.rideT - s.rideT), Math.abs(mine.ride - s.ride), Math.abs(mine.mags[1] - s.mags[1]));
      if (err > 1e-9 && settled) late++;
    }
    for (const k of predAt.keys()) if (((p.lastSeq - k) & 0xffff) < 0x8000) predAt.delete(k);
  }
  const p = game.players.get(c.id);
  const speed = ((2 * Math.PI * CAROUSEL.r) / CAROUSEL.period / 60) * 1.25; // a frame of the ride, and the bob on top
  const ok = late === 0 && lateRebases === 0 && checks > AT.end / 3 && rodeAt > 0 && offAt >= AT.jump && offAt <= AT.jump + 3 && p.state.ride === 0 && steady < speed && fired > 5;
  check(`a rider at ${LAG} ms each way (+${JIT} jitter): the prediction is the server's result, and it only rebases around the four things it cannot know`, ok, `${checks} commands checked, ${late} disagreed, ${lateRebases} late rebases of ${c.rebases}, ${fired} shots; turning steadily the view moves at most ${(steady * 100).toFixed(1)} cm a frame (the horse does ${(speed * 80).toFixed(1)}), ${(jump * 100).toFixed(0)} cm at the worst moment; Space takes them off ${offAt - AT.jump} ticks later`);
}
laggy(0, 0);
laggy(100, 30);
laggy(250, 120);

console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(' | ')}` : '\nall fair checks passed');
process.exit(fails.length ? 1 : 0);
