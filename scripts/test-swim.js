// Swimming in the lake and the ponds (shared/swim.js, shared/playersim.js, Game.updatePlayers), against the real server
// in-process with a survivor driven by real input. On each seed they walk in off the shore towards the middle of the
// lake:
//   - wading slows them, a crouch is let go before it would duck the eyes under, and further out they float with
//     their feet at floatY and their eyes SWIM_CLEAR above the surface
//   - afloat they swim at SWIM_SPEED (SWIM_FAST on sprint), can't jump, and nothing in their hands works
//   - stamina only goes in deep water, at the treading, swimming and sprinting rates; out of it they drown at
//     DROWN_DPS, and the killfeed says the water did it
//   - their feet find the bottom again on the way back, they walk out, and stamina comes back
//   - a survivor who falls into the lake from high up splashes in unhurt (the same fall onto the ground hurts)
//   - a turned survivor stops at the edge of the deep water like the rest of the dead
// usage: node scripts/test-swim.js [seed ...]
import { Game } from '../server/game.js';
import { C2S, S2C, PROTOCOL_VERSION, Writer, Reader, qangle16, qpitch, writeInput } from '../shared/protocol.js';
import { BTN, SERVER_TICK_RATE, WATER_LEVEL, STAMINA_MAX, STAMINA_DRAIN, SLOT_PISTOL } from '../shared/constants.js';
import { KILLER } from '../shared/defs.js';
import { groundAt } from '../shared/collision.js';
import { eyeHeight } from '../shared/playersim.js';
import { swimming, floatY, SWIM_SPEED, SWIM_FAST, SWIM_TREAD, SWIM_DRAIN, DROWN_DPS, CROUCH_WADE } from '../shared/swim.js';

const seeds = process.argv.slice(2).map(Number).filter((n) => n > 0);
if (!seeds.length) seeds.push(1, 2, 3);
const DT = 1 / SERVER_TICK_RATE;
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

function setup(seed, godMode) {
  const game = new Game({ seed, godMode, dayLength: 3600, themes: false, log: () => {} });
  const c = { id: 0, seq: 0, yaw: 0, pitch: 0, events: [] };
  c.conn = {
    send(bytes) {
      const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
      if (r.u8() === S2C.WELCOME) c.id = r.u16();
    },
  };
  c.session = game.onOpen(c.conn);
  const w = new Writer(64);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str('Swimmer');
  game.onMessage(c.session, w.bytes().slice());
  c.input = (buttons) => {
    const w2 = new Writer(64);
    w2.u8(C2S.INPUT);
    w2.u16(game.tick & 0xffff);
    w2.u8(0);
    const cmds = [];
    for (let i = 0; i < 3; i++) {
      c.seq = (c.seq + 1) & 0xffff;
      cmds.push({ seq: c.seq, buttons, qyaw: qangle16(c.yaw), qpitch: qpitch(c.pitch), slot: 255 });
    }
    writeInput(w2, cmds);
    game.onMessage(c.session, w2.bytes().slice());
  };
  for (let i = 0; i < 5; i++) {
    c.input(0);
    game.update();
  }
  const p = game.players.get(c.id);
  const kf = game.killfeed.bind(game);
  c.kills = [];
  game.killfeed = (...a) => {
    c.kills.push(a);
    kf(...a);
  };
  return { game, c, p };
}

function clear(game) {
  for (const z of [...game.zombies]) {
    game._listRemove(game.zombies, z);
    game.removeEntity(z);
  }
  game.zm.herds.reset();
  game.zm.maintainT = game.zm.herds.spawnT = 1e9;
}

function place(env, x, z, y) {
  const s = env.p.state;
  s.x = x;
  s.z = z;
  s.y = y ?? groundAt(env.game.world, x, z, 200, 0.3);
  s.vx = s.vy = s.vz = 0;
  s.onGround = 1;
  s.stamina = STAMINA_MAX;
  s.exhausted = 0;
}

// a tick of the server with these buttons held (3 commands a tick)
function tick(env, buttons) {
  env.c.input(buttons);
  env.game.update();
}

