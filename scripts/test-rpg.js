// The RPG: one grenade at a time (WEAPONS[ITEM.RPG], shared/defs.js), flown by the server as a projectile
// (Combat.launch, PROJ.ROCKET in Combat.updateProjectiles) until it strikes something, then a blast (Combat.explode).
// In-process checks against a real Game: the shared sim fires it once and re-arms it by itself; the grenade flies
// rather than striking at once, bursts on the one it is aimed at and takes the dead round it along, leaves those out of
// the blast alone, bursts on the ground it is fired into, goes off by itself at the end of its range, starts as far
// along its flight as the shooter's lag, gives the shooter a hit marker, and hurts no survivor.
// usage: node scripts/test-rpg.js [seed]
import { Game } from '../server/game.js';
import { C2S, PROTOCOL_VERSION, ENT, Writer } from '../shared/protocol.js';
import { BTN, CMD_DT, SERVER_DT, SLOT_PRIMARY, INTERP_DELAY } from '../shared/constants.js';
import { ITEM, WEAPONS, RECIPES, AMMO, PROJ, ZTYPE, EVT } from '../shared/defs.js';
import { createPlayerState, simulatePlayer } from '../shared/playersim.js';
import { raycastWorld, groundAt } from '../shared/collision.js';
import { rocketStrikesWorld } from '../shared/rocket.js';

const seed = +(process.argv[2] || 4242);
const game = new Game({ seed, godMode: true, dayLength: 3600, log: () => {} });
const w = game.world;
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};
const DEF = WEAPONS[ITEM.RPG];

// ---------------------------------------------------------------- the weapon in the shared sim
{
  check('one round, re-armed by itself, from its own ammunition', DEF.mag === 1 && DEF.autoReload && DEF.ammo === AMMO.ROCKET && !!DEF.rocket);
  const rec = RECIPES.find((r) => r.out === ITEM.RPG);
  const ammo = RECIPES.find((r) => r.out === ITEM.AMMO_ROCKET);
  check('both made at the workbench once the explosives schematic is found', rec?.station === 'bench' && rec.schem === ITEM.SCHEM_EXPLOSIVES && ammo?.station === 'bench' && ammo.schem === ITEM.SCHEM_EXPLOSIVES);

  const s = createPlayerState();
  s.weapons[SLOT_PRIMARY] = ITEM.RPG;
  s.slot = SLOT_PRIMARY;
  s.mags[0] = 1;
  s.ammo[AMMO.ROCKET] = 2;
  s.switchT = 0;
  const flat = { heightAt: () => 0, floorAt: () => 0, colliderGrids: [], structGrid: null };
  const events = [];
  let seq = 0;
  const step = (buttons) => simulatePlayer(s, { seq: seq++, buttons, yaw: 0, pitch: 0, slot: 255 }, flat, events);
  let ok = true;
  try {
    step(BTN.ATTACK);
  } catch (e) {
    ok = false;
    console.log(e);
  }
  if (ok) {
    const fired = events.filter((e) => e.type === 'fire');
    check('the trigger fires it once', fired.length === 1 && fired[0].weapon === ITEM.RPG && s.mags[0] === 0);
    events.length = 0;
    for (let i = 0; i < 20; i++) step(BTN.ATTACK); // (held: it does not fire again, empty)
    check('...and empty, holding the trigger fires nothing more', !events.some((e) => e.type === 'fire'));
    events.length = 0;
    const n = Math.ceil((DEF.rate + DEF.reload) / CMD_DT) + 4;
    for (let i = 0; i < n; i++) step(0);
    check(`...it re-arms by itself in ${DEF.rate + DEF.reload} s, from the reserve`, s.mags[0] === 1 && s.ammo[AMMO.ROCKET] === 1 && events.some((e) => e.type === 'reload') && events.some((e) => e.type === 'reload_done'), `mag ${s.mags[0]} reserve ${s.ammo[AMMO.ROCKET]}`);
  } else check('the shared sim runs the RPG', false);
}

