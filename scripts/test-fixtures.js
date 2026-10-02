// The chapel bell and the Relay Station's radio (shared/fixtures.js, server/fixtures.js, client/game/fixtures.js):
// in-process checks against real Games, with what the server sends decoded as a client does.
//   - world generation draws the rope, the bell and the radio where the rules say they are, on every map that has
//     the place, and a survivor can stand at them and reach them (and not through a wall);
//   - the bell: a 1.5 s hold, three tolls heard by everyone, each a noise that turns the idle dead and the wandering
//     herd inside 220 m towards the chapel and leaves the ones beyond alone, and 45 s before it rings again;
//   - the radio: 2 batteries and a 4 s hold call a supply plane whose crate lands where the caller stood, once a day
//     and by day only, and the prompt on the client says which of those is in the way.
// usage: node scripts/test-fixtures.js [seed with a Relay Station]
import { Game } from '../server/game.js';
import { createWorld } from '../shared/world.js';
import { C2S, S2C, ACT, HOLD, BELL_ID, RADIO_ID, ENT, PROTOCOL_VERSION, Writer, Reader, qangle16, qpitch, writeInput } from '../shared/protocol.js';
import { PHASE, NOISE, NOISE_RUSH, MAP_HALF, EYE_HEIGHT, PLANE_LEAD, PLANE_SPEED } from '../shared/constants.js';
import { ITEM, ZONE, ZTYPE, SOUND, NOTIFY } from '../shared/defs.js';
import { PROPS } from '../shared/props.js';
import { groundAt, resolveBody, canReach } from '../shared/collision.js';
import { fixtureSpots, placePoint, BELL_ROPE, RADIO_AT, BELL_HOLD_TIME, BELL_TOLLS, BELL_TOLL_GAP, BELL_COOLDOWN, RADIO_HOLD_TIME, RADIO_BATTERIES, RADIO_NO, FIXTURE_REACH } from '../shared/fixtures.js';
import { readSnapshot } from '../client/net/decode.js';
import { FixtureUI } from '../client/game/fixtures.js';

const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};
const near = (a, b, d) => Math.hypot(a.x - b.x, a.z - b.z) <= d;
const TICKS = 20; // per second

