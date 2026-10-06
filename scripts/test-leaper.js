// The leaper's pounce (server/zombies.js: LEAP_*, fireSpecial case 2, special states 2 and 3), against the real server
// in-process with a survivor driven by real input. Leapers are put down 6-14 m from the survivor on open ground of a
// few valleys, already wound up to go, and each is watched until it pins them or 10 s are up:
//   - a survivor who stands still, on flat ground and on rough ground, is pinned by every one of them
//   - one inside a ring of barricades is too: the arc is raised to clear them (it used to come down on top of one)
//   - one who sprints away is caught by most of them (the leap leads them and twists after them in the air), and a
//     leaper that misses is soon ready to go again
//   - one who strafes back and forth, or sidesteps once it is in the air (as soon as it leaves the ground, or with
//     0.2-0.8 s of flight left), gets away from some of them and not all
//   - a pinned survivor is let go when the pin runs out (5 s), when it is shoved off and when it has taken enough
//     damage, and is not pinned again by the hop off (it used to be, 0.15 s after it let go)
//   - one who mashes Space shoves it off in about a second, one who holds it down in about two, and a single tap does
//     not do it: shoved all the way, it is flung clear, reels for 1 s where it lands, and they get away
// usage: node scripts/test-leaper.js [seed ...]   (VERBOSE=1 prints each scenario's numbers)
import { Game } from '../server/game.js';
import { C2S, S2C, PROTOCOL_VERSION, Writer, Reader, qangle16, qpitch, writeInput } from '../shared/protocol.js';
import { BTN, SERVER_TICK_RATE } from '../shared/constants.js';
import { ZTYPE, STRUCT, ITEM } from '../shared/defs.js';
import { groundAt, raycastWorld } from '../shared/collision.js';