// ---------------------------------------------------------------- the grenade on the server
function client(name) {
  const c = { name, id: 0 };
  c.conn = {
    send(bytes) {
      if (bytes[0] === 1 && !c.id) c.id = bytes[1] | (bytes[2] << 8); // (S2C.WELCOME: u8 type, u16 id)
    },
  };
  c.session = game.onOpen(c.conn);
  const wr = new Writer(64);
  wr.u8(C2S.JOIN);
  wr.u8(PROTOCOL_VERSION);
  wr.str(name);
  game.onMessage(c.session, wr.bytes().slice());
  return c;
}
const A = client('Alice');
const B = client('Bob');
const players = [...game.players.values()];
const a = players[0];
const b = players[1];
const tick = (n = 1) => {
  for (let i = 0; i < n; i++) game.update();
};
tick(2);

// the events the game emits (EVT type, its first byte, who it is for), kept from here on
const emitted = [];
const emit = game.emit.bind(game);
game.emit = (fn, opts = {}) => {
  emit(fn, opts);
  const e = game.events[game.events.length - 1];
  emitted.push({ type: e.bytes[0], b1: e.bytes[1], to: opts.to || 0 });
};
const explosions = [];
const explode = game.combat.explode.bind(game.combat);
game.combat.explode = (x, y, z, r, opts) => {
  explosions.push({ x, y, z, r, opts, tick: game.tick });
  explode(x, y, z, r, opts);
};

const put = (p, x, z) => {
  const s = p.state;
  s.x = x;
  s.z = z;
  s.y = groundAt(w, x, z, 200, 0.3);
  s.vx = s.vy = s.vz = 0;
  game.fillHistory(p);
};
const ground = (x, z) => groundAt(w, x, z, 200, 0.3);
const rockets = () => game.projectiles.filter((e) => e.ptype === PROJ.ROCKET);
// the valley to ourselves: none of the dead about unless a check puts one there
const clearZombies = () => {
  for (const z of [...game.zombies]) game.removeEntity(z);
  game.zombies.length = 0;
};
game.zm.spawnRoamer = () => null;
game.zm.spawnForestPack = () => 0;
if (game.zm.herds) game.zm.herds.spawn = () => null;

// somewhere open: 40 m of clear, fairly level ground ahead of the shooter
let spot = null;
for (let r = 0; r < 400 && !spot; r += 20) {
  for (let k = 0; k < 16 && !spot; k++) {
    const ang = (k / 16) * Math.PI * 2;
    const x = a.state.x + Math.cos(ang) * r;
    const z = a.state.z + Math.sin(ang) * r;
    for (let j = 0; j < 8 && !spot; j++) {
      const yaw = (j / 8) * Math.PI * 2;
      const dx = -Math.sin(yaw);
      const dz = -Math.cos(yaw);
      const y0 = ground(x, z);
      let level = true;
      for (let d = 2; d <= 40; d += 2) if (Math.abs(ground(x + dx * d, z + dz * d) - y0) > 1) level = false;
      if (!level) continue;
      const out = { t: -1 };
      raycastWorld(w, x, y0 + 1.62, z, dx, 0, dz, 40, out);
      if (out.t < 0) spot = { x, z, yaw, dx, dz };
    }
  }
}
check('found open ground to shoot over', !!spot);

// fire from the shooter's eye at (tx,ty,tz); lag: how far behind the server tick the shooter's picture was (ticks)
const fireAt = (tx, ty, tz, lag = 0) => {
  const s = a.state;
  const oy = s.y + 1.62;
  const dx = tx - s.x;
  const dz = tz - s.z;
  a.renderTick = (game.tick - lag) & 0xffff;
  a.renderFrac = 0;
  game.combat.fire(a, { weapon: ITEM.RPG, x: s.x, y: oy, z: s.z, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(ty - oy, Math.hypot(dx, dz)), recoilPitch: 0, spread: 0, seed: 1 });
};
const flyOut = (max = 200) => {
  let n = 0;
  while (rockets().length && n < max) {
    tick();
    n++;
  }
  return n;
};