// ---------------------------------------------------------------- the world draws them where the rules have them
const SEEDS = [1, 2, 3, 7, 42, 1337, 4242, 12345];
let relaySeed = +process.argv[2] || 0;
let bareSeed = 0; // a valley without a Relay Station
{
  const wrong = [];
  let relays = 0;
  for (const seed of SEEDS) {
    const w = createWorld(seed);
    const f = fixtureSpots(w);
    const church = w.zoneById[ZONE.CHURCH];
    const relay = w.zoneById[ZONE.RELAY];
    // the rope is a part of the building, the bell and the radio set are props (their models: client/render/models/fixtures.js)
    const part = (mat, shape, p, r) => w.parts.find((q) => q.mat === mat && q.shape === shape && Math.hypot(q.x - p.x, q.z - p.z) <= r && Math.abs(q.y - p.y) <= q.sy / 2 + 0.02);
    const prop = (type, p, r) => w.props.find((q) => q.type === type && Math.hypot(q.x - p.x, q.z - p.z) <= r && p.y > q.y && p.y < q.y + PROPS[type].size[1]);
    if (!church || !f.bell) wrong.push(`${seed}: no chapel`);
    else {
      if (!part('rope', 'cyl', f.bell.rope, 0.01)) wrong.push(`${seed}: no rope drawn at BELL_ROPE`);
      if (!prop('church_bell', f.bell.bell, 0.01)) wrong.push(`${seed}: no bell hung at BELL_AT`);
      // a survivor a step inside the door has the rope at hand; one outside the front wall, as near to it, has not
      const inside = placePoint(church, [0.1, 0.12, -0.6]);
      const outside = placePoint(church, [BELL_ROPE[0], 0, -4.2]);
      const rope = f.bell.rope;
      if (!canReach(w, inside.x, inside.y + EYE_HEIGHT, inside.z, rope.x, rope.y, rope.z, inside.y + EYE_HEIGHT)) wrong.push(`${seed}: the rope cannot be reached from inside the door`);
      if (canReach(w, outside.x, outside.y + EYE_HEIGHT, outside.z, rope.x, rope.y, rope.z, outside.y + EYE_HEIGHT)) wrong.push(`${seed}: the rope can be reached through the front wall`);
      const body = { ...inside };
      resolveBody(w, body, 0.35, 1.8);
      if (!near(body, inside, 0.01)) wrong.push(`${seed}: something stands where the bell ringer does`);
    }
    if (!!relay !== !!f.radio) wrong.push(`${seed}: radio spot without a Relay Station, or the other way round`);
    if (relay) {
      relays++;
      if (!relaySeed) relaySeed = seed;
      if (!prop('radio_set', f.radio, 0.3)) wrong.push(`${seed}: no radio set at RADIO_AT`);
      // the operator's spot: free to stand on, the radio at hand, and nothing but sky over it (the crate comes down here)
      const stand = placePoint(relay, [RADIO_AT[0], 0, RADIO_AT[2] - 1.2]);
      const body = { ...stand };
      resolveBody(w, body, 0.35, 1.8);
      if (!near(body, stand, 0.01)) wrong.push(`${seed}: something stands where the radio operator does`);
      if (groundAt(w, stand.x, stand.z, 200, 0.6) > stand.y + 0.3) wrong.push(`${seed}: there is a roof over the radio operator`);
      if (!canReach(w, stand.x, stand.y + EYE_HEIGHT, stand.z, f.radio.x, f.radio.y, f.radio.z, stand.y + EYE_HEIGHT)) wrong.push(`${seed}: the radio cannot be reached from in front of it`);
    } else if (!bareSeed) bareSeed = seed;
  }
  // which places a seed draws moves whenever a place is added, so look further for a valley without the relay
  for (let seed = 1; !bareSeed && seed < 400; seed++) if (!createWorld(seed).zoneById[ZONE.RELAY]) bareSeed = seed;
  check('the rope, the bell and the radio are drawn where the rules have them, and can be stood at and reached', wrong.length === 0 && relays > 0, wrong.join(' ; ') || `${SEEDS.length} valleys, ${relays} with a Relay Station`);
}

