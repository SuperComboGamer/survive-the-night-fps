// The mounted gun at the Army Checkpoint (shared/mountedgun.js, server/mountedgun.js): in-process checks against a
// real Game, with what the server sends decoded as a client does.
//   - the nest: on the maps that have the checkpoint, where a survivor can stand at the grips and the dead can get
//     to them; no gun on a map without it
//   - manning it: one gunner at a time, whose commands fire it and nobody else's; stepping away, [E], going down
//     and dying let go
//   - a round: lag compensated like any gun's (a walker crossing 60 m out, aimed at where it was drawn 250 ms ago:
//     150 ms of latency plus the interpolation delay), against the AK-47 through the same path; the gunner's kill
//   - the belt: spent a round at a time, clicks when empty, fed from the 7.62 the gunner carries, reset with
//     a new game
//   - carrying it: lifted with [E] held (not from under a gunner), half pace walking and sprinting, nothing fired,
//     thrown, swung or reloaded on the way; a weapon key or [G] drops it on its side where they stand, and it is
//     lifted again from there; [E] sets it up a step ahead facing the way they look (not into a wall), where it is
//     manned and fired as at the checkpoint; going down, dying, a dropped connection and leaving all drop it
// usage: node scripts/test-gun.js [seed with a checkpoint = 1]
import { Game } from '../server/game.js';
import { C2S, S2C, ACT, ENT, GF, PROTOCOL_VERSION, Writer, Reader, qangle16, qpitch, dqangle16, dqpitch, writeInput } from '../shared/protocol.js';
import { BTN, SERVER_TICK_RATE, SLOT_PRIMARY, SLOT_PISTOL, SLOT_MELEE, PLAYER_RADIUS, PLAYER_HEIGHT, EYE_HEIGHT, NOISE, WALK_SPEED, SPRINT_SPEED, GUN_CARRY_SPEED, WATER_LEVEL } from '../shared/constants.js';
import { ITEM, WEAPONS, AMMO, ZTYPE, ZONE, KILLER, SOUND } from '../shared/defs.js';
import { GUN, MOUNTED_GUN, GUN_STANDS, GUN_CARRIED, GUN_LYING, gunNest, atGrips, gunAim, setUpSpot, snapNest } from '../shared/mountedgun.js';
import { createWorld } from '../shared/world.js';
import { resolveBody, raycastWorld, groundAt } from '../shared/collision.js';
import { swimming } from '../shared/swim.js';
import { readSnapshot } from '../client/net/decode.js';

const seed = +(process.argv[2] || 1);
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};

// ---------------------------------------------------------------- the nest, on a spread of valleys
{
  const bad = [];
  let nests = 0;
  let maps = 0;
  for (let sd = 1; sd <= 16; sd++) {
    const w = createWorld(sd);
    const n = gunNest(w);
    maps++;
    if (!!n !== !!w.zoneById[ZONE.CHECKPOINT]) bad.push(`seed ${sd}: checkpoint ${!!w.zoneById[ZONE.CHECKPOINT]}, nest ${!!n}`);
    if (!n) continue;
    nests++;
    // a body at the grips stands free of the sandbags and the tripod, on the ground the tripod stands on
    const gx = n.x + Math.sin(n.ry) * GUN.back;
    const gz = n.z + Math.cos(n.ry) * GUN.back;
    const pos = { x: gx, y: n.y, z: gz };
    resolveBody(w, pos, PLAYER_RADIUS, PLAYER_HEIGHT, true);
    if (Math.hypot(pos.x - gx, pos.z - gz) > 0.02) bad.push(`seed ${sd}: the grips are inside something (pushed ${Math.hypot(pos.x - gx, pos.z - gz).toFixed(2)} m)`);
    if (Math.abs(w.heightAt(gx, gz) - n.y) > 0.15) bad.push(`seed ${sd}: the ground at the grips is ${(w.heightAt(gx, gz) - n.y).toFixed(2)} m off the tripod's`);
    // level, and along the middle of the arc, a round from the gunner's eye clears the nest's own sandbags
    const ray = { t: -1, col: null, terrain: false };
    for (const a of [-GUN.arc, -GUN.arc / 2, 0, GUN.arc / 2, GUN.arc]) {
      const yaw = n.ry + a;
      raycastWorld(w, gx, n.y + EYE_HEIGHT, gz, -Math.sin(yaw), 0, -Math.cos(yaw), 4, ray);
      if (ray.t >= 0) bad.push(`seed ${sd}: a level round ${Math.round((a * 180) / Math.PI)} deg off the middle of the arc hits something ${ray.t.toFixed(1)} m out`);
    }
  }
  check('the nest stands wherever the checkpoint does, its grips free and its field of fire clear of its own sandbags', !bad.length && nests >= 4, bad.length ? bad.slice(0, 4).join('; ') : `${nests} of ${maps} valleys`);
}

// ---------------------------------------------------------------- a game
const game = new Game({ seed, godMode: true, dayLength: 3600, themes: false, log: () => {} });