const seeds = process.argv.slice(2).map(Number).filter((n) => n > 0);
if (!seeds.length) seeds.push(1, 2, 3);
const TRIALS = 12;
const DT = 1 / SERVER_TICK_RATE;
const GRAV = 16; // (server/zombies.js)
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};
const yawTo = (fx, fz, tx, tz) => Math.atan2(-(tx - fx), -(tz - fz));
const mulberry = (a) => () => {
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

function setup(seed) {
  const game = new Game({ seed, godMode: true, dayLength: 3600, themes: false, log: () => {} });
  const c = { id: 0, seq: 0, yaw: 0 };
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
  w.str('Prey');
  game.onMessage(c.session, w.bytes().slice());
  c.input = (buttons) => {
    const w2 = new Writer(64);
    w2.u8(C2S.INPUT);
    w2.u16(game.tick & 0xffff);
    w2.u8(0);
    const cmds = [];
    for (let i = 0; i < 3; i++) {
      c.seq = (c.seq + 1) & 0xffff;
      cmds.push({ seq: c.seq, buttons, qyaw: qangle16(c.yaw), qpitch: qpitch(0), slot: 255 });
    }
    writeInput(w2, cmds);
    game.onMessage(c.session, w2.bytes().slice());
  };
  for (let i = 0; i < 5; i++) {
    c.input(0);
    game.update();
  }
  return { game, c, p: game.players.get(c.id) };
}

// open ground around the car's valley: nothing standing within R m at knee or head height, no water, and the ground
// rising and falling by lo-hi m across it
const _ray = { t: -1, col: null, terrain: false };
function findSpot(game, lo, hi, R = 17) {
  const w = game.world;
  const car = w.car;
  for (let r = 60; r < 280; r += 7) {
    for (let a = 0; a < 6.28; a += 0.21) {
      const x = car.x + Math.sin(a) * r;
      const z = car.z + Math.cos(a) * r;
      if (Math.abs(x) > 290 || Math.abs(z) > 290 || w.isDeepWater(x, z) || game.nav.isBlocked(x, z)) continue;
      let mn = Infinity;
      let mx = -Infinity;
      let ok = true;
      for (let k = 0; k < 16 && ok; k++) {
        const b = (k / 16) * 6.28;
        for (const rr of [4, 9, 14, R]) {
          const px = x + Math.sin(b) * rr;
          const pz = z + Math.cos(b) * rr;
          const h = w.heightAt(px, pz);
          mn = Math.min(mn, h);
          mx = Math.max(mx, h);
          if (w.isDeepWater(px, pz)) ok = false;
        }
        const y0 = w.heightAt(x, z);
        for (const hh of [0.5, 1.4]) {
          raycastWorld(w, x, y0 + hh, z, Math.sin(b), 0, Math.cos(b), R, _ray);
          if (_ray.t >= 0 && !_ray.terrain) ok = false;
        }
      }
      if (ok && mx - mn >= lo && mx - mn <= hi) return { x, z };
    }
  }
  return null;
}

function clear(game) {
  for (const z of [...game.zombies]) {
    game._listRemove(game.zombies, z);
    game.removeEntity(z);
  }
  game.zm.herds.reset();
  game.zm.maintainT = game.zm.herds.spawnT = 1e9;
}

// one leaper put down d m from the survivor at spot, watched until it pins them or 10 s are up. mode: what the
// survivor does - 'still', 'strafe' (back and forth), 'flee' (sprints straight away), 'dodge' (steps aside 0.1-0.35 s
// after it leaves the ground), 'late' (steps aside with 0.2-0.8 s of its flight left)
function trial(env, spot, d, mode, rng) {
  const { game, c, p } = env;
  clear(game);
  const s = p.state;
  s.x = spot.x;
  s.z = spot.z;
  s.y = groundAt(game.world, s.x, s.z, 200, 0.3);
  s.vx = s.vy = s.vz = 0;
  s.pinned = s.pulled = 0;
  s.stunT = 0;
  p.pinnedBy = 0;
  const a = rng() * Math.PI * 2;
  const z = game.zm.spawn(ZTYPE.LEAPER, spot.x + Math.sin(a) * d, spot.z + Math.cos(a) * d, { horde: true });
  z.specialCd = 0.3; // it has seen its prey and is ready to go
  const r = { leaps: 0, pinned: false, gaps: [], flights: [], onTop: 0 };
  const late = 0.2 + rng() * 0.6;
  const react = 0.1 + rng() * 0.25;
  let dodgeT = -1;
  let strafe = 1;
  let strafeT = 0;
  let prev = z.state;
  let lastLeap = -1;
  let up = 0;
  for (let i = 0; i < 10 / DT; i++) {
    const t = i * DT;
    let btn = 0;
    c.yaw = yawTo(s.x, s.z, z.x, z.z);
    if (mode === 'strafe') {
      strafeT -= DT;
      if (strafeT <= 0) {
        strafe = -strafe;
        strafeT = 0.6 + rng() * 0.6;
      }
      btn = strafe > 0 ? BTN.LEFT : BTN.RIGHT;
    } else if (mode === 'flee') {
      c.yaw = yawTo(z.x, z.z, s.x, s.z);
      btn = BTN.FWD | BTN.SPRINT;
    } else if (mode === 'dodge' || mode === 'late') {
      if (mode === 'late' && dodgeT < 0 && z.state === 2) {
        const disc = z.vy * z.vy + 2 * GRAV * (z.y - (s.y + 0.6));
        if (disc >= 0 && (z.vy + Math.sqrt(disc)) / GRAV < late) dodgeT = t;
      }
      if (dodgeT >= 0) c.yaw = env.dodgeYaw;
      else env.dodgeYaw = c.yaw;
      if (dodgeT >= 0 && t >= dodgeT && t - dodgeT < 0.8) btn = BTN.LEFT;
    }
    c.input(btn);
    game.update();
    if (z.dead) break;
    if (z.state === 2 && prev !== 2 && prev !== 3) {
      r.leaps++;
      up = t;
      if (lastLeap >= 0) r.gaps.push(t - lastLeap);
      lastLeap = t;
      if (mode === 'dodge' && dodgeT < 0) dodgeT = t + react;
    }
    if (prev === 2 && z.state !== 2) {
      r.flights.push(t - up);
      // brought down on top of something it should have cleared (a barricade's top is 1.15 m up)
      if (z.state === 0 && z.y > s.y + 0.8) r.onTop++;
    }
    if (z.state === 3) {
      r.pinned = true;
      break;
    }
    prev = z.state;
  }
  return r;
}

// four barricades round the spot, built the way a survivor builds them
function ring(env, spot) {
  const { game, p, c } = env;
  const s = p.state;
  s.x = spot.x;
  s.z = spot.z;
  s.y = groundAt(game.world, s.x, s.z, 200, 0.3);
  game.giveItem(p, ITEM.WOOD, 30);
  game.giveItem(p, ITEM.NAILS, 20);
  s.slot = 4;
  for (const [ox, oz, rot] of [[0, 2.2, 0], [0, -2.2, 0], [-2.2, 0, 64], [2.2, 0, 64]]) {
    p.actionT = -1;
    game.build(p, STRUCT.BARRICADE, spot.x + ox, spot.z + oz, rot);
    for (let k = 0; k < 6; k++) {
      c.input(0);
      game.update();
    }
  }
  s.slot = 0;
  return game.structures.filter((e) => e.stype === STRUCT.BARRICADE && !e.removed).length;
}

const MODES = ['still', 'strafe', 'flee', 'dodge', 'late', 'rough', 'ring'];
const runs = Object.fromEntries(MODES.map((m) => [m, []]));
let spots = 0;
let pinChecks = 0;
let letGo = 0;
let pinnedAgain = 0;
const shoves = { mash: { n: 0, ok: 0, t: [] }, hold: { n: 0, ok: 0, t: [] }, tap: { n: 0, ok: 0 } };
for (const seed of seeds) {
  const env = setup(seed);
  const flat = findSpot(env.game, 0, 0.6);
  const rough = findSpot(env.game, 2, 5);
  if (!flat) continue;
  spots++;
  const rng = mulberry(seed * 77);
  for (const mode of ['still', 'strafe', 'flee', 'dodge', 'late']) for (let k = 0; k < TRIALS; k++) runs[mode].push(trial(env, flat, 6 + (k % 5) * 2, mode, rng));
  if (rough) for (let k = 0; k < TRIALS; k++) runs.rough.push(trial(env, rough, 6 + (k % 5) * 2, 'still', rng));
  // the pin: it lets go in its time (5 s), to a melee shove and to enough damage, and the hop off does not take the
  // survivor again
  for (const how of ['time', 'shove', 'damage']) {
    if (!trial(env, flat, 9, 'still', rng).pinned) continue;
    pinChecks++;
    const z = env.game.zombies.find((q) => q.ztype === ZTYPE.LEAPER && !q.dead);
    const s = env.p.state;
    let released = -1;
    for (let i = 0; i < 7 / DT; i++) {
      if (i === 10 && how === 'shove') env.game.combat.damageZombie(z, 5, env.p, { melee: true });
      if (i === 10 && how === 'damage') env.game.combat.damageZombie(z, z.maxHp * 0.5, env.p, {});
      env.c.input(0);
      env.game.update();
      if (released < 0 && z.state !== 3 && !s.pinned) released = i;
      if (released >= 0 && z.state === 3) {
        pinnedAgain++;
        break;
      }
      if (released >= 0 && i - released > 1.5 / DT) break;
    }
    if (released >= 0 && released * DT < (how === 'time' ? 5.5 : 1)) letGo++;
    else if (process.env.VERBOSE) console.log(`      ${how}: let go after ${released < 0 ? 'never' : (released * DT).toFixed(2) + ' s'}`);
  }
  // Space shoves it off: mashed (a press every 3 ticks, ~7 a second) or held, never by a single tap. Shoved all the
  // way it is let go at once, flung clear, and dazed (no attack, no leap) for a second on the ground while the
  // survivor runs for it
  for (const how of ['mash', 'hold', 'tap']) {
    if (!trial(env, flat, 9, 'still', rng).pinned) continue;
    const z = env.game.zombies.find((q) => q.ztype === ZTYPE.LEAPER && !q.dead);
    const s = env.p.state;
    const hp0 = env.p.hp;
    let released = -1;
    let landed = -1;
    let dazedFor = 0;
    let again = false;
    let full = 0;
    for (let i = 0; i < 4 / DT; i++) {
      // from i = 10: tap Space once, mash it or hold it down, then run away from it
      let btn = 0;
      if (released >= 0) {
        env.c.yaw = yawTo(z.x, z.z, s.x, s.z);
        btn = BTN.FWD | BTN.SPRINT;
      } else if (i >= 10) btn = how === 'tap' ? (i === 10 ? BTN.JUMP : 0) : how === 'mash' ? ((i - 10) % 3 === 0 ? BTN.JUMP : 0) : BTN.JUMP;
      env.c.input(btn);
      env.game.update();
      full = Math.max(full, s.shove);
      if (released < 0 && i >= 10 && !s.pinned) released = i;
      if (released >= 0 && landed < 0 && z.state !== 2) landed = i;
      if (landed >= 0 && z.dazedT > 0) dazedFor += DT;
      if (released >= 0 && (z.state === 3 || s.pinned)) again = true;
      if (how === 'tap' && i * DT > 3) break;
    }
    const took = (released - 10) * DT;
    if (process.env.VERBOSE) console.log(`      ${how}: ${released < 0 ? `still pinned 2.5 s after, the meter got to ${full.toFixed(2)}` : `let go ${took.toFixed(2)} s after the first press, dazed ${dazedFor.toFixed(2)} s on the ground, ${Math.hypot(z.x - s.x, z.z - s.z).toFixed(1)} m apart at the end, ${Math.round(hp0 - env.p.hp)} hp lost, pinned again: ${again}`}`);
    shoves[how].n++;
    if (how === 'tap') {
      if (released < 0 && full > 0 && full < 0.5) shoves.tap.ok++;
      continue;
    }
    const [lo, hi] = how === 'mash' ? [0.6, 1.5] : [1.5, 2.3];
    if (released >= 10 && took >= lo && took <= hi && dazedFor >= 0.9 && dazedFor <= 1.2 && !again) shoves[how].ok++;
    shoves[how].t.push(took);
  }
  // the barricades stay up from here on
  if (ring(env, flat) === 4) for (let k = 0; k < TRIALS; k++) runs.ring.push(trial(env, flat, 7 + (k % 4) * 2, 'still', rng));
}

const stat = (mode) => {
  const rows = runs[mode];
  const n = rows.length;
  const pinned = rows.filter((r) => r.pinned).length;
  const leaps = rows.reduce((a, r) => a + r.leaps, 0);
  const gaps = rows.flatMap((r) => r.gaps).sort((a, b) => a - b);
  const flights = rows.flatMap((r) => r.flights).sort((a, b) => a - b);
  return {
    n,
    pinned,
    share: n ? pinned / n : 0,
    leaped: rows.filter((r) => r.leaps > 0).length,
    leaps,
    onTop: rows.reduce((a, r) => a + r.onTop, 0),
    gap: gaps.length ? gaps[gaps.length >> 1] : 0,
    flight: flights.length ? flights[flights.length >> 1] : 0,
  };
};
const S = Object.fromEntries(MODES.map((m) => [m, stat(m)]));
const pct = (x) => `${Math.round(x * 100)}%`;
const line = (m) => `${S[m].pinned} of ${S[m].n} pinned (${pct(S[m].share)}), ${S[m].leaps} leaps`;
if (process.env.VERBOSE) for (const m of MODES) console.log(`      ${m}: ${line(m)}, flight ${S[m].flight.toFixed(2)} s median, ${S[m].gap.toFixed(1)} s between leaps, ${S[m].onTop} landed on top of something`);

check('open ground to test on', spots === seeds.length, `${spots} of ${seeds.length} valleys`);
check('a leaper in range and in sight of a survivor leaps, and pins one who stands still', S.still.n > 0 && S.still.leaped === S.still.n && S.still.share >= 0.95, line('still'));
check('...on rough ground too', S.rough.n > 0 && S.rough.share >= 0.9, line('rough'));
check('...and over a ring of barricades, without coming down on top of one', S.ring.n > 0 && S.ring.share >= 0.9 && S.ring.onTop === 0, `${line('ring')}, ${S.ring.onTop} came down on a barricade`);
check('a survivor sprinting away is caught by most of them, and a miss is soon ready to go again', S.flee.share >= 0.5 && S.flee.gap > 0 && S.flee.gap <= 6, `${line('flee')}, ${S.flee.gap.toFixed(1)} s between leaps`);
check('one who strafes back and forth gets away from some of them, not all', S.strafe.share >= 0.15 && S.strafe.share <= 0.85, line('strafe'));
check('one who sidesteps once it is in the air gets away from some of them, not all', [S.dodge, S.late].every((x) => x.share >= 0.25 && x.share <= 0.85), `as it leaves the ground: ${line('dodge')}; as it comes down: ${line('late')}`);
check('a pinned survivor is let go (in 5 s, to a shove, to damage), and the hop off does not take them again', pinChecks >= seeds.length * 2 && letGo === pinChecks && pinnedAgain === 0, `${letGo} of ${pinChecks} let go in time, ${pinnedAgain} taken again within 1.5 s`);
const secs = (t) => (t.length ? `${Math.min(...t).toFixed(2)}-${Math.max(...t).toFixed(2)} s` : 'none');
check('a pinned survivor who mashes Space shoves it off in about a second: it reels for 1 s where it lands, and they get away', shoves.mash.n >= seeds.length && shoves.mash.ok === shoves.mash.n, `${shoves.mash.ok} of ${shoves.mash.n}, let go ${secs(shoves.mash.t)} after the first press`);
check('...holding Space down does it too, in about two', shoves.hold.n >= seeds.length && shoves.hold.ok === shoves.hold.n, `${shoves.hold.ok} of ${shoves.hold.n}, let go ${secs(shoves.hold.t)} after the press`);
check('...and a single tap does not', shoves.tap.n >= seeds.length && shoves.tap.ok === shoves.tap.n, `${shoves.tap.ok} of ${shoves.tap.n} still pinned`);

if (fails.length) {
  console.log(`\n${fails.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
process.exit(0);