if (spot) {
  const at = (d, side = 0) => ({ x: spot.x + spot.dx * d + spot.dz * side, z: spot.z + spot.dz * d - spot.dx * side });
  put(a, spot.x, spot.z);
  put(b, spot.x - spot.dx * 3, spot.z - spot.dz * 3); // a friend just behind
  // (the dead held still where they are put: nothing walks between the shot and the blast)
  const hold = (z) => (z.def = { ...z.def, speed: 0.001 });

  // a direct hit at 20 m, the dead round it
  clearZombies();
  const t0 = at(20);
  const near = at(22, 2.5);
  const far = at(20, 9);
  const target = game.zm.spawn(ZTYPE.TANK, t0.x, t0.z);
  const side = game.zm.spawn(ZTYPE.WALKER, near.x, near.z);
  const away = game.zm.spawn(ZTYPE.WALKER, far.x, far.z);
  [target, side, away].forEach(hold);
  tick();
  const hp0 = [target.hp, side.hp, away.hp];
  const ahp = a.hp;
  const bhp = b.hp;
  emitted.length = 0;
  explosions.length = 0;
  fireAt(target.x, target.y + 1.2, target.z);
  check('the shot is a grenade in flight, not a hit at once', rockets().length === 1 && target.hp === hp0[0] && explosions.length === 0);
  const flew = flyOut();
  const blast = explosions[0];
  const hitAt = blast ? Math.hypot(blast.x - spot.x, blast.z - spot.z) : -1;
  check(`...that flies at ${DEF.rocket.speed} m/s (20 m in about ${(20 / DEF.rocket.speed).toFixed(2)} s)`, Math.abs(flew * SERVER_DT - 20 / DEF.rocket.speed) <= 2 * SERVER_DT, `${(flew * SERVER_DT).toFixed(2)} s`);
  check('...and bursts on the one it was aimed at', explosions.length === 1 && hitAt > 18 && hitAt < 20.5 && blast.r === DEF.rocket.radius, `${hitAt.toFixed(1)} m out`);
  check('...hurting it hard', target.hp < hp0[0] - DEF.damage * 0.7, `Tank ${hp0[0]} -> ${Math.round(target.hp)}`);
  check('...and the walker next to it is torn apart too (area damage)', side.dead, `hp ${Math.round(side.hp)}`);
  check(`...but one ${9} m to the side is left alone`, !away.dead && away.hp === hp0[2]);
  check('the shooter gets a hit marker, with the kill', emitted.some((e) => e.type === EVT.HITMARK && e.to === a.id && e.b1 & 8 && e.b1 & 2));
  check('...and an explosion goes out to everyone', emitted.some((e) => e.type === EVT.EXPLOSION && !e.to));
  check('no survivor is hurt by it: friendly fire is off', a.hp === ahp && b.hp === bhp && a.alive && b.alive);
  check('...and the grenade is gone from the world', rockets().length === 0 && !game.ents.some?.((e) => e?.kind === ENT.PROJECTILE && e.ptype === PROJ.ROCKET));

  // into the ground 12 m ahead, a walker 2 m from where it lands
  clearZombies();
  const g0 = at(12);
  const gz = at(12, 2);
  const w1 = game.zm.spawn(ZTYPE.WALKER, gz.x, gz.z);
  hold(w1);
  tick();
  explosions.length = 0;
  fireAt(g0.x, ground(g0.x, g0.z), g0.z);
  flyOut();
  const gb = explosions[0];
  check('fired into the ground, it bursts there', !!gb && Math.abs(Math.hypot(gb.x - spot.x, gb.z - spot.z) - 12) < 1.2 && Math.abs(gb.y - ground(gb.x, gb.z)) < 0.6, gb ? `${Math.hypot(gb.x - spot.x, gb.z - spot.z).toFixed(1)} m out, ${(gb.y - ground(gb.x, gb.z)).toFixed(2)} m up` : 'no blast');
  check('...and kills the walker beside the impact', w1.dead);

  // up into the sky: it goes off by itself at the end of its range
  clearZombies();
  explosions.length = 0;
  const s = a.state;
  game.combat.fire(a, { weapon: ITEM.RPG, x: s.x, y: s.y + 1.62, z: s.z, yaw: spot.yaw, pitch: 0.5, recoilPitch: 0, spread: 0, seed: 1 });
  const up = flyOut(400);
  const sb = explosions[0];
  const reach = sb ? Math.hypot(sb.x - spot.x, sb.z - spot.z) : 0;
  check(`fired at the sky, it bursts by itself ${DEF.range} m out`, !!sb && Math.abs(reach - DEF.range) < DEF.rocket.speed * SERVER_DT + 1 && rockets().length === 0, `${reach.toFixed(0)} m, ${(up * SERVER_DT).toFixed(1)} s`);

  // lag: the grenade starts as far along as the shooter's own has flown by the time the shot reaches the server (the
  // picture it was aimed at, less the interpolation the world is drawn behind by)
  clearZombies();
  const lag = 4; // ticks: 0.2 s
  fireAt(at(40).x, s.y + 1.62, at(40).z, lag);
  tick();
  const r0 = rockets()[0];
  const went = r0 ? Math.hypot(r0.x - spot.x, r0.z - spot.z) : 0;
  const want = DEF.rocket.speed * (lag * SERVER_DT - INTERP_DELAY + SERVER_DT);
  check(`a shot from ${lag * SERVER_DT} s back starts ${(lag * SERVER_DT - INTERP_DELAY).toFixed(1)} s along its flight`, Math.abs(went - want) < 0.5, `${went.toFixed(1)} m after one tick (${want.toFixed(1)} expected)`);
  flyOut();

  // skimming the ground: the server (a step a tick) and the shooter's own drawing of it (client/game/rockets.js: a
  // step a frame) bring it down in the same place
  clearZombies();
  const ray = { t: -1, col: null, terrain: false };
  let worst = 0;
  let shots = 0;
  for (let k = 0; k < 12; k++) {
    const yaw = (k / 12) * Math.PI * 2;
    const pitch = -0.03 - (k % 3) * 0.01;
    const cp = Math.cos(pitch);
    const d = [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
    const o = { x: s.x, y: s.y + 1.62, z: s.z };
    // the client's flight, 60 frames a second
    const v = d.map((c) => c * DEF.rocket.speed);
    const p = { ...o };
    let end = null;
    for (let f = 0; f < 600 && !end; f++) {
      const dt = 1 / 60;
      v[1] -= DEF.rocket.grav * dt;
      const n = [p.x + v[0] * dt, p.y + v[1] * dt, p.z + v[2] * dt];
      const len = Math.hypot(n[0] - p.x, n[1] - p.y, n[2] - p.z);
      const u = [(n[0] - p.x) / len, (n[1] - p.y) / len, (n[2] - p.z) / len];
      const t = rocketStrikesWorld(w, p.x, p.y, p.z, u[0], u[1], u[2], len, ray);
      if (t >= 0) end = { x: p.x + u[0] * t, z: p.z + u[2] * t };
      p.x = n[0];
      p.y = n[1];
      p.z = n[2];
      if (Math.hypot(p.x - o.x, p.z - o.z) > DEF.range) break;
    }
    if (!end) continue;
    explosions.length = 0;
    a.renderTick = game.tick & 0xffff;
    game.combat.fire(a, { weapon: ITEM.RPG, x: o.x, y: o.y, z: o.z, yaw, pitch, recoilPitch: 0, spread: 0, seed: 1 });
    flyOut();
    const sb = explosions[0];
    if (!sb) continue;
    shots++;
    worst = Math.max(worst, Math.hypot(sb.x - end.x, sb.z - end.z));
  }
  check('a shot skimming the ground comes down in the same place on the server and in the shooter\'s own view', shots >= 6 && worst < 1, `${shots} shots, at most ${worst.toFixed(2)} m apart`);
}

console.log(fails.length ? `\n${fails.length} FAILED` : '\nall RPG checks passed');
process.exit(fails.length ? 1 : 0);