function client(name) {
  const c = { name, id: 0, net: { tick: 0, ack: 0 }, global: null, self: {}, store: { ents: new Map(), onCreate() {}, onRemove() {}, onUpdate() {} }, shots: [], feed: [], sounds: [], chat: [], seq: 0 };
  const nop = () => {};
  c.handler = new Proxy(
    {
      shot: (ev) => c.shots.push(ev),
      killfeed: (kk, killer, victim, weapon) => c.feed.push({ kk, killer, victim, weapon }),
      sound: (snd) => c.sounds.push(snd),
    },
    { get: (t, k) => t[k] || nop },
  );
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
  c.p = () => game.players.get(c.id);
  if (c.p()) c.p().admin = true; // (the admin chat commands)
  c.yaw = 0;
  c.pitch = 0;
  c.act = (act, a) => {
    const w2 = new Writer(16);
    w2.u8(C2S.ACTION);
    w2.u8(act);
    w2.u8(a);
    game.onMessage(c.session, w2.bytes().slice());
  };
  // [E] held on an entity (HOLD_BEGIN), and let go (HOLD_END)
  c.hold = (id) => {
    const w2 = new Writer(16);
    w2.u8(C2S.ACTION);
    w2.u8(id ? ACT.HOLD_BEGIN : ACT.HOLD_END);
    if (id) w2.u16(id);
    game.onMessage(c.session, w2.bytes().slice());
  };
  // a tick's worth of commands (3), looking along c.yaw / c.pitch; back: how many ticks ago the screen they were
  // aimed on was drawn (the packet's render time)
  c.input = (buttons, back = 0, slot = 255) => {
    const w2 = new Writer(64);
    w2.u8(C2S.INPUT);
    w2.u16((game.tick - back) & 0xffff);
    w2.u8(0);
    const cmds = [];
    for (let i = 0; i < 3; i++) {
      c.seq = (c.seq + 1) & 0xffff;
      cmds.push({ seq: c.seq, buttons, qyaw: qangle16(c.yaw), qpitch: qpitch(c.pitch), slot: i === 0 ? slot : 255 });
    }
    writeInput(w2, cmds);
    game.onMessage(c.session, w2.bytes().slice());
  };
  return c;
}

const A = client('Alice');
const B = client('Bob');
const a = A.p();
const b = B.p();
const s = a.state;
const nest = gunNest(game.world);
const gun = () => game.gun.gun;
const seen = (c) => [...c.store.ents.values()].find((e) => e.kind === ENT.GUN);
// ticks: fa / fb are the buttons Alice / Bob hold on tick i
const run = (ticks, fa, fb) => {
  for (let i = 0; i < ticks; i++) {
    A.input(fa ? fa(i) : 0);
    B.input(fb ? fb(i) : 0);
    game.update();
  }
};
const has = (p, item) => p.inv.reduce((n, x) => n + (x && x.item === item ? x.count : 0), 0);
const pack = (p, ...list) => {
  p.inv.fill(null);
  list.forEach(([item, count], i) => (p.inv[i] = { item, count }));
  p.invDirty = true;
};
// stands a player at the grips (dx: metres to the side), looking down the middle of the arc
const toGrips = (c, side = 0, back = GUN.back + 0.3) => {
  const st = c.p().state;
  st.x = nest.x + Math.sin(nest.ry) * back + Math.cos(nest.ry) * side;
  st.z = nest.z + Math.cos(nest.ry) * back - Math.sin(nest.ry) * side;
  st.y = nest.y;
  st.vx = st.vy = st.vz = 0;
  c.yaw = nest.ry;
  c.pitch = 0;
  game.fillHistory(c.p());
};

run(5);
check('a new game on a map with the checkpoint has the gun on its tripod, the belt full and nobody at it', !!nest && !!gun() && gun().belt === GUN.mag && gun().gunner === 0, nest ? `belt ${gun()?.belt}` : `seed ${seed} has no checkpoint: pass one that does`);
if (!nest || !gun()) process.exit(1);
// The dead the valley put down at the start go: which of them wander up to the nest is down to the game's rolls (a
// new loot row moves them), and one at the grips knocks the gunner off them. Every zombie below is put there.
for (const z of game.zombies) {
  z.dead = true;
  game.removeEntity(z);
}
game.zombies.length = 0;

// ---------------------------------------------------------------- manning it
game.handleChat(a, '/gun');
run(2);
check('/gun puts a survivor at the grips', atGrips(nest, s.x, s.y, s.z), `${Math.hypot(s.x - nest.x, s.z - nest.z).toFixed(2)} m from the pintle`);
toGrips(A);
toGrips(B, 0.7);
run(3);
{
  const e = seen(A);
  check('the gun is replicated: belt, gunner and where it points', !!e && e.q[3] === GUN.mag && e.q[4] === 0 && Math.abs((((dqangle16(e.q[5] & 0xff80) - nest.ry + Math.PI * 3) % (Math.PI * 2)) - Math.PI)) < 0.02, e ? `belt ${e.q[3]}, gunner ${e.q[4]}` : 'not in the snapshot');
}
// nobody mans it: the trigger button does nothing, whoever sends it
run(10, () => BTN.GUN, () => BTN.GUN);
check('unmanned, it does not fire', gun().belt === GUN.mag);
A.act(ACT.GUN_MAN, 1);
B.act(ACT.GUN_MAN, 1);
run(2);
check('one gunner at a time: the first to take the grips has it', gun().gunner === a.id && seen(B)?.q[4] === a.id, `gunner ${gun().gunner}, Alice ${a.id}, Bob ${b.id}`);

// the gunner's fire button fires it; the second player's does not, and neither fires the weapon in their hands
{
  const noise = [];
  const zmNoise = game.zm.noise.bind(game.zm);
  game.zm.noise = (x, z, loud, y) => (noise.push(loud), zmNoise(x, z, loud, y));
  const mags = [s.mags[0], s.mags[1], b.state.mags[1]].join();
  A.shots.length = B.shots.length = 0;
  run(20, null, () => BTN.GUN);
  const bobOnly = GUN.mag - gun().belt;
  run(20, () => BTN.GUN, () => BTN.GUN);
  const fired = GUN.mag - gun().belt;
  game.zm.noise = zmNoise;
  check('a second player cannot fire it while it is manned', bobOnly === 0 && B.shots.every((ev) => ev.shooter === a.id), `${bobOnly} rounds left the belt on Bob's trigger alone`);
  check('the gunner fires it: 600 rounds a minute, one off the belt each', fired === 10, `${fired} rounds in a second`);
  check('...with the weapons in everybody\'s hands left alone', [s.mags[0], s.mags[1], b.state.mags[1]].join() === mags && a.state.fireCount === 0);
  check('...heard further than any rifle', noise.length === fired && noise.every((r) => r === GUN.noise) && GUN.noise > NOISE.GUNSHOT && GUN.noise > WEAPONS[ITEM.HUNTING_RIFLE].noise, `noise ${noise[0]} m`);
  check('...and the shots reach the others as the gun\'s, not the gunner (who has drawn them already)', B.shots.length === fired && B.shots.every((ev) => ev.weapon === MOUNTED_GUN) && A.shots.length === 0, `Bob was sent ${B.shots.length}, Alice ${A.shots.length}`);
  // outside the arc the gun is at its stop
  A.yaw = nest.ry + Math.PI * 0.75;
  A.pitch = -1.2;
  B.shots.length = 0;
  run(4, () => BTN.GUN);
  const off = B.shots.map((ev) => [((ev.yaw - nest.ry + Math.PI * 3) % (Math.PI * 2)) - Math.PI, ev.pitch]);
  check('looking past its arc, it fires from its stop', off.length > 0 && off.every(([y, p]) => Math.abs(y - GUN.arc) < 0.001 && Math.abs(p - GUN.pitchMin) < 0.001), off.length ? `${((off[0][0] * 180) / Math.PI).toFixed(1)} deg round, ${((off[0][1] * 180) / Math.PI).toFixed(1)} deg down` : 'no shot');
  A.yaw = nest.ry;
  A.pitch = 0;
}

