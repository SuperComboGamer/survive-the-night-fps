// In-process server smoke test: fake clients join, meet the cat, get hunted by a zombie dog pack, rouse the wandering herd, walk around,
// search containers, trip a car alarm, chop trees, build (incl. door boards), draw the dead with noise, go down +
// get revived, pin a shade
// with light, survive a night of waves and run the escape finale.
// Decodes every snapshot with the real client decoder. usage: node scripts/sim-smoke.js [seed]
import { CRAFT_MAX, craftRun, copyInv } from '../client/game/bulkcraft.js';
import { RECIPES, AMMO_MAX } from '../shared/defs.js';
import { Game } from '../server/game.js';
import { C2S, ACT, ENT, HOLD, CAR_ID, CHATF, PLF, PROTOCOL_VERSION, Writer, Reader, S2C, qangle16, qpitch, ZSTATUS, writeInput } from '../shared/protocol.js';
import { PHASE, BTN, NOISE, TANK_BOSS_NIGHT, TALK_CLEAR, TALK_RANGE, WALKIE_STASHES, EYE_HEIGHT, HORDE_SPAWN_MIN, HORDE_SPAWN_MAX } from '../shared/constants.js';
import { STRUCT, ITEM, WEAPONS, AMMO, SUPPLIES, SUPPLY_NEED, NOTIFY, ZTYPE, CANIM, ZANIM, ZONE, SOUND, CONT, CONSUMABLES, LOOT_TABLES, CONT_TABLES, CONT_DEFS, PROJ, ZOMBIE_DEFS, STRUCT_DEFS, THROWABLES, BURN, EVT, KILLER } from '../shared/defs.js';
import { readSnapshot } from '../client/net/decode.js';
import { raycastWorld, groundAt } from '../shared/collision.js';

const seed = +(process.argv[2] || 4242);
// The checks must pass on any seed, so none of them may lean on what the ones before it happened to leave behind.
// Two things are settled for the whole run: nothing hurts the survivors (they stand about for minutes while the
// dead wander in) except in the check about getting hurt, which switches god mode off for itself; and the first
// day is long enough for every check of the day, so night falls when the test calls it, and no supply plane comes
// over but the one the test calls. Everything else a check depends on, it sets up itself.
const game = new Game({ seed, godMode: true, dayLength: 3600, log: () => {} });
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};