// ---------------------------------------------------------------- a game, two clients
function setup(seed) {
  const game = new Game({ seed, godMode: true, dayLength: 3600, nightLength: 3600, log: () => {} });
  game.debugCommands = true;
  const client = (name) => {
    const c = { name, id: 0, net: { tick: 0, ack: 0 }, global: null, self: {}, store: { ents: new Map(), onCreate() {}, onRemove() {}, onUpdate() {} }, notes: [], sounds: [], chat: [], flyover: null, seq: 0 };
    const nop = () => {};
    c.handler = new Proxy({ notify: (m, a) => c.notes.push([m, a]), sound: (snd, x, y, z) => c.sounds.push({ snd, x, y, z, tick: game.tick }), flyover: (x, y, z, heading, eta) => (c.flyover = { x, y, z, heading, eta }) }, { get: (t, k) => t[k] || nop });
    c.conn = {
      send(bytes) {
        const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
        const t = r.u8();
        if (t === S2C.WELCOME) c.id = r.u16();
        else if (t === S2C.SNAPSHOT) readSnapshot(r, c);
        else if (t === S2C.CHAT) {
          r.u16();
          r.u8();
          c.chat.push(r.str());
        }
      },
    };
    c.session = game.onOpen(c.conn);
    const w = new Writer(64);
    w.u8(C2S.JOIN);
    w.u8(PROTOCOL_VERSION);
    w.str(name);
    game.onMessage(c.session, w.bytes().slice());
    c.p = game.players.get(c.id);
    c.hold = (id) => {
      const w2 = new Writer(8);
      w2.u8(C2S.ACTION);
      w2.u8(ACT.HOLD_BEGIN);
      w2.u16(id);
      game.onMessage(c.session, w2.bytes().slice());
    };
    c.release = () => {
      const w2 = new Writer(8);
      w2.u8(C2S.ACTION);
      w2.u8(ACT.HOLD_END);
      game.onMessage(c.session, w2.bytes().slice());
    };
    c.input = () => {
      const w2 = new Writer(64);
      w2.u8(C2S.INPUT);
      w2.u16(game.tick & 0xffff);
      w2.u8(0);
      const cmds = [];
      for (let i = 0; i < 3; i++) {
        c.seq = (c.seq + 1) & 0xffff;
        cmds.push({ seq: c.seq, buttons: 0, qyaw: qangle16(0), qpitch: qpitch(0), slot: 255 });
      }
      writeInput(w2, cmds);
      game.onMessage(c.session, w2.bytes().slice());
    };
    c.said = (m) => c.notes.filter(([msg]) => msg === m);
    c.count = (item) => c.p.inv.reduce((n, x) => n + (x && x.item === item ? x.count : 0), 0);
    return c;
  };
  const clients = [client('Alice'), client('Bob')];
  const run = (ticks) => {
    for (let i = 0; i < ticks; i++) {
      for (const c of clients) c.input();
      game.update();
    }
  };
  // a survivor put down at a spot of the world, on the floor that is there (y: the height to look for it from)
  const put = (c, x, z, y = 200) => {
    const s = c.p.state;
    s.x = x;
    s.z = z;
    s.y = groundAt(game.world, x, z, y, 0.3);
    s.vx = s.vy = s.vz = 0;
    game.fillHistory(c.p);
  };
  const clear = () => {
    for (const z of game.zombies) game.removeEntity(z);
    game.zombies.length = 0;
    game.zm.herds.reset();
  };
  // a spot `d` metres from (x, z) where one of the dead can stand, in the first direction (from angle a0 on) that has one
  const spotAt = (x, z, dists, a0 = 0) => {
    const lim = MAP_HALF - 12;
    for (let a = a0; a < a0 + Math.PI * 2; a += 0.05) {
      const pts = dists.map((d) => ({ x: x + Math.sin(a) * d, z: z + Math.cos(a) * d }));
      if (pts.every((p) => Math.abs(p.x) < lim && Math.abs(p.z) < lim && !game.world.isDeepWater(p.x, p.z) && !game.nav.isBlocked(p.x, p.z))) return pts;
    }
    throw new Error(`seed ${seed}: no line of open ground ${dists.join(' / ')} m out from ${x.toFixed(0)}, ${z.toFixed(0)}`);
  };
  return { game, clients, run, put, clear, spotAt };
}

const { game, clients, run, put, clear, spotAt } = setup(relaySeed);
const [A, B] = clients;
const a = A.p;
const world = game.world;
const church = world.zoneById[ZONE.CHURCH];
const relay = world.zoneById[ZONE.RELAY];
const spots = fixtureSpots(world);
const bell = spots.bell.bell;
const ringer = placePoint(church, [0.1, 0, -0.6]); // a step inside the chapel door, the rope at the left hand
const operator = placePoint(relay, [RADIO_AT[0], 0, RADIO_AT[2] - 1.2]);
const notesOff = () => clients.forEach((c) => ((c.notes.length = 0), (c.sounds.length = 0)));
run(3);
check('the dead can walk to where the bell ringer and the radio operator stand', !game.nav.isBlocked(ringer.x, ringer.z) && !game.nav.isBlocked(operator.x, operator.z));