// ---------------------------------------------------------------- lag compensation, against the AK-47
// A walker crossing the gunner's view 60 m out, up in the air over the treetops so that nothing of the valley is in
// the way, moved by hand at its walking pace: its history is what is tested. Every shot is aimed at where the walker
// stood `back` ticks ago and says so (the packet's render time), as a client 150 ms away does: 100 ms of
// interpolation delay plus the trip. The ticks are run by hand (history, then the commands), so no AI moves it.
const UP = 25;
// where in the arc the walker crosses: the first stretch of sky with no treetop between the gunner and any of it
function lane() {
  const ray = { t: -1, col: null, terrain: false };
  for (const deg of [0, 10, -10, 20, -20, 30, -30, 40, -40, 50, -50]) {
    const yaw = nest.ry + (deg * Math.PI) / 180;
    let clear = true;
    for (let side = -6.5; side <= 6.5 && clear; side += 0.25) {
      const dx = nest.x - Math.sin(yaw) * 60 + Math.cos(yaw) * side - s.x;
      const dy = nest.y + UP + 1 - (s.y + EYE_HEIGHT);
      const dz = nest.z - Math.cos(yaw) * 60 - Math.sin(yaw) * side - s.z;
      const l = Math.hypot(dx, dy, dz);
      raycastWorld(game.world, s.x, s.y + EYE_HEIGHT, s.z, dx / l, dy / l, dz / l, l, ray);
      clear = ray.t < 0;
    }
    if (clear) return yaw;
  }
  return nest.ry;
}
function volley(weapon, back, shots, honest = true, aimed = false) {
  const z = game.zm.spawn(ZTYPE.WALKER, nest.x, nest.z, {});
  z.hp = z.maxHp = 1e9;
  z.legHp = null; // (it keeps its legs: with them shot off it would be a crawler, and another shape to hit)
  const mid = lane();
  const fwdX = -Math.sin(mid);
  const fwdZ = -Math.cos(mid);
  const speed = z.def.speed / SERVER_TICK_RATE; // metres a tick, across
  const at = new Map(); // tick -> where it stood
  let hits = 0;
  let rounds = 0;
  const damageZombie = game.combat.damageZombie;
  game.combat.damageZombie = (e, ...rest) => {
    if (e === z) hits++;
    return e === z ? false : damageZombie.call(game.combat, e, ...rest);
  };
  const fire = game.combat.fire;
  game.combat.fire = (p, ev) => {
    if (p === a) rounds++;
    return fire.call(game.combat, p, ev);
  };
  const ak = weapon === ITEM.AK47;
  if (ak) {
    s.weapons[SLOT_PRIMARY] = ITEM.AK47;
    s.slot = SLOT_PRIMARY;
    s.switchT = 0;
    s.reloadT = 0;
  }
  const ex = s.x;
  const ey = s.y + EYE_HEIGHT;
  const ez = s.z;
  for (let i = 0; rounds < shots && i < shots * 40; i++) {
    game.tick++;
    game.time += 1 / SERVER_TICK_RATE; // (the server's flood guard counts messages by this clock)
    const side = -6 + ((i * speed) % 12); // back and forth over 12 m would turn round: it walks one way and starts again
    z.x = nest.x + fwdX * 60 + Math.cos(mid) * side;
    z.z = nest.z + fwdZ * 60 - Math.sin(mid) * side;
    z.y = nest.y + UP;
    game.recordHistory();
    at.set(game.tick, [z.x, z.y, z.z]);
    const old = at.get(game.tick - back);
    if (!old || side < -6 + speed * (back + 1)) continue; // (not across the jump back to the start)
    if (ak) {
      s.mags[0] = 30;
      s.recoil = 0;
    }
    const dx = old[0] - ex;
    const dy = old[1] + 1.0 - ey;
    const dz = old[2] - ez;
    A.yaw = Math.atan2(-dx, -dz);
    A.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    A.input(ak ? BTN.ATTACK | (aimed ? BTN.ALT : 0) : BTN.GUN, honest ? back : 0);
    game.processInputs();
  }
  game.combat.damageZombie = damageZombie;
  game.combat.fire = fire;
  game.events.length = 0; // (no snapshot went out in between: nobody is owed these shots)
  z.dead = true;
  game.removeEntity(z);
  game.zombies.splice(game.zombies.indexOf(z), 1);
  if (ak) {
    s.weapons[SLOT_PRIMARY] = 0;
    s.slot = SLOT_MELEE;
  }
  return { hits, rounds };
}
{
  const BACK = 5; // ticks: 250 ms
  gun().belt = GUN.mag;
  const g1 = volley(MOUNTED_GUN, BACK, 200);
  gun().belt = GUN.mag;
  const g0 = volley(MOUNTED_GUN, BACK, 200, false);
  const k1 = volley(ITEM.AK47, BACK, 200);
  const k2 = volley(ITEM.AK47, BACK, 200, true, true);
  const pct = (v) => `${v.hits}/${v.rounds}`;
  check('a round at a walker crossing 60 m out, aimed at where it was drawn 250 ms ago, hits', g1.rounds === 200 && g1.hits >= 180, `the mounted gun ${pct(g1)}`);
  // (from the hip the AK-47's cone is 2.4 m across out there, wider than the walker: what it loses, it loses to
  // that, not to the latency. Down its sights the cone is the mounted gun's, and so is the score.)
  check('...as reliably as an AK-47 through the same path', k1.rounds === 200 && k2.rounds === 200 && g1.hits >= k1.hits && g1.hits >= k2.hits - 10, `the AK-47 ${pct(k1)} from the hip and ${pct(k2)} down its sights, the mounted gun ${pct(g1)}`);
  check('...because the server rewinds to the screen it was aimed on (without that, fewer land)', g0.hits < g1.hits - 20, `${pct(g0)} with the render time left out`);
  gun().belt = GUN.mag;
  A.yaw = nest.ry;
  A.pitch = 0;
}