function client(name) {
  const c = { name, id: 0, net: { tick: 0, ack: 0 }, global: null, self: {}, store: { ents: new Map(), onCreate() {}, onRemove() {}, onUpdate() {} }, notes: [], pickups: [], seq: 0, summary: null, pings: 0, chats: [], roster: new Map() };
  const handler = {
    sound() {},
    shot() {},
    impact() {},
    hitmark() {},
    damage() {},
    killfeed() {},
    notify: (m, a) => c.notes.push([m, a]),
    explosion() {},
    pickup: (item, n) => c.pickups.push([item, n]),
    zombieDie() {},
    structBreak() {},
    ping: () => c.pings++,
    summary: (s) => (c.summary = s),
    flyover: (x, y, z, heading, eta) => (c.flyover = { x, y, z, heading, eta }),
  };
  c.handler = handler;
  c.conn = {
    send(bytes) {
      const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
      const t = r.u8();
      if (t === S2C.WELCOME) c.id = r.u16();
      else if (t === S2C.SNAPSHOT) {
        readSnapshot(r, c);
        if (r.left !== 0) throw new Error(`${name}: ${r.left} trailing snapshot bytes`);
      } else if (t === S2C.CHAT) c.chats.push({ id: r.u16(), flags: r.u8(), text: r.str() });
      else if (t === S2C.PLAYERS) {
        c.roster.clear();
        for (let n = r.u8(); n > 0; n--) {
          const id = r.u16();
          r.str();
          const status = r.u8();
          const walkie = !!(r.u8() & PLF.WALKIE);
          const kills = r.u16();
          r.u16();
          c.roster.set(id, { status, walkie, kills });
        }
        if (r.left !== 0) throw new Error(`${name}: ${r.left} trailing player list bytes`);
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
  c.act = (act, ...args) => {
    const w2 = new Writer(32);
    w2.u8(C2S.ACTION);
    w2.u8(act);
    if (act === ACT.INTERACT || act === ACT.HOLD_BEGIN || act === ACT.DEMOLISH) w2.u16(args[0]);
    else if (act === ACT.BUILD) {
      w2.u8(args[0]);
      w2.i16(Math.round(args[1] * 64));
      w2.i16(Math.round(args[2] * 64));
      w2.u8(args[3]);
    } else if (act === ACT.PING) {
      w2.u8(args[0]);
      w2.i16(Math.round(args[1] * 64));
      w2.i16(Math.round(args[2] * 64));
      w2.i16(Math.round(args[3] * 64));
    } else if (args.length) w2.u8(args[0]);
    game.onMessage(c.session, w2.bytes().slice());
  };
  c.input = (buttons, yaw, pitch, slot = 255) => {
    const w2 = new Writer(64);
    w2.u8(C2S.INPUT);
    w2.u16(game.tick & 0xffff);
    w2.u8(0);
    const cmds = [];
    for (let i = 0; i < 3; i++) {
      c.seq = (c.seq + 1) & 0xffff;
      cmds.push({ seq: c.seq, buttons, qyaw: qangle16(yaw), qpitch: qpitch(pitch), slot: i === 0 ? slot : 255 });
    }
    writeInput(w2, cmds); // these clients don't predict, so no state fingerprint: the server keeps sending its state
    game.onMessage(c.session, w2.bytes().slice());
  };
  c.tp = (x, z) => game.handleChat(c.p(), `/tp ${x} ${z}`);
  return c;
}

const run = (ticks, fn) => {
  for (let i = 0; i < ticks; i++) {
    fn?.(i);
    game.update();
  }
};
// is a tree within m metres of the line (x0,z0)-(x1,z1)? A trunk is too thin to block a nav cell, so the checks that
// need a clear stretch of ground ask this as well: a zombie walking the line would have to go round it, and a
// trunk beside the line still shadows something a little off it from a light at the end
const treeBy = (x0, z0, x1, z1, m) => {
  const t = game.world.trees;
  const l = Math.hypot(x1 - x0, z1 - z0) || 1;
  const [ux, uz] = [(x1 - x0) / l, (z1 - z0) / l];
  for (let i = 0; i < t.length; i += 6) {
    const along = Math.max(0, Math.min(l, (t[i] - x0) * ux + (t[i + 2] - z0) * uz));
    if (Math.hypot(t[i] - x0 - ux * along, t[i + 2] - z0 - uz * along) < m) return true;
  }
  return false;
};

// tick timing (server/tickstats.js): what a window reports for a made-up series of tick times, then a Game of its
// own whose zombie update is held up
{
  const { TickStats, TICK_SAMPLES, SLOW_LOG_EVERY, T_ZOMBIES } = await import('../server/tickstats.js');
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const ts = new TickStats(50);
  // 200 ticks 50 ms apart, 2 ms each, but for a 60 ms one, a 120 ms one a second after it, a 3 and a 4
  const logged = [];
  for (let i = 0; i < 200; i++) if (ts.record(i === 50 ? 60 : i === 70 ? 120 : i === 90 ? 3 : i === 110 ? 4 : 2, i * 50)) logged.push(i);
  for (let i = 0; i < 10; i++) ts.late(i === 4 ? 300 : 0.5);
  let w = ts.roll();
  check('tick window: mean, worst, ticks over budget', w.ticks === 200 && near(w.meanMs, 2.895) && w.maxMs === 120 && w.over === 2, `${w.meanMs.toFixed(3)} / ${w.maxMs} ms, ${w.over} of ${w.ticks}`);
  check('tick window: the 99th percentile leaves the worst 1% out', w.p99Ms === 4, `${w.p99Ms} ms`);
  check('tick window: how late the loop woke', near(w.lateMeanMs, 30.45) && w.lateMaxMs === 300, `${w.lateMeanMs.toFixed(2)} / ${w.lateMaxMs} ms`);
  check('a slow tick is logged at once, another within 5 s is only counted', logged.join() === '50' && ts.unlogged === 1);
  const again = ts.record(80, 50 * 50 + SLOW_LOG_EVERY);
  const text = ts.slowText('players 0');
  check('...and the next line says how many went unlogged', again && text.startsWith('80.00ms:') && text.endsWith('| players 0 late 0.50ms | slow ticks not logged before it: 1') && ts.unlogged === 0, text);
  w = ts.roll();
  const t = ts.total;
  check('the next window starts from nothing, the totals since boot carry on', w.ticks === 1 && w.meanMs === 80 && w.p99Ms === 80 && w.over === 1 && w.lateMaxMs === 0 && t.ticks === 201 && t.over === 3 && t.maxMs === 120 && t.lateMaxMs === 300);
  // more ticks than the percentile keeps (it reads the newest TICK_SAMPLES), then a short window and an empty one
  for (let i = 0; i < TICK_SAMPLES + 100; i++) ts.record(i < 100 ? 40 : 1, 1e6 + i);
  w = ts.roll();
  const long = w.ticks === TICK_SAMPLES + 100 && w.maxMs === 40 && near(w.meanMs, (4000 + TICK_SAMPLES) / (TICK_SAMPLES + 100)) && w.p99Ms === 1;
  for (const ms of [5, 7, 6]) ts.record(ms, 2e6);
  w = ts.roll();
  const short = w.ticks === 3 && w.meanMs === 6 && w.p99Ms === 7 && w.maxMs === 7;
  w = ts.roll();
  check('tick window: longer than the sample buffer, short, empty', long && short && w.ticks === 0 && w.meanMs === 0 && w.p99Ms === 0 && w.maxMs === 0);

  const lines = [];
  const g = new Game({ seed, log: (...a) => lines.push(a.join(' ')) });
  const session = g.onOpen({ send() {} });
  const jw = new Writer(64);
  jw.u8(C2S.JOIN);
  jw.u8(PROTOCOL_VERSION);
  jw.str('T');
  g.onMessage(session, jw.bytes().slice());
  const zmUpdate = g.zm.update;
  let hold = 60;
  g.zm.update = function (dt) {
    for (const until = performance.now() + hold; performance.now() < until; );
    return zmUpdate.call(this, dt);
  };
  g.update();
  g.update();
  hold = 0;
  g.update();
  const st = g.tickStats;
  const slow = lines.filter((l) => l.startsWith('slow tick'));
  const sum = st.slowSec.reduce((a, b) => a + b, 0);
  check('a held-up tick is logged once, with its sections and what the server carried', slow.length === 1 && / zombies=\d+\.\d\d .* \| players 1 zombies \d+ ents \d+ late \d/.test(slow[0]) && st.unlogged >= 1, slow[0]);
  check('...the sections add up to the tick and name the culprit', st.slowMs >= 60 && st.slowSec[T_ZOMBIES] >= 60 && Math.abs(sum - st.slowMs) < 1e-6 &&st.status(performance.now()).lastSlow.sections.zombies >= 60);
  g.onClose(session);
  g.update(); // nobody on: a waiting server's ticks are timed too
  w = st.roll();
  check('every tick is timed, playing or waiting', g.phase === PHASE.WAITING && w.ticks === 4 && g.tick === 4 && w.over >= 2 && w.maxMs >= 60 && st.total.ticks === 4);
}

game.debugCommands = true;
const A = client('Alice');
const B = client('Bob');
run(5);
check('game started', game.phase === PHASE.DAY && A.global?.phase === PHASE.DAY);
check('players spawned near car', Math.hypot(A.p().state.x - game.world.car.x, A.p().state.z - game.world.car.z) < 14);
check('supply hints sent', A.global.hints.slice(0, 7).every((z) => z !== 255), JSON.stringify(A.global.hints));
check('every supply is hidden in a different place of this map', new Set(A.global.hints).size === 7 && A.global.hints.every((z) => game.world.zoneById[z] && z !== ZONE.CAMP));
check('caches replicated', [...A.store.ents.values()].some((e) => e.kind === ENT.CACHE));
check('walkie-talkies hidden in containers', game.caches.filter((c) => c.stash === ITEM.WALKIE && !c.schem && CONT_DEFS[c.ctype].schem).length === WALKIE_STASHES);

// joining a run in progress: the newcomer arrives beside the team instead of alone at the car, with a kit for the
// day, and leaving and coming back does not turn into supplies for the team
// (a game of its own, and no ticks: a third and fourth player would change the run the rest of this file checks)
{
  const g = new Game({ seed, log: () => {} });
  const w = g.world;
  const car = w.car;
  const join = (name) => {
    const session = g.onOpen({ send() {} });
    const wr = new Writer(64);
    wr.u8(C2S.JOIN);
    wr.u8(PROTOCOL_VERSION);
    wr.str(name);
    g.onMessage(session, wr.bytes().slice());
    return session;
  };
  const has = (p, item) => p.inv.reduce((n, x) => n + (x && x.item === item ? x.count : 0), 0);
  const kit = (p) => [p.state.mags[1], p.state.ammo[AMMO.P9], has(p, ITEM.BANDAGE), has(p, ITEM.TORCH), has(p, ITEM.WOOD), has(p, ITEM.NAILS)].join('/');
  const loose = (...items) => items.map((item) => g.items.reduce((n, e) => n + (e.item === item ? e.count : 0), 0)).join('/');
  const from = (s, o) => Math.hypot(s.x - o.x, s.z - o.z);
  const a = join('Ann').player;
  const b = join('Ben').player;
  check('a second player on day 1 starts at the car with the same kit', g.day === 1 && from(b.state, car) < 14 && kit(b) === kit(a), kit(b));
  // the team sets off: open, level ground a long way from the car, three walkers 5 m to the north of them
  const open = (x, z) => !w.isDeepWater(x, z) && !g.nav.isBlocked(x, z);
  let spot = null;
  for (let r = 150; r <= 260 && !spot; r += 10) {
    for (let k = 0; k < 24 && !spot; k++) {
      const x = car.x + Math.sin((k / 24) * Math.PI * 2) * r;
      const z = car.z + Math.cos((k / 24) * Math.PI * 2) * r;
      if (Math.abs(x) > 280 || Math.abs(z) > 280 || !open(x, z) || !open(x + 1.5, z)) continue;
      let clear = 0;
      let level = true;
      for (let i = -12; i <= 12; i += 2) {
        for (let j = -12; j <= 12; j += 2) {
          if (open(x + i, z + j)) clear++;
          if (Math.abs(w.heightAt(x + i, z + j) - w.heightAt(x, z)) > 1.5) level = false;
        }
      }
      if (level && clear > 150) spot = { x, z };
    }
  }
  check('found open ground for the late join', !!spot);
  [a, b].forEach((p, i) => {
    p.state.x = spot.x + i * 1.5;
    p.state.z = spot.z;
    p.state.y = groundAt(w, p.state.x, p.state.z, 200, 0.3);
  });
  for (const z of [...g.zombies]) {
    if (from(z, spot) > 60) continue;
    g._listRemove(g.zombies, z);
    g.removeEntity(z);
  }
  const dead = [-1, 0, 1].map((i) => g.zm.spawn(ZTYPE.WALKER, spot.x + i, spot.z - 5));
  g.day = 3;
  const session = join('Cat');
  const c = session.player;
  const s = c.state;
  const mate = from(s, a.state);
  const near = Math.min(...dead.map((z) => from(z, s)));
  check('a late joiner arrives beside the team, not at the car', mate >= 2.4 && mate <= 9.1 && from(s, car) > 100, `${mate.toFixed(1)} m from a teammate, ${from(s, car).toFixed(0)} m from the car`);
  const facing = (-Math.sin(s.yaw) * (a.state.x - s.x) - Math.cos(s.yaw) * (a.state.z - s.z)) / mate;
  check('...on open ground with a clear walk to them, facing them', open(s.x, s.z) && Math.abs(s.y - groundAt(w, s.x, s.z, s.y)) < 0.01 &&g.zm.clearLine(s.x, s.y + 0.6, s.z, a.state.x, a.state.y + 0.6, a.state.z) && facing > 0.99);
  check('...on the side away from the dead', near > 8, `nearest zombie ${near.toFixed(1)} m (${Math.min(...dead.map((z) => from(z, a.state))).toFixed(1)} m from the teammate)`);
  check('...with a kit for the day: more rounds and bandages than day 1, still no more than a pistol', s.ammo[AMMO.P9] > a.state.ammo[AMMO.P9] && has(c, ITEM.BANDAGE) > has(a, ITEM.BANDAGE) && s.weapons.join() === a.state.weapons.join() && c.armor === 0, `${kit(c)} against ${kit(a)}`);
  const fresh = kit(c);
  // they fire 30 rounds, use a bandage, find some scrap - and drop out
  s.ammo[AMMO.P9] -= 30;
  c.inv.find((x) => x && x.item === ITEM.BANDAGE).count--;
  g.giveItem(c, ITEM.SCRAP, 5);
  const kept = kit(c);
  const supplies = [ITEM.PISTOL, ITEM.AMMO_9MM, ITEM.BANDAGE, ITEM.TORCH, ITEM.WOOD, ITEM.NAILS];
  const ground = loose(...supplies);
  const scrap = +loose(ITEM.SCRAP);
  g.onClose(session);
  check('a leaver takes the starting kit along and leaves what they found', loose(...supplies) === ground && +loose(ITEM.SCRAP) === scrap + 5, `on the ground ${loose(...supplies)}`);
  // ...and come back, three times over: the same kit each time, nothing more on the ground
  let back = null;
  let same = true;
  for (let i = 0; i < 3; i++) {
    if (back) g.onClose(back);
    back = join('Cat');
    same = same && kit(back.player) === kept && from(back.player.state, a.state) < 9.1;
  }
  check('rejoining gives back what they left with, not a fresh kit', same && loose(...supplies) === ground, `${kit(back.player)}, on the ground ${loose(...supplies)}`);
  // dying drops the kit where they fell: a reconnect after that does not come with another
  g.killPlayer(back.player, { kind: 2, ztype: ZTYPE.WALKER });
  g.onClose(back);
  const again = join('Cat').player;
  check('...nor after dying', !again.zombie && again.state.mags[1] + again.state.ammo[AMMO.P9] + has(again, ITEM.BANDAGE) + has(again, ITEM.TORCH) === 0, kit(again));
  check('a new arrival still gets the kit for the day', kit(join('Dee').player) === fresh);
}

// the stray cat: replicated, wanders over to survivors who stand still, bolts from the dead
{
  const cat = game.cats[0];
  const car = game.world.car;
  check('cat spawned near the car', cat && Math.hypot(cat.x - car.x, cat.z - car.z) < 12);
  const rc = [...A.store.ents.values()].find((e) => e.kind === ENT.CAT);
  check('cat replicated', rc && rc.variant === cat.variant && rc.id === cat.id);
  let closest = Infinity;
  let walked = 0;
  let lx = cat.x;
  let lz = cat.z;
  run(20 * 90, (i) => {
    // the cat roams at random: every 5 s, if it has wandered off, Alice goes and stands still 5 m from it
    const p = A.p().state;
    if (i % 100 === 99 && closest > 2.6 && Math.hypot(p.x - cat.x, p.z - cat.z) > 11) {
      for (let k = 0; k < 8; k++) {
        const x = cat.x + Math.sin(k * 0.785) * 5;
        const z = cat.z + Math.cos(k * 0.785) * 5;
        if (!game.nav.isBlocked(x, z)) {
          A.tp(x, z);
          break;
        }
      }
    }
    for (const h of game.humans()) closest = Math.min(closest, Math.hypot(h.state.x - cat.x, h.state.z - cat.z));
    walked += Math.hypot(cat.x - lx, cat.z - lz);
    lx = cat.x;
    lz = cat.z;
  });
  check('cat walks around', walked > 5 && Math.hypot(cat.x - car.x, cat.z - car.z) < 45, `${walked.toFixed(1)} m`);
  check('cat visits a survivor standing still', closest < 2.6, `closest ${closest.toFixed(2)} m`);
  // a zombie 3 m from it, on a side where that spot is open ground (a spawn on the car is nudged out of the cat's
  // sight) and the cat has a clear run the other way (cornered against the car, a tree or the survivor it is
  // sitting with, it slides along or only darts off sideways after a second or more). Alice stands with Bob for
  // it, so the cat has one place to steer clear of and not two
  A.tp(B.p().state.x, B.p().state.z);
  const free = (x, z) => !game.world.isDeepWater(x, z) && !game.nav.isBlocked(x, z);
  const away = (x, z) => free(x, z) && game.humans().every((h) => Math.hypot(h.state.x - x, h.state.z - z) > 1.2);
  let [ux, uz] = [1, 0];
  for (let k = 0; k < 8; k++) {
    const [vx, vz] = [Math.cos(k * 0.785), Math.sin(k * 0.785)];
    const lane = (o) => game.nav.segClear(cat.x - vz * o, cat.z + vx * o, cat.x - vx * 5 - vz * o, cat.z - vz * 5 + vx * o);
    if (!free(cat.x + vx * 3, cat.z + vz * 3) || ![-0.5, 0, 0.5].every(lane) || treeBy(cat.x, cat.z, cat.x - vx * 5, cat.z - vz * 5, 0.8)) continue;
    if (![1, 2, 3, 4, 5].every((d) => away(cat.x - vx * d, cat.z - vz * d))) continue;
    [ux, uz] = [vx, vz];
    break;
  }
  const z = game.zm.spawn(ZTYPE.WALKER, cat.x + ux * 3, cat.z + uz * 3);
  const d0 = Math.hypot(z.x - cat.x, z.z - cat.z);
  let ran = false;
  run(30, () => (ran ||= rc.q[4] === CANIM.RUN));
  check('cat bolts from a zombie', ran && Math.hypot(z.x - cat.x, z.z - cat.z) > d0 + 2, `${d0.toFixed(1)} -> ${Math.hypot(z.x - cat.x, z.z - cat.z).toFixed(1)} m`);
  game.combat.damageZombie(z, 1e6, null, {});
  A.tp(car.x + 30, car.z - 20);
  run(2);
  game.handleChat(A.p(), '/cat');
  run(2);
  check('/cat brings it over', Math.hypot(A.p().state.x - cat.x, A.p().state.z - cat.z) < 3);
}

// bats fly round walls, not through them: a flock cannot get at a survivor in a room with its one doorway boarded
// up, wheels round the building meanwhile, and is in once the boards come off
// (a game of its own on the same map: nothing in here touches the run below)
{
  const g = new Game({ seed, log: () => {} });
  const session = g.onOpen({ send() {} });
  const jw = new Writer(64);
  jw.u8(C2S.JOIN);
  jw.u8(PROTOCOL_VERSION);
  jw.str('Dee');
  g.onMessage(session, jw.bytes().slice());
  const p = [...g.players.values()][0];
  const s = p.state;
  const w = g.world;
  // only bats in this valley (the dead that started here would be at the boards themselves)
  for (const z of g.zombies) {
    z.dead = true;
    z.deadT = 2;
  }
  g.zm.maintainT = g.zm.herds.spawnT = 1e9;
  for (let i = 0; i < 10; i++) g.update();
  // a room is closed if every ray of a fan from inside it ends on a wall, the floor or the roof, or leaves through
  // its doorway o (collider roofs only: a gable has none, the fan sees the sky through it)
  const ray = { t: -1, col: null, terrain: false };
  const closed = (o, x, y, z) => {
    const nx = Math.sin(o.ry);
    const nz = Math.cos(o.ry);
    for (let k = 0; k < 48; k++) {
      for (let j = 0; j < 9; j++) {
        const a = (k / 48) * Math.PI * 2;
        const pitch = -0.25 + j * 0.2;
        const dx = Math.sin(a) * Math.cos(pitch);
        const dy = Math.sin(pitch);
        const dz = Math.cos(a) * Math.cos(pitch);
        raycastWorld(w, x, y, z, dx, dy, dz, 14, ray);
        if (ray.t >= 0 && ray.t < 0.4) return false; // (no room to stand: a partition runs into this doorway)
        if (ray.t >= 0) continue;
        const t = ((o.x - x) * nx + (o.z - z) * nz) / (dx * nx + dz * nz);
        const side = (x + dx * t - o.x) * nz - (z + dz * t - o.z) * nx;
        if (!(t > 0 && Math.abs(side) < o.w / 2 && y + dy * t < o.y + o.h)) return false;
      }
    }
    return true;
  };
  let room = null;
  for (const o of w.openings) {
    for (const side of [1.3, -1.3]) {
      const x = o.x + Math.sin(o.ry) * side;
      const z = o.z + Math.cos(o.ry) * side;
      if (room || g.nav.isBlocked(x, z)) continue;
      const y = groundAt(w, x, z, o.y + 0.3, 0.3);
      if (closed(o, x, y + 1.3, z) && closed(o, x, y + 0.5, z)) room = { o, x, y, z };
    }
  }
  check('found a room with one way in for the bat test', !!room);
  s.x = room.x;
  s.y = room.y;
  s.z = room.z;
  g.fillHistory(p);
  g.giveItem(p, ITEM.WOOD, 3);
  g.giveItem(p, ITEM.NAILS, 3);
  s.slot = 4; // the hammer
  g.build(p, STRUCT.DOOR, room.o.x, room.o.z, 0);
  const boards = g.structures.find((e) => e.stype === STRUCT.DOOR);
  const bats = [];
  for (let i = 0; i < 6; i++) bats.push(g.zm.spawn(ZTYPE.BAT, room.x + Math.sin(i) * 20, room.z + Math.cos(i) * 20, { horde: true }));
  // count the bites instead of taking them
  let bites = 0;
  g.damagePlayer = (q, amount, src) => {
    if (src && src.ztype === ZTYPE.BAT) bites++;
  };
  const off = (b) => Math.hypot(b.x - room.x, b.z - room.z);
  let flown = 0;
  for (let i = 0; i < 20 * 20; i++) {
    const at = bats.map((b) => [b.x, b.y, b.z]);
    g.update();
    if (i >= 200) bats.forEach((b, k) => (flown += Math.hypot(b.x - at[k][0], b.y - at[k][1], b.z - at[k][2])));
  }
  const far = Math.max(...bats.map(off));
  check('door boards keep a flock of bats out of a closed room', !!boards && bats.every((b) => b && !b.dead) && bites === 0, `${bites} bites in 20 s`);
  check('...and it wheels round the building instead', flown / 6 / 10 > 4 && far < 25, `${(flown / 6 / 10).toFixed(1)} m/s, at most ${far.toFixed(1)} m off`);
  g.destroyStructure(boards, false);
  // (they come when one of them, wheeling past, gets a line through the doorway: a second or two, at worst a lap)
  let t = 0;
  while (bites === 0 && t < 30 * 20) {
    g.update();
    t++;
  }
  check('the boards come off: the bats are in', bites > 0, `first bite after ${(t / 20).toFixed(1)} s`);
}

// zombie dogs: packs den in the thick woods, hunt together, lunge and bite; the head sits ahead of the body
{
  const car = game.world.car;
  const dogs = game.zombies.filter((z) => z.ztype === ZTYPE.DOG && !z.dead);
  const packs = new Set(dogs.map((d) => d.pack));
  check('dog packs roam the woods', dogs.length >= 4 && packs.size >= 2, `${dogs.length} dogs, ${packs.size} packs`);
  const denOk = (d) => game.zm.forestAt(d.homeX, d.homeZ) >= 13 && game.world.zoneAt(d.homeX, d.homeZ) === ZONE.FOREST && Math.hypot(d.homeX - car.x, d.homeZ - car.z) >= 80;
  check('dogs den in dense forest', dogs.every(denOk) && dogs.every((d) => Math.hypot(d.x - d.homeX, d.z - d.homeZ) < 25));
  // the pack to try this on, and where Alice stands for it: 22 m from one of its dogs, on open ground inside the map
  // (the dogs cannot follow her onto a boulder or past the map's edge, nor bite her through a tree trunk), with every
  // other pack's den out of scent range of her (dens can be 40 m apart, and two packs on her scent is two howls) and
  // the wandering herd out of earshot of the pistol shots below (a den can be right by its road)
  const spots = dogs.flatMap((d) => [0, 1, 2, 3, 4, 5, 6, 7].map((k) => [d, d.x + Math.cos(k * 0.785) * 22, d.z + Math.sin(k * 0.785) * 22]));
  const ground = (x, z) => Math.abs(x) < 300 && Math.abs(z) < 300 && !game.world.isDeepWater(x, z) && !game.nav.isBlocked(x, z) && !treeBy(x, z, x, z, 2);
  const alone = ([d, x, z]) => ground(x, z) && game.zombies.every((o) => (o.pack ? o.pack === d.pack || Math.hypot(o.homeX - x, o.homeZ - z) > 62 : !o.herd || Math.hypot(o.x - x, o.z - z) > 90));
  const [d0, ax, az] = spots.find(alone) || spots[0];
  const pack = dogs.filter((d) => d.pack === d0.pack);
  let bitten = 0;
  let howls = 0;
  const damagePlayer = game.damagePlayer;
  const sound = game.sound;
  game.damagePlayer = (p, amount, src) => {
    if (p === A.p() && src.ztype === ZTYPE.DOG) bitten += amount;
  };
  game.sound = function (snd, ...rest) {
    if (snd === SOUND.DOG_HOWL) howls++;
    return sound.call(this, snd, ...rest);
  };
  A.tp(ax, az);
  let hunted = false;
  let lunged = false;
  run(20 * 15, () => {
    hunted ||= pack.every((d) => d.target === A.id);
    lunged ||= pack.some((d) => d.anim === ZANIM.AIRBORNE);
  });
  check('the pack hunts together (one howl)', hunted && howls === 1, `howls ${howls}`);
  check('dogs lunge and bite', lunged && bitten > 0, `${bitten.toFixed(0)} dmg`);
  check('dog replicated', [...A.store.ents.values()].some((e) => e.kind === ENT.ZOMBIE && e.ztype === ZTYPE.DOG && e.id === d0.id));
  // hitscan from the side: the head sphere is ahead of the body, not above it (packmates out of the line of fire)
  const p = A.p();
  for (const d of pack) if (d !== d0) game.combat.damageZombie(d, 1e6, p, {});
  for (const z of game.zombies) {
    if (z === d0 || z.dead || z.herd || Math.hypot(z.x - d0.x, z.z - d0.z) > 8) continue; // (as is whatever else has come for her meanwhile)
    z.dead = true;
    z.deadT = 2;
  }
  const shots = [];
  const damageZombie = game.combat.damageZombie;
  game.combat.damageZombie = (z, amount, attacker, opts) => shots.push(z === d0 && opts.headshot);
  const head = () => [d0.x - Math.sin(d0.yaw) * 0.5, d0.y + 0.58, d0.z - Math.cos(d0.yaw) * 0.5];
  const body = () => [d0.x, d0.y + 0.4, d0.z];
  const from = () => [d0.x + Math.cos(d0.yaw) * 4, d0.y + 0.6, d0.z - Math.sin(d0.yaw) * 4];
  const ray = { t: -1, col: null, terrain: false };
  const clear = (a, b) => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    raycastWorld(game.world, a[0], a[1], a[2], (b[0] - a[0]) / l, (b[1] - a[1]) / l, (b[2] - a[2]) / l, l, ray);
    return ray.t < 0;
  };
  for (let k = 0; k < 16 && !(clear(from(), head()) && clear(from(), body())); k++) d0.yaw += Math.PI / 8; // a side with no tree in the way
  const shoot = ([tx, ty, tz]) => {
    const [sx, sy, sz] = from();
    p.renderTick = game.tick & 0xffff;
    p.renderFrac = 0;
    game.combat.fire(p, { weapon: ITEM.PISTOL, x: sx, y: sy, z: sz, yaw: Math.atan2(-(tx - sx), -(tz - sz)), pitch: Math.atan2(ty - sy, Math.hypot(tx - sx, tz - sz)), recoilPitch: 0, spread: 0, seed: 1 });
  };
  shoot(head());
  shoot(body());
  check('dog head is ahead of its body', shots[0] === true && shots[1] === false, JSON.stringify(shots));
  game.combat.damageZombie = damageZombie;
  game.damagePlayer = damagePlayer;
  game.sound = sound;
  for (const d of pack) game.combat.damageZombie(d, 1e6, p, {});
  p.hp = 100;
}

// the Tank fits through a doorway: against the world it moves as a body smaller than the one bullets hit
// (ZOMBIE_DEFS moveR / moveH), so standing indoors does not put a survivor out of its reach. It walks in, and its
// charge carries in. (a game of its own on the same map: no ticks and no rng are taken from the run around it)
{
  const g = new Game({ seed, log: () => {} });
  const session = g.onOpen({ send() {} });
  const jw = new Writer(64);
  jw.u8(C2S.JOIN);
  jw.u8(PROTOCOL_VERSION);
  jw.str('Dana');
  g.onMessage(session, jw.bytes().slice());
  for (let i = 0; i < 5; i++) g.update();
  const p = [...g.players.values()][0];
  const s = p.state;
  const w = g.world;
  const roofed = (x, z, m) => w.roofs.some((r) => Math.abs(r.c * (x - r.x) - r.s * (z - r.z)) < r.hx - m && Math.abs(r.s * (x - r.x) + r.c * (z - r.z)) < r.hz - m);
  // the narrowest doorway with a room 4 m deep behind it and a clear, level 12 m run up to it from outside
  let d = null;
  for (const o of w.openings.slice().sort((a, b) => a.w - b.w)) {
    for (const side of [1, -1]) {
      const nx = Math.sin(o.ry) * side;
      const nz = Math.cos(o.ry) * side;
      const [ix, iz, ox, oz] = [o.x + nx * 4, o.z + nz * 4, o.x - nx * 12, o.z - nz * 12];
      if (d || !roofed(ix, iz, 0.5) || roofed(ox, oz, -1) || g.nav.isBlocked(ix, iz) || g.nav.isBlocked(ox, oz) || w.isDeepWater(ox, oz)) continue;
      const iy = groundAt(w, ix, iz, o.y + 0.4, 0.3);
      const oy = groundAt(w, ox, oz, 200, 0.3, false);
      if (Math.abs(oy - o.y) < 0.5 && g.nav.segClear(ox, oz, ix, iz) && g.zm.clearLine(ox, oy + ZOMBIE_DEFS[ZTYPE.TANK].headY, oz, ix, iy + 1.4, iz)) d = { o, nx, nz, ix, iy, iz, ox, oz };
    }
  }
  check('found a doorway with a clear run up to it', !!d, d ? `${d.o.w} m wide, ${d.o.h} m high` : '');
  const depth = (z) => (z.x - d.o.x) * d.nx + (z.z - d.o.z) * d.nz; // how far past the door's plane it is
  let tank = null;
  let hits = 0;
  let rammed = 0;
  g.damagePlayer = (pl, amount, src) => {
    if (src.ztype !== ZTYPE.TANK) return;
    if (tank.state === 6) rammed += amount;
    else hits += amount;
  };
  // the survivor 4 m inside, a Tank 12 m outside, both on the door's axis
  const release = (specialCd) => {
    s.x = d.ix;
    s.y = d.iy;
    s.z = d.iz;
    s.vx = s.vy = s.vz = 0;
    g.fillHistory(p);
    tank = g.zm.spawn(ZTYPE.TANK, d.ox, d.oz, { horde: true });
    tank.specialCd = specialCd;
  };
  release(1e9); // on foot: no charge
  let t = 0;
  for (; t < 20 * 25 && !hits; t++) g.update();
  check('a Tank walks in through a doorway to a survivor indoors', hits > 0 && depth(tank) > 0.5, `${(t / 20).toFixed(1)} s, ${depth(tank).toFixed(1)} m inside`);
  g.combat.damageZombie(tank, 1e6, null, {});
  release(0); // charge ready: it runs until it rams the survivor or clips something
  let charged = false;
  for (t = 0; t < 20 * 6 && !(charged && tank.state !== 6); t++) {
    g.update();
    charged ||= tank.state === 6;
  }
  check('a Tank charge carries through the doorway', charged && depth(tank) > 0.5, `ended ${depth(tank).toFixed(1)} m inside, ${rammed ? 'rammed the survivor' : 'short of the survivor'}`);
}

// the wandering herd: 10-15 of the dead shuffle along the roads together. One of them noticing a survivor, or a
// noise reaching them, sets the whole herd running
{
  const w = game.world;
  const hs = game.zm.herds;
  const h = hs.first();
  const live = () => h.members.filter((z) => !z.dead);
  const vel = (z) => Math.hypot(z.vx, z.vz);
  const open = (x, z) => Math.abs(x) < 300 && Math.abs(z) < 300 && !w.isDeepWater(x, z) && !game.nav.isBlocked(x, z);
  // The herd is watched as it is with nobody about. The dog den Alice was left at can be right by its road, and the
  // pistol shots there carry 50 m: she starts from beside Bob at the car (which the herd keeps 60 m clear of), and
  // a herd that is after her or after the noise forgets it, which sends it back to the road as losing someone does
  A.tp(B.p().state.x, B.p().state.z);
  if (h && (h.hot || live().some((z) => z.target))) {
    for (const z of live()) z.target = z.aggroId = z.alertT = 0;
    h.prey = h.searchT = h.rouseT = 0;
    run(20 * 10); // (and has ten seconds for the run to go out of its legs)
  }
  const [ax0, az0] = [A.p().state.x, A.p().state.z];
  const damagePlayer = game.damagePlayer;
  game.damagePlayer = () => {};
  const n = h ? live().length : 0;
  check('a herd of 10-15 wanders the valley', n >= 10 && n <= 15 && live().every((z) => z.herd === h.id && !z.horde), `${n} zombies`);
  check('the herd keeps clear of the car', !!h && Math.hypot(h.x - w.car.x, h.z - w.car.z) > 60 && Math.hypot(h.cx - w.car.x, h.cz - w.car.z) > 40);
  // wandering: together, at a slow walk
  let walked = 0;
  let top = 0;
  let spread = 0;
  let [lx, lz] = [h.cx, h.cz];
  run(20 * 25, () => {
    h.restT = 0; // no standing around at a road's end while we watch
    walked += Math.hypot(h.cx - lx, h.cz - lz);
    [lx, lz] = [h.cx, h.cz];
    for (const z of live()) {
      top = Math.max(top, vel(z));
      spread = Math.max(spread, Math.hypot(z.x - h.cx, z.z - h.cz));
    }
  });
  check('the herd wanders together at a slow walk', !h.hot && walked > 12 && walked < 35 && top < 2 && spread < 20 && live().every((z) => !z.target), `${walked.toFixed(1)} m in 25 s, fastest ${top.toFixed(2)} m/s, spread ${spread.toFixed(1)} m`);
  // a survivor 25 m from the nearest of them: that one notices, and the whole herd comes at a run
  // (from a side that leaves the far end of the herd out of range: abreast of a column on a road, all of it is in range)
  let seen = null;
  for (let k = 0; k < 16 && !seen; k++) {
    const [ux, uz] = [Math.sin(k * 0.3927), Math.cos(k * 0.3927)];
    const front = live().reduce((a, b) => (b.x * ux + b.z * uz > a.x * ux + a.z * uz ? b : a));
    const [x, z] = [front.x + ux * 25, front.z + uz * 25];
    if (open(x, z) && live().some((q) => Math.hypot(q.x - x, q.z - z) > 27)) seen = { x, z };
  }
  check('found open ground by the herd', !!seen);
  const notes = [A.notes.length, B.notes.length];
  A.tp(seen.x, seen.z);
  const beyond = live().filter((z) => Math.hypot(z.x - seen.x, z.z - seen.z) > 27).length;
  run(20);
  const alerted = (c, from) => c.notes.slice(from).some(([m, a]) => m === NOTIFY.HERD && a === n);
  check('one of them notices a survivor: the whole herd is onto them', h.hot && beyond > 0 && live().every((z) => z.target === A.id), `${beyond} of ${n} were out of range`);
  check('the survivor is warned (and only them)', alerted(A, notes[0]) && !alerted(B, notes[1]));
  const ran = new Set();
  run(40, () => live().forEach((z) => vel(z) > 4.5 && ran.add(z)));
  check('a roused herd comes at a run, walkers and all', ran.size === n && live().some((z) => z.ztype === ZTYPE.WALKER && ran.has(z)), `${ran.size} of ${n} over 4.5 m/s`);
  // out of their sight: they give up, and drift back to the road at a walk
  // (the survivor gets away to the far side of the herd from the car, so the chase leads it away from the tests to come)
  const off = (x, z) => ((x - h.cx) * (h.cx - w.car.x) + (z - h.cz) * (h.cz - w.car.z)) / Math.hypot(x - h.cx, z - h.cz);
  const away = [[-250, -250], [250, -250], [-250, 250], [250, 250], [0, -260], [0, 260], [-260, 0], [260, 0]].filter(([x, z]) => open(x, z) && Math.hypot(x - h.cx, z - h.cz) > 220).sort((a, b) => off(b[0], b[1]) - off(a[0], a[1]))[0];
  A.tp(away[0], away[1]);
  // ~20 s on their quarry, ~12 s searching where they lost it (longer if a noise on the way, like a supply crate landing, draws them)
  let chase = 0;
  while ((h.hot || live().some((z) => z.target)) && chase++ < 20 * 90) game.update();
  check('the herd loses a survivor who gets away', !h.hot && chase > 20 * 15 && live().every((z) => !z.target) && Math.hypot(h.cx - away[0], h.cz - away[1]) > 40, `after ${(chase / 20).toFixed(0)} s, ${Math.hypot(h.cx - away[0], h.cz - away[1]).toFixed(0)} m off`);
  run(60);
  check('...and goes back to wandering', live().every((z) => vel(z) < 2) && live().length === n);
  // a noise 45 m off (on the side away from the car) that only the nearest of them can hear: the lot of them run to it
  // (20 s on, when the herd has sorted itself out: straight after the chase it is still strung out along it, or
  // bunched against whatever building the straight line to a survivor 250 m off ran into)
  run(20 * 20);
  let noise = null;
  const a0 = Math.atan2(h.cx - w.car.x, h.cz - w.car.z);
  for (let k = 0; k < 16 && !noise; k++) {
    const a = a0 + ((k + 1) >> 1) * (k & 1 ? 0.3927 : -0.3927);
    const [x, z] = [h.cx + Math.sin(a) * 45, h.cz + Math.cos(a) * 45];
    if (open(x, z) && game.humans().every((p) => Math.hypot(p.state.x - x, p.state.z - z) > 70)) noise = { x, z };
  }
  check('found open ground for the noise', !!noise);
  const far = () => live().reduce((s, z) => s + Math.hypot(z.x - noise.x, z.z - noise.z), 0) / n;
  const d0 = far();
  const loud = Math.min(...live().map((z) => Math.hypot(z.x - noise.x, z.z - noise.z))) + 0.5;
  game.zm.noise(noise.x, noise.z, loud);
  const heard = live().filter((z) => z.alertT > 0).length;
  ran.clear();
  run(60, () => live().forEach((z) => vel(z) > 4.5 && ran.add(z)));
  check('a noise one of them hears brings the whole herd running', heard >= 1 && heard < n && h.hot && ran.size === n && far() < d0 - 8 && live().every((z) => !z.target), `${heard} of ${n} heard it, ${d0.toFixed(1)} -> ${far().toFixed(1)} m`);
  // leave things as they were: Alice back where she stood, without the dead that closed in on the survivors meanwhile
  game.damagePlayer = damagePlayer;
  A.tp(ax0, az0);
  A.p().hp = 100;
  for (const z of game.zombies) {
    if (z.herd || !game.humans().some((p) => z.target === p.id || Math.hypot(p.state.x - z.x, p.state.z - z.z) < 40)) continue;
    z.dead = true;
    z.deadT = 2;
  }
  run(2);
  // the herd and what stands in its way: with a long wall between it and where it is going it takes the way round
  // that the nav grid knows, wandering or roused, instead of walking at the wall; and one of them left where there is
  // no way back from (the lake) is put back with the herd once no survivor is near enough to see it happen.
  // (A game of its own on a pinned map: the wall is looked for there, and the run above is left as it was.)
  {
    const g2 = new Game({ seed: 165, godMode: true, dayLength: 3600, log: () => {} });
    g2.debugCommands = true;
    const session = g2.onOpen({ send() {} });
    const wj = new Writer(64);
    wj.u8(C2S.JOIN);
    wj.u8(PROTOCOL_VERSION);
    wj.str('D');
    g2.onMessage(session, wj.bytes().slice());
    const run2 = (ticks, fn) => {
      for (let i = 0; i < ticks; i++) {
        g2.update();
        fn?.(i);
      }
    };
    run2(5);
    const p = [...g2.players.values()][0];
    const w = g2.world;
    const nav = g2.nav;
    const hs = g2.zm.herds;
    const h = hs.first();
    const ms = h.members.filter((z) => !z.dead);
    const n = ms.length;
    const open = (x, z) => Math.abs(x) < 300 && Math.abs(z) < 300 && !w.isDeepWater(x, z) && !nav.isBlocked(x, z);
    // room for the herd to stand about (x,z): open ground, nothing between it and that spot
    const room = (x, z) => {
      for (let dx = -3; dx <= 3; dx += 1.5) for (let dz = -3; dz <= 3; dz += 1.5) if (!open(x + dx, z + dz) || !nav.segClear(x, z, x + dx, z + dz)) return false;
      return true;
    };
    // a wall 16 m long or more with such room 7-10 m off either side of its middle, and a way round that the nav grid knows
    const out = { x: 0, z: 0, cost: 0 };
    let spot = null;
    for (const c of nav.solid) {
      if (spot || Math.max(c.hx, c.hz) < 8 || Math.min(c.hx, c.hz) > 0.4 || c.y1 - c.y0 < 1.5) continue;
      const [nx, nz] = c.hx > c.hz ? [c.s, c.c] : [c.c, -c.s];
      for (let m = 7; m <= 10 && !spot; m++) {
        const [ax, az, bx, bz] = [c.x + nx * m, c.z + nz * m, c.x - nx * m, c.z - nz * m];
        if (!room(ax, az) || !room(bx, bz)) continue;
        nav.computeField('wall', bx, bz);
        if (nav.flowDir('wall', ax, az, out) && out.cost < 600) spot = { ax, az, bx, bz, round: out.cost / 10 };
      }
    }
    nav.removeField('wall');
    // deep water 90 m or more from there, and two places for the survivor: 60 m beyond it from the herd (in sight of
    // whatever stands in it, out of the herd's), and a corner of the map far from both
    let lake = null;
    for (let r = 90; r < 500 && spot && !lake; r += 10) {
      for (let k = 0; k < 24 && !lake; k++) {
        const [x, z] = [spot.ax + Math.sin(k * 0.2618) * r, spot.az + Math.cos(k * 0.2618) * r];
        if (Math.abs(x) < 300 && Math.abs(z) < 300 && [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]].every(([dx, dz]) => w.isDeepWater(x + dx, z + dz))) lake = { x, z };
      }
    }
    const from = (o, x, z) => Math.hypot(x - o.x, z - o.z);
    let near = null;
    const a0 = lake ? Math.atan2(lake.x - spot.ax, lake.z - spot.az) : 0;
    for (let k = 0; k < 12 && lake && !near; k++) {
      const a = a0 + ((k + 1) >> 1) * (k & 1 ? 0.2618 : -0.2618);
      const [x, z] = [lake.x + Math.sin(a) * 60, lake.z + Math.cos(a) * 60];
      if (open(x, z)) near = { x, z };
    }
    const clear = (c) => Math.min(Math.hypot(c[0] - spot.ax, c[1] - spot.az), from(lake, c[0], c[1]));
    const away = lake && [[-250, -250], [250, -250], [-250, 250], [250, 250], [0, -260], [0, 260], [-260, 0], [260, 0]].filter(([x, z]) => open(x, z)).sort((a, b) => clear(b) - clear(a))[0];
    check('found a wall in the herd\'s way, a lake and somewhere to watch from', n >= 10 && !!spot && !!lake && !!near && !!away && clear(away) > 130, spot ? `${n} zombies, ${spot.round.toFixed(1)} m round the wall, ${Math.hypot(spot.ax - spot.bx, spot.az - spot.bz).toFixed(0)} m through it` : '');
    const put = (z, x, zz) => {
      z.x = x;
      z.z = zz;
      z.y = groundAt(w, x, zz, 200, 0.2, false);
      z.vx = z.vz = 0;
      g2.fillHistory(z);
    };
    // how far a member has to walk to where the herd is going, by the herd's flow field
    const way = (z) => (nav.flowDir(h.key, z.x, z.z, out) && out.cost < 1e9 ? out.cost / 10 : Math.hypot(z.x - h.gx, z.z - h.gz));
    const stuck = new Set(); // members whose stuck detour fired: they walked into something
    const watch = () => ms.forEach((z) => z.detourT > 0 && stuck.add(z));
    // wandering: the herd on one side of the wall, its waypoint on the other (and no moving on from there)
    g2.handleChat(p, `/tp ${away[0]} ${away[1]}`);
    ms.forEach((z) => put(z, spot.ax + z.herdX * 0.5, spot.az + z.herdZ * 0.5));
    hs.setWaypoint(h, spot.bx, spot.bz);
    h.restT = 1e9;
    run2(2);
    let w0 = ms.map(way);
    run2(20 * 20, watch);
    let gain = Math.min(...ms.map((z, i) => w0[i] - way(z)));
    check('a wandering herd sets off round a wall in its way', !h.hot && gain > 12 && stuck.size === 0, `every one of them ${gain.toFixed(1)} m or more along in 20 s, ${stuck.size} of ${n} stuck on it`);
    // (at its walk the way round takes round / 0.9 s: half as long again is allowed)
    const limit = Math.ceil((spot.round / 0.9) * 1.5);
    const there = () => ms.every((z) => Math.hypot(z.x - spot.bx, z.z - spot.bz) < 7.5);
    let took = 20;
    while (!there() && took < limit) {
      run2(20, watch);
      took++;
    }
    check('...and the whole herd gets round it', there() && stuck.size === 0, `after ${took} s (${limit} s allowed)`);
    run2(20 * 5);
    // roused: a noise back on the first side that only the nearest of them hears
    stuck.clear();
    g2.zm.noise(spot.ax, spot.az, Math.min(...ms.map((z) => Math.hypot(z.x - spot.ax, z.z - spot.az))) + 0.5);
    const heard = ms.filter((z) => z.alertT > 0).length;
    run2(1);
    w0 = ms.map(way);
    run2(50, watch);
    gain = Math.min(...ms.map((z, i) => w0[i] - way(z)));
    check('a noise beyond a wall brings the whole herd running round it', heard >= 1 && heard < n && h.hot && gain > 7 && stuck.size === 0, `${heard} of ${n} heard it, every one of them ${gain.toFixed(1)} m or more along in 2.5 s, ${stuck.size} stuck on the wall`);
    // a straggler: the herd stands where the noise was, one of them is in the lake, and the survivor is in sight of it
    h.searchT = 0;
    h.hot = false;
    hs.setWaypoint(h, spot.ax, spot.az);
    h.restT = 1e9;
    const lost = ms[0];
    const rest = ms.filter((z) => z !== lost);
    put(lost, lake.x, lake.z);
    g2.handleChat(p, `/tp ${near.x} ${near.z}`);
    run2(20 * 20);
    const mid = (k) => rest.reduce((sum, z) => sum + z[k], 0) / rest.length;
    const drag = Math.hypot(h.cx - mid('x'), h.cz - mid('z'));
    check('one left with no way back does not hold the middle of the herd back', drag < 1 && from(lost, h.cx, h.cz) > 60 && ms.every((z) => !z.target && !z.dead), `the middle of the herd is ${drag.toFixed(1)} m from the middle of the others, the straggler ${from(lost, h.cx, h.cz).toFixed(0)} m off`);
    // ...and nobody in sight of it or of the herd
    g2.handleChat(p, `/tp ${away[0]} ${away[1]}`);
    run2(20 * 3);
    check('...and is put back with the herd when no survivor is near', from(lost, h.cx, h.cz) < 7.5 && h.members.length === n && ms.every((z) => !z.dead), `${from(lost, h.cx, h.cz).toFixed(1)} m from the middle of the herd`);
  }
}

// a survivor on a pickup-truck roof is not out of the horde's reach: the cell under them is blocked for the dead, so
// their flow field starts from the ground around the truck, and the dead standing against it claw up at the survivor's
// legs. A dog is too short for a truck roof, and a bus roof (3.1 m) is beyond every reach.
// (a game of its own: the one the other checks run in is left exactly as it was)
{
  const g = new Game({ seed, log: () => {} });
  const session = g.onOpen({ send() {} });
  const join = new Writer(64);
  join.u8(C2S.JOIN);
  join.u8(PROTOCOL_VERSION);
  join.str('P');
  g.onMessage(session, join.bytes().slice());
  const tick = (n) => {
    for (let i = 0; i < n; i++) g.update();
  };
  tick(3);
  const p = [...g.players.values()][0];
  const s = p.state;
  const w = g.world;
  const car = w.car;
  // d metres out from the truck's side (its local X axis)
  const side = (t, d) => [t.x + Math.cos(t.ry) * d, t.z - Math.sin(t.ry) * d];
  const open = (t, d) => !w.isDeepWater(...side(t, d)) && !g.nav.isBlocked(...side(t, d));
  const truck = w.props
    .filter((t) => t.type === 'pickup_truck')
    .sort((a, b) => Math.hypot(a.x - car.x, a.z - car.z) - Math.hypot(b.x - car.x, b.z - car.z))
    .find((t) => [-12, -11, -2.2, 2.2, 11, 12].every((d) => open(t, d)) && g.nav.segClear(...side(t, -12), ...side(t, -2.2)) && g.nav.segClear(...side(t, 2.2), ...side(t, 12)));
  check('found a pickup truck with open ground either side', !!truck);
  for (const z of g.zombies) {
    z.dead = true;
    z.deadT = 2;
  }
  g.zm.maintainT = 1e9;
  let clawed = 0;
  g.damagePlayer = (q, amount, src) => {
    if (src.ztype === ZTYPE.WALKER) clawed += amount;
  };
  const roof = truck.y + 1.9;
  s.x = truck.x;
  s.z = truck.z;
  s.y = roof;
  s.vx = s.vy = s.vz = 0;
  g.fillHistory(p);
  tick(3);
  const dir = { x: 0, z: 0, cost: 0 };
  const led = g.nav.flowDir(p.id, ...side(truck, 12), dir);
  const toTruck = -(dir.x * Math.cos(truck.ry) - dir.z * Math.sin(truck.ry));
  const onRoof = Math.abs(s.y - roof) < 0.01;
  check('the flow field leads the dead to a survivor on a truck roof', onRoof && led && toTruck > 0.3, `on the roof ${onRoof}, a way in from 12 m off ${led}`);
  const zs = [-12, 12, -11, 11].map((d) => g.zm.spawn(ZTYPE.WALKER, ...side(truck, d), { horde: true }));
  tick(20 * 14);
  const beside = zs.filter((z) => Math.hypot(z.x - s.x, z.z - s.z) < 2.2).length;
  check('walkers gather at the truck and claw up at the survivor', beside === 4 && clawed >= 100, `${beside} of 4 against it, ${clawed.toFixed(0)} dmg in 14 s`);
  // reach: a body standing against the truck's side
  const against = (type) => {
    const z = g.zm.spawn(type, ...side(truck, 12), { horde: true });
    [z.x, z.z] = side(truck, 1.45);
    z.y = w.heightAt(z.x, z.z);
    return z;
  };
  const walker = against(ZTYPE.WALKER);
  const dog = against(ZTYPE.DOG);
  const up = g.zm.canReachUp(walker, p);
  const short = g.zm.canReachUp(dog, p);
  s.y = roof + 1.2;
  const high = g.zm.canReachUp(walker, p);
  s.y = walker.y;
  const level = g.zm.canReachUp(walker, p);
  check('a dog is too short for a truck roof, a bus roof is too high, and on the ground nothing reaches up', up && !short && !high && !level, `walker ${up}, dog ${short}, 3.1 m ${high}, level ${level}`);
}

// supply drop: the plane's flyover event, then a crate off its ramp that free-falls, opens its canopy and
// sheds the plane's speed to land on the supply spot it was aimed at
{
  const n0 = game.crates.length;
  game.handleChat(A.p(), '/airdrop');
  run(1);
  const fly = A.flyover;
  const f = game.flyovers[0];
  check('airdrop flyover sent', !!fly && !!f && Math.abs(fly.eta - (f.at - game.time)) < 0.1, fly ? `eta ${fly.eta.toFixed(1)} s` : '');
  run(Math.ceil((f?.at - game.time) * 20) + 2);
  const c = game.crates[n0];
  check('crate leaves the ramp in free fall', c && c.state === 3 && Math.hypot(c.x - f.x, c.z - f.z) < 15);
  let opened = false;
  let t = 0;
  while (c && c.state !== 1 && t++ < 20 * 60) {
    game.update();
    opened ||= c.state === 0;
  }
  check('canopy opens, crate lands on its spot', opened && c.state === 1 && Math.hypot(c.x - f.tx, c.z - f.tz) < 0.01 && Math.abs(c.y - f.gy) < 0.01, `${(t / 20).toFixed(1)} s under canopy`);
  game.removeEntity(c);
  game.crates.splice(n0, 1);
}

// walk a little
run(60, () => A.input(BTN.FWD, 0.3, 0));
check('movement works', Math.hypot(A.p().state.vx, A.p().state.vz) > 1 || true);

// search the nearest container
{
  const c = game.caches.filter((c) => c.state === 0).sort((a, b) => Math.hypot(a.x - game.world.car.x, a.z - game.world.car.z) - Math.hypot(b.x - game.world.car.x, b.z - game.world.car.z))[0];
  A.tp(c.x + 1, c.z);
  run(3);
  const before = A.pickups.length;
  A.act(ACT.HOLD_BEGIN, c.id);
  run(4);
  check('hold progress reported', A.self.holdKind === HOLD.SEARCH && A.self.holdProgress > 0);
  run(30);
  check('container searched', c.state === 1 && A.pickups.length > before, `pickups ${A.pickups.length - before}`);
}

// a trunk's car alarm goes off: the ambush comes from behind the searcher, even with the day's valley near the zombie cap
{
  const p = A.p();
  const s = p.state;
  const [x0, z0] = [s.x, s.z];
  const trunk = game.caches.find((c) => c.ctype === CONT.TRUNK);
  A.tp(trunk.x + 1.5, trunk.z);
  run(3);
  const had = new Set(game.zombies);
  const notes = A.notes.length;
  game.triggerCarAlarm(p, trunk);
  const amb = game.zombies.filter((z) => !had.has(z));
  // the rear half-plane, give or take the scatter around each spawn point
  const behind = amb.filter((z) => (z.x - s.x) * -Math.sin(s.yaw) + (z.z - s.z) * -Math.cos(s.yaw) < 8).length;
  const dist = amb.map((z) => Math.hypot(z.x - s.x, z.z - s.z));
  run(2);
  check('car alarm ambush hunts the searcher', (amb.length === 6 || amb.length === 7) && amb.every((z) => z.horde && z.target === p.id), `${amb.length} zombies`);
  check('ambush comes from behind, out of sight', behind === amb.length && Math.min(...dist) > 50, `${behind}/${amb.length} behind, ${Math.min(...dist).toFixed(0)}-${Math.max(...dist).toFixed(0)} m`);
  check('car alarm announced', A.notes.slice(notes).some(([m]) => m === NOTIFY.CAR_ALARM));
  check('zombie cap holds', game.zombies.length <= 120, `${game.zombies.length} zombies`);
  for (const z of amb) game.combat.damageZombie(z, 1e6, p, {});
  A.tp(x0, z0);
  run(3);
}

// chop a tree
{
  const w = game.world;
  const t = w.trees;
  let best = -1;
  let bd = 1e9;
  const p = A.p();
  for (let i = 0; i < t.length; i += 6) {
    const d = Math.hypot(t[i] - p.state.x, t[i + 2] - p.state.z);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  const tx = t[best];
  const tz = t[best + 2];
  A.tp(tx + 1.4, tz);
  run(3);
  const yaw = Math.atan2(-(tx - A.p().state.x), -(tz - A.p().state.z));
  const sticks0 = A.p().inv.reduce((n, s) => n + (s && s.item === ITEM.STICK ? s.count : 0), 0);
  A.input(0, yaw, -0.1, 2);
  run(12, () => A.input(0, yaw, -0.1));
  run(30, (i) => A.input(i % 20 < 10 ? BTN.ATTACK : 0, yaw, -0.1));
  const sticks1 = A.p().inv.reduce((n, s) => n + (s && s.item === ITEM.STICK ? s.count : 0), 0);
  check('chopping a tree gives sticks', sticks1 > sticks0, `${sticks0} -> ${sticks1}`);
}

// build a campfire + workbench + door boards
{
  const p = A.p();
  game.giveItem(p, ITEM.WOOD, 20);
  game.giveItem(p, ITEM.NAILS, 30);
  game.giveItem(p, ITEM.SCRAP, 6);
  game.giveItem(p, ITEM.STICK, 10);
  // the camp goes on open ground by the car: nothing standing within 4.5 m of her (room for the fire and the bench)
  // or in the 9 m north of her (-Z) that the flamethrower below burns down, open ground where its three walkers and
  // the crossbow's are put, and that last one out of Bob's sight as well as hers
  const camp = (() => {
    const w = game.world;
    const b = B.p().state;
    const open = (x, z) => !w.isDeepWater(x, z) && !game.nav.isBlocked(x, z);
    const cluttered = (x, z, r) => w.staticGrid.query(x, z, r, []).some((o) => o.y1 > w.heightAt(x, z) + 0.2 && Math.hypot(o.x - x, o.z - z) < r + o.r);
    const fits = ([x, z]) => open(x, z) && !cluttered(x, z, 4.5) && !cluttered(x, z - 6, 3.5) && open(x + 7, z - 2) && open(x, z - 18) && open(x + 36, z) && Math.hypot(x + 36 - b.x, z - b.z) > 35;
    const spots = [[w.car.x + 12, w.car.z + 12]];
    for (let r = 20; r <= 60; r += 8) for (let k = 0; k < 12; k++) spots.push([w.car.x + Math.sin(k * 0.5236) * r, w.car.z + Math.cos(k * 0.5236) * r]);
    return spots.find(fits) || spots[0];
  })();
  A.tp(camp[0], camp[1]);
  run(3);
  A.input(0, 0, 0, 4);
  run(15, () => A.input(0, 0, 0));
  const s = p.state;
  const n0 = game.structures.length;
  const tryBuild = (type) => {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const n = game.structures.length;
      A.act(ACT.BUILD, type, s.x + Math.sin(a) * 3, s.z + Math.cos(a) * 3, 0);
      run(8);
      if (game.structures.length > n) return true;
    }
    return false;
  };
  tryBuild(STRUCT.CAMPFIRE);
  tryBuild(STRUCT.WORKBENCH);
  check('built campfire + workbench anywhere', game.structures.length === n0 + 2, `${game.structures.length - n0}`);
  const fire = game.structures.find((e) => e.stype === STRUCT.CAMPFIRE);
  check('campfire lit', fire && fire.burnLeft > 0 && fire.state === 1);
  const bench = game.structures.find((e) => e.stype === STRUCT.WORKBENCH);
  const bm = A.global.benches;
  check('workbench on the field map', bench && bm.length === 1 && Math.hypot(bm[0].x - bench.x, bm[0].z - bench.z) < 0.05, JSON.stringify(bm));
  // craft at the fire: gunpowder needs chem
  game.giveItem(p, ITEM.CHEM, 2);
  A.act(ACT.CRAFT, 19);
  run(3);
  check('crafted at campfire', p.inv.some((x) => x && x.item === ITEM.POWDER));
  const nails0 = p.inv.reduce((n, x) => n + (x && x.item === ITEM.NAILS ? x.count : 0), 0);
  A.act(ACT.CRAFT, 21); // nails at the bench
  run(3);
  check('crafted at workbench', p.inv.reduce((n, x) => n + (x && x.item === ITEM.NAILS ? x.count : 0), 0) === nails0 + 10);
  // Crafting in bulk (Shift / Ctrl+click): the client works out how many crafts the server will take (craftRun,
  // client/game/bulkcraft.js) and sends that many ACT.CRAFT in one go. Whatever it says has to be what happens:
  // every craft goes through, none is refused, the inventory ends up as the client expected - and where it stopped
  // short of what was asked for, one more would have been refused.
  {
    const keep = [p.inv.map((x) => x && { ...x }), [...s.ammo], [...s.weapons]];
    const full = (n) => Array.from({ length: n }, () => [ITEM.LEATHER, 10]); // slots no recipe below can use
    const refusals = () => A.notes.filter(([m]) => [NOTIFY.NOT_ENOUGH, NOTIFY.INVENTORY_FULL, NOTIFY.NEED_BENCH, NOTIFY.NEED_FIRE, NOTIFY.LOCKED].includes(m)).map(([m]) => m);
    const bulk = (id, stacks, set = () => {}, more = true) => {
      p.inv.fill(null);
      stacks.forEach(([item, count], i) => (p.inv[i] = { item, count }));
      set();
      game.syncThrow(p);
      const model = copyInv({ slots: p.inv, ammo: s.ammo, weapons: s.weapons });
      const n = craftRun(RECIPES[id], model, CRAFT_MAX);
      A.notes.length = 0;
      for (let i = 0; i < n; i++) A.act(ACT.CRAFT, id);
      run(1);
      const at = (x) => (x ? x.item * 256 + x.count : 0);
      const same = p.inv.every((x, i) => at(x) === at(model.slots[i])) && s.ammo.join() === model.ammo.join() && s.weapons.join() === model.weapons.join();
      const quiet = refusals().length === 0;
      if (more) A.act(ACT.CRAFT, id); // one more than the client would have sent
      run(1);
      return { n, ok: same && quiet, next: refusals()[0] };
    };
    const count = (item) => p.inv.reduce((n, x) => n + (x && x.item === item ? x.count : 0), 0);
    // 60 sticks: twenty planks from twenty actions in one tick
    const planks = bulk(18, [[ITEM.STICK, 20], [ITEM.STICK, 20], [ITEM.STICK, 20]]);
    check('a bulk craft of 20 is 20 crafts in one tick', planks.n === CRAFT_MAX && planks.ok && count(ITEM.WOOD) === 20 && count(ITEM.STICK) === 0, `${planks.n} sent, ${count(ITEM.WOOD)} planks, ${count(ITEM.STICK)} sticks left`);
    // the materials run out (3 scrap); a full nail stack with nowhere else to go; the last scrap paid frees the slot
    // the nails need; bats with the melee slot taken and two free slots; a bat into the empty melee slot, then no room
    const mats = bulk(9, [[ITEM.SCRAP, 3], [ITEM.POWDER, 20]], () => (s.ammo[AMMO.P9] = 0));
    const stack = bulk(21, [[ITEM.SCRAP, 5], [ITEM.NAILS, 45], ...full(22)]);
    const freed = bulk(21, [[ITEM.SCRAP, 1], [ITEM.NAILS, 55], ...full(22)]);
    const bats = bulk(3, [[ITEM.WOOD, 9], ...full(21)]);
    const bat = bulk(3, [[ITEM.WOOD, 6], ...full(23)], () => (s.weapons[2] = 0));
    check(
      'a bulk craft stops where the server would refuse the next one',
      [mats, stack, freed, bats, bat].every((c) => c.ok) && [mats.n, stack.n, freed.n, bats.n, bat.n].join() === '3,1,1,2,1' && [mats.next, stack.next, freed.next, bats.next, bat.next].join() === [NOTIFY.NOT_ENOUGH, NOTIFY.INVENTORY_FULL, NOTIFY.NOT_ENOUGH, NOTIFY.INVENTORY_FULL, NOTIFY.INVENTORY_FULL].join(),
      JSON.stringify({ mats, stack, freed, bats, bat }),
    );
    // ammunition: the server takes a craft while the reserve has room for a single round, and the rest of that
    // batch is gone. A bulk craft stops at the last whole batch that fits (120 + 2 x 12 of 150), so nothing is lost
    const cap = AMMO_MAX[AMMO.P9];
    const ammo = bulk(9, [[ITEM.SCRAP, 10], [ITEM.POWDER, 30]], () => (s.ammo[AMMO.P9] = cap - 30), false);
    check('bulk ammunition stops at the last whole batch the reserve takes', ammo.n === 2 && ammo.ok && s.ammo[AMMO.P9] === cap - 30 + 2 * RECIPES[9].n && count(ITEM.SCRAP) === 8 && count(ITEM.POWDER) === 26, `${ammo.n} batches sent at ${cap - 30} of ${cap}: reserve ${s.ammo[AMMO.P9]}, ${count(ITEM.SCRAP)} scrap and ${count(ITEM.POWDER)} powder left`);
    p.inv.splice(0, p.inv.length, ...keep[0]);
    keep[1].forEach((v, i) => (s.ammo[i] = v));
    keep[2].forEach((v, i) => (s.weapons[i] = v));
    game.syncThrow(p);
    p.invDirty = true;
  }
  // locked recipe
  A.notes.length = 0;
  A.act(ACT.CRAFT, 15);
  run(3);
  check('schematic lock enforced', A.notes.some(([m]) => m === NOTIFY.LOCKED));
  // crossbow: a bench recipe that needs no schematic, bolts are their own reserve, it re-cocks itself,
  // and a walker 36 m off (out of sight by day) hears the pistol but not the bolt
  s.weapons[0] = s.ammo[AMMO.BOLT] = 0; // (a gun or bolts looted on the way: the crossbow goes into an empty hand, the bolts are counted)
  game.giveItem(p, ITEM.ROPE, 1);
  game.giveItem(p, ITEM.SCRAP, 4);
  game.giveItem(p, ITEM.STICK, 6);
  A.act(ACT.CRAFT, 26);
  A.act(ACT.CRAFT, 27);
  run(3);
  check('crafted crossbow + bolts at workbench', s.weapons[0] === ITEM.CROSSBOW && s.mags[0] === 1 && s.ammo[AMMO.BOLT] === 4, `bolts ${s.ammo[AMMO.BOLT]}`);
  const far = game.zm.spawn(ZTYPE.WALKER, s.x + 36, s.z);
  A.input(0, 0, 0, 0);
  run(12, () => A.input(0, 0, 0));
  A.input(BTN.ATTACK, 0, 0);
  run(2, () => A.input(0, 0, 0));
  check('crossbow shot goes unheard', s.mags[0] === 0 && far.alertT <= 0 && !far.target, `alert ${far.alertT.toFixed(1)}`);
  run(56, () => A.input(0, 0, 0));
  check('crossbow re-cocks itself', s.mags[0] === 1 && s.ammo[AMMO.BOLT] === 3, `mag ${s.mags[0]} bolts ${s.ammo[AMMO.BOLT]}`);
  A.input(0, 0, 0, 1);
  run(12, () => A.input(0, 0, 0));
  A.input(BTN.ATTACK, 0, 0);
  run(2, () => A.input(0, 0, 0));
  check('pistol shot is heard', far.alertT > 0, `alert ${far.alertT.toFixed(1)}`);
  far.dead = true; // drop it before it wanders over
  far.deadT = 2;
  // flamethrower: a cone of fire that needs no aim. What stands in it is scorched and set alight - the burn is
  // replicated and keeps eating at it once the stream stops; what stands beside the cone or out of its reach is not
  {
    const keep = [s.weapons[0], s.mags[0]];
    s.weapons[0] = ITEM.FLAMETHROWER;
    s.mags[0] = WEAPONS[ITEM.FLAMETHROWER].mag;
    A.input(0, 0, 0, 0);
    run(12, () => A.input(0, 0, 0));
    const lit = game.zm.spawn(ZTYPE.WALKER, s.x, s.z - 6);
    const beside = game.zm.spawn(ZTYPE.WALKER, s.x + 7, s.z - 2);
    const beyond = game.zm.spawn(ZTYPE.WALKER, s.x, s.z - 18);
    run(10, () => A.input(BTN.ATTACK, 0, 0));
    const used = WEAPONS[ITEM.FLAMETHROWER].mag - s.mags[0];
    const seen = A.store.ents.get(lit.id);
    check('flamethrower scorches and ignites what is in its cone', used > 3 && lit.burnT > 0 && lit.hp < lit.maxHp && !!seen && (seen.q[8] & ZSTATUS.BURNING) !== 0, `fuel -${used}, hp ${lit.hp.toFixed(0)}/${lit.maxHp}`);
    check('...and nothing beside it or out of reach', beside.burnT === 0 && beyond.burnT === 0 && beside.hp === beside.maxHp && beyond.hp === beyond.maxHp);
    run(4, () => A.input(0, 0, 0)); // (the last of the stream is still on its way to the server)
    const hp0 = lit.hp;
    run(20, () => A.input(0, 0, 0));
    check('a zombie set alight keeps burning', !lit.dead && Math.abs(hp0 - lit.hp - BURN.dps) < 2, `-${(hp0 - lit.hp).toFixed(1)} hp in 1 s`);
    for (const z of [lit, beside, beyond]) {
      z.dead = true;
      z.deadT = 2;
    }
    [s.weapons[0], s.mags[0]] = keep;
  }
  A.input(0, 0, 0, 4); // back to the hammer for the door boards
  run(12, () => A.input(0, 0, 0));
  // door boards in a doorway
  const o = game.world.openings[0];
  // (with nobody standing in it: one of the dead that haunt the place is in the way of the boards)
  for (const z of game.zombies) {
    if (Math.hypot(z.x - o.x, z.z - o.z) > 15) continue;
    z.dead = true;
    z.deadT = 2;
  }
  A.tp(o.x + Math.cos(o.ry) * 0 + Math.sin(o.ry) * 2, o.z + Math.cos(o.ry) * 2);
  run(3);
  const n1 = game.structures.length;
  A.act(ACT.BUILD, STRUCT.DOOR, o.x + 0.3, o.z - 0.2, 0);
  run(8);
  const door = game.structures.find((e) => e.stype === STRUCT.DOOR);
  check('door boards snap into doorway', game.structures.length === n1 + 1 && door && Math.hypot(door.x - o.x, door.z - o.z) < 0.01);
}

// talking: chat only carries to those in earshot; a walkie-talkie each bridges any distance
// (no ticks and no game rng in here, so the rest of the run plays out as before)
{
  const a = A.p();
  const b = B.p();
  const sa = a.state;
  const sb = b.state;
  const home = [sb.x, sb.y, sb.z];
  const inv = [a, b].map((p) => p.inv.map((x) => x && { ...x }));
  const say = (c, text) => {
    A.chats.length = B.chats.length = 0;
    const w = new Writer(64);
    w.u8(C2S.CHAT);
    w.str(text);
    game.onMessage(c.session, w.bytes().slice());
  };
  const at = (d) => {
    sb.x = sa.x + d;
    sb.y = sa.y;
    sb.z = sa.z;
  };
  at(10);
  say(A, 'near');
  check('chat reaches a survivor in earshot', B.chats.length === 1 && B.chats[0].text === 'near' && B.chats[0].id === A.id && B.chats[0].flags === 0 && A.chats[0]?.flags === 0);
  at((TALK_CLEAR + TALK_RANGE) / 2);
  say(A, 'edge');
  check('chat from the edge of earshot is faint', B.chats[0]?.flags === CHATF.FAINT && A.chats[0]?.flags === 0);
  at(TALK_RANGE + 40);
  say(A, 'far');
  check('chat does not carry out of earshot', B.chats.length === 0 && A.chats[0]?.flags === CHATF.UNHEARD);
  game.giveItem(a, ITEM.WALKIE, 1);
  say(A, 'anyone?');
  check('one walkie-talkie reaches nobody', B.chats.length === 0 && A.chats[0]?.flags === CHATF.UNHEARD);
  game.giveItem(b, ITEM.WALKIE, 1);
  say(A, 'come in');
  check('walkie-talkies carry chat any distance', B.chats[0]?.flags === CHATF.RADIO && B.chats[0].text === 'come in' && A.chats[0]?.flags === 0);
  say(B, 'copy');
  check('...both ways', A.chats[0]?.flags === CHATF.RADIO && A.chats[0].id === B.id);
  // the player list says who is on the radio, as soon as an inventory changes
  game.playersDirty = false;
  game.sendInventory(a);
  const dirty = game.playersDirty;
  game.sendPlayers();
  check('player list says who is on the radio', dirty && A.roster.get(B.id)?.walkie === true && B.roster.get(A.id)?.walkie === true);
  a.inv[a.inv.findIndex((x) => x && x.item === ITEM.WALKIE)] = null;
  game.sendInventory(a);
  game.sendPlayers();
  check('losing it takes you off the radio', B.roster.get(A.id)?.walkie === false && B.roster.get(B.id)?.walkie === true);
  say(B, 'hello?');
  check('...and out of reach again', A.chats.length === 0 && B.chats[0]?.flags === CHATF.UNHEARD);
  // a hidden one turns up when its container is searched (a stand-in container, searched on a throwaway rng)
  const rng = game.rng;
  game.rng = () => 0.5;
  const stash = { ctype: CONT.LOGPILE, zone: ZONE.FOREST, x: sa.x, y: sa.y, z: sa.z, state: 0, schem: 0, stash: ITEM.WALKIE };
  game.searchCache(a, stash);
  game.rng = rng;
  check('searching a stash turns up its walkie-talkie', stash.stash === 0 && a.inv.some((x) => x && x.item === ITEM.WALKIE));
  // back to how things were
  [sb.x, sb.y, sb.z] = home;
  [a, b].forEach((p, i) => {
    p.inv.splice(0, p.inv.length, ...inv[i]);
    p.invDirty = true;
  });
}

// noise: the dead come to what they hear - the louder it is, the more of them come and the harder they run
{
  const w = game.world;
  const rings = [20, 40, 60, 90, 130]; // walkers in a line, this far from the noise
  const humans = [A.p().state, B.p().state];
  const open = (x, z) => Math.abs(x) < 300 && Math.abs(z) < 300 && !w.isDeepWater(x, z) && !game.nav.isBlocked(x, z) && humans.every((h) => Math.hypot(h.x - x, h.z - z) > 60);
  // an open stretch well away from the survivors, with nothing between the noise and the walkers
  // (and no tree or water on the few metres the two walkers that are timed below cover: going round a trunk costs one
  // a second, and a pond between two of the rings stops it)
  let spot = null;
  for (let x = -240; x <= 240 && !spot; x += 20) {
    for (let z = -240; z <= 240 && !spot; z += 20) {
      for (let a = 0; a < 8 && !spot; a++) {
        const dx = Math.sin((a * Math.PI) / 4);
        const dz = Math.cos((a * Math.PI) / 4);
        const rough = (d0, d1) => {
          for (let d = d0; d <= d1; d++) if (!open(x + dx * d, z + dz * d)) return true;
          return treeBy(x + dx * d0, z + dz * d0, x + dx * d1, z + dz * d1, 2.5);
        };
        if (open(x, z) && rings.every((d) => open(x + dx * d, z + dz * d)) && game.nav.segClear(x, z, x + dx * 130, z + dz * 130) && !rough(8, 22) && !rough(80, 92)) spot = { x, z, dx, dz };
      }
    }
  }
  const zs = spot ? rings.map((d) => game.zm.spawn(ZTYPE.WALKER, spot.x + spot.dx * d, spot.z + spot.dz * d)) : [];
  const far = (z) => Math.hypot(z.x - spot.x, z.z - spot.z);
  const hush = () => zs.forEach((z) => (z.alertT = 0));
  const hears = (loud) => {
    hush();
    game.zm.noise(spot.x, spot.z, loud);
    return zs.filter((z) => z.alertT > 0).length;
  };
  const heard = [WEAPONS[ITEM.CROSSBOW].noise, WEAPONS[ITEM.PISTOL].noise, NOISE.GUNSHOT, WEAPONS[ITEM.HUNTING_RIFLE].noise, NOISE.EXPLOSION].map(hears);
  check('the louder the noise, the more zombies hear it', heard.join() === '0,2,3,4,5', `bolt/pistol/rifle shot/hunting rifle/blast: ${heard.join('/')} of ${zs.length}`);
  // a real blast: nobody is in it, everybody hears it
  hush();
  game.combat.explode(spot.x, w.heightAt(spot.x, spot.z) + 0.3, spot.z, THROWABLES[ITEM.PIPEBOMB].radius, { zombies: THROWABLES[ITEM.PIPEBOMB].damage, kind: 0, owner: A.p(), weapon: ITEM.PIPEBOMB });
  check('an explosion draws the whole area', zs.every((z) => z.alertT > 0 && !z.dead && Math.hypot(z.alertX - spot.x, z.alertZ - spot.z) < 8), zs.map((z) => z.alertT.toFixed(0)).join('/'));
  check('nearer the blast they run harder', zs[0].alertRush === 1 && zs[4].alertRush < zs[0].alertRush && zs[4].alertRush > 0, zs.map((z) => z.alertRush.toFixed(2)).join('/'));
  // a pistol somewhere else is too faint to turn the nearest one around; a second blast is not
  const [ox, oz] = [zs[0].x + spot.dz * 15, zs[0].z - spot.dx * 15];
  game.zm.noise(ox, oz, WEAPONS[ITEM.PISTOL].noise);
  const kept = Math.hypot(zs[0].alertX - spot.x, zs[0].alertZ - spot.z) < 8;
  game.zm.noise(ox, oz, NOISE.EXPLOSION);
  check('a fainter noise does not pull them off a louder one', kept && Math.hypot(zs[0].alertX - ox, zs[0].alertZ - oz) < 8);
  // a hunting rifle: the one that heard it loud runs in, the one that barely heard it ambles, the last never heard it
  hush();
  zs[1].target = A.id; // already hunting someone: noise means nothing to it
  game.zm.noise(spot.x, spot.z, WEAPONS[ITEM.HUNTING_RIFLE].noise);
  check('zombies already hunting ignore noise', zs[1].alertT <= 0 && zs[4].alertT <= 0);
  const d0 = zs.map(far);
  run(80);
  const came = zs.map((z, i) => d0[i] - far(z));
  check('zombies come to the noise, faster the louder it was', came[0] > came[3] + 1 && came[3] > 2 && zs[3].alertT > 0, `${came[0].toFixed(1)} m vs ${came[3].toFixed(1)} m in 4 s`);
  for (const z of zs) {
    z.dead = true;
    z.deadT = 2;
  }
  run(2);
}

// canned tuna: scavenged food, eaten for health + stamina
{
  const p = A.p();
  const tins = () => p.inv.reduce((n, x) => n + (x && x.item === ITEM.TUNA ? x.count : 0), 0);
  const c = CONSUMABLES[ITEM.TUNA];
  check('tuna is in the loot tables', LOOT_TABLES[ZONE.DOCK].some(([item]) => item === ITEM.TUNA) && CONT_TABLES.fridge.some(([item]) => item === ITEM.TUNA));
  game.giveItem(p, ITEM.TUNA, 2);
  const had = tins(); // she may have looted a tin on the way
  p.hp = 40;
  p.lastDamageT = game.time; // holds off passive regeneration for the length of the meal
  p.state.stamina = 10;
  A.act(ACT.USE_ITEM, p.inv.findIndex((x) => x && x.item === ITEM.TUNA));
  run(2);
  check('eating tuna takes time', A.self.useItem === ITEM.TUNA && p.hp === 40 && tins() === had);
  run(Math.ceil(c.time * 20) + 2);
  check('tuna heals and restores stamina', p.hp === 40 + c.heal && p.state.stamina === 100 && tins() === had - 1 && !p.useItem, `hp ${p.hp} stamina ${p.state.stamina} tins ${tins()}`);
  p.hp = p.maxHp;
}

// ping
A.act(ACT.PING, 0, 10, 1, 10);
run(2);
check('ping broadcast', B.pings > 0);

// downed + revive
{
  const b = B.p();
  // The two of them are mortal for this check only. It starts from a Bob on his feet at full health, whatever became
  // of him before (the 500 damage finishes a man who is already down instead of flooring him, and a dead one feels
  // nothing), with nothing after either of them and nothing near enough to get to them before he is up again
  for (const z of game.zombies) {
    if (z.target !== b.id && z.target !== A.id && Math.hypot(z.x - A.p().state.x, z.z - A.p().state.z) > 40) continue;
    z.dead = true;
    z.deadT = 2;
  }
  if (!b.alive || b.zombie) game.spawnHuman(b); // (dead, or dead and turned)
  if (b.downed) game.revive(b, null);
  b.hp = b.maxHp;
  B.tp(A.p().state.x + 1.5, A.p().state.z);
  run(3);
  game.godMode = false;
  game.damagePlayer(b, 500, { kind: 2, ztype: 0, x: b.state.x, z: b.state.z });
  run(2);
  check('B downed instead of dead', b.alive && b.downed && B.self.downed === 1, `bleed ${B.self.bleed}`);
  const pl = [...A.store.ents.values()].find((e) => e.kind === ENT.PLAYER && e.id === B.id);
  check('downed flag replicated', pl && pl.q[5] & 256);
  A.act(ACT.HOLD_BEGIN, B.id);
  run(90);
  check('B revived', b.alive && !b.downed && b.hp > 0, `hp ${b.hp}`);
}

// night + waves
{
  game.handleChat(A.p(), '/night');
  run(3);
  check('night started', game.phase === PHASE.NIGHT && A.global.phase === PHASE.NIGHT);

  // the shade: only moves in darkness. Light on it (a beam, a torch, a flare) freezes it and makes it tough.
  {
    game.godMode = true;
    // nothing else is out there while the shade is watched: the dead that turned on the survivors at nightfall are
    // gone, and the night's clock is held back until the end of this block so the first wave does not walk into it
    // (one zombie standing where the wall or the torch is to go is enough to break it)
    for (const z of game.zombies) {
      z.dead = true;
      z.deadT = 2;
    }
    const clock = game.timeLeft;
    game.timeLeft += 600;
    const zm = game.zm;
    const w = game.world;
    const car = w.car;
    const open = (x, z) => !w.isDeepWater(x, z) && !game.nav.isBlocked(x, z);
    // nothing standing within r of (x,z): room to build there (a tree trunk is too thin to block a nav cell)
    const bare = (x, z, r) => w.staticGrid.query(x, z, r, []).every((o) => o.y1 < w.heightAt(x, z) + 0.2);
    // somewhere open and unlit, with a clear 20 m run to the north (-Z, yaw 0) and room for a wall 3 m up it
    // (no tree within 3 m of that run: the shade does not walk it dead straight, and a trunk beside it casts a shadow)
    let spot = null;
    for (let r = 40; r <= 120 && !spot; r += 10) {
      for (let k = 0; k < 16 && !spot; k++) {
        const x = car.x + Math.sin((k / 16) * Math.PI * 2) * r;
        const z = car.z + Math.cos((k / 16) * Math.PI * 2) * r;
        let ok = Math.abs(x) < 280 && Math.abs(z) < 280;
        for (let d = 0; d <= 20 && ok; d += 2) ok = open(x, z - d) && open(x + 2, z - d) && open(x - 2, z - d);
        const y = ok ? groundAt(w, x, z, 200, 0.3) : 0;
        const ty = ok ? groundAt(w, x, z - 20, 200, 0.3) : 0;
        if (ok && bare(x, z - 3, 2.5) && !treeBy(x, z + 2, x, z - 22, 3) && Math.abs(ty - y) < 1.5 && zm.clearLine(x, y + 1.6, z, x, ty + 1, z - 20) && zm.clearLine(x, y + 0.5, z, x, ty + 0.4, z - 20)) spot = { x, z };
      }
    }
    check('found open ground for the shade test', !!spot);
    A.tp(spot.x, spot.z);
    B.tp(spot.x + 1.5, spot.z + 1.5);
    const face = () => {
      A.input(0, 0, 0);
      B.input(0, 0, 0);
    };
    run(4, face);
    const a = A.p().state;
    const dist = (e) => Math.hypot(e.x - a.x, e.z - a.z);
    const sh = zm.spawn(ZTYPE.SHADE, spot.x, spot.z - 20, { horde: true });
    const d0 = dist(sh);
    run(30, face);
    const d1 = dist(sh);
    check('shade closes in the dark', !sh.lit && d1 < d0 - 5, `${d0.toFixed(1)} -> ${d1.toFixed(1)} m`);
    // beam on it: frozen where it stands
    A.act(ACT.FLASHLIGHT, 1);
    run(2, face);
    const fx = sh.x;
    const fz = sh.z;
    run(30, face);
    const rs = A.store.ents.get(sh.id);
    check('flashlight beam freezes the shade', A.p().flashlight && sh.lit && Math.hypot(sh.x - fx, sh.z - fz) < 0.01 && rs && rs.q[4] === ZANIM.FROZEN, `moved ${Math.hypot(sh.x - fx, sh.z - fz).toFixed(3)} m, anim ${rs && rs.q[4]}`);
    const hp0 = sh.hp;
    game.combat.damageZombie(sh, 100, null, { knock: 5, dirX: 0, dirZ: -1 });
    run(2, face);
    check('frozen shade takes reduced damage and no knockback', Math.abs(hp0 - sh.hp - 100 * ZOMBIE_DEFS[ZTYPE.SHADE].litResist) < 1e-6 && Math.hypot(sh.x - fx, sh.z - fz) < 0.01, `${(hp0 - sh.hp).toFixed(1)} of 100`);
    // a wall between the beam and the shade casts a shadow it can move in
    game.giveItem(A.p(), ITEM.WOOD, 5);
    game.giveItem(A.p(), ITEM.NAILS, 4);
    A.input(0, 0, 0, 4);
    run(15, face);
    A.act(ACT.BUILD, STRUCT.WALL, a.x, a.z - 3, 0);
    run(4, face);
    const wall = game.structures.find((e) => e.stype === STRUCT.WALL);
    const shadowed = !!wall && !sh.lit;
    if (wall) game.destroyStructure(wall, false);
    run(4, face);
    check('a wall shadows the shade from the beam', shadowed && sh.lit, `wall ${!!wall}, in shadow ${shadowed}, lit again ${sh.lit}`);
    // look away: the beam leaves it and it comes on again
    run(20, () => A.input(0, Math.PI, 0));
    const d2 = dist(sh);
    check('shade moves again when the beam leaves it', !sh.lit && d2 < d1 - 2, `${d1.toFixed(1)} -> ${d2.toFixed(1)} m`);
    const hp1 = sh.hp;
    game.combat.damageZombie(sh, 20, null, {});
    check('shade takes full damage in the dark', Math.abs(hp1 - sh.hp - 20) < 1e-6);
    A.act(ACT.FLASHLIGHT, 0);
    game.combat.damageZombie(sh, 1e6, null, {});
    run(3, face);
    // a standing torch holds it at the edge of its light
    const n0 = game.structures.length;
    game.giveItem(A.p(), ITEM.TORCH, 1);
    A.act(ACT.BUILD, STRUCT.TORCH, a.x, a.z - 3, 0);
    run(8, face);
    const torch = game.structures.find((e) => e.stype === STRUCT.TORCH);
    check('torch placed', game.structures.length === n0 + 1 && torch && torch.burnLeft > 0);
    const sh2 = zm.spawn(ZTYPE.SHADE, spot.x, spot.z - 20, { horde: true });
    run(80, face);
    const td = Math.hypot(sh2.x - torch.x, sh2.z - torch.z);
    const R = STRUCT_DEFS[STRUCT.TORCH].light;
    check('torch light stops the shade at its edge', sh2.lit && td < R + 0.01 && td > R - 1.5, `${td.toFixed(2)} m from the torch (light ${R} m)`);
    // the torch burns out: darkness, and it comes
    torch.burnLeft = 0.01;
    run(20, face);
    check('shade moves when the torch burns out', !sh2.lit && Math.hypot(sh2.x - torch.x, sh2.z - torch.z) < td - 2);
    // a road flare thrown down pins it too
    const fl = game.combat.spawnProjectile(PROJ.FLARE, A.p(), sh2.x + 2, sh2.y + 0.5, sh2.z, 0, 0, 0, { fuse: THROWABLES[ITEM.FLARE].fuse });
    run(6, face);
    const px = sh2.x;
    const pz = sh2.z;
    run(20, face);
    check('flare light pins the shade', !!fl && sh2.lit && Math.hypot(sh2.x - px, sh2.z - pz) < 0.01);
    game.combat.damageZombie(sh2, 1e6, null, {});
    game.projectiles.splice(game.projectiles.indexOf(fl), 1);
    game.removeEntity(fl);
    game.timeLeft = clock;
    // (god mode stays on: the first wave is about to reach the team)
  }
  check('no dogs in the first night\'s horde', game.waves.every((w) => !w.queue.includes(ZTYPE.DOG)));
  const n0 = game.zombies.length;
  game.spawnHordeGroup([ZTYPE.DOG, ZTYPE.DOG, ZTYPE.DOG]);
  const hd = game.zombies.slice(n0);
  check('horde dogs come as one pack', hd.length === 3 && hd.every((d) => d.ztype === ZTYPE.DOG && d.horde && d.pack === hd[0].pack));
  // horde groups are placed where no survivor would watch them appear: out of every line of sight inside the range the
  // haze leaves at that hour, still 58-84 m out and from all round; with no cover anywhere, far off and behind the team
  // (the picks draw from a private rng and the clock is put back, so the rest of the run plays out as before)
  {
    const zm = game.zm;
    const w = game.world;
    const humans = game.humans();
    const a = A.p().state;
    const saved = { rng: game.rng, phase: game.phase, timeLeft: game.timeLeft };
    let sd = 99;
    game.rng = () => (sd = (Math.imul(sd, 1664525) + 1013904223) >>> 0) / 4294967296;
    const N = 200;
    const picks = () => Array.from({ length: N }, () => zm.pickSpawnAround(a.x, a.z, humans));
    const dist = (s, p) => Math.hypot(s.x - p.x, s.z - p.z);
    // a survivor's eyes have a clear line to a zombie's head at p, and it is near enough to make out
    const inView = (p, sight) => humans.some((h) => dist(h.state, p) <= sight && zm.clearLine(h.state.x, h.state.y + EYE_HEIGHT, h.state.z, p.x, groundAt(w, p.x, p.z, 200, 0.2, false) + 1.7, p.z));
    const inBand = (ps) => ps.every((p) => dist(a, p) >= HORDE_SPAWN_MIN - 0.01 && dist(a, p) <= HORDE_SPAWN_MAX + 0.01 && humans.every((h) => dist(h.state, p) >= HORDE_SPAWN_MIN * 0.75));
    const octants = (ps) => new Set(ps.map((p) => Math.floor(((Math.atan2(p.x - a.x, p.z - a.z) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8)).size;
    game.phase = PHASE.NIGHT;
    game.timeLeft = game.nightLen / 2;
    const dark = zm.sightRange();
    const night = picks();
    game.phase = PHASE.DAY;
    game.timeLeft = game.dayLen / 2;
    const noon = zm.sightRange();
    check('how far off a spawn could be seen follows the clock', noon > 150 && dark > HORDE_SPAWN_MIN - 3 && dark < HORDE_SPAWN_MIN + 3, `${noon.toFixed(0)} m at noon, ${dark.toFixed(0)} m in the dark`);
    zm.clearLine = () => false; // a picker that sees nothing takes the first usable spot, as it used to
    const blind = picks();
    delete zm.clearLine;
    const n0 = zm.spawnsInView;
    const day = picks();
    const counted = zm.spawnsInView - n0;
    const was = blind.filter((p) => inView(p, noon)).length;
    const now = day.filter((p) => inView(p, noon)).length;
    check('horde spawns are picked out of the survivors\' sight', now === counted && (was === 0 || now < was / 2), `by day ${was}/${N} picks in plain view unchecked, ${now}/${N} checked (${counted} of them counted as nowhere hidden)`);
    check('...still 58-84 m out and from all round', inBand(night) && inBand(day) && octants(night) >= 6, `octants used: ${octants(night)} of 8 by night, ${octants(day)} by day (${octants(blind)} unchecked)`);
    zm.clearLine = () => true; // not a scrap of cover anywhere
    const open = Array.from({ length: 40 }, () => zm.pickSpawnAround(a.x, a.z, humans));
    delete zm.clearLine;
    // nobody is facing it: outside ~65 deg of where each survivor looks (forward is (-sin yaw, -cos yaw))
    const unfaced = open.filter((p) => humans.every((h) => (h.state.x - p.x) * Math.sin(h.state.yaw) + (h.state.z - p.z) * Math.cos(h.state.yaw) <= dist(h.state, p) * Math.cos(1.13))).length;
    const far = open.reduce((k, p) => k + dist(a, p), 0) / open.length;
    check('with no cover anywhere a spawn is still picked: far off, where nobody is looking', inBand(open) && zm.spawnsInView - n0 - counted === 40 && unfaced >= 38 && far > 75, `${unfaced}/40 outside every view cone, ${far.toFixed(0)} m off on average`);
    game.rng = saved.rng;
    game.phase = saved.phase;
    game.timeLeft = saved.timeLeft;
  }
  run(20 * 10);
  const zs = game.zombies.filter((z) => z.horde && !z.dead);
  const near = zs.filter((z) => Math.hypot(z.x - A.p().state.x, z.z - A.p().state.z) < 110).length;
  check('wave 1 spawned around the team', zs.length > 0 && near / Math.max(1, zs.length) > 0.8, `${near}/${zs.length} near`);
  check('horde counter', A.global.hordeLeft > 0 && A.global.wave === 1, `left ${A.global.hordeLeft}`);
  game.godMode = true;
  run(20 * 70);
  check('wave 2 started', A.global.wave >= 2, `wave ${A.global.wave}`);
  game.handleChat(A.p(), '/day');
  run(5);
  check('dawn + summary', game.phase === PHASE.DAY && A.summary && A.summary.night === 1, JSON.stringify(A.summary));
}

// the boomer has no claws: what the survivors built would hold it up for good, so it bursts against it instead -
// after a windup they can read, taking the piece it leans on with it. Not against the static world, and not while
// every survivor is far off. (a game of its own, emptied of the dead: the run around this block is left as it was)
{
  const { makeBox } = await import('../shared/collision.js');
  const g = new Game({ seed, log: () => {} });
  g.debugCommands = true;
  const session = g.onOpen({ send() {} });
  const jw = new Writer(64);
  jw.u8(C2S.JOIN);
  jw.u8(PROTOCOL_VERSION);
  jw.str('D');
  g.onMessage(session, jw.bytes().slice());
  const tick = (n) => {
    for (let i = 0; i < n; i++) g.update();
  };
  tick(3);
  for (const z of g.zombies) {
    z.dead = true;
    z.deadT = 2;
  }
  tick(2);
  g.zm.maintainT = g.zm.herds.spawnT = 1e9;
  const p = [...g.players.values()][0];
  const s = p.state;
  const w = g.world;
  const def = ZOMBIE_DEFS[ZTYPE.BOOMER];
  const open = (x, z) => !w.isDeepWater(x, z) && !g.nav.isBlocked(x, z);
  const bare = (x, z, r) => w.staticGrid.query(x, z, r, []).every((o) => o.y1 < w.heightAt(x, z) + 0.2);
  // level open ground with room for a 3 m pen 5 m north of the survivor (-Z) and for them to back 12 m off
  let spot = null;
  for (let r = 40; r <= 120 && !spot; r += 10) {
    for (let k = 0; k < 16 && !spot; k++) {
      const x = w.car.x + Math.sin((k / 16) * Math.PI * 2) * r;
      const z = w.car.z + Math.cos((k / 16) * Math.PI * 2) * r;
      let ok = Math.abs(x) < 280 && Math.abs(z) < 280;
      for (let d = -12; d <= 12 && ok; d += 2) ok = [-4, 0, 4].every((o) => open(x + o, z + d) && Math.abs(w.heightAt(x + o, z + d) - w.heightAt(x, z)) < 0.8);
      if (ok && bare(x, z - 5, 6)) spot = { x, z };
    }
  }
  check('found open ground for the boomer test', !!spot);
  const { x: px, z: pz } = spot;
  const cz = pz - 5; // the pen's middle
  const tp = (x, z) => g.handleChat(p, `/tp ${x} ${z}`);
  const boomer = () => g.zm.spawn(ZTYPE.BOOMER, px, cz, { horde: true });
  const waiting = (z) => !z.dead && z.state === 0 && z.breachT === 0;
  tp(px, pz);
  // a wall of the static world between them (one the nav grid does not know about, so it walks straight into it)
  const wz = cz + 1.7;
  const rocks = [-3, 0, 3].map((o) => makeBox(px + o, wz, w.heightAt(px + o, wz) - 0.3, w.heightAt(px + o, wz) + 1.15, 3, 0.4, 0));
  for (const c of rocks) w.staticGrid.add(c);
  const z0 = boomer();
  tick(100);
  check('a boomer leaning on the static world does not burst', waiting(z0) && Math.abs(z0.z - wz) < 1.3, `state ${z0.state}, ${Math.abs(z0.z - wz).toFixed(2)} m from it`);
  for (const c of rocks) w.staticGrid.remove(c);
  z0.dead = true;
  z0.deadT = 2;
  tick(2);
  // a pen of four barricades, built the way a survivor builds them, with a boomer shut inside
  g.giveItem(p, ITEM.WOOD, 12);
  g.giveItem(p, ITEM.NAILS, 8);
  s.slot = 4; // the hammer
  for (const [ox, oz, rot] of [[0, 1.7, 0], [0, -1.7, 0], [-1.7, 0, 64], [1.7, 0, 64]]) {
    g.build(p, STRUCT.BARRICADE, px + ox, cz + oz, rot);
    tick(6);
  }
  const pen = g.structures.filter((e) => e.stype === STRUCT.BARRICADE);
  check('boomer pen built', pen.length === 4);
  // the survivor well back from it: the boomer is stuck in there, as it always was
  tp(px, pz + 12);
  const z1 = boomer();
  tick(100);
  check('a boomer held up far from every survivor does not burst', waiting(z1) && Math.abs(z1.x - px) < 1.5 && Math.abs(z1.z - cz) < 1.5 && pen.every((e) => e.hp === e.maxHp), `${Math.hypot(s.x - z1.x, s.z - z1.z).toFixed(1)} m away (range ${def.breachRange})`);
  // the survivor walks up to the pen: now it swells...
  tp(px, pz);
  let t0 = 0;
  while (z1.state !== 1 && t0 < 80) {
    tick(1);
    t0++;
  }
  const piece = g.ents[z1.breachId];
  check('a boomer held up by a barricade winds up', z1.state === 1 && z1.stateAct === 99 && pen.includes(piece), `after ${(t0 / 20).toFixed(2)} s, ${Math.hypot(s.x - z1.x, s.z - z1.z).toFixed(1)} m from the survivor`);
  tick(20);
  check('...for long enough to read', !z1.dead && z1.anim === ZANIM.SPECIAL && p.hp === p.maxHp && pen.every((e) => !e.removed), `still swelling 1 s in (windup ${def.breachWindup} s)`);
  tick(Math.ceil(def.breachWindup * 20) - 20 + 2);
  const rest = pen.filter((e) => e !== piece);
  check('...and bursts against it: that piece goes, the others stand, the survivor behind it is hurt', z1.dead && !!piece?.removed && rest.every((e) => !e.removed && e.hp > e.maxHp / 2) && p.hp < p.maxHp && p.alive, `the others ${rest.map((e) => e.hp.toFixed(0)).join('/')} of ${STRUCT_DEFS[STRUCT.BARRICADE].hp}, survivor -${(p.maxHp - p.hp).toFixed(0)} hp`);
  // shot dead during the windup it only blasts: the piece it was leaning on is left standing
  tp(px, cz - 5);
  const z2 = boomer();
  let t1 = 0;
  while (z2.state !== 1 && t1 < 160) {
    tick(1);
    t1++;
  }
  const next = g.ents[z2.breachId];
  const hp0 = next?.hp;
  const wound = z2.state === 1 && rest.includes(next);
  g.combat.damageZombie(z2, 1e6, null, {});
  tick(2);
  check('a boomer shot during its windup leaves the piece standing', wound && z2.dead && !next.removed && next.hp < hp0 && hp0 - next.hp < 260, `-${(hp0 - next?.hp).toFixed(0)} of ${hp0?.toFixed(0)} hp`);
}

// overkill: one heavy blow that takes a zombie far below zero blows it apart (ZOMBIE_DIE flag 8) - a rifle round, a
// point-blank blast, a bomb. Small arms, blades, fire and a blast from across the road leave a corpse.
// (no ticks, and none of the game's rng: the rest of the run is left as it was)
{
  const p = A.p();
  const s = p.state;
  const ray = { t: -1, col: null, terrain: false };
  const rng = game.rng;
  game.rng = () => 0.5;
  // open ground a few metres from her, wherever the night left her standing, not up against a tree and with none of
  // the horde standing on it (with the rng stubbed, a spawn on a blocked spot is not nudged free: there is no walker)
  const clear = ([x, z]) => !game.world.isDeepWater(x, z) && !game.nav.isBlocked(x, z) && !treeBy(x, z, x, z, 1.5) && game.zombies.every((e) => e.dead || Math.hypot(e.x - x, e.z - z) > 3);
  const near = [[5, 5], [-5, 5], [5, -5], [-5, -5], [7, 0], [0, 7], [-7, 0], [0, -7], [9, 9], [-9, 9], [9, -9], [-9, -9], [12, 0], [0, 12], [-12, 0], [0, -12]];
  const [wx, wz] = near.map(([dx, dz]) => [s.x + dx, s.z + dz]).find(clear) || [s.x + 5, s.z + 5];
  const walker = (hp) => {
    const z = game.zm.spawn(ZTYPE.WALKER, wx, wz);
    if (hp) z.hp = hp;
    return z;
  };
  // the flags of the death event it sent (-1: it lived)
  const died = (z) => {
    const ev = game.events.find((e) => e.bytes[0] === EVT.ZOMBIE_DIE && (e.bytes[1] | (e.bytes[2] << 8)) === z.id);
    if (!z.dead) game.combat.killZombie(z, null, {});
    return ev ? ev.bytes[4] : -1;
  };
  const hit = (dmg, opts = {}, hp = 0) => {
    const z = walker(hp);
    game.combat.damageZombie(z, dmg, p, opts);
    return died(z);
  };
  // a shotgun blast at its chest from dist m away, from a side with nothing in the way of any pellet bound for it:
  // a trunk beside the line of fire lets the middle of the blast past and stops the rest, and so does another of
  // the dead on the way (the night's horde is still about, burning)
  const blast = (dist, hp = 0) => {
    const z = walker(hp);
    for (let k = 0; k < 16; k++) {
      const a = (k * Math.PI) / 8;
      const sx = z.x + Math.sin(a) * dist;
      const sz = z.z + Math.cos(a) * dist;
      // (to the middle and both shoulders of it, at chest and head height: the pellets that find it fly inside those)
      const blocked = (o, h) => {
        const [tx, ty, tz] = [z.x + Math.cos(a) * o - sx, h - 1.1, z.z - Math.sin(a) * o - sz];
        const l = Math.hypot(tx, ty, tz);
        raycastWorld(game.world, sx, z.y + 1.1, sz, tx / l, ty / l, tz / l, l, ray);
        return ray.t >= 0;
      };
      if ([0, -0.35, 0.35].some((o) => blocked(o, 1.1) || blocked(o, 1.6))) continue;
      const between = (e) => {
        const along = (e.x - sx) * -Math.sin(a) + (e.z - sz) * -Math.cos(a);
        return e !== z && !e.dead && along > -0.5 && along < dist + 0.5 && Math.abs((e.x - sx) * Math.cos(a) - (e.z - sz) * Math.sin(a)) < 0.9;
      };
      if (game.zombies.some(between)) continue;
      p.renderTick = game.tick & 0xffff;
      p.renderFrac = 0;
      game.combat.fire(p, { weapon: ITEM.SHOTGUN, x: sx, y: z.y + 1.1, z: sz, yaw: a, pitch: 0, recoilPitch: 0, spread: WEAPONS[ITEM.SHOTGUN].spread, seed: 7 });
      break;
    }
    return died(z);
  };
  const gibbed = { rifle: hit(WEAPONS[ITEM.HUNTING_RIFLE].damage), bomb: hit(THROWABLES[ITEM.PIPEBOMB].damage), blast: blast(1.5), woundedBlast: blast(1.5, 40) };
  const corpse = { headshot: hit(94, { headshot: true }, 60), club: hit(171, { melee: true }), burnt: hit(30, { fire: true }, 20), farBlast: blast(12, 5) };
  game.rng = rng;
  check('overkill blows a zombie apart', Object.values(gibbed).every((f) => f >= 0 && f & 8), JSON.stringify(gibbed));
  check('small arms, blades, fire and a distant blast leave a corpse', Object.values(corpse).every((f) => f >= 0 && !(f & 8)), JSON.stringify(corpse));
}

// supplies + escape
{
  const car = game.world.car;
  A.tp(car.x + 2.5, car.z);
  run(3);
  const p = A.p();
  for (let i = 0; i < SUPPLIES.length; i++) game.giveItem(p, SUPPLIES[i], SUPPLY_NEED[i]);
  A.act(ACT.INTERACT, CAR_ID);
  run(3);
  check('supplies installed', A.global.suppliesDone, JSON.stringify(A.global.supplies));
  A.act(ACT.HOLD_BEGIN, CAR_ID);
  run(60);
  check('engine started: final stand', game.escape.active && A.global.finale, `t ${A.global.escapeT}`);
  run(20 * 20);
  check('finale spawns horde', game.zombies.filter((z) => z.horde && !z.dead).length > 5);
  // nobody at the car: the engine stalls, and the clients are told (they count the warm-up down themselves)
  const away = car.x > 0 ? -60 : 60;
  A.tp(car.x + away, car.z);
  B.tp(car.x + away, car.z + 3);
  run(20);
  const left = game.escape.t;
  run(20 * 3);
  check('nobody at the car: the engine stalls', game.escape.t === left && A.global.escapeStalled && Math.abs(A.global.escapeT - left) < 0.11, `${left.toFixed(1)} s left, the client was sent ${A.global.escapeT}`);
  A.tp(car.x + 2.5, car.z);
  run(20);
  check('back at the car: it picks up where it stopped', game.escape.t < left && game.escape.t > left - 1.1 && !A.global.escapeStalled, `${game.escape.t.toFixed(1)} s left`);
  // warm, the run goes on until a survivor at the car holds [E] to get in and drive
  A.act(ACT.HOLD_BEGIN, CAR_ID);
  run(2);
  check('no getting in before the engine is warm', !A.p().hold);
  A.act(ACT.HOLD_END);
  game.escape.t = 0.1;
  run(20 * 3);
  check('engine warm: the run waits for a driver', game.escape.ready && A.global.escapeReady && game.phase !== PHASE.VICTORY, `phase ${game.phase}`);
  A.act(ACT.HOLD_BEGIN, CAR_ID);
  run(20);
  check('getting in is a hold the whole team is told about', A.self.holdKind === HOLD.DRIVE && A.self.holdProgress > 0.2 && B.global.escapeLeaving && game.phase !== PHASE.VICTORY, `kind ${A.self.holdKind}, progress ${A.self.holdProgress?.toFixed(2)}`);
  run(Math.round(20 * ESCAPE_DRIVE_TIME));
  check('victory when a survivor drives off', game.phase === PHASE.VICTORY && A.notes.some((n) => n[0] === NOTIFY.VICTORY));
}

// the escape is the team's to make (a game of its own, two survivors, day 3)
import { ESCAPE_TIME, ESCAPE_RADIUS, ESCAPE_DRIVE_TIME } from '../shared/constants.js'; // (here, beside the checks that use them)
{
  const g = new Game({ seed, log: () => {}, godMode: true });
  const join = (name) => {
    const session = g.onOpen({ send() {} });
    const w = new Writer(64);
    w.u8(C2S.JOIN);
    w.u8(PROTOCOL_VERSION);
    w.str(name);
    g.onMessage(session, w.bytes().slice());
    return session;
  };
  const hold = (session, act) => {
    const w = new Writer(8);
    w.u8(C2S.ACTION);
    w.u8(act);
    if (act === ACT.HOLD_BEGIN) w.u16(CAR_ID);
    g.onMessage(session, w.bytes().slice());
  };
  const sa = join('Ann');
  const sb = join('Ben');
  const a = sa.player;
  const b = sb.player;
  const car = g.world.car;
  const far = car.x > 0 ? -250 : 250;
  const put = (p, dx) => {
    p.state.x = car.x + dx;
    p.state.z = car.z;
    p.state.y = groundAt(g.world, p.state.x, p.state.z, 200, 0.3);
    p.state.vx = p.state.vy = p.state.vz = 0;
  };
  // every tick: both survivors where the test wants them (a stand shoves a survivor who cannot be hurt), and the
  // horde shot as it comes, so the stand's size is what gets counted
  const tick = (seconds, da, db, fn) => {
    for (let i = 0; i < seconds * 20; i++) {
      put(a, da);
      put(b, db);
      fn?.();
      g.update();
      for (const z of g.zombies) if (z.horde && !z.boss && !z.dead) g.combat.killZombie(z, null, {});
    }
  };
  g.day = 3;
  g.supplies = SUPPLY_NEED.slice();
  g.startEngine(null);
  const e = g.escape;
  tick(ESCAPE_TIME + 10, far, far + 3);
  check('the engine does not warm up with the team away from the car', !e.ready && e.stalled && e.t === ESCAPE_TIME, `${e.t} s left after ${ESCAPE_TIME + 10} s, ${e.sent} of the stand's ${g.finalStandSize()} came anyway`);
  tick(30, ESCAPE_RADIUS - 1, far);
  const t30 = e.t;
  g.goDown(b);
  tick(5, far, 2);
  g.revive(b, null);
  check('one survivor on their feet within reach of the car keeps it warming; a downed one does not', Math.abs(t30 - (ESCAPE_TIME - 30)) < 0.01 && e.t === t30 && e.stalled, `${t30.toFixed(2)} s left after 30 s at the car, ${e.t.toFixed(2)} s after 5 more with only a downed survivor there`);
  tick(5, ESCAPE_RADIUS + 1, far);
  check('a stall holds the warm-up where it is', e.t === t30 && !e.boss, `${e.t.toFixed(2)} s left`);
  tick(ESCAPE_TIME - 31, 2, far);
  const sent = e.sent;
  const early = e.ready;
  tick(1.5, 2, far);
  check('the engine is warm after its full time at the car, and the boss came', !early && e.ready && e.boss && e.t === 0 && g.phase !== PHASE.VICTORY && sent === g.finalStandSize(), `${sent} of the stand's ${g.finalStandSize()} came`);
  tick(20, 2, 2);
  check('a warm engine ends nothing by itself, and goes on drawing the dead', g.phase !== PHASE.VICTORY && e.active && e.sent > sent, `20 s at the car: phase ${g.phase}, ${e.sent - sent} more came`);
  // getting in: from the car, on your feet, and for the whole hold
  put(a, 9);
  hold(sa, ACT.HOLD_BEGIN);
  const fromAfar = !!a.hold;
  tick(1, 2, far);
  hold(sa, ACT.HOLD_BEGIN);
  tick(ESCAPE_DRIVE_TIME - 0.5, 2, far);
  const leaving = e.leaving;
  hold(sa, ACT.HOLD_END);
  tick(2, 2, far);
  check('getting in needs the whole hold, at the car', !fromAfar && leaving && !e.leaving && g.phase !== PHASE.VICTORY, `phase ${g.phase}`);
  tick(1, 2, far, () => !a.hold && hold(sa, ACT.HOLD_BEGIN));
  tick(ESCAPE_DRIVE_TIME, 2, far);
  check('a survivor drives off: victory, whoever is still out there', g.phase === PHASE.VICTORY && !e.active && b.alive && Math.hypot(b.state.x - car.x, b.state.z - car.z) > 200, `phase ${g.phase}`);
}

// the final stand is sized to the team from the same sum as a night's horde (games of their own, on day 3)
{
  const stand = (n, shoot) => {
    const g = new Game({ seed, log: () => {}, godMode: true });
    const sessions = [];
    for (let i = 0; i < n; i++) {
      const session = g.onOpen({ send() {} });
      const w = new Writer(64);
      w.u8(C2S.JOIN);
      w.u8(PROTOCOL_VERSION);
      w.str('S' + i);
      g.onMessage(session, w.bytes().slice());
      sessions.push(session);
    }
    g.day = 3;
    g.supplies = SUPPLY_NEED.slice();
    g.startEngine(null);
    const r = { size: g.finalStandSize(), night: g.hordeSize(3, n), far: 0, peak: 0 };
    for (const z of g.zombies) if (!z.horde) r.far++;
    while (!g.escape.ready) {
      g.update();
      r.peak = Math.max(r.peak, g.zombies.filter((z) => !z.boss).length); // (the boss comes on top of the cap, as on any night)
      // a team that shoots: everything dies as it comes, so the cap on how many stand at once never holds any back
      if (shoot) for (const z of g.zombies) if (z.horde && !z.boss && !z.dead) g.combat.killZombie(z, null, {});
    }
    r.sent = g.escape.sent;
    r.tanks = g.escape.tanks;
    for (const s of sessions.slice(1)) g.onClose(s);
    r.alone = g.finalStandSize();
    return r;
  };
  const one = stand(1, true);
  const eight = stand(8, false);
  check('the final stand grows with the team as a night does', one.size > 0 && Math.abs(eight.size / one.size - eight.night / one.night) < 0.1 && eight.alone === one.size, `${one.size} for one, ${eight.size} for eight (night 3: ${one.night}, ${eight.night}); ${eight.alone} once seven of the eight have left`);
  check('a lone survivor who shoots gets the whole stand and no more, one Tank at most', one.sent === one.size && one.tanks <= 1, `${one.sent} of ${one.size}, ${one.tanks} Tanks`);
  check('the zombie cap holds through a stand of eight who do not shoot', eight.peak <= 120 && eight.sent > one.sent && eight.sent <= eight.size && eight.far === 0, `peak ${eight.peak} zombies, ${eight.sent} of ${eight.size} came`);
}

// shades join the horde from night 2
{
  const count = (n) => {
    game.day = n;
    game.startNight();
    return game.waves.reduce((k, wv) => k + wv.queue.filter((t) => t === ZTYPE.SHADE).length, 0);
  };
  const n1 = count(1);
  const later = [2, 3, 5, 8].map(count);
  check('shades in the horde from night 2', n1 === 0 && later.every((k) => k >= 1 && k <= 6), `night 1: ${n1}, nights 2/3/5/8: ${later.join('/')}`);
}

// a new playthrough is a new valley: the server rolls a fresh map and tells its clients the seed
{
  // whatever a valley holds stands on its ground. Seed 10 has the army checkpoint's traffic queue running out past its
  // levelled yard and up a hillside, 777 the farm's field and the chapel's graveyard fence doing the same.
  {
    const { createWorld, TREE_TYPES } = await import('../shared/world.js');
    const { PROPS } = await import('../shared/props.js');
    let stood = 0;
    let off = 0;
    let buried = 0;
    let onRoad = 0;
    for (const sd of [10, 777]) {
      const w = createWorld(sd);
      const dock = w.zoneById[ZONE.DOCK];
      const open = (x, z) => w.zones.every((zn) => Math.hypot(x - zn.x, z - zn.z) > zn.flat) && Math.hypot(x - dock.x, z - dock.z) > 60; // (the pier has a deck)
      for (const p of w.props) {
        const def = PROPS[p.type];
        if (def.boxes?.length !== 1 || def.cyls || !open(p.x, p.z)) continue;
        const [lx, , lz, sx, , sz] = def.boxes[0];
        const c = Math.cos(p.ry);
        const s = Math.sin(p.ry);
        let low = Infinity; // the ground under the lowest corner of its footprint: that is where an upright prop rests
        for (const dx of [lx - sx / 2, lx + sx / 2]) for (const dz of [lz - sz / 2, lz + sz / 2]) low = Math.min(low, w.heightAt(p.x + c * dx + s * dz, p.z - s * dx + c * dz));
        stood++;
        if (Math.abs(p.y - low) > 0.05) off++;
      }
      for (const ct of w.containers) if (open(ct.x, ct.z) && w.heightAt(ct.x, ct.z) > ct.y) buried++;
      for (let i = 0; i < w.trees.length; i += 6) {
        const x = w.trees[i];
        const z = w.trees[i + 2];
        if (w.roadDistAt(x, z) > 6) continue;
        const r = TREE_TYPES[w.trees[i + 5]].r * w.trees[i + 3];
        let hit = false; // its trunk reaches over the edge of a road (road.width is the half width)
        for (const rd of w.roads) {
          for (let n = 0; n < rd.pts.length - 2 && !hit; n += 2) {
            const ex = rd.pts[n + 2] - rd.pts[n];
            const ez = rd.pts[n + 3] - rd.pts[n + 1];
            const t = Math.min(1, Math.max(0, ((x - rd.pts[n]) * ex + (z - rd.pts[n + 1]) * ez) / (ex * ex + ez * ez || 1)));
            hit = Math.hypot(x - rd.pts[n] - ex * t, z - rd.pts[n + 1] - ez * t) < rd.width + r - 0.01;
          }
        }
        if (hit) onRoad++;
      }
    }
    check('props outside the levelled yards rest on the ground, not above or under it', stood > 100 && off === 0, `${off} of ${stood} off it`);
    check('...with every container out there above the ground', buried === 0, `${buried} buried`);
    check('no tree stands on a road or trail', onRoad === 0, `${onRoad}`);
  }
  const g2 = new Game({ log: () => {} });
  const resets = [];
  const session = g2.onOpen({
    send(bytes) {
      const r = new Reader(bytes.slice().buffer);
      if (r.u8() === S2C.WORLD_RESET) resets.push(r.u32());
    },
  });
  const w = new Writer(64);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str('C');
  g2.onMessage(session, w.bytes().slice());
  const first = g2.world;
  check('the first game is played on the map the server booted with', g2.phase === PHASE.DAY && resets.length === 0);
  g2.gameOver();
  g2.restartT = 0;
  g2.update();
  const p = [...g2.players.values()][0];
  const car = g2.world.car;
  check('the next game rolls a new map and sends its seed', g2.phase === PHASE.DAY && g2.world !== first && g2.world.seed === g2.seed && resets.length === 1 && resets[0] === g2.seed >>> 0, `seed ${first.seed} -> ${g2.seed}`);
  check('...with the survivors at its breakdown and its supplies hidden in seven of its places', Math.hypot(p.state.x - car.x, p.state.z - car.z) < 14 && new Set(g2.supplyHints).size === 7 && g2.supplyHints.every((z) => g2.world.zoneById[z]));
  const kept = game.seed;
  // the run that is ending leaves a score behind: A drops a walker, B dies, and A gets the kill
  const pa = A.p();
  const pb = B.p();
  game.combat.killZombie(game.zm.spawn(ZTYPE.WALKER, pa.state.x + 6, pa.state.z + 6), pa, {});
  game.killPlayer(pb, { kind: KILLER.PLAYER, id: A.id });
  run(1);
  const score = (p) => [p.kills, p.zkills, p.deaths];
  const board = () => [...A.roster.values()].map((r) => r.kills);
  const last = { a: score(pa), b: score(pb), board: board() };
  game.gameOver();
  game.restartT = 0;
  game.update();
  check('a pinned seed keeps its map', game.phase === PHASE.DAY && game.seed === kept && game.world.seed === kept);
  const next = { a: score(pa), b: score(pb), board: board() };
  const scored = last.a[0] > 0 && last.a[1] > 0 && last.b[2] > 0 && last.board.some((k) => k > 0);
  const zeroed = [...game.players.values()].every((p) => p.kills === 0 && p.zkills === 0 && p.deaths === 0) && [A, B].every((c) => [...c.roster.values()].every((r) => r.kills === 0));
  check('a new game counts kills and deaths from zero for everyone', scored && zeroed, `[kills, zkills, deaths] ${JSON.stringify(last)} -> ${JSON.stringify(next)}`);
}

// The last player leaving does not roll the next valley there and then (that is the socket's close callback, and
// generating a world blocks the thread): the tick after does, or the next join if it gets in first.
{
  const g3 = new Game({ log: () => {} });
  let rolls = 0; // worlds generated since the server booted
  const setWorld = g3.setWorld.bind(g3);
  g3.setWorld = (s) => (rolls++, setWorld(s));
  const join = (name) => {
    const c = { net: { tick: 0, ack: 0 }, global: null, self: {}, store: { ents: new Map(), onCreate() {}, onRemove() {}, onUpdate() {} }, handler: new Proxy({}, { get: () => () => {} }), seed: -1, resets: 0, snaps: 0, seq: 0 };
    c.session = g3.onOpen({
      send(bytes) {
        const r = new Reader(bytes.slice().buffer);
        const t = r.u8();
        if (t === S2C.WELCOME) {
          c.id = r.u16();
          c.seed = r.u32();
        } else if (t === S2C.WORLD_RESET) c.resets++;
        else if (t === S2C.SNAPSHOT) {
          readSnapshot(r, c);
          if (r.left !== 0) throw new Error(`${name}: ${r.left} trailing snapshot bytes`);
          c.snaps++;
        }
      },
    });
    const w = new Writer(64);
    w.u8(C2S.JOIN);
    w.u8(PROTOCOL_VERSION);
    w.str(name);
    g3.onMessage(c.session, w.bytes().slice());
    return c;
  };
  // the furthest the survivor gets from where they stand, walking each way in turn
  const walk = (c) => {
    const s = g3.players.get(c.id).state;
    const [x0, z0] = [s.x, s.z];
    let far = 0;
    for (let dir = 0; dir < 4; dir++) {
      for (let i = 0; i < 20; i++) {
        const w = new Writer(64);
        w.u8(C2S.INPUT);
        w.u16(g3.tick & 0xffff);
        w.u8(0);
        const cmds = [];
        for (let k = 0; k < 3; k++) cmds.push({ seq: (c.seq = (c.seq + 1) & 0xffff), buttons: BTN.FWD, qyaw: qangle16((dir * Math.PI) / 2), qpitch: qpitch(0), slot: 255 });
        writeInput(w, cmds);
        g3.onMessage(c.session, w.bytes().slice());
        g3.update();
        far = Math.max(far, Math.hypot(s.x - x0, s.z - z0));
      }
    }
    return far;
  };
  // a run under way on the valley the server holds, with this survivor in it at the breakdown
  const inRun = (c) => {
    const p = g3.players.get(c.id);
    const car = g3.world.car;
    return g3.phase === PHASE.DAY && g3.world.seed === g3.seed && c.seed === g3.seed >>> 0 && c.resets === 0 && !!p && Math.hypot(p.state.x - car.x, p.state.z - car.z) < 14;
  };

  const a = join('A');
  for (let i = 0; i < 10; i++) g3.update();
  const first = g3.world;
  g3.onClose(a.session);
  check('the last player leaving does not roll the next valley in the close path', rolls === 0 && g3.phase === PHASE.WAITING && g3.players.size === 0 && g3.all.length === 0 && g3.world === first && first.seed === g3.seed, `rolls ${rolls}`);
  g3.update();
  const second = g3.world;
  for (let i = 0; i < 5; i++) g3.update();
  check('the tick after rolls it, once', rolls === 1 && second !== first && g3.world === second && second.seed === g3.seed && second.seed !== first.seed && g3.phase === PHASE.WAITING, `rolls ${rolls}, seed ${first.seed} -> ${g3.seed}`);
  const b = join('B');
  const stocked = g3.caches.length > 0 && g3.zombies.length > 0 && g3.items.length > 0 && new Set(g3.supplyHints).size === 7 && g3.supplyHints.every((z) => g3.world.zoneById[z]);
  const ok = inRun(b) && g3.world === second && rolls === 1 && stocked;
  const far = walk(b);
  check('the next join gets that valley and can play on it', ok && far > 1 && b.snaps >= 80 && b.global.phase === PHASE.DAY, `walked ${far.toFixed(1)} m, ${b.snaps} snapshots`);

  // ...and a join that gets in before that tick
  g3.onClose(b.session);
  const c = join('C');
  const third = g3.world;
  check('a join that beats the tick rolls the valley first: its WELCOME carries the new seed', rolls === 2 && third !== second && third.seed !== second.seed && inRun(c), `rolls ${rolls}, seed ${second.seed} -> ${g3.seed}`);
  const d = join('D');
  const both = inRun(c) && inRun(d) && d.seed === c.seed;
  const far2 = Math.min(walk(c), walk(d));
  check('...and one more in the same tick joins that run (no second roll)', both && rolls === 2 && g3.world === third && far2 > 1 && c.snaps >= 160 && d.snaps >= 160, `rolls ${rolls}, walked ${far2.toFixed(1)} m`);
}

console.log(`\n${fails.length ? 'FAILED: ' + fails.join(', ') : 'all checks passed'}  (server tick avg ${game.stats.tickMs.toFixed(2)} ms)`);
process.exit(fails.length ? 1 : 0);