function runSeed(seed) {
  const env = setup(seed, false);
  const { game, c, p } = env;
  const w = game.world;
  const L = w.lake;
  const s = p.state;
  clear(game);
  // in from the shore on the side facing the middle of the map, across, and out the far side
  const a = Math.atan2(-L.x, -L.z);
  place(env, L.x + Math.sin(a) * (L.r + 10), L.z + Math.cos(a) * (L.r + 10));
  c.yaw = Math.atan2(s.x - L.x, s.z - L.z); // facing the middle of the lake
  s.slot = SLOT_PISTOL;
  s.mags[1] = 12;
  s.switchT = 0;
  const tag = `seed ${seed}:`;
  let crouchWade = 0; // deepest a crouch was kept at
  let wadeSlow = Infinity; // slowest speed walking in, wading
  let floated = null; // the first tick afloat
  let swimV = 0;
  let firedAfloat = 0;
  let jumpedAfloat = false;
  let maxFeetAfloat = -Infinity;
  let minFeetAfloat = Infinity;
  let eyeAfloat = 0;
  for (let t = 0; t < 30 * SERVER_TICK_RATE && !floated; t++) {
    const depth = WATER_LEVEL - s.y;
    tick(env, BTN.FWD | BTN.CROUCH);
    if (s.crouch) crouchWade = Math.max(crouchWade, WATER_LEVEL - s.y);
    if (depth > 0.9 && !swimming(w, s)) wadeSlow = Math.min(wadeSlow, Math.hypot(s.vx, s.vz));
    if (swimming(w, s)) floated = { t, x: s.x, z: s.z };
  }
  check(`${tag} walked in until they floated`, !!floated, floated ? `${Math.hypot(floated.x - L.x, floated.z - L.z).toFixed(1)} m from the middle of a ${L.r.toFixed(0)} m lake` : '');
  if (!floated) return;
  check(`${tag} a crouch is let go before the eyes go under`, crouchWade > 0.5 && crouchWade < CROUCH_WADE + 0.05, `kept to ${crouchWade.toFixed(2)} m deep`);
  check(`${tag} wading in deep is slow`, wadeSlow < 3.2, `${wadeSlow.toFixed(2)} m/s`);
  // swim on across, pulling the trigger and jumping all the way
  const fc = s.fireCount;
  const mag = s.mags[1];
  const st0 = s.stamina;
  let n = 0;
  for (let t = 0; t < 6 * SERVER_TICK_RATE; t++) {
    tick(env, BTN.FWD | (t & 1 ? BTN.ATTACK : BTN.JUMP));
    if (!swimming(w, s)) continue;
    n++;
    swimV = Math.hypot(s.vx, s.vz);
    if (s.vy > 0 || !s.onGround) jumpedAfloat = true;
    maxFeetAfloat = Math.max(maxFeetAfloat, s.y);
    minFeetAfloat = Math.min(minFeetAfloat, s.y);
    eyeAfloat = s.y + eyeHeight(s) - WATER_LEVEL;
  }
  firedAfloat = ((s.fireCount - fc) & 255) + (mag - s.mags[1]);
  check(`${tag} afloat at the float height`, n > 0 && near(maxFeetAfloat, floatY(s), 0.005) && near(minFeetAfloat, floatY(s), 0.005), `feet ${(minFeetAfloat - WATER_LEVEL).toFixed(3)}..${(maxFeetAfloat - WATER_LEVEL).toFixed(3)} m, eyes ${eyeAfloat.toFixed(2)} m out`);
  check(`${tag} swims at SWIM_SPEED`, near(swimV, SWIM_SPEED, 0.01), `${swimV.toFixed(2)} m/s`);
  check(`${tag} no jumping and no shooting afloat`, !jumpedAfloat && firedAfloat === 0, `jumped ${jumpedAfloat}, ${firedAfloat} shots`);
  const drained = st0 - s.stamina;
  check(`${tag} swimming drains stamina`, near(drained, SWIM_DRAIN * 6, 0.6), `${drained.toFixed(1)} in 6 s`);
  // sprint strokes
  const st1 = s.stamina;
  let fast = 0;
  for (let t = 0; t < 2 * SERVER_TICK_RATE; t++) {
    tick(env, BTN.FWD | BTN.SPRINT);
    fast = Math.hypot(s.vx, s.vz);
  }
  check(`${tag} sprint strokes: SWIM_FAST at the sprinting rate`, swimming(w, s) && near(fast, SWIM_FAST, 0.01) && near(st1 - s.stamina, STAMINA_DRAIN * 2, 0.6), `${fast.toFixed(2)} m/s, ${(st1 - s.stamina).toFixed(1)} stamina in 2 s`);
  // treading water: still draining, never coming back
  const st2 = s.stamina;
  for (let t = 0; t < 4 * SERVER_TICK_RATE; t++) tick(env, 0);
  check(`${tag} treading water drains stamina too`, swimming(w, s) && near(st2 - s.stamina, SWIM_TREAD * 4, 0.5), `${(st2 - s.stamina).toFixed(1)} in 4 s`);
  // out of it: drowning
  s.stamina = 0.5;
  const hp0 = p.hp;
  p.lastDamageT = game.time;
  for (let t = 0; t < 3 * SERVER_TICK_RATE; t++) tick(env, 0);
  const lost = hp0 - p.hp;
  check(`${tag} out of stamina afloat they drown`, s.exhausted === 1 && near(lost, DROWN_DPS * (3 - 0.5 / SWIM_TREAD), DROWN_DPS * 0.5), `${lost.toFixed(1)} hp in 3 s`);
  // back the way they came (the far shore can run into the edge of the map): feet find the bottom, stamina comes back
  c.yaw += Math.PI;
  s.stamina = STAMINA_MAX;
  s.exhausted = 0;
  p.hp = p.maxHp;
  let out = -1;
  for (let t = 0; t < 70 * SERVER_TICK_RATE && out < 0; t++) {
    tick(env, BTN.FWD);
    if (!swimming(w, s) && s.y > WATER_LEVEL) out = t;
    if (t % SERVER_TICK_RATE === 0) s.stamina = STAMINA_MAX; // (a long lake: keep them from drowning on the way)
  }
  check(`${tag} they swim back and walk out`, out >= 0, `${Math.hypot(s.x - L.x, s.z - L.z).toFixed(1)} m from the middle`);
  s.stamina = 40;
  for (let t = 0; t < 2 * SERVER_TICK_RATE; t++) tick(env, 0);
  check(`${tag} stamina comes back on dry ground`, s.stamina > 60, `${s.stamina.toFixed(1)}`);
  check(`${tag} still alive and nobody drowned so far`, p.alive && !p.downed && c.kills.length === 0);
  // high fall into the deep water: a splash, no harm. The same fall onto the shore does hurt
  place(env, L.x + 3, L.z + 3, WATER_LEVEL + 12);
  s.onGround = 0;
  p.hp = p.maxHp;
  for (let t = 0; t < 3 * SERVER_TICK_RATE; t++) tick(env, 0);
  check(`${tag} a 12 m fall into the lake does not hurt`, swimming(w, s) && p.hp === p.maxHp, `hp ${p.hp.toFixed(0)}`);
  place(env, L.x + Math.sin(a) * (L.r + 30), L.z + Math.cos(a) * (L.r + 30));
  s.y += 12;
  s.onGround = 0;
  p.hp = p.maxHp;
  for (let t = 0; t < 3 * SERVER_TICK_RATE; t++) tick(env, 0);
  check(`${tag} ...where the same fall onto the shore does`, p.hp < p.maxHp, `hp ${p.hp.toFixed(0)}`);
  // drowned for good: the killfeed blames the water
  p.hp = 8;
  place(env, L.x, L.z, floatY(s));
  s.stamina = 0;
  s.exhausted = 1;
  for (let t = 0; t < 90 * SERVER_TICK_RATE && p.alive; t++) tick(env, 0);
  const k = c.kills.find((x) => x[2] === p.id);
  check(`${tag} drowning kills, and the feed says the water did it`, !p.alive && !!k && k[0] === KILLER.WORLD && (k[4] & 4) !== 0, k ? `flags ${k[4]}` : 'no killfeed');
}

function runTurned(seed) {
  const env = setup(seed, true);
  const { game, c, p } = env;
  const w = game.world;
  const L = w.lake;
  clear(game);
  game.spawnPlayerZombie(p);
  const s = p.state;
  const a = Math.atan2(-L.x, -L.z);
  place(env, L.x + Math.sin(a) * (L.r + 10), L.z + Math.cos(a) * (L.r + 10));
  c.yaw = Math.atan2(s.x - L.x, s.z - L.z);
  let wet = 0;
  for (let t = 0; t < 30 * SERVER_TICK_RATE; t++) {
    tick(env, BTN.FWD);
    if (w.isDeepWater(s.x, s.z) && s.y <= w.heightAt(s.x, s.z) + 0.01) wet++;
  }
  check(`seed ${seed}: a turned survivor stops at the deep water`, s.zombie && wet === 0 && !swimming(w, s), `${Math.hypot(s.x - L.x, s.z - L.z).toFixed(1)} m from the middle, ${wet} ticks in it`);
}

for (const seed of seeds) {
  runSeed(seed);
  runTurned(seed);
}
console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
process.exit(fails.length ? 1 : 0);