// ---------------------------------------------------------------- the kill is the gunner's
{
  const kills0 = a.zkills;
  const night0 = game.nightStats.kills;
  A.feed.length = B.feed.length = 0;
  // a spitter (not rank-and-file, so the killfeed names it) 10 m down the barrel, behind a walker: one round goes
  // through the first body into the next
  const fx = -Math.sin(nest.ry);
  const fz = -Math.cos(nest.ry);
  const w1 = game.zm.spawn(ZTYPE.WALKER, nest.x + fx * 9, nest.z + fz * 9, {});
  const z1 = game.zm.spawn(ZTYPE.SPITTER, nest.x + fx * 10.5, nest.z + fz * 10.5, {});
  for (const z of [w1, z1]) {
    z.x = nest.x + fx * (z === w1 ? 9 : 10.5);
    z.z = nest.z + fz * (z === w1 ? 9 : 10.5);
    z.y = nest.y;
    game.fillHistory(z);
  }
  const hp0 = [w1.hp, z1.hp];
  const dy = 1.0 - EYE_HEIGHT;
  A.pitch = Math.atan2(dy, 9 + GUN.back + 0.3);
  // one tick by hand: the two stand where they were put
  game.tick++;
  game.recordHistory();
  A.input(BTN.GUN);
  game.processInputs();
  const through = w1.hp < hp0[0] && z1.hp < hp0[1];
  check('a round goes through one body into the next', through, `walker ${hp0[0]} -> ${w1.hp.toFixed(0)}, spitter behind it ${hp0[1]} -> ${z1.hp.toFixed(0)}`);
  w1.hp = z1.hp = 1;
  game.phase = 2; // (night: the kills go on the night's summary)
  game.tick++;
  game.recordHistory();
  A.input(0);
  game.processInputs();
  for (let i = 0; i < 6 && !(w1.dead && z1.dead); i++) {
    game.tick++;
    game.recordHistory();
    A.input(BTN.GUN);
    game.processInputs();
  }
  game.phase = 1;
  run(2);
  const line = B.feed.find((f) => f.victim === (0x8000 | ZTYPE.SPITTER));
  check('its kills are the gunner\'s: on the scoreboard, the night\'s summary and the killfeed (as the gun\'s)', w1.dead && z1.dead && a.zkills === kills0 + 2 && game.nightStats.kills === night0 + 2 && !!line && line.kk === KILLER.PLAYER && line.killer === a.id && line.weapon === MOUNTED_GUN, `kills ${a.zkills - kills0}, the feed: ${line ? `player ${line.killer} with ${line.weapon}` : 'nothing'}`);
  A.pitch = 0;
}

// ---------------------------------------------------------------- the belt
{
  pack(a, [ITEM.BANDAGE, 1]);
  gun().belt = 7;
  run(2);
  A.sounds.length = B.sounds.length = 0;
  run(30, () => BTN.GUN);
  const out = gun().belt === 0 && seen(A).q[3] === 0;
  const before = B.shots.length;
  run(10, (i) => (i % 2 ? BTN.GUN : 0));
  check('the belt runs out, and then it only clicks: not a round more', out && B.shots.length === before && gun().belt === 0 && B.sounds.includes(SOUND.DRY_FIRE));
  // nothing to feed it with
  A.act(ACT.GUN_FEED, 1);
  run(10);
  check('with no 7.62 carried there is nothing to feed it', gun().belt === 0 && !gun().feeding);
  // 120 rounds: 50 a second, until the 7.62 is out (ammunition is carried apart from the backpack)
  pack(a, [ITEM.BANDAGE, 1]);
  s.ammo[AMMO.R762] = 120;
  run(2);
  B.act(ACT.GUN_FEED, 1);
  run(5);
  const byBob = gun().belt;
  A.act(ACT.GUN_FEED, 1);
  run(20);
  const one = [gun().belt, s.ammo[AMMO.R762], A.self.ammo[AMMO.R762]].join('/');
  // the trigger does nothing while the hand is on the belt
  run(4, () => BTN.GUN);
  const during = B.shots.length - before;
  run(60);
  check('only the gunner feeds it', byBob === 0);
  check('fed from the gunner\'s 7.62 at 50 rounds a second, and the gunner told of what is left', one === '50/70/70', `after a second: belt/reserve/told ${one}`);
  check('...with the trigger dead while the hand is on the belt', during === 0);
  check('...until the 7.62 is out', gun().belt === 120 && s.ammo[AMMO.R762] === 0 && A.self.ammo[AMMO.R762] === 0 && !gun().feeding && has(a, ITEM.BANDAGE) === 1 && seen(B).q[3] === 120, `belt ${gun().belt}, 7.62 ${s.ammo[AMMO.R762]}`);
  // more than it takes: the belt stops at 250
  s.ammo[AMMO.R762] = 240;
  run(2);
  A.act(ACT.GUN_FEED, 1);
  run(30);
  A.act(ACT.GUN_FEED, 0);
  const part = gun().belt;
  run(10);
  const held = gun().belt;
  A.act(ACT.GUN_FEED, 1);
  run(100);
  check('letting go of [R] stops the feed where it is', part === 195 && held === 195, `belt ${part} then ${held}`);
  check('...and it never takes more than the belt holds', gun().belt === GUN.mag && s.ammo[AMMO.R762] === 240 - (GUN.mag - 120) && !gun().feeding, `belt ${gun().belt}, 7.62 ${s.ammo[AMMO.R762]}`);
  B.sounds.length = 0;
}

