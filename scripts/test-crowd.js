// A crowd fanning out on its way in (server/zombies.js: spreadOut, SPREAD_*), against the real server in-process.
// A column of the dead is put down in single file on open ground, 20-34 m from a survivor who stands still, and
// watched until each has come within 3 m of them (or 25 s are up). Then the bearings they arrived on are compared
// with the same column steered as before (spreadOut off):
//   - they come in over a much wider arc than the old single file did, from both sides of the line
//   - every one of them still gets there, and not much later than before
// usage: node scripts/test-crowd.js [seed ...]   (VERBOSE=1 prints each trial's numbers)
import { Game } from '../server/game.js';
import { C2S, S2C, PROTOCOL_VERSION, Writer, Reader, qangle16, qpitch, writeInput } from '../shared/protocol.js';
import { SERVER_TICK_RATE } from '../shared/constants.js';
import { ZTYPE } from '../shared/defs.js';
import { groundAt, raycastWorld } from '../shared/collision.js';

const seeds = process.argv.slice(2).map(Number).filter((n) => n > 0);
if (!seeds.length) seeds.push(1, 3, 4);
const DT = 1 / SERVER_TICK_RATE;
const N = 8;
const ARRIVE = 3;
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};

function setup(seed) {
  const game = new Game({ seed, godMode: true, dayLength: 3600, themes: false, log: () => {} });
  const c = { id: 0, seq: 0 };
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
  w.str('Bait');
  game.onMessage(c.session, w.bytes().slice());
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
  for (let i = 0; i < 5; i++) {
    c.input();
    game.update();
  }
  return { game, c, p: game.players.get(c.id) };
}

// open ground: nothing standing within R m of the spot at knee or chest height, no water, gentle slopes
const _ray = { t: -1, col: null, terrain: false };
function findSpot(game, R = 34) {
  const w = game.world;
  const car = w.car;
  for (let r = 30; r < 330; r += 5) {
    for (let a = 0; a < 6.28; a += 0.17) {
      const x = car.x + Math.sin(a) * r;
      const z = car.z + Math.cos(a) * r;
      if (Math.abs(x) > 260 || Math.abs(z) > 260 || w.isDeepWater(x, z) || game.nav.isBlocked(x, z)) continue;
      let mn = Infinity;
      let mx = -Infinity;
      let ok = true;
      for (let k = 0; k < 24 && ok; k++) {
        const b = (k / 24) * 6.28;
        for (const rr of [5, 12, 20, 28, R]) {
          const px = x + Math.sin(b) * rr;
          const pz = z + Math.cos(b) * rr;
          const h = w.heightAt(px, pz);
          mn = Math.min(mn, h);
          mx = Math.max(mx, h);
          if (w.isDeepWater(px, pz) || game.nav.isBlocked(px, pz)) ok = false;
        }
        const y0 = w.heightAt(x, z);
        for (const hh of [0.5, 1.4]) {
          raycastWorld(w, x, y0 + hh, z, Math.sin(b), 0, Math.cos(b), R, _ray);
          if (_ray.t >= 0 && !_ray.terrain) ok = false;
        }
      }
      if (ok && mx - mn < 7) return { x, z };
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

// a column of N walkers coming from bearing a, the first 20 m out, each 2 m behind the last
function trial(env, spot, a, spread) {
  const { game, c, p } = env;
  clear(game);
  game.zm.spreadOut = spread ? Object.getPrototypeOf(game.zm).spreadOut : () => false;
  const s = p.state;
  s.x = spot.x;
  s.z = spot.z;
  s.y = groundAt(game.world, s.x, s.z, 200, 0.3);
  s.vx = s.vy = s.vz = 0;
  const zs = [];
  for (let i = 0; i < N; i++) {
    const d = 20 + i * 2;
    const z = game.zm.spawn(ZTYPE.WALKER, spot.x + Math.sin(a) * d, spot.z + Math.cos(a) * d, { horde: true });
    if (z) zs.push({ z, bearing: null, t: null });
  }
  for (let i = 0; i < 25 / DT && zs.some((e) => e.t === null); i++) {
    c.input();
    game.update();
    for (const e of zs) {
      if (e.t !== null) continue;
      const dx = e.z.x - s.x;
      const dz = e.z.z - s.z;
      if (Math.hypot(dx, dz) > ARRIVE) continue;
      e.t = i * DT;
      // the bearing it came in on, relative to the line the column stood on (+ one side, - the other)
      let b = Math.atan2(dx, dz) - a;
      b = Math.atan2(Math.sin(b), Math.cos(b));
      e.bearing = b;
    }
  }
  const got = zs.filter((e) => e.t !== null);
  const bs = got.map((e) => e.bearing);
  return {
    n: zs.length,
    arrived: got.length,
    arc: bs.length ? Math.max(...bs) - Math.min(...bs) : 0,
    left: bs.some((b) => b < -0.15),
    right: bs.some((b) => b > 0.15),
    last: got.length ? Math.max(...got.map((e) => e.t)) : Infinity,
  };
}

const deg = (r) => Math.round((r * 180) / Math.PI);
let ran = 0;
for (const seed of seeds) {
  const env = setup(seed);
  const spot = findSpot(env.game);
  if (!spot) {
    console.log(`SKIP  seed ${seed}: no open ground wide enough`);
    continue;
  }
  ran++;
  const old = [];
  const now = [];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.3;
    old.push(trial(env, spot, a, false));
    now.push(trial(env, spot, a, true));
    if (process.env.VERBOSE) console.log(`  seed ${seed} bearing ${deg(a)}: before arc ${deg(old[k].arc)} last ${old[k].last.toFixed(1)} s, after arc ${deg(now[k].arc)} last ${now[k].last.toFixed(1)} s (${now[k].arrived}/${now[k].n})`);
  }
  const mean = (rs, f) => rs.reduce((t, r) => t + f(r), 0) / rs.length;
  const arcOld = mean(old, (r) => r.arc);
  const arcNow = mean(now, (r) => r.arc);
  check(`seed ${seed}: the column fans out`, arcNow > Math.max(arcOld * 2, (50 * Math.PI) / 180), `(mean arc ${deg(arcOld)} deg before, ${deg(arcNow)} deg after)`);
  check(`seed ${seed}: from both sides of the line`, now.filter((r) => r.left && r.right).length >= 4, `(${now.filter((r) => r.left && r.right).length}/6 trials)`);
  const arrived = now.every((r) => r.arrived === r.n);
  check(`seed ${seed}: every one of them gets there`, arrived, `(${now.map((r) => `${r.arrived}/${r.n}`).join(' ')})`);
  const lastOld = mean(old, (r) => r.last);
  const lastNow = mean(now, (r) => r.last);
  check(`seed ${seed}: and not much later`, lastNow < lastOld * 1.25 + 1, `(last in ${lastOld.toFixed(1)} s before, ${lastNow.toFixed(1)} s after)`);
}
check('some seed had open ground to try it on', ran > 0);
if (fails.length) {
  console.log(`\n${fails.length} failed`);
  process.exit(1);
}
console.log('\nall passed');