// ---------------------------------------------------------------- the bell
{
  clear();
  put(A, ringer.x, ringer.z, church.h + 1);
  put(B, relay.x, relay.z); // somewhere else: Bob hears it from wherever he is
  const far = Math.hypot(relay.x - bell.x, relay.z - bell.z);

  // out of reach, and through the wall: nothing
  notesOff();
  put(A, placePoint(church, [0.1, 0, 4.5]).x, placePoint(church, [0.1, 0, 4.5]).z, church.h + 1);
  A.hold(BELL_ID);
  run(2);
  const tooFar = !a.hold;
  const out = placePoint(church, [BELL_ROPE[0], 0, -4.2]);
  put(A, out.x, out.z);
  A.hold(BELL_ID);
  run(2);
  check('the rope is not pulled from across the chapel, nor through its front wall', tooFar && !a.hold && Math.hypot(out.x - spots.bell.rope.x, out.z - spots.bell.rope.z) < FIXTURE_REACH && A.notes.length === 0);

  // a hold let go, and one walked away from, ring nothing
  put(A, ringer.x, ringer.z, church.h + 1);
  A.hold(BELL_ID);
  run(10);
  const ring = `hold ${A.self.holdKind} at ${Math.round(A.self.holdProgress * 100)}% after half a second`;
  const held = a.hold?.kind === HOLD.BELL && A.self.holdKind === HOLD.BELL && A.self.holdProgress > 0.2;
  A.release();
  run(40);
  const letGo = !a.hold && !A.said(NOTIFY.BELL).length;
  A.hold(BELL_ID);
  run(10);
  put(A, placePoint(church, [0.1, 0, 6]).x, placePoint(church, [0.1, 0, 6]).z, church.h + 1);
  run(40);
  check('a pull let go of, or walked away from, rings nothing', held && letGo && !a.hold && !A.said(NOTIFY.BELL).length && game.fixtures.tolls === 0, ring);

  // the dead standing idle at 60, 150, 210 and 240 m, and a herd on its road 120 m off
  const DIST = [60, 150, 210, 240];
  const pts = spotAt(bell.x, bell.z, DIST);
  const zs = pts.map((p) => game.zm.spawn(ZTYPE.WALKER, p.x, p.z));
  const herdAt = spotAt(bell.x, bell.z, [120], 2)[0];
  let herd = null;
  for (let tries = 0; tries < 10 && !herd; tries++) herd = game.zm.herds.spawn([]);
  if (!herd) throw new Error(`seed ${relaySeed}: no herd could be put on a road`);
  for (const m of herd.members) {
    m.x = herdAt.x + m.herdX;
    m.z = herdAt.z + m.herdZ;
    m.y = groundAt(world, m.x, m.z, 200, 0.2, false);
    game.fillHistory(m);
  }
  herd.x = herd.cx = herdAt.x;
  herd.z = herd.cz = herdAt.z;
  run(2);
  check('the dead stand where the test put them, with nobody to chase', zs.every((z, i) => z && Math.abs(Math.hypot(z.x - bell.x, z.z - bell.z) - DIST[i]) < 1 && !z.target && z.alertT <= 0) && herd.members.length >= 4 && !herd.hot, zs.map((z) => (z ? Math.hypot(z.x - bell.x, z.z - bell.z).toFixed(0) : 'none')).join(' / ') + ` m, herd of ${herd.members.length}`);

  // the pull
  put(A, ringer.x, ringer.z, church.h + 1);
  notesOff();
  A.hold(BELL_ID);
  const t0 = game.tick;
  let rung = 0;
  for (let i = 0; i < 80 && !rung; i++) {
    run(1);
    if (A.said(NOTIFY.BELL).length) rung = game.tick - t0;
  }
  check(`holding [E] on the rope for ${BELL_HOLD_TIME} s rings the bell, and the whole team is told`, Math.abs(rung / TICKS - BELL_HOLD_TIME) <= 0.11 && A.said(NOTIFY.BELL)[0]?.[1] === BELL_COOLDOWN && B.said(NOTIFY.BELL).length === 1 && A.sounds.some((s) => s.snd === SOUND.BELL_ROPE), `${(rung / TICKS).toFixed(2)} s`);

  // the first toll is out: who heard it
  // (lvl: how much further the toll would have carried past it - a metre or two off NOISE.BELL less its distance,
  // for the steps it has wandered since)
  const alert = zs.map((z) => ({ on: z.alertT > 0, at: near({ x: z.alertX, z: z.alertZ }, bell, 7.1), rush: z.alertRush, lvl: z.alertLvl }));
  check('the first toll turns the idle dead at 60, 150 and 210 m towards the chapel, and not the one at 240 m', alert[0].on && alert[0].at && alert[1].on && alert[1].at && alert[2].on && alert[2].at && !alert[3].on, alert.map((x, i) => `${DIST[i]} m: ${x.on ? 'coming' : 'no'}`).join(', '));
  check('...running harder the closer they stood', alert[0].rush === 1 && alert[1].rush === 1 && alert[2].rush < 0.4 && alert.slice(0, 3).every((x, i) => Math.abs(x.lvl - (NOISE.BELL - DIST[i])) < 4 && Math.abs(x.rush - Math.min(1, x.lvl / NOISE_RUSH)) < 1e-6), `rush ${alert.slice(0, 3).map((x) => x.rush.toFixed(2)).join(' / ')}`);
  const d0 = zs.map((z) => Math.hypot(z.x - bell.x, z.z - bell.z));
  run(Math.round((BELL_TOLLS - 1) * BELL_TOLL_GAP * TICKS) + 30);
  const tolls = B.sounds.filter((s) => s.snd === SOUND.BELL_TOLL);
  const gaps = tolls.slice(1).map((s, i) => (s.tick - tolls[i].tick) / TICKS);
  check(`it tolls ${BELL_TOLLS} times, ${BELL_TOLL_GAP} s apart, and a survivor ${far.toFixed(0)} m away hears each one from the belfry`, tolls.length === BELL_TOLLS && gaps.every((g) => Math.abs(g - BELL_TOLL_GAP) <= 0.06) && tolls.every((s) => Math.hypot(s.x - bell.x, s.y - bell.y, s.z - bell.z) < 0.05) && A.sounds.filter((s) => s.snd === SOUND.BELL_TOLL).length === BELL_TOLLS && far > 100, `gaps ${gaps.map((g) => g.toFixed(2)).join(', ')} s`);
  const moved = zs.map((z, i) => d0[i] - Math.hypot(z.x - bell.x, z.z - bell.z));
  // (how far each got depends on what stood in its way: only that all three are on their way is checked)
  check('...and they come: each of the three is nearer the chapel a few seconds on', moved[0] > 1.5 && moved[1] > 1.5 && moved[2] > 1.5, `nearer by ${moved.slice(0, 3).map((m) => m.toFixed(1)).join(' / ')} m`);
  check('the wandering herd heard it too: the lot of them run for the chapel', herd.hot && near({ x: herd.ax, z: herd.az }, bell, 7.1), `herd ${herd.hot ? 'roused' : 'wandering'}, heading ${Math.hypot(herd.ax - bell.x, herd.az - bell.z).toFixed(1)} m from the belfry`);

  // not again yet
  notesOff();
  A.hold(BELL_ID);
  run(2);
  const wait = A.said(NOTIFY.BELL_WAIT)[0]?.[1];
  check(`the rope does not pull again inside ${BELL_COOLDOWN} s, and only the one who tried is told how long`, !a.hold && wait > BELL_COOLDOWN - 12 && wait < BELL_COOLDOWN && B.said(NOTIFY.BELL_WAIT).length === 0, `${wait} s to go`);
  run(wait * TICKS + 2);
  notesOff();
  A.hold(BELL_ID);
  run(Math.round(BELL_HOLD_TIME * TICKS) + 3);
  check('...and after that it does', A.said(NOTIFY.BELL).length === 1 && B.said(NOTIFY.BELL).length === 1);
  run(Math.round(BELL_TOLLS * BELL_TOLL_GAP * TICKS));

  // by night as by day
  game.fixtures.reset();
  game.startNight();
  notesOff();
  A.hold(BELL_ID);
  run(Math.round(BELL_HOLD_TIME * TICKS) + 3);
  check('the bell rings at night as well', game.phase === PHASE.NIGHT && A.said(NOTIFY.BELL).length === 1);
  game.startDay();
  run(Math.round(BELL_TOLLS * BELL_TOLL_GAP * TICKS));

  // /bell
  game.fixtures.reset();
  notesOff();
  game.handleChat(a, '/bell');
  run(3);
  check('/bell rings it from anywhere', B.said(NOTIFY.BELL).length === 1 && B.sounds.some((s) => s.snd === SOUND.BELL_TOLL));
  run(Math.round(BELL_TOLLS * BELL_TOLL_GAP * TICKS));
}