// ---------------------------------------------------------------- letting go
{
  A.act(ACT.GUN_MAN, 0);
  run(2);
  const free = gun().gunner === 0;
  B.act(ACT.GUN_MAN, 1);
  run(2);
  check('[E] again lets go, and the next survivor can take it', free && gun().gunner === b.id);
  A.act(ACT.GUN_MAN, 1);
  run(2);
  check('...which the first cannot take back from them', gun().gunner === b.id);
  // stepping away
  b.state.x += Math.sin(nest.ry) * 4;
  b.state.z += Math.cos(nest.ry) * 4;
  run(2);
  check('stepping away from the grips lets go', gun().gunner === 0);
  const far = gun().gunner;
  B.act(ACT.GUN_MAN, 1);
  run(2);
  check('...and it cannot be taken from over there', far === 0 && gun().gunner === 0);
  // left pointing where the gunner had it
  toGrips(A);
  A.act(ACT.GUN_MAN, 1);
  A.yaw = nest.ry + 0.5;
  A.pitch = 0.2;
  run(3);
  A.act(ACT.GUN_MAN, 0);
  run(2);
  const aim = gunAim(nest, A.yaw, A.pitch, {});
  check('it stays pointing where it was left', Math.abs(gun().yaw - aim.yaw) < 0.01 && Math.abs(gun().pitch - aim.pitch) < 0.01 && Math.abs(dqpitch((seen(B).q[5] & 127) - 64) * 492 - 0.2) < 0.03, `${(((gun().yaw - nest.ry) * 180) / Math.PI).toFixed(0)} deg round, ${((gun().pitch * 180) / Math.PI).toFixed(0)} deg up`);
  // going down, dying
  A.yaw = nest.ry;
  A.pitch = 0;
  A.act(ACT.GUN_MAN, 1);
  run(2);
  const on = gun().gunner === a.id;
  game.goDown(a);
  run(2);
  const down = gun().gunner;
  game.revive(a, b);
  run(2);
  A.act(ACT.GUN_MAN, 1);
  run(2);
  const again = gun().gunner === a.id;
  game.killPlayer(a, {});
  run(2);
  check('going down lets go, and so does dying', on && down === 0 && again && gun().gunner === 0);
  const belt = gun().belt;
  run(10, () => BTN.GUN, () => BTN.GUN);
  check('...and the dead do not fire it', gun().belt === belt);
}

// ---------------------------------------------------------------- the dead can get at the gunner
{
  game.revive(b, b);
  toGrips(B);
  B.act(ACT.GUN_MAN, 1);
  run(2);
  let mauled = 0;
  const damagePlayer = game.damagePlayer.bind(game);
  game.damagePlayer = (p, amount, src) => {
    if (p === b && src && src.kind === KILLER.ZOMBIE) mauled++;
    return damagePlayer(p, amount, src);
  };
  // nothing else about: what reaches the gunner now is what is put down here
  for (const z of game.zombies) {
    z.dead = true;
    game.removeEntity(z);
  }
  game.zombies.length = 0;
  // runners from in front of the sandbags, from both sides and from behind: all but the last have to go round the
  // horseshoe into its open back
  const fx = -Math.sin(nest.ry);
  const fz = -Math.cos(nest.ry);
  const pack0 = [];
  for (const [f, sd] of [[22, 0], [20, 6], [20, -6], [2, 16], [2, -16], [14, 3], [-18, 2]]) {
    const z = game.zm.spawn(ZTYPE.RUNNER, nest.x + fx * f + Math.cos(nest.ry) * sd, nest.z + fz * f - Math.sin(nest.ry) * sd, { horde: true });
    if (z) pack0.push(z);
  }
  const got = new Set(); // the ones that came within a blow's reach of the gunner
  let ticks = 0;
  while (ticks < 20 * 40 && (got.size < pack0.length || mauled < pack0.length)) {
    run(1);
    ticks++;
    for (const z of pack0) if (Math.hypot(z.x - b.state.x, z.z - b.state.z) < z.def.range + 0.4) got.add(z);
  }
  game.damagePlayer = damagePlayer;
  check('the dead get round the sandbags to the gunner', pack0.length === 7 && got.size === pack0.length && mauled >= pack0.length && gun().gunner === b.id, `${got.size} of ${pack0.length} runners at the grips and ${mauled} blows landed within ${(ticks / 20).toFixed(0)} s; the gun still manned (they do not touch it)`);
  for (const z of pack0) z.hp = 0.1;
}

// ---------------------------------------------------------------- carrying it
{
  for (const z of game.zombies) {
    z.dead = true;
    game.removeEntity(z);
  }
  game.zombies.length = 0;
  game.spawnHuman(a); // (Alice died above: a survivor again)
  game.fillHistory(a);
  const e = gun();
  const ticks = (sec) => Math.ceil(sec * SERVER_TICK_RATE);
  const lift = (c) => {
    c.hold(e.id);
    run(ticks(GUN.lift) + 2);
    c.hold(0);
    run(1);
  };
  // a gunner on it: nobody lifts it from under them
  toGrips(B);
  B.act(ACT.GUN_MAN, 1);
  toGrips(A, 0.6);
  run(2);
  A.hold(e.id);
  run(ticks(GUN.lift) + 2);
  A.hold(0);
  check('nobody lifts the gun from under its gunner', e.mode === GUN_STANDS && e.gunner === b.id && !s.hmg && !a.hold);
  B.act(ACT.GUN_MAN, 0);
  run(2);
  // let go too soon, and it stays
  A.hold(e.id);
  run(ticks(GUN.lift / 2));
  A.hold(0);
  run(ticks(GUN.lift));
  const early = e.mode;
  // held long enough, from beside it (the grips are a step to the side)
  B.sounds.length = 0;
  s.reloadT = 0.5;
  lift(A);
  const g1 = seen(B);
  check(`[E] held for ${GUN.lift} s lifts it, tripod and all; let go sooner and it stays`, early === GUN_STANDS && e.mode === GUN_CARRIED && e.carrier === a.id && s.hmg === 1 && A.self.hmg === 1 && !!g1 && g1.q[7] === GUN_CARRIED && g1.q[4] === a.id && s.reloadT === 0, `mode ${e.mode}, carrier ${e.carrier}, s.hmg ${s.hmg}, Alice told ${A.self.hmg}, Bob sees mode ${g1?.q[7]} carrier ${g1?.q[4]}`);
  check('...with a clank the others hear', B.sounds.includes(SOUND.METAL_HIT));

  // the pace: the same open stretch walked and sprinted by Bob empty-handed and by Alice carrying it
  const open = (() => {
    // somewhere flat and clear: along the road out of the nest, 30 m behind it
    for (let k = 0; k < 40; k++) {
      const ang = nest.ry + (k * Math.PI) / 20;
      const x = nest.x + Math.sin(ang) * 30;
      const z = nest.z + Math.cos(ang) * 30;
      const y = groundAt(game.world, x, z, 200, 0.3);
      const ray = { t: -1, col: null, terrain: false };
      let clear = true;
      for (const h of [0.3, 1]) {
        raycastWorld(game.world, x, y + h, z, -Math.sin(ang), 0, -Math.cos(ang), 16, ray);
        if (ray.t >= 0) clear = false;
      }
      if (clear && Math.abs(groundAt(game.world, x - Math.sin(ang) * 12, z - Math.cos(ang) * 12, 200, 0.3) - y) < 1.2) return { x, y, z, yaw: ang };
    }
    return null;
  })();
  const stretch = (c, buttons, secs) => {
    const st = c.p().state;
    st.x = open.x;
    st.y = open.y;
    st.z = open.z;
    st.vx = st.vy = st.vz = 0;
    st.stamina = 100;
    st.exhausted = 0;
    c.yaw = open.yaw;
    c.pitch = 0;
    for (let i = 0; i < ticks(secs); i++) {
      c.input(buttons);
      game.update();
    }
    return Math.hypot(st.x - open.x, st.z - open.z);
  };
  if (!open) check('an open stretch to walk', false, 'none found near the checkpoint');
  else {
    const walk = stretch(B, BTN.FWD, 2);
    const walkC = stretch(A, BTN.FWD, 2);
    const run2 = stretch(B, BTN.FWD | BTN.SPRINT, 2);
    const runC = stretch(A, BTN.FWD | BTN.SPRINT, 2);
    check(`carrying it, every pace is ${GUN_CARRY_SPEED * 100}%`, s.hmg === 1 && Math.abs(walkC / walk - GUN_CARRY_SPEED) < 0.03 && Math.abs(runC / run2 - GUN_CARRY_SPEED) < 0.03, `walking ${(walk / 2).toFixed(2)} -> ${(walkC / 2).toFixed(2)} m/s, sprinting ${(run2 / 2).toFixed(2)} -> ${(runC / 2).toFixed(2)} m/s (${WALK_SPEED} / ${SPRINT_SPEED} empty-handed)`);
    check('...and the gun goes with its carrier (for everyone, from anywhere)', Math.hypot(e.x - s.x, e.z - s.z) < 0.01 && !!seen(B) && seen(B).q[7] === GUN_CARRIED);
  }
  // hands full: no shot, no swing, no reload, no aim
  s.weapons[SLOT_PRIMARY] = ITEM.AK47;
  s.mags[0] = 5;
  s.ammo[AMMO.R762] = 60;
  const fc = s.fireCount;
  const before = B.shots.length;
  run(15, () => BTN.ATTACK | BTN.ALT);
  run(5, () => BTN.RELOAD);
  run(15, (i) => (i % 2 ? BTN.ATTACK : 0));
  check('carrying it, the fire button, the sights and [R] do nothing', s.hmg === 1 && s.fireCount === fc && s.mags[0] === 5 && s.reloadT === 0 && B.shots.length === before && e.belt === seen(B).q[3], `fired ${s.fireCount - fc}, mag ${s.mags[0]}`);

  // a weapon key drops it where they stand, on its side, and the switch goes ahead
  const slot0 = s.slot;
  const want = slot0 === SLOT_PISTOL ? SLOT_MELEE : SLOT_PISTOL;
  const at = { x: s.x, z: s.z, yaw: A.yaw };
  B.sounds.length = 0;
  A.input(0, 0, want);
  game.update();
  run(1);
  const g2 = seen(B);
  check('reaching for a weapon drops it on its side where they stand, and the weapon comes out', s.hmg === 0 && s.slot === want && e.mode === GUN_LYING && e.carrier === 0 && Math.hypot(e.x - at.x, e.z - at.z) < 0.05 && !!g2 && g2.q[7] === GUN_LYING && B.sounds.includes(SOUND.METAL_HIT) && A.self.hmg === 0, `mode ${e.mode}, ${Math.hypot(e.x - at.x, e.z - at.z).toFixed(2)} m from their feet, slot ${slot0} -> ${s.slot}`);
  // a lying gun is not manned, but it is lifted again from beside it, and not from across the road
  toGrips(B);
  const lying = { x: e.x, z: e.z };
  s.x = lying.x + 3.5;
  s.z = lying.z;
  game.fillHistory(a);
  B.act(ACT.GUN_MAN, 1);
  A.hold(e.id);
  run(ticks(GUN.lift) + 2);
  A.hold(0);
  const far = e.mode;
  s.x = lying.x + 1.4;
  game.fillHistory(a);
  run(1);
  lift(A);
  check('lying, nobody mans it; it is lifted again from beside it, not from 3.5 m off', far === GUN_LYING && e.gunner === 0 && e.mode === GUN_CARRIED && s.hmg === 1);
  // [G] drops it too
  A.act(ACT.GUN_PUT, 0);
  run(1);
  const gDrop = e.mode === GUN_LYING && s.hmg === 0;
  lift(A);
  check('[G] drops it as well', gDrop && e.mode === GUN_CARRIED);

  // set up where they face: a step ahead, facing the way they look
  if (open) {
    s.x = open.x;
    s.y = open.y;
    s.z = open.z;
    s.vx = s.vy = s.vz = 0;
    A.yaw = open.yaw + 0.3;
    game.fillHistory(a);
    run(2);
    const spot = setUpSpot(game.world, s, {});
    // (Bob in earshot, behind Alice)
    b.state.x = open.x + Math.sin(open.yaw) * 4;
    b.state.y = open.y;
    b.state.z = open.z + Math.cos(open.yaw) * 4;
    game.fillHistory(b);
    B.sounds.length = 0;
    A.act(ACT.GUN_PUT, 1);
    run(2);
    const n2 = game.gun.nest;
    const g3 = seen(B);
    const ahead = n2 && (n2.x - s.x) * -Math.sin(A.yaw) + (n2.z - s.z) * -Math.cos(A.yaw);
    check('[E] sets it up a step ahead of the carrier, facing the way they look, its feet on their ground', !!spot && e.mode === GUN_STANDS && s.hmg === 0 && !!n2 && Math.abs(ahead - GUN.setOut) < 0.05 && Math.abs(n2.ry - snapNest({ x: 0, y: 0, z: 0, ry: A.yaw }).ry) < 1e-9 && Math.abs(n2.y - s.y) < 0.4 && !!g3 && g3.q[7] === GUN_STANDS && B.sounds.includes(SOUND.GUN_MAN), n2 ? `${ahead.toFixed(2)} m ahead, facing ${((n2.ry * 180) / Math.PI).toFixed(1)} deg, ${(n2.y - s.y).toFixed(2)} m below their feet` : 'not set up');
    // ...and there it is manned and fired like at the checkpoint, its arc about the new facing
    A.act(ACT.GUN_MAN, 1);
    run(2);
    const belt = e.belt;
    A.yaw = n2.ry + 2; // (past the arc: it fires from its stop)
    const shots0 = B.shots.length;
    run(10, () => BTN.GUN);
    const last = B.shots[B.shots.length - 1];
    check('...and manned there, it fires inside an arc about the way it was set up', e.gunner === a.id && belt - e.belt === 5 && B.shots.length - shots0 === 5 && !!last && Math.abs(((last.yaw - n2.ry + Math.PI * 3) % (Math.PI * 2)) - Math.PI - GUN.arc) < 0.01, `${belt - e.belt} rounds, the last ${last ? (((((last.yaw - n2.ry + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * 180) / Math.PI).toFixed(1) : '-'} deg off its facing`);
    A.act(ACT.GUN_MAN, 0);
    run(2);
  }

  // up against the checkpoint's own sandbags: it goes down behind them, nearer than a step
  {
    if (!s.hmg) lift(A);
    const fx = -Math.sin(nest.ry);
    const fz = -Math.cos(nest.ry);
    const ray = { t: -1, col: null, terrain: false };
    raycastWorld(game.world, nest.x, nest.y + 0.6, nest.z, fx, 0, fz, 4, ray);
    const face = ray.t; // the front sandbags, from the pintle
    s.x = nest.x + fx * (face - 0.85);
    s.z = nest.z + fz * (face - 0.85);
    s.y = nest.y;
    s.vx = s.vy = s.vz = 0;
    A.yaw = nest.ry;
    game.fillHistory(a);
    run(2);
    A.act(ACT.GUN_PUT, 1);
    run(2);
    const n3 = game.gun.nest;
    const d = n3 ? Math.hypot(n3.x - s.x, n3.z - s.z) : -1;
    check('up against sandbags it goes down right behind them, nearer than a step', face > 0 && e.mode === GUN_STANDS && Math.abs(d - (0.85 - GUN.clear)) < 0.03, `the sandbags 0.85 m ahead of the carrier, the pintle ${d.toFixed(2)} m`);
    lift(A);
  }

  // into a wall: no room, and it stays in their arms
  {
    let wall = null;
    for (const pt of game.world.parts) {
      if (pt.shape !== 'box' || pt.sy < 2.4 || pt.sz > 0.4 || pt.sx < 3) continue;
      const nx = Math.sin(pt.ry || 0);
      const nz = Math.cos(pt.ry || 0);
      const d = pt.sz / 2 + PLAYER_RADIUS + 0.12;
      for (const side of [1, -1]) {
        const x = pt.x + nx * d * side;
        const z = pt.z + nz * d * side;
        const y = groundAt(game.world, x, z, pt.y + 0.5, 0.3);
        if (Math.abs(y - pt.y) > 0.3 || game.world.isDeepWater(x, z)) continue;
        const pos = { x, y, z };
        resolveBody(game.world, pos, PLAYER_RADIUS, PLAYER_HEIGHT, true);
        if (Math.hypot(pos.x - x, pos.z - z) > 0.01) continue;
        wall = { x, y, z, yaw: Math.atan2(nx * side, nz * side) };
        break;
      }
      if (wall) break;
    }
    lift(A);
    if (!wall) check('a wall to face', false, 'no wall found');
    else {
      s.x = wall.x;
      s.y = wall.y;
      s.z = wall.z;
      s.vx = s.vy = s.vz = 0;
      A.yaw = wall.yaw;
      game.fillHistory(a);
      run(2);
      A.act(ACT.GUN_PUT, 1);
      run(2);
      check('facing a wall a step off, there is no room to set it up: it stays in their arms', !setUpSpot(game.world, s, {}) && e.mode === GUN_CARRIED && s.hmg === 1, `mode ${e.mode}`);
    }
  }

  // into the lake: nobody swims with it. They wade in as far as their feet keep the bottom, and stop there
  {
    const L = game.world.lake;
    if (!s.hmg) lift(A);
    if (!L) check('a lake to walk into', false, `seed ${seed} has none`);
    else {
      const ang = Math.atan2(-L.x, -L.z);
      s.x = L.x + Math.sin(ang) * (L.r + 10);
      s.z = L.z + Math.cos(ang) * (L.r + 10);
      s.y = groundAt(game.world, s.x, s.z, 200, 0.3);
      s.vx = s.vy = s.vz = 0;
      A.yaw = Math.atan2(s.x - L.x, s.z - L.z); // facing the middle of the lake
      game.fillHistory(a);
      let afloat = 0;
      let deepest = 0;
      for (let t = 0; t < 25 * SERVER_TICK_RATE; t++) {
        A.input(BTN.FWD | BTN.SPRINT);
        game.update();
        if (swimming(game.world, s)) afloat++;
        deepest = Math.max(deepest, WATER_LEVEL - s.y);
      }
      check('carrying it, the deep water stops them where they would float: they wade in and no further', afloat === 0 && deepest > 0.5 && s.hmg === 1 && e.carrier === a.id, `${afloat} ticks afloat, waded ${deepest.toFixed(2)} m deep`);
    }
  }

  // going down, dying, a dropped connection, leaving: it goes down where they fell
  {
    if (!s.hmg) lift(A);
    const w0 = { x: s.x, z: s.z };
    game.goDown(a);
    run(2);
    const down = e.mode === GUN_LYING && s.hmg === 0 && Math.hypot(e.x - w0.x, e.z - w0.z) < 0.05;
    game.revive(a, b);
    run(2);
    lift(A);
    game.killPlayer(a, {});
    run(2);
    const dead = e.mode === GUN_LYING && s.hmg === 0;
    game.spawnHuman(a);
    run(2);
    check('going down or dying drops it where they fell', down && dead, `down ${down}, dead ${dead}`);
  }
  {
    const C = client('Carol');
    const c = C.p();
    run(2);
    const cs = c.state;
    cs.x = e.x + 1;
    cs.y = e.y - GUN.pivotY;
    cs.z = e.z;
    game.fillHistory(c);
    run(1);
    c.rejoinKey = 'carol';
    lift(C);
    const had = e.mode === GUN_CARRIED && e.carrier === c.id;
    cs.x += 2;
    run(2);
    game.onClose(C.session, 1006); // dropped: their place is held
    run(2);
    const away = e.mode === GUN_LYING && Math.hypot(e.x - cs.x, e.z - cs.z) < 0.05;
    check('a carrier whose connection drops lets it fall where they stood', had && away, `carried ${had}, then mode ${e.mode}`);
    if (c) game.removePlayer(c);
    const D = client('Dave');
    const d = D.p();
    run(2);
    d.state.x = e.x + 1;
    d.state.y = e.y - GUN.pivotY;
    d.state.z = e.z;
    game.fillHistory(d);
    run(1);
    lift(D);
    const had2 = e.carrier === d.id;
    const at2 = { x: d.state.x, z: d.state.z };
    game.onClose(D.session, 4001); // "Leave game"
    run(2);
    check('...and so does one who leaves the game', had2 && e.mode === GUN_LYING && Math.hypot(e.x - at2.x, e.z - at2.z) < 0.05);
  }
}