// ---------------------------------------------------------------- the radio
{
  clear();
  game.fixtures.reset();
  const radio = spots.radio;
  put(A, operator.x, operator.z);
  put(B, ringer.x, ringer.z, church.h + 1);
  const pack = (n) => {
    a.inv.fill(null);
    if (n) a.inv[0] = { item: ITEM.BATTERY, count: n };
    a.invDirty = true;
  };
  // no batteries, one battery: refused, and told why
  pack(RADIO_BATTERIES - 1);
  notesOff();
  A.hold(RADIO_ID);
  run(2);
  check(`the radio does nothing for ${RADIO_BATTERIES - 1} battery, and says what it needs`, !a.hold && A.said(NOTIFY.RADIO_NO)[0]?.[1] === RADIO_NO.BATTERIES && B.said(NOTIFY.RADIO_NO).length === 0 && A.count(ITEM.BATTERY) === RADIO_BATTERIES - 1);

  // the dead at 60 m hear the call go out, the ones at 120 m do not
  const pts = spotAt(radio.x, radio.z, [60, 120]);
  const zs = pts.map((p) => game.zm.spawn(ZTYPE.WALKER, p.x, p.z));
  pack(RADIO_BATTERIES + 1);
  notesOff();
  A.hold(RADIO_ID);
  run(20);
  const mid = a.hold?.kind === HOLD.RADIO && A.self.holdKind === HOLD.RADIO && A.count(ITEM.BATTERY) === RADIO_BATTERIES + 1 && game.flyovers.length === 0;
  const t0 = game.tick - 20;
  let called = 0;
  for (let i = 0; i < 100 && !called; i++) {
    run(1);
    if (A.said(NOTIFY.RADIO_CALL).length) called = game.tick - t0;
  }
  const stood = { x: a.state.x, z: a.state.z };
  const fly = game.flyovers[0];
  check(`holding [E] for ${RADIO_HOLD_TIME} s with ${RADIO_BATTERIES} batteries spends them and calls a plane`, mid && Math.abs(called / TICKS - RADIO_HOLD_TIME) <= 0.11 && A.count(ITEM.BATTERY) === 1 && game.flyovers.length === 1, `${(called / TICKS).toFixed(2)} s, ${A.count(ITEM.BATTERY)} battery left`);
  check('...the scheduled planes\' own: the flyover, the notice, and a crate aimed at where the caller stands', !!fly && near({ x: fly.tx, z: fly.tz }, stood, 0.8) && Math.abs(fly.at - game.time - PLANE_LEAD / PLANE_SPEED) < 0.2 && !!A.flyover && !!B.flyover && A.said(NOTIFY.SUPPLY_DROP).length === 1 && B.said(NOTIFY.SUPPLY_DROP).length === 1, fly ? `${Math.hypot(fly.tx - stood.x, fly.tz - stood.z).toFixed(2)} m from the caller` : '');
  check('...the team is told who called it, and the dead within 90 m heard the call go out', B.said(NOTIFY.RADIO_CALL)[0]?.[1] === A.id && A.sounds.some((s) => s.snd === SOUND.RADIO_CALL) && zs[0].alertT > 0 && near({ x: zs[0].alertX, z: zs[0].alertZ }, radio, 7.1) && zs[1].alertT <= 0);
  clear();

  // one call a day
  pack(RADIO_BATTERIES);
  notesOff();
  A.hold(RADIO_ID);
  run(2);
  check('a second call the same day is refused, batteries or not', !a.hold && A.said(NOTIFY.RADIO_NO)[0]?.[1] === RADIO_NO.CALLED && A.count(ITEM.BATTERY) === RADIO_BATTERIES && game.flyovers.length === 1);

  // the crate comes down where the caller stood
  let crate = null;
  for (let i = 0; i < 1500 && !crate; i++) {
    run(1);
    crate = game.crates.find((c) => c.state === 1) || null;
  }
  const ground = groundAt(world, stood.x, stood.z, relay.h + 0.5, 0.3);
  check('the crate lands where the caller stood, on the ground, an ordinary supply crate', !!crate && crate.kind === ENT.CRATE && near(crate, stood, 0.8) && Math.abs(crate.y - ground) < 0.1 && !near(crate, radio, 0.9), crate ? `${Math.hypot(crate.x - stood.x, crate.z - stood.z).toFixed(2)} m off, ${((game.tick - t0 - called) / TICKS).toFixed(0)} s after the call` : 'no crate');

  // the night: the day's call is still spent; the next day it is back; and no plane flies at night
  game.startNight();
  notesOff();
  A.hold(RADIO_ID);
  run(2);
  const spent = !a.hold && A.said(NOTIFY.RADIO_NO)[0]?.[1] === RADIO_NO.CALLED;
  game.startDay();
  clear();
  put(A, operator.x, operator.z);
  notesOff();
  A.hold(RADIO_ID);
  run(4);
  const back = a.hold?.kind === HOLD.RADIO;
  A.release();
  run(2);
  game.startNight();
  notesOff();
  A.hold(RADIO_ID);
  run(2);
  check('the call is back at dawn, and no plane is called at night', spent && back && !a.hold && A.said(NOTIFY.RADIO_NO)[0]?.[1] === RADIO_NO.NIGHT && A.count(ITEM.BATTERY) === RADIO_BATTERIES, `spent ${spent}, back ${back}`);
  game.startDay();
  clear();
  put(A, operator.x, operator.z);

  // the call itself draws nothing from the game's random stream (nothing is near enough to hear it)
  const rng = game.rng;
  let draws = 0;
  game.rng = () => (draws++, rng());
  const n0 = game.flyovers.length;
  game.fixtures.callPlane(a);
  game.rng = rng;
  check("a call does not draw from the game's own random stream", draws === 0 && game.flyovers.length === n0 + 1 && A.count(ITEM.BATTERY) === 0);
  game.flyovers.length = 0;

  // /radio
  put(A, ringer.x, ringer.z, church.h + 1);
  pack(0);
  game.handleChat(a, '/radio');
  check("/radio takes you to the radio with the batteries for a call", near(a.state, radio, 2) && A.count(ITEM.BATTERY) === RADIO_BATTERIES && game.fixtures.inReach(a, radio, 0));
}