// ---------------------------------------------------------------- a new game
{
  gun().belt = 33;
  const old = gun();
  game.startGame();
  game.handleChat(a, '/gun');
  run(3);
  check('a new game resets it: back on its tripod at the checkpoint, a full belt, nobody at it, nobody carrying it', gun() && gun() !== old && old.removed && gun().belt === GUN.mag && gun().gunner === 0 && gun().mode === GUN_STANDS && gun().x === nest.x && gun().z === nest.z && !s.hmg && seen(A)?.q[3] === GUN.mag);
}

// ---------------------------------------------------------------- a map without the checkpoint
{
  let none = 0;
  for (let sd = 1; sd < 60 && !none; sd++) if (!createWorld(sd).zoneById[ZONE.CHECKPOINT]) none = sd;
  const g2 = new Game({ seed: none, godMode: true, dayLength: 3600, themes: false, log: () => {} });
  const said = [];
  const conn = {
    send(bytes) {
      const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
      if (r.u8() === S2C.CHAT) {
        r.u16();
        r.u8();
        said.push(r.str());
      }
    },
  };
  const session = g2.onOpen(conn);
  const w = new Writer(64);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str('Carol');
  g2.onMessage(session, w.bytes().slice());
  for (let i = 0; i < 3; i++) g2.update();
  const p = [...g2.players.values()][0];
  p.admin = true; // (/gun)
  const at = [p.state.x, p.state.z].join();
  g2.handleChat(p, '/gun');
  const w2 = new Writer(8);
  w2.u8(C2S.ACTION);
  w2.u8(ACT.GUN_MAN);
  w2.u8(1);
  g2.onMessage(session, w2.bytes().slice());
  for (let i = 0; i < 3; i++) g2.update();
  check('a valley without the checkpoint has no gun, and /gun says so', !g2.gun.gun && !g2.all.some((e) => e.kind === ENT.GUN) && [p.state.x, p.state.z].join() === at && said.some((t) => /no Army Checkpoint/.test(t)), `seed ${none}`);
}

void GF;
console.log(fails.length ? `\n${fails.length} FAILED:\n  ${fails.join('\n  ')}` : '\nall mounted gun checks passed');
process.exit(fails.length ? 1 : 0);