// ---------------------------------------------------------------- the prompt (client/game/fixtures.js)
{
  const lines = [];
  const g = { world, time: 100, myId: A.id, global: { day: 3, phase: PHASE.DAY }, lookTarget: null, prompt: null, name: () => 'Bob', audio: { playLocal() {} }, ui: { notify: (text) => lines.push(text) }, held: 0, beginHold: (id) => (g.held = id) };
  const ui = new FixtureUI(g);
  // looking straight at spot sp from where a survivor at `at` has their eyes
  const look = (at, sp, counts = {}) => {
    const y = groundAt(world, at.x, at.z, at.y + 1, 0.3);
    const o = { x: at.x, y: y + EYE_HEIGHT, z: at.z };
    const l = Math.hypot(sp.x - o.x, sp.y - o.y, sp.z - o.z);
    g.lookTarget = g.prompt = null;
    return ui.look(o.x, o.y, o.z, (sp.x - o.x) / l, (sp.y - o.y) / l, (sp.z - o.z) / l, y + EYE_HEIGHT, counts) ? g.prompt : null;
  };
  const rope = spots.bell.rope;
  const ready = look(ringer, rope);
  ui.interact(g.lookTarget);
  const pulled = g.held === BELL_ID;
  ui.notify(NOTIFY.BELL, BELL_COOLDOWN);
  g.time += 5;
  const swinging = look(ringer, rope);
  g.time += BELL_COOLDOWN;
  check('the rope offers [E], says so while the bell is still swinging, and offers it again after', /^\[E\] Hold to ring/.test(ready) && pulled && !/^\[E\]/.test(swinging) && swinging.includes(`${BELL_COOLDOWN - 5} s`) && /^\[E\]/.test(look(ringer, rope)) && lines.length === 1, `"${ready}" / "${swinging}"`);
  const radio = spots.radio;
  const none = look(operator, radio, {});
  const ok = look(operator, radio, { [ITEM.BATTERY]: RADIO_BATTERIES });
  ui.interact(g.lookTarget);
  const keyed = g.held === RADIO_ID;
  ui.notify(NOTIFY.RADIO_CALL, B.id);
  const spent = look(operator, radio, { [ITEM.BATTERY]: 5 });
  g.global.day = 4;
  const dawn = look(operator, radio, { [ITEM.BATTERY]: 5 });
  g.global.phase = PHASE.NIGHT;
  const night = look(operator, radio, { [ITEM.BATTERY]: 5 });
  check('the radio says what a call costs, and why it will not work: batteries, already called today, night', none.includes(`needs ${RADIO_BATTERIES} Batteries`) && !/^\[E\]/.test(none) && /^\[E\] Hold to call a supply drop/.test(ok) && ok.includes(`${RADIO_BATTERIES} Batteries`) && keyed && /already called today/.test(spent) && /^\[E\]/.test(dawn) && /night/.test(night), `"${none}" / "${ok}" / "${spent}" / "${night}"`);
  check('nothing is offered from across the yard, or with the back turned', look(placePoint(relay, [RADIO_AT[0], 0, RADIO_AT[2] - 4.5]), radio) === null && ui.look(operator.x, operator.y + EYE_HEIGHT, operator.z, 0, 1, 0, operator.y + EYE_HEIGHT, {}) === false);

  // a prompt on screen is never refused for distance: wherever the client offers [E], the server takes it
  let offered = 0;
  const refused = [];
  for (const [zone, sp, y] of [[church, rope, church.h + 1], [relay, radio, 200]]) {
    for (let lx = -5; lx <= 5; lx += 0.25) {
      for (let lz = -5; lz <= 5; lz += 0.25) {
        const at = { x: sp.x + lx, y: zone.h, z: sp.z + lz };
        const s = a.state;
        s.x = at.x;
        s.z = at.z;
        s.y = groundAt(world, at.x, at.z, y, 0.3);
        if (s.y > zone.h + 0.5) continue; // (on top of something)
        if (look({ x: at.x, y: s.y, z: at.z }, sp) === null) continue;
        offered++;
        if (!game.fixtures.inReach(a, sp, 0)) refused.push(`${lx},${lz}`);
      }
    }
  }
  check('wherever the client offers [E] on one of them, the server takes it', offered > 200 && refused.length === 0, refused.length ? `refused at ${refused.slice(0, 5).join(' ; ')}` : `${offered} spots`);
}

// ---------------------------------------------------------------- a valley without a Relay Station
if (bareSeed) {
  const bare = setup(bareSeed);
  const C = bare.clients[0];
  bare.run(3);
  C.hold(RADIO_ID);
  bare.game.handleChat(C.p, '/radio');
  bare.run(2);
  check('a valley without a Relay Station has no radio, and /radio says so', fixtureSpots(bare.game.world).radio === null && !C.p.hold && C.notes.every(([m]) => m !== NOTIFY.RADIO_NO) && C.chat.some((t) => /no Relay Station/.test(t)) && !!fixtureSpots(bare.game.world).bell, `seed ${bareSeed}`);
} else check('a valley without a Relay Station was among the seeds', false);

console.log(fails.length ? `\n${fails.length} FAILED:\n  ${fails.join('\n  ')}` : '\nall fixture checks passed');
process.exit(fails.length ? 1 : 0);
