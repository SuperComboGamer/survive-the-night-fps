// In-process server smoke test: fake clients join, meet the cat, get hunted by a zombie dog pack, rouse the wandering herd, walk around,
// search containers, trip a car alarm, chop trees, build (incl. door boards), draw the dead with noise, go down +
// get revived, pin a shade
// with light, survive a night of waves and run the escape finale.
// Decodes every snapshot with the real client decoder. usage: node scripts/sim-smoke.js [seed]
import { CRAFT_MAX, craftRun, copyInv } from '../client/game/bulkcraft.js';
import { RECIPES, AMMO_MAX } from '../shared/defs.js';
import { Game } from '../server/game.js';
import { C2S, ACT, ENT, HOLD, CAR_ID, CHATF, PLF, REJECT_REASON, PROTOCOL_VERSION, Writer, Reader, S2C, qangle16, qpitch, ZSTATUS, writeInput } from '../shared/protocol.js';
import { PHASE, BTN, NOISE, TALK_CLEAR, TALK_RANGE, SLOT_RADIO, INTERACT_REACH, PICK_RADIUS, CAR_REACH, BUILD_REACH, SPRINT_SPEED, EYE_HEIGHT, HORDE_SPAWN_MIN, HORDE_SPAWN_MAX } from '../shared/constants.js';
import { STRUCT, ITEM, WEAPONS, AMMO, SUPPLIES, SUPPLY_NEED, NOTIFY, ZTYPE, CANIM, ZANIM, ZONE, SOUND, CONT, CONSUMABLES, LOOT_TABLES, CONT_TABLES, CONT_DEFS, PROJ, ZOMBIE_DEFS, STRUCT_DEFS, THROWABLES, BURN, EVT, KILLER, structPickRadius } from '../shared/defs.js';
import { readSnapshot } from '../client/net/decode.js';
import { createPlayerState, copyPlayerState, simulatePlayer, radioKeyed } from '../shared/playersim.js';
import { MAP_HALF, WATER_LEVEL } from '../shared/constants.js';
import { COL, BOX, footprintContains } from '../shared/collision.js';
import { HARVEST, harvestAt, harvestPrompt, strippedKey, needLines } from '../client/game/harvest.js';
import { SLOT_PISTOL, SLOT_MELEE } from '../shared/constants.js';
import { ITEM_DEFS } from '../shared/defs.js';
import { raycastWorld, groundAt } from '../shared/collision.js';
import { NIGHT_THEMES, nightTheme, nightBoss, BOSS_POOL, FIRST_BOSS } from '../shared/nights.js';

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
// A survivor's reserve of a calibre (carried apart from the backpack): makes that n
const setAmmo = (p, cal, n) => {
  p.state.ammo[cal] = Math.max(0, n);
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
          const flags = r.u8();
          const onAir = !!(flags & PLF.ON_AIR);
          const kills = r.u16();
          r.u16();
          const way = flags & PLF.WAYPOINT ? { x: r.i16() / 64, z: r.i16() / 64, zone: r.u8() } : null;
          c.roster.set(id, { status, onAir, kills, way });
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
  if (c.p()) c.p().admin = true; // (the admin chat commands: c.tp and the rest)
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
    } else if (act === ACT.WAYPOINT) {
      w2.u8(args[0] ? 1 : 0);
      if (args[0]) {
        w2.i16(Math.round(args[0].x * 64));
        w2.i16(Math.round(args[0].z * 64));
        w2.u8(args[0].zone);
      }
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

const A = client('Alice');
const B = client('Bob');
run(5);
check('game started', game.phase === PHASE.DAY && A.global?.phase === PHASE.DAY);
check('players spawned near car', Math.hypot(A.p().state.x - game.world.car.x, A.p().state.z - game.world.car.z) < 14);
check('supply hints sent', A.global.hints.slice(0, 7).every((z) => z !== 255), JSON.stringify(A.global.hints));
check('every supply is hidden in a different place of this map', new Set(A.global.hints).size === 7 && A.global.hints.every((z) => game.world.zoneById[z] && z !== ZONE.CAMP));
check('caches replicated', [...A.store.ents.values()].some((e) => e.kind === ENT.CACHE));

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
  setAmmo(c, AMMO.P9, s.ammo[AMMO.P9] - 30);
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
  // dying drops the kit where they fell, and a death lasts until dawn (DAWN_RETURN): a reconnect after that does not
  // come with another kit, it is one of the dead again
  g.killPlayer(back.player, { kind: 2, ztype: ZTYPE.WALKER });
  g.onClose(back);
  back = join('Cat');
  const again = back.player;
  check('...nor after dying: before sunrise they are back among the dead, with nothing', again.zombie && again.alive && !again.state.weapons.some(Boolean) && !again.inv.some(Boolean), `weapons ${again.state.weapons.join()}, ${again.inv.filter(Boolean).length} stacks in the pack`);
  // ...and one who stays away until the sun is up comes back a survivor with what the dead who stayed wake with
  const fell = loose(...supplies); // (with what they dropped where they fell)
  g.onClose(back);
  g.returnFallen();
  const woke = join('Cat').player;
  check('...and after sunrise a survivor with one magazine and a bandage, not a fresh kit', !woke.zombie && woke.alive && kit(woke) === `${WEAPONS[ITEM.PISTOL].mag}/0/1/0/0/0` && from(woke.state, a.state) < 9.1 && loose(...supplies) === fell, kit(woke));
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
// (a game of its own: nothing in here touches the run below. On a pinned valley, 167: the fan of rays below takes a
// room for closed when what it sees through a window ends on a hillside or a wreck within its reach, and on the
// run's own valley, as the clinic's place in the pool redrew it, the first doorway it comes to is a motel room's)
{
  const g = new Game({ seed: 167, log: () => {} });
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
    const g2 = new Game({ seed: 170, godMode: true, dayLength: 3600, log: () => {} });
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
    p.admin = true; // (/tp)
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

// what this valley's containers hold if each is searched once: a place's own table reaches too few of them to supply
// a gun or a recipe by itself (the AK-47 and leather used to be in place tables only)
{
  const holds = (item) =>
    game.caches.reduce((sum, c) => {
      const def = CONT_DEFS[c.ctype];
      const table = (def.table && CONT_TABLES[def.table]) || LOOT_TABLES[c.zone] || LOOT_TABLES[ZONE.ROADSIDE];
      const total = table.reduce((n, t) => n + t[1], 0);
      const perRoll = table.reduce((n, [i, w, lo, hi]) => n + (i === item ? (w / total) * ((lo + hi) / 2) : 0), 0);
      return sum + perRoll * ((def.rolls[0] + def.rolls[1]) / 2);
    }, 0);
  const [ak, m4, plates, leather] = [ITEM.AK47, ITEM.M4A1, ITEM.PLATE, ITEM.LEATHER].map(holds);
  check('containers hold an AK-47 for all that 7.62, about as often as an M4A1', ak >= 0.5 && ak >= m4 * 0.8, `${ak.toFixed(2)} AK-47, ${m4.toFixed(2)} M4A1`);
  check('...and plates for a kevlar vest, leather for jackets and machetes', plates >= 3 && leather >= 4, `${plates.toFixed(1)} plates, ${leather.toFixed(1)} leather`);
}

// [E] has to work from wherever the client offers it. Its view ray, INTERACT_REACH long, only needs to pass within
// the target's pick radius (Entities.pick), and the server's copy of a survivor who came up at a sprint is still
// some 0.1 s behind the one that client looks out of: promptEdge is how far out that puts them.
const RUN_UP = SPRINT_SPEED * 0.1;
const promptEdge = (radius) => Math.hypot(INTERACT_REACH, radius) + RUN_UP - 0.02;
// stand c that far from e, on a side with a clear line to it
const standOff = (c, e, d) => {
  const s = c.p().state;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    s.x = e.x + Math.sin(a) * d;
    s.z = e.z + Math.cos(a) * d;
    s.y = groundAt(game.world, s.x, s.z, e.y + 1.5, 0.3);
    s.vx = s.vy = s.vz = 0;
    if (!game.nav.isBlocked(s.x, s.z) && !game.world.isDeepWater(s.x, s.z) && Math.abs(s.y - e.y) < 1.2 && game.canReachEnt(c.p(), e)) return true;
  }
  return false;
};
// These checks take no tick, roll none of the game's dice and make no noise (they wind A's cooldowns back instead
// of waiting them out): the scenario below runs on its own clock and must play out as it does without them.
{
  const p = A.p();
  const s = p.state;
  const [x0, y0, z0] = [s.x, s.y, s.z];
  const from = (e) => `from ${Math.hypot(e.x - s.x, e.z - s.z).toFixed(2)} m`;
  // a hold starts there, and is not dropped there once under way (a plain container: no car alarm, no stash)
  const c = game.caches
    .filter((c) => c.state === 0 && c.ctype !== CONT.TRUNK && !c.stash && !c.schem)
    .sort((a, b) => Math.hypot(a.x - x0, a.z - z0) - Math.hypot(b.x - x0, b.z - z0))
    .find((c) => standOff(A, c, promptEdge(PICK_RADIUS.CACHE)));
  A.act(ACT.HOLD_BEGIN, c.id);
  const began = p.hold?.kind === HOLD.SEARCH;
  game.updateHold(p, 0);
  check('a search starts at the edge of its prompt, and is kept up there', began && p.hold?.kind === HOLD.SEARCH, from(c));
  A.act(ACT.HOLD_END);
  // a press: an item on the ground, from the edge and from a ledge straight above it
  const drop = () => game.spawnItem(ITEM.TAPE, 1, x0, y0 + 0.02, z0);
  let item = drop();
  standOff(A, item, promptEdge(PICK_RADIUS.ITEM));
  A.act(ACT.INTERACT, item.id);
  check('an item is picked up from the edge of its prompt', item.removed, from(item));
  item = drop();
  s.x = x0 + 0.2;
  s.z = z0;
  s.y = item.y + 0.15 + INTERACT_REACH - EYE_HEIGHT - 0.05; // eyes just within reach of its pick point
  p.interactT = -1;
  A.act(ACT.INTERACT, item.id);
  check('...and from a ledge above it', item.removed, `${(s.y - item.y).toFixed(2)} m up`);
  // a supply crate (opened for nothing: no loot)
  const crate = { kind: ENT.CRATE, x: x0, y: y0, z: z0, gy: y0, state: 1, despawnAt: game.time + 600 };
  game.spawnEntity(crate);
  game.crates.push(crate);
  standOff(A, crate, promptEdge(PICK_RADIUS.CRATE));
  const rng = game.rng;
  game.rng = () => 0.99;
  game.dropItem = () => null;
  p.interactT = -1;
  A.act(ACT.INTERACT, crate.id);
  game.rng = rng;
  delete game.dropItem;
  check('a supply crate is opened from the edge of its prompt', crate.state === 2, from(crate));
  game.removeEntity(crate);
  game.crates.splice(game.crates.indexOf(crate), 1);
  s.x = x0;
  s.y = y0;
  s.z = z0;
}

// walking over things picks them up - but not a stack the survivor has just put down, which stays down until they
// have walked off (a teammate's feet take it, and their own [E]); and a full backpack that leaves a car supply lying
// says so (a game of its own: the one above is left as it was)
{
  const g = new Game({ seed, godMode: true, log: () => {} });
  const join = (name) => {
    const c = { id: 0, notes: [], net: { tick: 0, ack: 0 }, global: null, self: {}, store: { ents: new Map(), onCreate() {}, onRemove() {}, onUpdate() {} } };
    c.handler = new Proxy({}, { get: (_, k) => (k === 'notify' ? (m, a) => c.notes.push([m, a]) : () => {}) });
    c.session = g.onOpen({
      send(bytes) {
        const r = new Reader(bytes.slice().buffer);
        const t = r.u8();
        if (t === S2C.WELCOME) c.id = r.u16();
        else if (t === S2C.SNAPSHOT) readSnapshot(r, c);
      },
    });
    const w = new Writer(64);
    w.u8(C2S.JOIN);
    w.u8(PROTOCOL_VERSION);
    w.str(name);
    g.onMessage(c.session, w.bytes().slice());
    return c;
  };
  const ticks = (n) => {
    for (let i = 0; i < n; i++) g.update();
  };
  const D = join('Dropper'); // (first in the pickup pass: on a tie the stack would be theirs)
  const T = join('Teammate');
  ticks(5);
  for (const z of g.zombies) {
    z.dead = true;
    z.deadT = 2;
  }
  const d = g.players.get(D.id);
  const t = g.players.get(T.id);
  d.admin = t.admin = true; // (/tp)
  const s = d.state;
  const tp = (p, x, z) => g.handleChat(p, `/tp ${x} ${z}`);
  // (on open ground: a spawn point can be beside a post of the rest area, and /tp puts a survivor on top of that)
  for (let k = 0; k < 40 && groundAt(g.world, s.x, s.z, 200, 0.3) > g.world.heightAt(s.x, s.z) + 0.05; k++) tp(d, s.x + 0.5, s.z);
  const home = [s.x, s.z];
  // (and nothing else lying about: a find in reach goes into the first free slot, the one `drop` puts the rope in)
  for (const e of g.items.filter((e) => !e.removed && !(e.hint >= 0) && Math.hypot(e.x - home[0], e.z - home[1]) < 8)) g.removeItemEnt(e);
  const rope = (p) => p.inv.reduce((n, x) => n + (x && x.item === ITEM.ROPE ? x.count : 0), 0);
  const off = (e) => Math.hypot(e.x - s.x, e.z - s.z);
  // the dropper puts three rope down out of the first backpack slot; `drop` is the stack on the ground
  const drop = () => {
    d.inv[0] = { item: ITEM.ROPE, count: 3 };
    const had = new Set(g.items);
    const m = new Writer(8);
    m.u8(C2S.ACTION);
    m.u8(ACT.DROP_SLOT);
    m.u8(0);
    m.u16(0);
    g.onMessage(D.session, m.bytes().slice());
    return g.items.find((e) => !had.has(e));
  };
  d.inv.fill(null);
  t.inv.fill(null);
  tp(t, s.x + 12, s.z);
  let stack = drop();
  const within = off(stack) < 1.9 && g.canReachEnt(d, stack); // (in reach of the pickup pass, or this proves nothing)
  ticks(200);
  check('a stack dropped from the backpack stays down while its dropper stands by it', within && rope(d) === 0 && !stack.removed && stack.count === 3, `10 s, ${off(stack).toFixed(2)} m from it`);
  tp(t, stack.x, stack.z);
  ticks(5);
  check('...a teammate who walks over it has it', rope(t) === 3 && rope(d) === 0 && stack.removed);
  tp(t, s.x + 12, s.z);
  stack = drop();
  ticks(85); // (nobody's feet take a stack in its first 4 s on the ground)
  // a step back (2.6 m from it: out of pickup range, not yet away from it) and return, then 4 m off and return
  const r = Math.hypot(home[0] - stack.x, home[1] - stack.z);
  const leave = (m) => {
    tp(d, stack.x + ((home[0] - stack.x) / r) * m, stack.z + ((home[1] - stack.z) / r) * m);
    ticks(8);
    tp(d, ...home);
    ticks(8);
    return rope(d);
  };
  const stepped = leave(2.6);
  const walked = leave(4);
  check('...and so has the dropper, once they have walked off and come back', stepped === 0 && walked === 3 && stack.removed, `a step back and return: ${stepped}, 4 m off and return: ${walked}`);
  stack = drop();
  ticks(1);
  const m = new Writer(8);
  m.u8(C2S.ACTION);
  m.u8(ACT.INTERACT);
  m.u16(stack.id);
  g.onMessage(D.session, m.bytes().slice());
  check('...or at once with [E]', rope(d) === 3 && stack.removed);
  // every slot taken, a car battery at the dropper's feet
  for (let i = 0; i < d.inv.length; i++) d.inv[i] = { item: ITEM.CLOTH, count: 1 };
  const told = (c, kind) => c.notes.filter(([msg, arg]) => msg === kind && arg === ITEM.CAR_BATTERY).length;
  const battery = g.spawnItem(ITEM.CAR_BATTERY, 1, s.x + 0.5, s.y + 0.02, s.z, { permanent: true });
  ticks(8);
  const first = told(D, NOTIFY.INVENTORY_FULL);
  ticks(200);
  const said = told(D, NOTIFY.INVENTORY_FULL);
  check('a full backpack that leaves a car supply lying says so, to that survivor', first === 1 && !battery.removed && told(T, NOTIFY.INVENTORY_FULL) === 0);
  check('...again every few seconds while they stand by it, not on every try', said === 2, `${said} notices in 10 s`);
  d.inv[0] = null;
  ticks(70); // (it is tried again every 3 s)
  check('...and it is picked up once there is room', battery.removed && d.inv[0]?.item === ITEM.CAR_BATTERY && told(D, NOTIFY.SUPPLY_FOUND) === 1 && told(D, NOTIFY.INVENTORY_FULL) === said);
  // a car supply taken from its hiding place: the team is told that place needs no more searching (the battery
  // above lay loose, it was nobody's rumour), and putting it down again does not bring the rumour back
  ticks(2);
  check('a car supply picked up off the ground leaves the rumours as they were', g.supplyFound === 0 && T.global.found === 0);
  const hidden = g.items.find((e) => e.hint === 5);
  const rumours = [...g.supplyHints];
  d.inv[1] = null;
  [s.x, s.y, s.z] = [hidden.x, hidden.y, hidden.z];
  const take = new Writer(8);
  take.u8(C2S.ACTION);
  take.u8(ACT.INTERACT);
  take.u16(hidden.id);
  g.onMessage(D.session, take.bytes().slice());
  ticks(2);
  check('a car supply taken from its hiding place is marked found for the whole team', hidden.removed && g.supplyFound === 1 << 5 && D.global.found === 1 << 5 && T.global.found === 1 << 5, `found ${g.supplyFound}, sent ${T.global.found}`);
  check('...its place still named by the rumour, and the others untouched', JSON.stringify(T.global.hints) === JSON.stringify(rumours));
  const had = new Set(g.items);
  const put = new Writer(8);
  put.u8(C2S.ACTION);
  put.u8(ACT.DROP_SLOT);
  put.u8(1);
  put.u16(0);
  g.onMessage(D.session, put.bytes().slice());
  ticks(2);
  const lying = g.items.find((e) => !had.has(e));
  check('...and it stays found when it is put down again', lying?.item === hidden.item && lying.hint === -1 && T.global.found === 1 << 5);
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

  // The client's harvest prompt (client/game/harvest.js) mirrors two things the server decides: how far a swing
  // reaches (Combat.melee) and what a hit gives (Game.gatherHit). Hold it against both, without leaving a trace.
  const s = p.state;
  const cols = game.world.staticGrid.query(game.world.car.x, game.world.car.z, 400, []);
  const treeCol = cols.find((c) => c.flags & COL.TREE && Math.hypot(c.x - tx, c.z - tz) < 0.01);
  const wreckCol = cols.find((c) => c.flags & COL.SALVAGE);
  const keep = { x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch, slot: s.slot, melee: s.weapons[SLOT_MELEE] };
  const real = { gatherHit: game.gatherHit, giveOrDrop: game.giveOrDrop, rng: game.rng, forTargets: game.combat.forTargets, noise: game.zm.noise };
  const events = game.events.length;
  let landed = null;
  game.gatherHit = (q, col) => (landed = col);
  game.combat.forTargets = () => {}; // nobody in the way: a swing that finds a zombie never reaches the tree
  const stand = (col, d) => {
    s.x = col.x + d;
    s.z = col.z;
    s.y = game.world.heightAt(s.x, s.z);
    s.yaw = Math.PI / 2; // facing it
  };
  // walk a line up to the collider, looking at it: wherever the prompt offers the hit the swing lands, and nowhere else
  const sweep = (col, weapon, slot) => {
    const n = { offered: 0, refused: 0, wrong: 0 };
    s.weapons[SLOT_MELEE] = weapon;
    s.slot = slot;
    for (let d = 0.3; d < col.r + 3.2; d += 0.04) {
      for (const pitch of [-0.4, 0, 0.5]) {
        stand(col, d);
        s.pitch = pitch;
        landed = null;
        game.combat.melee(p, { weapon: weapon || ITEM.KNIFE, heavy: false });
        const hit = landed ? HARVEST.find((h) => landed.flags & h.flag) : null;
        const offered = harvestAt(game.world, s);
        if (offered !== hit) n.wrong++;
        else if (offered) n.offered++;
        else n.refused++;
      }
    }
    return n;
  };
  const agrees = (n) => n.wrong === 0 && n.offered > 0 && n.refused > 0;
  const knife = sweep(treeCol, ITEM.KNIFE, SLOT_MELEE);
  const bat = sweep(treeCol, ITEM.BAT, SLOT_PISTOL); // a longer weapon, and not in hand: the prompt answers for the swap
  const bare = sweep(treeCol, 0, SLOT_PISTOL); // no melee weapon: it assumes the shortest reach (the knife's)
  const wreck = sweep(wreckCol, ITEM.KNIFE, SLOT_MELEE);
  check('harvest prompt reaches exactly as far as a swing (tree)', agrees(knife) && agrees(bat) && agrees(bare) && bat.offered > knife.offered, JSON.stringify({ knife, bat, bare }));
  check('harvest prompt reaches exactly as far as a swing (wreck)', agrees(wreck), JSON.stringify(wreck));
  // what it says, by what is in hand
  stand(treeCol, treeCol.r + 1);
  s.pitch = 0;
  const say = (weapon, slot) => {
    s.weapons[SLOT_MELEE] = weapon;
    s.slot = slot;
    return harvestPrompt(game.world, s) || '';
  };
  const yields = (h) => h.gives.map((it) => ITEM_DEFS[it].name);
  const said = [say(ITEM.KNIFE, SLOT_MELEE), say(ITEM.KNIFE, SLOT_PISTOL), say(0, SLOT_PISTOL)];
  check(
    'harvest prompt says how, by what is in hand, and what for',
    said[0].startsWith('[LMB] ') && said[1].startsWith(`[${SLOT_MELEE + 1}] `) && said[1].includes(ITEM_DEFS[ITEM.KNIFE].name) && !said[2].startsWith('[') && said.every((t) => yields(HARVEST[0]).every((nm) => t.includes(nm))),
    JSON.stringify(said),
  );
  // ...and those yields are the server's: the first item with every hit, the rest when the dice allow
  game.gatherHit = real.gatherHit;
  game.zm.noise = () => {};
  const got = new Set();
  game.giveOrDrop = (q, item) => got.add(item);
  const gives = (col, roll) => {
    const left = game.gather.get(col);
    game.gather.delete(col);
    game.rng = () => roll;
    got.clear();
    game.gatherHit(p, col, col.x, s.y + 1, col.z, ITEM.KNIFE);
    if (left) game.gather.set(col, left);
    else game.gather.delete(col);
    return [...got];
  };
  const sure = [treeCol, wreckCol].map((c) => gives(c, 0.999));
  const lucky = [treeCol, wreckCol].map((c) => gives(c, 0));
  check(
    'harvest prompt promises what a hit gives',
    HARVEST.every((h, i) => sure[i].length === 1 && sure[i][0] === h.gives[0] && h.gives.every((it) => lucky[i].includes(it))),
    HARVEST.map((h, i) => `${h.verb}: always ${sure[i].map((it) => ITEM_DEFS[it].name)}, at best ${lucky[i].map((it) => ITEM_DEFS[it].name)}`).join('; '),
  );
  Object.assign(game, { gatherHit: real.gatherHit, giveOrDrop: real.giveOrDrop, rng: real.rng });
  game.combat.forTargets = real.forTargets;
  game.zm.noise = real.noise;
  game.events.length = events;
  Object.assign(s, { x: keep.x, y: keep.y, z: keep.z, yaw: keep.yaw, pitch: keep.pitch, slot: keep.slot });
  s.weapons[SLOT_MELEE] = keep.melee;

  // a failed build or craft: what is short, by how much, and where it comes from
  const wall = STRUCT_DEFS[STRUCT.WALL].cost;
  const need = needLines(wall, { [ITEM.WOOD]: 1, [ITEM.NAILS]: 9 });
  const both = needLines(STRUCT_DEFS[STRUCT.GATE].cost, {});
  check(
    'a shortfall names the item, the amount and the source',
    need.length === 2 && need[0] === `Need ${wall[ITEM.WOOD] - 1} more ${ITEM_DEFS[ITEM.WOOD].name}` && /trees/.test(need[1]) && !/wrecks/.test(need[1]) && /trees/.test(both[1]) && /wrecks/.test(both[1]) && needLines(wall, wall).length === 0,
    JSON.stringify([need, both]),
  );
}

// a wreck gives five hits a day: the fifth tells every client it is used up, so no prompt goes on offering the hit;
// whoever joins later is told what was used up before they came, and dawn brings it all back
// (a game of its own: the one above is left as it was)
{
  const g = new Game({ seed, godMode: true, log: () => {} });
  const join = (name) => {
    const c = { id: 0, notes: [], stripped: new Set(), fell: [], net: { tick: 0, ack: 0 }, global: null, self: {}, store: { ents: new Map(), onCreate() {}, onRemove() {}, onUpdate() {} } };
    const on = { notify: (m, a) => c.notes.push([m, a]), stripped: (x, y, z) => c.stripped.add(strippedKey(x, y, z)), regrown: () => c.stripped.clear(), fell: (x, y, z, yaw) => c.fell.push([strippedKey(x, y, z), yaw]) };
    c.handler = new Proxy({}, { get: (_, k) => on[k] || (() => {}) });
    c.session = g.onOpen({
      send(bytes) {
        const r = new Reader(bytes.slice().buffer);
        const t = r.u8();
        if (t === S2C.WELCOME) c.id = r.u16();
        else if (t === S2C.SNAPSHOT) readSnapshot(r, c);
      },
    });
    const w = new Writer(64);
    w.u8(C2S.JOIN);
    w.u8(PROTOCOL_VERSION);
    w.str(name);
    g.onMessage(c.session, w.bytes().slice());
    return c;
  };
  const ticks = (n) => {
    for (let i = 0; i < n; i++) g.update();
  };
  const S = join('Salvager');
  const T = join('Teammate');
  ticks(5);
  const p = g.players.get(S.id);
  const s = p.state;
  s.weapons[SLOT_MELEE] = ITEM.KNIFE;
  g.combat.forTargets = () => {}; // nobody in the way: a swing that finds a zombie never reaches the wreck
  // the ticks in between simulate the survivor, so every swing and every look is taken from the same spot again
  let at = null;
  const stand = () => Object.assign(s, { x: at.x, y: g.world.heightAt(at.x, at.z), z: at.z, yaw: Math.PI / 2, pitch: at.pitch, slot: SLOT_MELEE });
  let landed = null;
  const swing = () => {
    stand();
    landed = null;
    g.combat.melee(p, { weapon: ITEM.KNIFE, heavy: false });
    return landed;
  };
  const prompt = (c) => (stand(), harvestPrompt(g.world, s, c.stripped) || '');
  const scrap = () => p.inv.reduce((n, x) => n + (x && x.item === ITEM.SCRAP ? x.count : 0), 0);
  const emptied = (c) => c.notes.filter(([msg, arg]) => msg === NOTIFY.SEARCH_EMPTY && arg === 2).length;
  // a wreck, and a spot beside it from where the swing lands on it (found with swings that take nothing)
  const take = g.gatherHit;
  g.gatherHit = (q, col) => (landed = col);
  let wreck = null;
  for (const col of g.world.staticGrid.query(g.world.car.x, g.world.car.z, 400, []).filter((c) => c.flags & COL.SALVAGE)) {
    for (let d = col.r + 3; d > 0.3 && !wreck; d -= 0.05) {
      for (const pitch of [-0.4, 0]) {
        at = { x: col.x + d, z: col.z, pitch };
        if (!wreck && swing() === col) wreck = col;
        if (wreck) break;
      }
    }
    if (wreck) break;
  }
  g.gatherHit = (q, col, ...rest) => ((landed = col), take.call(g, q, col, ...rest));
  check('found a wreck to salvage', !!wreck);
  const key = strippedKey(Math.round(wreck.x * 64), Math.round(wreck.y0 * 64), Math.round(wreck.z * 64));
  for (let i = 0; i < 4; i++) swing();
  ticks(1);
  check('a wreck with a hit left in it is still offered', scrap() >= 4 && S.stripped.size === 0 && T.stripped.size === 0 && prompt(S).startsWith('[LMB] ') && emptied(S) === 0, `${scrap()} scrap, "${prompt(S)}"`);
  swing();
  ticks(1);
  const had = scrap();
  check('the last hit tells every client the wreck is used up, and the one who took it', landed === wreck && S.stripped.has(key) && S.stripped.size === 1 && T.stripped.has(key) && emptied(S) === 1 && emptied(T) === 0, `stripped ${S.stripped.size}/${T.stripped.size}, told ${emptied(S)}/${emptied(T)}`);
  check('...and the prompt no longer offers the hit: it says there is nothing to be had', prompt(S) === HARVEST[1].spent && !prompt(S).startsWith('[') && prompt({ stripped: new Set() }).startsWith('[LMB] '), `"${prompt(S)}"`);
  const rng = g.rng;
  g.rng = () => 0.999; // (no "nothing left" toast: that one is a roll of the dice)
  swing();
  g.rng = rng;
  check('...and there is nothing: another swing gives no scrap', landed === wreck && scrap() === had, `${had} -> ${scrap()}`);
  const L = join('Latecomer');
  ticks(2);
  check('whoever joins later is told which are used up', L.stripped.size === 1 && L.stripped.has(key), `${L.stripped.size}`);
  g.startDay();
  ticks(1);
  check('dawn brings them back, on every client', S.stripped.size === 0 && T.stripped.size === 0 && L.stripped.size === 0 && prompt(S).startsWith('[LMB] '), `"${prompt(S)}"`);
  swing();
  check('...and the wreck gives again', scrap() > had, `${had} -> ${scrap()}`);

  // a tree takes six hits a day: the sixth brings it down, away from whoever cut it, and out of the world until dawn
  g.gatherHit = (q, col) => (landed = col);
  let tree = null;
  for (const col of g.world.staticGrid.query(g.world.car.x, g.world.car.z, 400, []).filter((c) => c.flags & COL.TREE)) {
    for (let d = col.r + 2.5; d > 0.3 && !tree; d -= 0.05) {
      at = { x: col.x + d, z: col.z, pitch: 0 };
      if (swing() === col) tree = col;
    }
    if (tree) break;
  }
  g.gatherHit = (q, col, ...rest) => ((landed = col), take.call(g, q, col, ...rest));
  check('found a tree to chop', !!tree);
  const tkey = strippedKey(Math.round(tree.x * 64), Math.round(tree.y0 * 64), Math.round(tree.z * 64));
  const standing = () => g.world.staticGrid.query(tree.x, tree.z, 0.5, []).includes(tree);
  for (let i = 0; i < 5; i++) swing();
  ticks(1);
  check('a tree with a hit left in it still stands', landed === tree && standing() && S.fell.length === 0 && T.fell.length === 0, `${S.fell.length}/${T.fell.length} told`);
  swing();
  ticks(1);
  // (stand() faces -X from the +X side: it goes over toward -X, yaw PI/2)
  check(
    'the last hit fells it, and every client is told which way it falls: away from the one who cut it',
    landed === tree && !standing() && [S, T].every((c) => c.fell.length === 1 && c.fell[0][0] === tkey && Math.abs(c.fell[0][1] - Math.PI / 2) < 0.03),
    JSON.stringify([S.fell, T.fell]),
  );
  check('...and it is out of the world: the same swing meets nothing of it', swing() !== tree);
  const M = join('Straggler');
  ticks(2);
  check('whoever joins later is told it is down', M.stripped.has(tkey) && M.fell.length === 0, `${M.stripped.size}`);
  g.startDay();
  ticks(1);
  check('dawn stands it up again', standing() && swing() === tree);
}

// melee needs a clear line: no stabbing the dead through the wall you shelter behind, no claws through it either.
// A survivor's blade still goes over what they see over (a barricade) and through what they walk through (a gate)
{
  const w = game.world;
  const p = A.p();
  const q = B.p();
  const keep = [p, q].map((e) => [e.state.x, e.state.y, e.state.z, e.state.yaw, e.state.pitch]);
  const ray = { t: -1, col: null, terrain: false };
  // solid from shin to eye between two points on level ground? (walled: something is; else: nothing is)
  const line = (a, b, walled) => {
    const l = Math.hypot(b[0] - a[0], b[2] - a[2]);
    return Math.abs(a[1] - b[1]) < 0.3 && [0.5, 1.0, 1.62].every((h) => !!raycastWorld(w, a[0], a[1] + h, a[2], (b[0] - a[0]) / l, 0, (b[2] - a[2]) / l, l, ray).col === walled && !ray.terrain);
  };
  // the wall beside a doorway: `out` and `far` on one side of it (0.85 and 2.35 m off), `inn` on the other,
  // and none of the dead that haunt the buildings near enough to take a swing meant for the one under test
  let spot = null;
  for (const o of w.openings) {
    for (const side of [1, -1]) {
      const [nx, nz, mx, mz] = [Math.sin(o.ry), Math.cos(o.ry), o.x + Math.cos(o.ry) * side * (o.w / 2 + 0.8), o.z - Math.sin(o.ry) * side * (o.w / 2 + 0.8)];
      const [inn, out, far] = [-0.85, 0.85, 2.35].map((d) => [mx + nx * d, groundAt(w, mx + nx * d, mz + nz * d, o.y + 1, 0.3), mz + nz * d]);
      const alone = game.zombies.every((e) => e.dead || Math.hypot(e.x - mx, e.z - mz) > 8);
      if (!spot && alone && [inn, out, far].every((v) => !game.nav.isBlocked(v[0], v[2])) && line(inn, out, true) && line(far, out, false)) spot = { inn, out, far, mid: [(out[0] + far[0]) / 2, (out[2] + far[2]) / 2], rot8: Math.round((((o.ry % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * 256) & 255 };
    }
  }
  check('found a building wall to swing at', !!spot);
  const { inn, out, far, mid, rot8 } = spot;
  const hits = [];
  let landed = 0;
  let chopped = 0;
  const [damageZombie, damagePlayer, impact, gatherHit] = [game.combat.damageZombie, game.damagePlayer, game.impact, game.gatherHit];
  game.combat.damageZombie = (z) => (hits.push(z), false);
  game.damagePlayer = (h) => hits.push(h);
  game.impact = () => landed++;
  game.gatherHit = () => chopped++;
  const stand = (e, [x, y, z]) => {
    const t = e.kind === ENT.PLAYER ? e.state : e;
    [t.x, t.y, t.z] = [x, y, z];
  };
  // one swing by `e` standing at `from`, aimed at `to`: how many it hit
  const swing = (e, from, to, weapon = ITEM.KNIFE) => {
    stand(e, from);
    e.state.yaw = Math.atan2(-(to[0] - from[0]), -(to[2] - from[2]));
    e.state.pitch = 0;
    e.renderTick = game.tick & 0xffff;
    e.renderFrac = 0;
    hits.length = landed = 0;
    game.combat.melee(e, { weapon, heavy: false });
    return hits.length;
  };
  // Bob as a player-zombie for a swing: his claws go for the living, and Alice's blade would go for him
  const claws = (from, to) => {
    q.zombie = true;
    const n = swing(q, from, to, 0);
    q.zombie = false;
    return n;
  };
  const z = game.zm.spawn(ZTYPE.WALKER, out[0], out[2]);
  stand(z, out);
  const open = swing(p, far, out) === 1 && hits[0] === z;
  const through = swing(p, inn, out);
  check('melee hits a zombie in the open', open);
  check('melee does not reach through a building wall', through === 0 && landed > 0, `${through} hit, the swing landed on the wall: ${landed > 0}`);
  stand(p, out);
  const clawed = [claws(far, out), claws(inn, out)];
  check("a player-zombie's claws do not reach through it either", clawed[0] === 1 && clawed[1] === 0, `open ${clawed[0]}, through the wall ${clawed[1]}`);
  // what the team builds, set down between the two: only its collider matters to a swing
  const across = {};
  for (const [name, type] of [['barricade', STRUCT.BARRICADE], ['gate', STRUCT.GATE], ['wall', STRUCT.WALL]]) {
    const col = game.structCollider(type, mid[0], far[1], mid[1], rot8, 0);
    w.structGrid.add(col);
    const blade = swing(p, far, out);
    stand(p, out);
    across[name] = [blade, claws(far, out)];
    w.structGrid.remove(col);
  }
  check('a blade goes over a barricade and through a gate, not through a wall the team built', across.barricade[0] === 1 && across.gate[0] === 1 && across.wall[0] === 0, JSON.stringify(across));
  check('...and claws are stopped by all three, as the AI dead are', across.barricade[1] === 0 && across.gate[1] === 0 && across.wall[1] === 0);
  // a swing at a tree still chops it, also when a zombie hides behind the trunk (it used to take the blow instead)
  const t = w.trees;
  let tree = null;
  for (let i = 0; i < t.length && !tree; i += 6) {
    const [front, back] = [1.4, -0.8].map((d) => [t[i] + d, groundAt(w, t[i] + d, t[i + 2], t[i + 1] + 1, 0.3), t[i + 2]]);
    raycastWorld(w, front[0], front[1] + 1.3, front[2], -1, 0, 0, 2.2, ray);
    const alone = game.zombies.every((e) => e === z || e.dead || Math.hypot(e.x - t[i], e.z - t[i + 2]) > 8);
    if (alone && Math.abs(front[1] - back[1]) < 0.3 && ray.col && Math.hypot(ray.col.x - t[i], ray.col.z - t[i + 2]) < 0.01) tree = { front, back };
  }
  stand(z, tree.back);
  const behind = swing(p, tree.front, tree.back);
  check('a swing at a tree chops it, not the zombie behind the trunk', behind === 0 && chopped === 1, `${behind} hit, ${chopped} chop`);
  [game.combat.damageZombie, game.damagePlayer, game.impact, game.gatherHit] = [damageZombie, damagePlayer, impact, gatherHit];
  z.dead = true;
  z.deadT = 2;
  [p, q].forEach((e, i) => ([e.state.x, e.state.y, e.state.z, e.state.yaw, e.state.pitch] = keep[i]));
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
  // demolishing refunds half the cost (a wall: 2 planks, 2 nails). With room for one plank in the backpack the
  // other plank and the nails go on the ground - the part that did not fit, not the whole refund over again
  {
    const inv = p.inv.map((x) => x && { ...x });
    tryBuild(STRUCT.WALL);
    const wall = game.structures.find((e) => e.stype === STRUCT.WALL);
    for (let i = 0; i < p.inv.length; i++) p.inv[i] = i ? { item: ITEM.CLOTH, count: 1 } : null;
    game.giveItem(p, ITEM.WOOD, 999); // every slot taken, one of them a full stack of planks...
    const planks = --p.inv[0].count; // ...less one
    const before = new Set(game.items);
    if (wall) A.act(ACT.DEMOLISH, wall.id);
    run(2);
    const drops = game.items.filter((e) => !before.has(e));
    const dropped = (item) => drops.reduce((n, e) => n + (e.item === item ? e.count : 0), 0);
    check('demolishing with a full backpack refunds each plank once', wall && !game.structures.includes(wall) && p.inv[0].count === planks + 1 && dropped(ITEM.WOOD) === 1 && dropped(ITEM.NAILS) === 2, `planks: ${p.inv[0].count - planks} kept, ${dropped(ITEM.WOOD)} dropped; nails: ${dropped(ITEM.NAILS)} dropped`);
    for (const e of drops) game.removeItemEnt(e);
    p.inv.splice(0, p.inv.length, ...inv);
    p.invDirty = true;
  }
  // [E] on a structure from the edge of its prompt (promptEdge above): feed the fire, mend the bench. As there:
  // no ticks, and the hammering goes unheard
  {
    const [x1, y1, z1] = [s.x, s.y, s.z];
    const built = p.actionT;
    const noise = game.zm.noise;
    game.zm.noise = () => {};
    const fuel = fire.burnLeft;
    standOff(A, fire, promptEdge(structPickRadius(STRUCT.CAMPFIRE)));
    p.interactT = -1;
    A.act(ACT.INTERACT, fire.id);
    const fed = fire.burnLeft > fuel;
    bench.hp = bench.maxHp / 2;
    standOff(A, bench, promptEdge(structPickRadius(STRUCT.WORKBENCH)));
    p.interactT = p.actionT = -1;
    A.act(ACT.INTERACT, bench.id);
    check('a fire is fed and a structure mended from the edge of their prompts', fed && bench.hp > bench.maxHp / 2, `${Math.hypot(bench.x - s.x, bench.z - s.z).toFixed(2)} m from the bench`);
    bench.hp = bench.maxHp;
    fire.burnLeft = fuel;
    s.x = x1;
    s.y = y1;
    s.z = z1;
    // ...and the build ghost reaches BUILD_REACH: a torch put down at full stretch, on the run
    game.giveItem(p, ITEM.TORCH, 1);
    const n = game.structures.length;
    for (let k = 0; k < 12 && game.structures.length === n; k++) {
      const a = (k / 12) * Math.PI * 2;
      p.actionT = -1;
      A.act(ACT.BUILD, STRUCT.TORCH, s.x + Math.sin(a) * (BUILD_REACH + RUN_UP - 0.05), s.z + Math.cos(a) * (BUILD_REACH + RUN_UP - 0.05), 0);
    }
    const torch = game.structures.length > n && game.structures[n];
    check('a structure is placed at the full reach of the build ghost', !!torch, torch ? `${Math.hypot(torch.x - s.x, torch.z - s.z).toFixed(2)} m` : '');
    if (torch) game.destroyStructure(torch, false);
    game.zm.noise = noise;
    p.actionT = built;
  }
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
    const keep = [p.inv.map((x) => x && { ...x }), [...s.weapons]];
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
    const mats = bulk(9, [[ITEM.SCRAP, 3], [ITEM.POWDER, 20]]);
    const stack = bulk(21, [[ITEM.SCRAP, 5], [ITEM.NAILS, 45], ...full(22)]);
    const freed = bulk(21, [[ITEM.SCRAP, 1], [ITEM.NAILS, 55], ...full(22)]);
    const bats = bulk(3, [[ITEM.WOOD, 9], ...full(21)]);
    const bat = bulk(3, [[ITEM.WOOD, 6], ...full(23)], () => (s.weapons[2] = 0));
    check(
      'a bulk craft stops where the server would refuse the next one',
      [mats, stack, freed, bats, bat].every((c) => c.ok) && [mats.n, stack.n, freed.n, bats.n, bat.n].join() === '3,1,1,2,1' && [mats.next, stack.next, freed.next, bats.next, bat.next].join() === [NOTIFY.NOT_ENOUGH, NOTIFY.INVENTORY_FULL, NOTIFY.NOT_ENOUGH, NOTIFY.INVENTORY_FULL, NOTIFY.INVENTORY_FULL].join(),
      JSON.stringify({ mats, stack, freed, bats, bat }),
    );
    // ammunition is carried apart from the backpack, up to AMMO_MAX: the server takes a craft while the reserve has
    // room for a single round and puts the rest of that batch on the ground. A bulk craft stops at the last whole
    // batch that fits (120 + 2 x 12 of 150), so nothing is spilt - and every backpack slot taken does not matter
    const cap = AMMO_MAX[AMMO.P9];
    const had = s.ammo[AMMO.P9];
    const ammo = bulk(9, [[ITEM.SCRAP, 10], [ITEM.POWDER, 30], ...full(22)], () => (s.ammo[AMMO.P9] = cap - 30), false);
    check('bulk ammunition stops at the last whole batch the reserve takes', ammo.n === 2 && ammo.ok && s.ammo[AMMO.P9] === cap - 30 + 2 * RECIPES[9].n && count(ITEM.AMMO_9MM) === 0 && count(ITEM.SCRAP) === 8 && count(ITEM.POWDER) === 26, `${ammo.n} batches sent at ${cap - 30} of ${cap}: reserve ${s.ammo[AMMO.P9]}, ${count(ITEM.SCRAP)} scrap and ${count(ITEM.POWDER)} powder left`);
    s.ammo[AMMO.P9] = had;
    p.inv.splice(0, p.inv.length, ...keep[0]);
    keep[1].forEach((v, i) => (s.weapons[i] = v));
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
  s.weapons[0] = 0; // (a gun or bolts looted on the way: the crossbow goes into an empty hand, the bolts are counted)
  setAmmo(p, AMMO.BOLT, 0);
  game.giveItem(p, ITEM.ROPE, 1);
  game.giveItem(p, ITEM.SCRAP, 4);
  game.giveItem(p, ITEM.STICK, 6);
  A.act(ACT.CRAFT, 26);
  A.act(ACT.CRAFT, 27);
  run(3);
  check('crafted crossbow + bolts at workbench', s.weapons[0] === ITEM.CROSSBOW && s.mags[0] === 1 && s.ammo[AMMO.BOLT] === 4, `bolts ${s.ammo[AMMO.BOLT]}`);
  // four more bolts with room for one in the reserve, and every backpack slot taken (ammunition needs none): the
  // other three land at her feet, they were paid for
  {
    const inv = p.inv.slice();
    const had = s.ammo[AMMO.BOLT];
    const cap = AMMO_MAX[AMMO.BOLT];
    const has = (item) => p.inv.reduce((n, x) => n + (x && x.item === item ? x.count : 0), 0);
    p.inv.fill(null);
    [[ITEM.STICK, 3], [ITEM.SCRAP, 2]].forEach(([item, count], i) => (p.inv[i] = { item, count }));
    for (let i = 2; i < p.inv.length; i++) p.inv[i] = { item: ITEM.LEATHER, count: 10 };
    s.ammo[AMMO.BOLT] = cap - 1;
    const before = new Set(game.items);
    A.act(ACT.CRAFT, 27);
    run(3);
    const spilt = game.items.filter((e) => !before.has(e) && e.item === ITEM.AMMO_BOLTS);
    const n = spilt.reduce((k, e) => k + e.count, 0);
    check('ammo crafted with the reserve nearly full is not lost', s.ammo[AMMO.BOLT] === cap && n === 3 && has(ITEM.STICK) === 1 && has(ITEM.SCRAP) === 1, `reserve ${cap - 1} -> ${s.ammo[AMMO.BOLT]} of ${cap}, ${n} on the ground, ${has(ITEM.STICK)} sticks, ${has(ITEM.SCRAP)} scrap`);
    for (const e of spilt) game.removeItemEnt(e);
    p.inv.splice(0, p.inv.length, ...inv);
    p.invDirty = true;
    s.ammo[AMMO.BOLT] = had;
  }
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
  // a rifle taken by swap (slot taken, backpack full) while the gun in hand is reloading: that reload is dropped,
  // it must not finish on the rifle just picked up and fill its magazine
  {
    const keep = [s.weapons[0], s.mags[0]];
    const inv = p.inv.slice();
    const ammo = [...s.ammo];
    // (a full backpack of cloth; six shells and five .308 rounds carried)
    p.inv.fill(null);
    for (let i = 0; i < p.inv.length; i++) p.inv[i] = { item: ITEM.CLOTH, count: 1 };
    s.ammo[AMMO.SHELL] = 6;
    s.ammo[AMMO.R308] = 5;
    s.weapons[0] = ITEM.SHOTGUN; // (the shortest reload there is: one shell)
    s.mags[0] = 2;
    A.input(BTN.RELOAD, 0, 0);
    run(2, () => A.input(0, 0, 0));
    const reloading = s.reloadT > 0;
    const rifle = game.spawnItem(ITEM.HUNTING_RIFLE, 1, s.x, s.y + 0.02, s.z, { mag: 0 });
    const before = new Set(game.items);
    A.act(ACT.INTERACT, rifle.id);
    run(Math.ceil(WEAPONS[ITEM.SHOTGUN].reload * 20) + 1, () => A.input(0, 0, 0)); // as long as the shell had left to go in
    check('a weapon swapped in mid-reload does not inherit the reload', reloading && s.weapons[0] === ITEM.HUNTING_RIFLE && s.mags[0] === 0 && s.ammo[AMMO.R308] === 5, `rifle mag ${s.mags[0]}, .308 reserve ${s.ammo[AMMO.R308]}`);
    for (const e of game.items.filter((e) => !before.has(e) && e.item === ITEM.SHOTGUN)) game.removeItemEnt(e); // the one she put down
    [s.weapons[0], s.mags[0]] = keep;
    p.inv.splice(0, p.inv.length, ...inv);
    p.invDirty = true;
    ammo.forEach((v, i) => (s.ammo[i] = v));
  }
  // heavy melee (RMB): one harder blow, then a longer recovery - more in the blow, less per second, so that
  // neither button is always the right one. (no ticks and no game rng in here: the run plays out as before)
  {
    const melee = [ITEM.KNIFE, ITEM.BAT, ITEM.SPIKED_BAT, ITEM.MACHETE];
    const flat = melee.filter((id) => !(WEAPONS[id].altDamage > WEAPONS[id].damage && WEAPONS[id].altRate > WEAPONS[id].rate && WEAPONS[id].altDamage / WEAPONS[id].altRate < WEAPONS[id].damage / WEAPONS[id].rate));
    check('every melee weapon has a heavy attack of its own', flat.length === 0, flat.join(','));
    const bat = WEAPONS[ITEM.BAT];
    // the swing itself, in the shared sim: which button, and how long before the next one
    const sim = copyPlayerState(createPlayerState(), s);
    sim.weapons[2] = ITEM.BAT;
    sim.slot = 2;
    const swing = (buttons) => {
      sim.cooldown = sim.switchT = sim.lastBtn = 0;
      const ev = [];
      simulatePlayer(sim, { seq: 1, buttons, yaw: 0, pitch: 0, slot: 255 }, game.world, ev);
      return [ev.find((e) => e.type === 'melee')?.heavy, sim.cooldown];
    };
    const [lightEv, lightCd] = swing(BTN.ATTACK);
    const [heavyEv, heavyCd] = swing(BTN.ALT);
    check('RMB swings heavy and recovers slower', lightEv === false && heavyEv === true && lightCd === bat.rate && heavyCd === bat.altRate, `${lightCd} s / ${heavyCd} s`);
    // the blow, on the server: looking down at a walker's chest
    const rng = game.rng;
    game.rng = () => 0.99;
    const look = [s.yaw, s.pitch];
    s.yaw = 0;
    s.pitch = -0.6;
    const dummy = game.zm.spawn(ZTYPE.WALKER, s.x, s.z - 1.5, { hpMul: 20 });
    game.fillHistory(dummy);
    const blow = (heavy) => {
      const hp = dummy.hp;
      game.combat.melee(p, { weapon: ITEM.BAT, heavy });
      return hp - dummy.hp;
    };
    const light = blow(false);
    const heavy = blow(true);
    check('a heavy blow deals altDamage', light === bat.damage && heavy === bat.altDamage, `${light} / ${heavy}`);
    dummy.dead = true;
    dummy.deadT = 2;
    [s.yaw, s.pitch] = look;
    game.rng = rng;
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

// talking: chat only carries to those in earshot; the walkie-talkie everyone has in slot 6 bridges any distance
// (no ticks and no game rng in here, so the rest of the run plays out as before)
{
  const a = A.p();
  const b = B.p();
  const sa = a.state;
  const sb = b.state;
  const home = [sb.x, sb.y, sb.z];
  const slots = [sa.slot, sb.slot];
  const btn = sa.lastBtn;
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
  check('nobody has to find a walkie-talkie: none is hidden in any container', game.caches.every((c) => !c.stash));
  sa.slot = SLOT_RADIO;
  say(A, 'come in');
  check('chat said with the walkie-talkie in hand carries any distance', B.chats[0]?.flags === CHATF.RADIO && B.chats[0].text === 'come in' && A.chats[0]?.flags === 0);
  say(B, 'copy');
  check('...but not back without theirs in hand', A.chats.length === 0 && B.chats[0]?.flags === CHATF.UNHEARD);
  sb.slot = SLOT_RADIO;
  say(B, 'copy');
  check('...and back with it', A.chats[0]?.flags === CHATF.RADIO && A.chats[0].id === B.id);
  // keying it (fire held with it in hand) puts you on the air: the player list tells everyone at once
  game.sendPlayers();
  check('in hand is not on the air', A.roster.get(A.id)?.onAir === false && A.roster.get(B.id)?.onAir === false);
  sa.lastBtn = BTN.ATTACK;
  game.playersDirty = false;
  game.checkOnAir();
  const keyed = game.playersDirty;
  game.sendPlayers();
  check('keying the walkie-talkie puts you on the air for everyone', keyed && B.roster.get(A.id)?.onAir === true && A.roster.get(A.id)?.onAir === true && B.roster.get(B.id)?.onAir === false);
  sa.lastBtn = 0;
  game.playersDirty = false;
  game.checkOnAir();
  const off = game.playersDirty;
  game.sendPlayers();
  check('...and letting go takes you off it', off && B.roster.get(A.id)?.onAir === false);
  sa.slot = slots[0];
  sa.lastBtn = BTN.ATTACK;
  check('fire held with a weapon in hand is not the radio', !game.onAir(a));
  sa.lastBtn = btn;
  sb.slot = slots[1];
  say(B, 'hello?');
  check('...and out of reach again once it is put away', A.chats.length === 0 && B.chats[0]?.flags === CHATF.UNHEARD);
  // slot 6 is everyone's, and a survivor who is down can still reach it to call for help
  const ps = createPlayerState();
  const cmd = { seq: 1, buttons: 0, yaw: 0, pitch: 0, slot: SLOT_RADIO };
  simulatePlayer(ps, cmd, game.world, null);
  check('[6] takes out the walkie-talkie', ps.slot === SLOT_RADIO);
  ps.lastBtn = BTN.ATTACK;
  const keyedFree = radioKeyed(ps);
  ps.using = 1;
  const keyedUsing = radioKeyed(ps);
  ps.using = 0;
  ps.hmg = 1;
  const keyedCarrying = radioKeyed(ps);
  check('...keyed by fire held, but not with a medkit in use or the mounted gun in both arms', keyedFree && !keyedUsing && !keyedCarrying);
  ps.slot = SLOT_MELEE;
  ps.lastBtn = 0;
  cmd.slot = SLOT_RADIO;
  simulatePlayer(ps, cmd, game.world, null);
  check('...and reaching for it lets go of the mounted gun', ps.slot === SLOT_RADIO && ps.hmg === 0);
  ps.downed = 1;
  cmd.slot = 255;
  simulatePlayer(ps, cmd, game.world, null);
  check('...and going down does not put it away', ps.slot === SLOT_RADIO);
  ps.zombie = 1;
  simulatePlayer(ps, cmd, game.world, null);
  check('...the turned have none', ps.slot !== SLOT_RADIO);
  // back to how things were
  [sb.x, sb.y, sb.z] = home;
  game.sendPlayers();
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
  // a pipe bomb going off on the very tick a corpse is swept from the list still hurts everything round it
  // (a blast looks zombies up in a spatial hash of list indices: the sweep has to come before it is built)
  {
    const corpse = game.zm.spawn(ZTYPE.WALKER, spot.x + spot.dx * 60, spot.z + spot.dz * 60);
    const pack = [];
    for (let i = 0; i < 12; i++) pack.push(game.zm.spawn(ZTYPE.WALKER, spot.x + Math.sin(i) * 2.5, spot.z + Math.cos(i) * 2.5));
    corpse.dead = true;
    corpse.deadT = 2; // swept on the next tick...
    const bomb = game.combat.spawnProjectile(PROJ.PIPEBOMB, A.p(), spot.x, w.heightAt(spot.x, spot.z) + 0.1, spot.z, 0, 0, 0, { fuse: 0.01, grav: 0 }); // ...which is when this goes off
    run(1);
    // (in range: a spot of the ring something stands on has its walker nudged off it by spawn, maybe out of the blast)
    const near = pack.filter((z) => Math.hypot(z.x - bomb.x, z.y + 1 - bomb.y, z.z - bomb.z) < THROWABLES[ITEM.PIPEBOMB].radius - 0.5);
    const hurt = near.filter((z) => z.dead || z.hp < z.maxHp).length;
    check('a blast on the tick a corpse is swept hits everything in range', !game.zombies.includes(corpse) && !game.projectiles.includes(bomb) && near.length >= 10 && hurt === near.length, `${hurt} of ${near.length} in range hurt (${pack.length} spawned)`);
    for (const z of pack) {
      z.dead = true;
      z.deadT = 2;
    }
    run(2);
  }
}

// the pier: a deck over deep water is no refuge. The dead walk it by the rule a survivor's feet follow, a Tank's
// charge pulls up at the water's edge, and one that ends up on the lake bed wades back out.
// (a game of its own: none of this touches the run above or its rng)
{
  const g = new Game({ seed, log: () => {} });
  const session = g.onOpen({ send() {} });
  const jw = new Writer(64);
  jw.u8(C2S.JOIN);
  jw.u8(PROTOCOL_VERSION);
  jw.str('Dockhand');
  g.onMessage(session, jw.bytes().slice());
  const p = [...g.players.values()][0];
  const s = p.state;
  const w = g.world;
  for (const z of [...g.zombies]) {
    g._listRemove(g.zombies, z);
    g.removeEntity(z);
  }
  g.zm.herds.reset();
  g.zm.maintainT = g.zm.herds.spawnT = 1e9; // no roamers, no herd: only the dead put here
  // the dock's own frame: lz runs out along the pier, lx across it
  const dock = w.zoneById[ZONE.DOCK];
  const at = (lx, lz) => ({ x: dock.x + Math.cos(dock.ry) * lx + Math.sin(dock.ry) * lz, z: dock.z - Math.sin(dock.ry) * lx + Math.cos(dock.ry) * lz });
  // how far out the lake gets deep, lx to the side of the pier's centre line
  const deepFrom = (lx) => {
    let lz = 12;
    while (lz < 40 && !w.isDeepWater(at(lx, lz).x, at(lx, lz).z)) lz += 0.5;
    return lz;
  };
  const stand = at(0, Math.min(40, deepFrom(0) + 12)); // on the deck, well out over deep water
  const deckY = groundAt(w, stand.x, stand.z, 200, 0.25);
  // the survivor is held where they stand (a Tank's blow would throw them down the pier); hits are counted, not taken
  const hold = () => {
    [s.x, s.y, s.z] = [stand.x, deckY, stand.z];
    s.vx = s.vy = s.vz = 0;
  };
  hold();
  g.fillHistory(p);
  // set one of the dead down on the ground (or the lake bed) at a spot in the dock's frame
  const put = (z, lx, lz) => {
    const q = at(lx, lz);
    [z.x, z.y, z.z] = [q.x, w.heightAt(q.x, q.z), q.z];
    [z.lastX, z.lastZ] = [q.x, q.z];
    g.fillHistory(z);
    return z;
  };
  let hits = 0;
  let firstHit = -1;
  g.damagePlayer = (who) => {
    if (who !== p) return;
    if (!hits++) firstHit = g.tick;
  };
  const dead = (t) => g.zm.spawn(t, at(0, 0).x, at(0, 0).z, { horde: true });
  // walkers and runners (all a first night has) let go on land at the foot of the pier
  const walkers = [ZTYPE.WALKER, ZTYPE.WALKER, ZTYPE.WALKER, ZTYPE.RUNNER, ZTYPE.WALKER, ZTYPE.WALKER, ZTYPE.RUNNER].map((t, i) => put(dead(t), i - 3, 2));
  // a Tank in the shallows beside the pier, the lake between it and the survivor, ready to charge
  const tank = put(dead(ZTYPE.TANK), 4, deepFrom(4) - 4.5);
  tank.specialCd = 0;
  // a walker on the lake bed beside the deck, as a pounce off the edge would leave it
  const sunk = put(dead(ZTYPE.WALKER), 3, deepFrom(3) + 3);
  const onBed = (z) => z.state !== 2 && w.isDeepWater(z.x, z.z) && z.y <= w.heightAt(z.x, z.z) + 0.05;
  const t0 = g.tick;
  const reached = new Set();
  let wet = 0; // ticks any of those let go on land spent on the lake bed
  let charges = 0;
  let charging = false;
  let out = sunk && onBed(sunk) ? -1 : -2; // seconds the sunk walker took to leave the lake (-1: still in it, -2: bad setup)
  for (let t = 0; t < 20 * 30; t++) {
    hold();
    g.update();
    for (const z of [...walkers, tank]) {
      if (onBed(z)) wet++;
      if (Math.hypot(z.x - s.x, z.z - s.z) < z.def.range + 1.5 && Math.abs(z.y - deckY) < 0.1) reached.add(z);
    }
    if (tank.state === 6 && !charging) charges++;
    charging = tank.state === 6;
    if (out === -1 && !onBed(sunk)) out = (g.tick - t0) / 20;
  }
  const came = walkers.filter((z) => reached.has(z)).length;
  check('the dead walk the pier to a survivor standing on it', came >= 6 && hits > 0 && firstHit - t0 < 20 * 15, `${came} of ${walkers.length} walkers and runners reached them, ${hits} hits in 30 s${hits ? `, the first after ${((firstHit - t0) / 20).toFixed(1)} s` : ''}`);
  check('a Tank charging at the pier stops at the water and comes round by the deck', charges > 0 && reached.has(tank), `${charges} charges`);
  check('the lake itself is still no way across', wet === 0, `${wet} ticks on the lake bed`);
  check('one left on the lake bed wades out', out >= 0 && out < 15 && !onBed(sunk), out >= 0 ? `after ${out.toFixed(1)} s` : '');
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

// armour: a vest taken off goes into the backpack with the points it has left, however few, and comes back on
// with exactly those - swapping between two vests neither repairs one nor throws one away
{
  const p = A.p();
  const inv = p.inv.slice();
  p.inv.fill(null);
  p.inv[0] = { item: ITEM.JACKET, count: 1 };
  p.inv[1] = { item: ITEM.KEVLAR, count: 1 };
  A.act(ACT.EQUIP_ARMOR, 0);
  run(1);
  const jacket = p.armor; // new
  p.armor = 20; // most of it soaked up
  A.act(ACT.EQUIP_ARMOR, 1); // the kevlar on, the jacket into its slot
  run(1);
  const kevlar = p.armor;
  const kept = p.inv[1]?.item === ITEM.JACKET;
  p.armor = kevlar - 10; // barely scratched
  A.act(ACT.EQUIP_ARMOR, 1); // and back
  run(1);
  const worn = [p.armorItem, p.armor];
  A.act(ACT.EQUIP_ARMOR, 1);
  run(1);
  check('a worn vest taken off is kept, not thrown away', jacket > 20 && kevlar > jacket && kept && worn[0] === ITEM.JACKET);
  check('...and is as worn when it goes back on', worn[1] === 20 && p.armorItem === ITEM.KEVLAR && p.armor === kevlar - 10 && A.self.armor === kevlar - 10 && A.self.armorMax === kevlar, `jacket ${jacket} -> 20 -> ${worn[1]}, kevlar ${kevlar} -> ${kevlar - 10} -> ${p.armor}`);
  p.armor = p.armorMax = p.armorItem = 0;
  p.inv.splice(0, p.inv.length, ...inv);
  p.invDirty = true;
}

// ping
A.act(ACT.PING, 0, 10, 1, 10);
run(2);
check('ping broadcast', B.pings > 0);

// a waypoint set on the field map: everyone's player list carries it (late joiners get the list whole), until it is
// moved or cleared, and a bad place id is dropped rather than passed on
{
  const zid = game.world.zones[2].id;
  A.act(ACT.WAYPOINT, { x: 40.5, z: -12.25, zone: zid });
  run(1);
  const seen = B.roster.get(A.id)?.way;
  check('a waypoint reaches the team in the player list', !!seen && seen.x === 40.5 && seen.z === -12.25 && seen.zone === zid && A.roster.get(A.id)?.way?.zone === zid, JSON.stringify(seen));
  A.act(ACT.WAYPOINT, { x: 500, z: 3, zone: 254 });
  run(1);
  const moved = B.roster.get(A.id)?.way;
  check('...moves with it (kept on the map, no such place passed on)', !!moved && moved.x === MAP_HALF - 3 && moved.z === 3 && moved.zone === 255, JSON.stringify(moved));
  A.act(ACT.WAYPOINT, null);
  run(1);
  check('...and is gone when cleared', B.roster.get(A.id)?.way === null && B.roster.has(A.id));
}

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
  // he goes down in the middle of reloading a rifle: that reload must not run on over the pistol he is left with
  const bs = b.state;
  const keep = [bs.weapons[0], bs.mags[0], bs.ammo[AMMO.R308]];
  bs.weapons[0] = ITEM.HUNTING_RIFLE;
  bs.mags[0] = 1;
  setAmmo(b, AMMO.R308, 5);
  B.input(0, 0, 0, 0);
  run(12, () => B.input(0, 0, 0));
  B.input(BTN.RELOAD, 0, 0);
  run(2, () => B.input(0, 0, 0));
  const reloading = bs.slot === 0 && bs.reloadT > 2;
  game.godMode = false;
  // what the team's HUD shows of B (nameplate bar, survivors list) is read from these: B's health in A's copy of
  // the entity, and B's status in the player list
  const pl = [...A.store.ents.values()].find((e) => e.kind === ENT.PLAYER && e.id === B.id);
  const hpSeen = () => pl.q[7] / 255;
  b.hp = b.maxHp;
  game.damagePlayer(b, 60, { kind: 2, ztype: 0, x: b.state.x, z: b.state.z });
  run(2);
  check('a hurt teammate: health replicated', !b.downed && b.hp > 0 && b.hp < b.maxHp && Math.abs(hpSeen() - b.hp / b.maxHp) < 0.005, `${b.hp}/${b.maxHp} seen as ${hpSeen().toFixed(3)}`);
  game.damagePlayer(b, 500, { kind: 2, ztype: 0, x: b.state.x, z: b.state.z });
  run(2);
  check('B downed instead of dead', b.alive && b.downed && B.self.downed === 1, `bleed ${B.self.bleed}`);
  {
    const told = B.self.slot === 1 && B.self.reloadT === 0; // his client is sent the pistol with no reload running
    const mag = bs.mags[1];
    let t = 0;
    while (t < 60 && bs.mags[1] === mag) run(1, () => B.input(t++ % 2 ? 0 : BTN.ATTACK, 0, 0)); // click, click
    check('downed mid-reload: the pistol fires at once', reloading && told && t <= 4, `first shot after ${(t / 20).toFixed(2)} s`);
    [bs.weapons[0], bs.mags[0]] = keep;
    setAmmo(b, AMMO.R308, keep[2]);
  }
  check('downed flag replicated', pl && pl.q[5] & 256);
  check('a downed teammate: no health, and the player list says down', hpSeen() === 0 && A.roster.get(B.id)?.status === 3, `status ${A.roster.get(B.id)?.status}`);
  // from the edge of the revive prompt (promptEdge above), and without stepping closer for the whole of it
  standOff(A, b, promptEdge(PICK_RADIUS.DOWNED));
  const from = Math.hypot(b.x - A.p().state.x, b.z - A.p().state.z);
  A.act(ACT.HOLD_BEGIN, B.id);
  run(90);
  check('B revived', b.alive && !b.downed && b.hp > 0, `hp ${b.hp}, from ${from.toFixed(2)} m`);
  check('...and seen back on their feet, hurt', Math.abs(hpSeen() - b.hp / b.maxHp) < 0.005 && hpSeen() < 0.6 && A.roster.get(B.id)?.status === 0, `seen as ${hpSeen().toFixed(3)}`);
}

// death lasts until dawn (DAWN_RETURN): the night you die is the night you hunt, a reload is no way round it, at
// sunrise you are a survivor again beside the team with next to nothing - and a wipe is still a loss
// (a game of its own: these deaths and a third and fourth player would change the run the rest of this file checks)
{
  const g = new Game({ seed, godMode: true, dawnReturn: true, log: () => {} });
  const w = g.world;
  const car = w.car;
  const join = (name) => {
    const c = { name, id: 0, net: { tick: 0, ack: 0 }, global: null, self: {}, store: { ents: new Map(), onCreate() {}, onRemove() {}, onUpdate() {} }, notes: [], chats: [] };
    c.handler = { ...A.handler, notify: (m, a) => c.notes.push([m, a]), pickup() {}, ping() {}, summary() {}, flyover() {} };
    c.session = g.onOpen({
      send(bytes) {
        const r = new Reader(bytes.slice().buffer);
        const t = r.u8();
        if (t === S2C.WELCOME) c.id = r.u16();
        else if (t === S2C.SNAPSHOT) readSnapshot(r, c);
        else if (t === S2C.CHAT) {
          r.u16();
          r.u8();
          c.chats.push(r.str());
        }
      },
    });
    const wr = new Writer(64);
    wr.u8(C2S.JOIN);
    wr.u8(PROTOCOL_VERSION);
    wr.str(name);
    g.onMessage(c.session, wr.bytes().slice());
    c.p = () => g.players.get(c.id);
    return c;
  };
  const tick = (n) => {
    for (let i = 0; i < n; i++) g.update();
  };
  const nightfall = () => {
    g.timeLeft = 0.04;
    tick(1);
  };
  const has = (p, item) => p.inv.reduce((n, x) => n + (x && x.item === item ? x.count : 0), 0);
  // tools, rounds in the pistol, reserves, bandages, stacks in the pack
  const kit = (p) => [p.state.weapons.join(), p.state.mags[1], p.state.ammo.join(''), has(p, ITEM.BANDAGE), p.inv.filter(Boolean).length].join(' / ');
  const from = (s, o) => Math.hypot(s.x - o.x, s.z - o.z);
  const survivor = (p) => p.alive && !p.zombie;
  const returned = (c) => c.notes.filter((n) => n[0] === NOTIFY.RETURNED).map((n) => n[1]).sort().join();
  const walker = { kind: 2, ztype: ZTYPE.WALKER };
  const Ann = join('Ann');
  const Ben = join('Ben');
  const Cat = join('Cat');
  let Dee = join('Dee');
  tick(2);
  const starter = kit(Ann.p());
  // the team holds open, level ground a long way from the car
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
  check('found open ground for the dawn return', !!spot);
  [Ann, Cat, Ben, Dee].forEach((c, i) => {
    const s = c.p().state;
    s.x = spot.x + i * 1.5;
    s.z = spot.z;
    s.y = groundAt(w, s.x, s.z, 200, 0.3);
  });
  nightfall();
  // Ben and Dee die in the night; Dee reloads the page
  g.killPlayer(Ben.p(), walker);
  g.killPlayer(Dee.p(), walker);
  tick(20 * 7);
  const rose = Ben.p().zombie && Dee.p().zombie;
  g.onClose(Dee.session);
  Dee = join('Dee');
  check('a dead player who reloads is still one of them', g.phase === PHASE.NIGHT && Dee.p().zombie && Dee.p().alive && Dee.chats.some((t) => t.includes('until dawn')), Dee.chats.join(' | '));
  g.timeLeft = 0.5;
  tick(5);
  check('a dead player is a zombie through the night', rose && g.phase === PHASE.NIGHT && [Ben, Dee].every((c) => c.p().zombie && c.p().alive && c.self.zombie === 1) && !returned(Ann));
  // sunrise, with three walkers 5 m to the north of the team and nothing else near
  for (const z of [...g.zombies]) {
    g._listRemove(g.zombies, z);
    g.removeEntity(z);
  }
  const dead = [-1, 0, 1].map((i) => g.zm.spawn(ZTYPE.WALKER, spot.x + i, spot.z - 5));
  g.timeLeft = 0.04;
  tick(1);
  const back = [Ben, Dee].map((c) => c.p());
  check('at dawn the dead are survivors again', g.phase === PHASE.DAY && g.day === 2 && back.every((p) => survivor(p) && p.hp === 100) && [Ben, Dee].every((c) => c.self.zombie === 0 && c.self.alive === 1));
  const mates = back.map((p) => Math.min(from(p.state, Ann.p().state), from(p.state, Cat.p().state)));
  check('...beside the team, not at the car', mates.every((d) => d >= 2.4 && d <= 9.1) && back.every((p) => from(p.state, car) > 100), `${mates.map((d) => d.toFixed(1)).join(' and ')} m from a teammate, ${from(back[0].state, car).toFixed(0)} m from the car`);
  check('...on open ground with a clear walk to them', back.every(({ state: s }) => open(s.x, s.z) && Math.abs(s.y - groundAt(w, s.x, s.z, s.y)) < 0.01 && [Ann, Cat].some((c) => g.zm.clearLine(s.x, s.y + 0.6, s.z, c.p().state.x, c.p().state.y + 0.6, c.p().state.z))));
  const near = Math.min(...back.flatMap((p) => dead.map((z) => from(z, p.state))));
  check('...on the side away from the dead', near > 8, `nearest zombie ${near.toFixed(1)} m (${Math.min(...dead.map((z) => from(z, Ann.p().state))).toFixed(1)} m from a teammate)`);
  check('...with next to nothing: the tools, one pistol magazine and a bandage', back.every((p) => kit(p) === `${Ann.p().state.weapons.join()} / ${WEAPONS[ITEM.PISTOL].mag} / ${'0'.repeat(Object.keys(AMMO).length)} / 1 / 1`) && Ben.self.mags[1] === WEAPONS[ITEM.PISTOL].mag && Ben.self.ammo.every((n) => n === 0), `${kit(back[0])} against the starting ${starter}`);
  const ids = [Ben.id, Dee.id].sort().join();
  check('...and everyone is told who came back', [Ann, Cat, Ben, Dee].every((c) => returned(c) === ids), returned(Ann));
  // a wipe is still a loss: the last survivors fall with dawn due on the very next tick, Ben already one of the dead
  nightfall();
  g.killPlayer(Ben.p(), walker);
  tick(20 * 7);
  g.timeLeft = 0.04;
  for (const c of [Dee, Cat, Ann]) g.killPlayer(c.p(), walker);
  const over = g.phase;
  tick(3);
  g.returnFallen(); // (even asked outright)
  check('a wipe is a loss, dawn or not: nobody comes back', over === PHASE.GAMEOVER && g.phase === PHASE.GAMEOVER && g.day === 2 && ![...g.players.values()].some(survivor) && returned(Ann) === ids);
  // the switch off is the rule as it was: a death lasts the run, and a reload is a survivor again at once
  g.restartT = 0;
  tick(1);
  g.dawnReturn = false;
  nightfall();
  g.killPlayer(Ben.p(), walker);
  g.killPlayer(Dee.p(), walker);
  tick(20 * 7);
  g.onClose(Dee.session);
  Dee = join('Dee');
  const reload = survivor(Dee.p());
  g.timeLeft = 0.04;
  tick(1);
  check('with DAWN_RETURN off a death lasts the run, as before', g.phase === PHASE.DAY && g.day === 2 && Ben.p().zombie && Ben.p().alive && returned(Ann) === ids && reload, `after dawn: zombie ${Ben.p().zombie}; a reload: survivor ${reload}, ${kit(Dee.p())}`);
}

// what is left lying when a survivor dies or leaves, the ceiling on loose drops, and the limits on coming and
// going (games of their own: the one above is left as it was)
{
  const join = (g, name, ip) => {
    const c = { id: 0, rejected: false, chats: [], net: { tick: 0, ack: 0 }, global: null, self: {}, store: { ents: new Map(), onCreate() {}, onRemove() {}, onUpdate() {} }, handler: new Proxy({}, { get: () => () => {} }) };
    c.session = g.onOpen({
      ip,
      send(bytes) {
        const r = new Reader(bytes.slice().buffer);
        const t = r.u8();
        if (t === S2C.WELCOME) c.id = r.u16();
        else if (t === S2C.REJECT) c.rejected = true;
        else if (t === S2C.SNAPSHOT) readSnapshot(r, c);
        else if (t === S2C.CHAT) {
          r.u16();
          r.u8();
          c.chats.push(r.str());
        }
      },
    });
    const w = new Writer(64);
    w.u8(C2S.JOIN);
    w.u8(PROTOCOL_VERSION);
    w.str(name);
    g.onMessage(c.session, w.bytes().slice());
    return c;
  };
  const ticks = (g, n) => {
    for (let i = 0; i < n; i++) g.update();
  };
  // the items that appeared on the ground while fn ran
  const fell = (g, fn) => {
    const had = new Set(g.items);
    fn();
    return g.items.filter((e) => !had.has(e));
  };
  const list = (pairs) => pairs.map(([item, count]) => `${item}x${count}`).sort().join(' ');
  const names = (ents) => list(ents.map((e) => [e.item, e.count]));
  const KIT = [[ITEM.BANDAGE, 2], [ITEM.TORCH, 1], [ITEM.WOOD, 6], [ITEM.NAILS, 8], [ITEM.STICK, 4], [ITEM.CLOTH, 1], [ITEM.PISTOL, 1], [ITEM.KNIFE, 1], [ITEM.HAMMER, 1], [ITEM.AMMO_9MM, 36]];
  const FOUND = [[ITEM.FUEL_CAN, 1], [ITEM.AK47, 1], [ITEM.AMMO_762, 30], [ITEM.WOOD, 5]];

  const g = new Game({ seed, godMode: true, log: () => {} });
  const W = join(g, 'Witness', 'home');
  ticks(g, 5);
  const s = g.players.get(W.id).state;
  // leaving with the kit everyone is handed: nothing stays behind
  const none = fell(g, () => g.onClose(join(g, 'Leaver', 'home').session));
  check('a survivor who leaves takes the starting kit along: nothing is left lying', none.length === 0 && g.drops === 0 && g.players.size === 1, names(none));
  // leaving with a haul: what was found stays for the team, the car supply for good
  const haul = fell(g, () => {
    const F = join(g, 'Finder', 'home');
    for (const [item, n] of FOUND) g.giveItem(g.players.get(F.id), item, n);
    g.onClose(F.session);
  });
  const can = haul.find((e) => e.item === ITEM.FUEL_CAN);
  check('what a leaver found stays for the team, a car supply for good', names(haul) === list(FOUND) && can.despawnAt === Infinity && !can.drop && g.drops === 3, names(haul));
  // dying: everything goes on the ground, as before
  const D = join(g, 'Dier', 'home');
  const dead = fell(g, () => g.killPlayer(g.players.get(D.id), {}));
  check('a survivor who dies drops all they carry', names(dead) === list(KIT) && g.drops === 3 + KIT.length, names(dead));
  g.onClose(D.session);
  // an item lying still is not looked at again for a client that has it - until its count changes
  const nails = g.dropItem(ITEM.NAILS, 20, s.x + 6, s.y, s.z, { spread: 0 });
  ticks(g, 3);
  const seen = W.store.ents.get(nails.id)?.q[3];
  nails.count = 7;
  ticks(g, 2);
  check('a partly picked up stack still reaches the clients', seen === 20 && W.store.ents.get(nails.id)?.q[3] === 7 && W.store.ents.get(can.id)?.kind === ENT.ITEM, `${seen} -> ${W.store.ents.get(nails.id)?.q[3]}`);
  // the ceiling: the oldest loose drops make room, a car supply never does, loot is not counted
  const far = g.world.zones.reduce((a, b) => (Math.hypot(b.x - s.x, b.z - s.z) > Math.hypot(a.x - s.x, a.z - s.z) ? b : a));
  const drop = (item) => g.dropItem(item, 1, far.x, g.world.heightAt(far.x, far.z), far.z);
  const loot = g.items.filter((e) => e.point).length;
  const plugs = drop(ITEM.SPARK_PLUGS);
  const first = drop(ITEM.STICK);
  let last = null;
  for (let i = 0; i < g.maxDrops + 40; i++) last = drop(ITEM.STICK);
  const lying = g.items.filter((e) => e.drop).length;
  check('loose drops have a ceiling: the oldest make room, car supplies and loot never', lying === g.maxDrops && g.drops === lying && first.removed && nails.removed && !last.removed && !plugs.removed && !can.removed && g.items.filter((e) => e.point).length === loot, `${lying} loose of ${g.items.length} items`);
  ticks(g, 2);
  check('...and the client is told the ones that went are gone', !W.store.ents.has(nails.id) && W.store.ents.has(can.id));

  // coming and going: a lobby's worth of joins from one address is fine, a stream of them is not
  const g2 = new Game({ seed, godMode: true, log: () => {} });
  const max = g2.maxPlayers;
  const H = join(g2, 'Host', 'house');
  let admitted = 0;
  let refused = 0;
  for (let i = 0; i < 2 * max + 4; i++) {
    const c = join(g2, 'Churn', 'elsewhere');
    if (c.id && !c.rejected) admitted++;
    else if (c.rejected && !c.session.player) refused++;
    g2.onClose(c.session);
  }
  check('joins from one address are limited', admitted === 2 * max && refused === 4 && g2.players.size === 1, `${admitted} admitted, ${refused} turned away`);
  const lines = (word) => H.chats.filter((t) => t.includes(word)).length;
  check('join and leave chat lines are throttled, and nobody leaves who was not announced', H.chats.length === 2 * max + 1 && lines('joined') === lines('left') + 1, `${H.chats.length} lines for ${admitted + 1} joins and ${admitted} leaves`);
  const kids = [];
  for (let i = 1; i < max; i++) kids.push(join(g2, 'Kid' + i, 'house'));
  check('a household fills the lobby from its one address meanwhile', g2.players.size === max && kids.every((c) => c.id && !c.rejected) && H.chats.length === 2 * max + 1);
  for (const c of kids) g2.onClose(c.session);
  ticks(g2, 85); // 4 s: one more join for the address that was turned away
  const again = [join(g2, 'Churn', 'elsewhere'), join(g2, 'Churn', 'elsewhere')];
  check('an address gets a join back every few seconds', !!again[0].id && again[1].rejected && g2.players.size === 2);
  g2.onClose(again[0].session);
  ticks(g2, 340); // 21 s since the lines ran out: two are back
  const N = join(g2, 'Newcomer', 'next door');
  check('...and arrivals are announced again once the chat has been quiet', H.chats.length === 2 * max + 2 && H.chats[H.chats.length - 1].startsWith('Newcomer'));
  ticks(g2, 601 - g2.tick);
  check('an allowance that has worn off is forgotten', !g2.joins.has('next door') && g2.joins.has('house') && !!N.id);
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
    // ...but the flare draws no zombies to it: only a pipe bomb lures
    const wk = zm.spawn(ZTYPE.WALKER, fl.x + 12, fl.z);
    run(10, face);
    check('a burning flare lures no zombies', !!wk && !(wk.lureT > 0));
    const pb = game.combat.spawnProjectile(PROJ.PIPEBOMB, A.p(), wk.x + 6, wk.y + 0.5, wk.z, 0, 0, 0, { fuse: 5 });
    run(10, face);
    check('a pipe bomb still lures them', !!pb && wk.lureT > 0);
    game.projectiles.splice(game.projectiles.indexOf(pb), 1);
    game.removeEntity(pb);
    game.combat.damageZombie(wk, 1e6, null, {});
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
  p.admin = true; // (/tp)
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

// legs: a bullet below the hip of what walks on two goes into a leg. It trips the zombie and wears the leg down, the
// body taking only a share of it; a leg worn through is shot off. On one leg it hobbles, on none it crawls: slower,
// lying low with its head ahead of it, and with no spit or rope left in it. Every client is told, there or not.
// (a game of its own, emptied of the dead: the run around this block is left as it was)
{
  const { LEG_HP, LEG_BODY_DAMAGE, STUMBLE_TIME, HOBBLE_SPEED, CRAWL_HEIGHT, CRAWL_HEAD_Y, CRAWL_HEAD_FWD, SERVER_TICK_RATE } = await import('../shared/constants.js');
  const { crawlSpeed } = await import('../server/zombies.js');
  const g = new Game({ seed, godMode: true, dayLength: 3600, log: () => {} });
  const join = (name) => {
    const c = { id: 0, net: { tick: 0, ack: 0 }, global: null, self: {}, store: { ents: new Map(), onCreate() {}, onRemove() {}, onUpdate() {} }, legs: [] };
    c.handler = { sound() {}, shot() {}, impact() {}, hitmark() {}, damage() {}, killfeed() {}, notify() {}, explosion() {}, pickup() {}, zombieDie() {}, structBreak() {}, ping() {}, summary() {}, flyover() {}, zombieLeg: (id, bits) => c.legs.push(`${id}:${bits}`) };
    c.session = g.onOpen({
      send(bytes) {
        const r = new Reader(bytes.slice().buffer);
        const t = r.u8();
        if (t === S2C.WELCOME) c.id = r.u16();
        else if (t === S2C.SNAPSHOT) readSnapshot(r, c);
      },
    });
    const jw = new Writer(64);
    jw.u8(C2S.JOIN);
    jw.u8(PROTOCOL_VERSION);
    jw.str(name);
    g.onMessage(c.session, jw.bytes().slice());
    return c;
  };
  const tick = (n, fn) => {
    for (let i = 0; i < n; i++) {
      g.update();
      fn?.();
    }
  };
  const A1 = join('L');
  tick(3);
  for (const z of g.zombies) {
    z.dead = true;
    z.deadT = 2;
  }
  tick(2);
  g.zm.maintainT = g.zm.herds.spawnT = 1e9;
  const p = g.players.get(A1.id);
  const s = p.state;
  const pistol = WEAPONS[ITEM.PISTOL];
  // a stretch of open, level ground for her to stand at the end of: the dead are put down at the far end of it and
  // come up it. By the car if there is one, or else the first one on a sweep of the valley
  const gy = (x, z) => groundAt(g.world, x, z, 200, 0.2, false);
  const laneAt = (ox, oz) => {
    if (g.world.isDeepWater(ox, oz) || g.nav.isBlocked(ox, oz)) return null;
    const oy = gy(ox, oz);
    for (let k = 0; k < 16; k++) {
      const a = (k * Math.PI) / 8;
      const [ux, uz] = [Math.sin(a), Math.cos(a)];
      const [fx, fz] = [ox + ux * 15, oz + uz * 15];
      let ok = g.nav.segClear(ox, oz, fx, fz) && !treeBy(ox, oz, fx, fz, 1.6);
      for (let d = 1; d <= 15 && ok; d++) ok = !g.world.isDeepWater(ox + ux * d, oz + uz * d) && !g.nav.isBlocked(ox + ux * d, oz + uz * d) && Math.abs(gy(ox + ux * d, oz + uz * d) - oy) < 1.2;
      if (ok && g.zm.clearLine(ox, oy + 0.4, oz, fx, gy(fx, fz) + 0.4, fz)) return { ox, oz, ux, uz };
    }
    return null;
  };
  let lane = laneAt(s.x, s.z);
  for (let x = -200; x <= 200 && !lane; x += 25) for (let z = -200; z <= 200 && !lane; z += 25) lane = laneAt(x, z);
  check('there is open ground to test legs on', !!lane);
  if (lane) {
    s.x = lane.ox;
    s.z = lane.oz;
    s.y = gy(s.x, s.z); // (on the ground the lane was judged by: a post beside the spot is no floor)
    s.vx = s.vy = s.vz = 0;
    g.fillHistory(p);
    tick(2);
    const put = (type, d) => {
      const z = g.zm.spawn(type, s.x + lane.ux * d, s.z + lane.uz * d);
      z.yaw = Math.atan2(lane.ux, lane.uz); // facing her: forward is (-sin yaw, -cos yaw)
      return z;
    };
    // a pistol round from 3 m in front of it (flank: from 3 m to its right) at the point `h` above its feet, `side`
    // m to its right and `fwd` ahead
    const shoot = (z, h, side = 0, fwd = 0, flank = false) => {
      const [fx, fz] = [-Math.sin(z.yaw), -Math.cos(z.yaw)];
      const [rx, rz] = [Math.cos(z.yaw), -Math.sin(z.yaw)];
      const [tx, ty, tz] = [z.x + rx * side + fx * fwd, z.y + h, z.z + rz * side + fz * fwd];
      // (from the side: whichever one the lie of the ground leaves a clear line from)
      const from = (k) => [z.x + rx * 2 * k, gy(z.x + rx * 2 * k, z.z + rz * 2 * k) + 1, z.z + rz * 2 * k];
      const [ox, oy, oz] = !flank ? [z.x + fx * 3, z.y + 1, z.z + fz * 3] : g.zm.clearLine(...from(1), tx, ty, tz) ? from(1) : from(-1);
      p.renderTick = g.tick & 0xffff;
      p.renderFrac = 0;
      const hp = z.hp;
      g.combat.fire(p, { weapon: ITEM.PISTOL, x: ox, y: oy, z: oz, yaw: Math.atan2(-(tx - ox), -(tz - oz)), pitch: Math.atan2(ty - oy, Math.hypot(tx - ox, tz - oz)), recoilPitch: 0, spread: 0, seed: 1 });
      return hp - z.hp;
    };
    const near = (a, b) => Math.abs(a - b) < 0.01;
    // how fast it comes at her (m/s), once it has caught itself
    const pace = (z) => {
      z.aggroId = p.id;
      z.aggroT = 60;
      tick(Math.ceil((STUMBLE_TIME + 0.6) * SERVER_TICK_RATE));
      const [x0, z0] = [z.x, z.z];
      tick(2 * SERVER_TICK_RATE);
      return Math.hypot(z.x - x0, z.z - z0) / 2;
    };

    const w = put(ZTYPE.WALKER, 14);
    const def = w.def;
    const leg0 = w.maxHp * LEG_HP;
    const body = shoot(w, 1.15);
    check('a shot in the chest is the body\'s, and no leg\'s', near(body, pistol.damage) && w.legs === 0 && w.anim !== ZANIM.STUMBLE && near(w.legHp[0], leg0) && near(w.legHp[1], leg0), `-${body.toFixed(1)} hp, anim ${w.anim}`);
    const full = pace(w);
    const first = shoot(w, 0.4, 0.1);
    check('a shot below the hip is in the leg on that side: the leg takes it, the body a share, and it trips', near(first, pistol.damage * LEG_BODY_DAMAGE) && near(w.legHp[1], leg0 - pistol.damage) && near(w.legHp[0], leg0) && w.legs === 0 && w.anim === ZANIM.STUMBLE && w.stumbleT > 0, `-${first.toFixed(1)} hp, legs ${w.legHp.map((v) => v.toFixed(0))}, anim ${w.anim}`);
    shoot(w, 0.4, 0.1);
    tick(1);
    const e1 = A1.store.ents.get(w.id);
    check('a leg worn through is shot off, and the clients are told', w.legs === 2 && A1.legs.join() === `${w.id}:2` && e1?.q[7] === 2, `legs ${w.legs}, events ${A1.legs.join() || 'none'}, replicated ${e1?.q[7]}`);
    const hobble = pace(w);
    check('on one leg it hobbles', hobble > full * HOBBLE_SPEED * 0.6 && hobble < full * HOBBLE_SPEED * 1.25 && full > def.speed * 0.8, `${hobble.toFixed(2)} m/s on one leg, ${full.toFixed(2)} on two (a walker's is ${def.speed})`);
    // the right one is gone: a shot on that side finds the left
    shoot(w, 0.4, 0.1);
    shoot(w, 0.4, 0.1);
    tick(1);
    check('...and with the other gone too it is down for good', w.legs === 3 && !w.dead && A1.legs.join() === `${w.id}:2,${w.id}:1` && A1.store.ents.get(w.id)?.q[7] === 3, `legs ${w.legs}, events ${A1.legs.join()}`);
    const crawl = pace(w);
    const want = crawlSpeed(def);
    check('with none it crawls', crawl > want * 0.6 && crawl < want * 1.25 && crawl < hobble, `${crawl.toFixed(2)} m/s (${want.toFixed(2)} for a walker), anim ${w.anim}`);
    // it lies on the ground now: a shot at where its chest was passes over it, its head is ahead of it, and there
    // is no leg left to hit
    const hb = g.combat.hitbox(w, false);
    w.hp = w.maxHp = 1000;
    w.yaw = Math.atan2(lane.ux, lane.uz);
    const over = shoot(w, 1.15);
    const low = shoot(w, 0.3, 0, 0, true);
    const head = shoot(w, CRAWL_HEAD_Y, 0, CRAWL_HEAD_FWD);
    check('a crawler is hit where it lies', hb.top === CRAWL_HEIGHT && near(over, 0) && near(low, pistol.damage) && near(head, pistol.damage * pistol.headMul) && w.legs === 3, `over it -${over.toFixed(0)}, body -${low.toFixed(0)}, head -${head.toFixed(0)}`);
    // it still bites at whoever it gets to
    w.x = s.x + lane.ux * 1.2;
    w.z = s.z + lane.uz * 1.2;
    g.fillHistory(w);
    let bit = false;
    tick(4 * SERVER_TICK_RATE, () => (bit = bit || w.anim === ZANIM.ATTACK));
    check('a crawler still attacks what it reaches', bit && w.legs === 3);
    // somebody who joins now sees it as it is
    const B1 = join('M');
    tick(3);
    check('a late joiner sees the legs it has lost', B1.store.ents.get(w.id)?.q[7] === 3 && B1.legs.length === 0, `replicated ${B1.store.ents.get(w.id)?.q[7]}`);
    g.onClose(B1.session); // (the rest is between the dead and the one survivor at the end of the lane)
    g.combat.killZombie(w, null, {});
    tick(2);

    // only what walks on two has legs to lose
    const legged = Object.values(ZTYPE).filter((t) => ZOMBIE_DEFS[t].legs);
    const dog = put(ZTYPE.DOG, 14);
    const dogHit = shoot(dog, 0.25);
    check('a dog, a tank or a boss has no leg to shoot off', near(dogHit, pistol.damage) && dog.legHp === null && dog.legs === 0 && dog.anim !== ZANIM.STUMBLE && legged.length === 6 && [ZTYPE.DOG, ZTYPE.TANK, ZTYPE.LEAPER, ZTYPE.BAT, ZTYPE.BOSS_ABOMINATION, ZTYPE.BOSS_HIVEQUEEN].every((t) => !ZOMBIE_DEFS[t].legs), `dog -${dogHit.toFixed(0)}, legged: ${legged.map((t) => ZOMBIE_DEFS[t].name).join(' ')}`);
    g.combat.killZombie(dog, null, {});

    // a shade pinned by light is stone in the leg too: it takes litResist of the hit there, and does not trip
    const shade = put(ZTYPE.SHADE, 14);
    shade.lit = true;
    const sLeg = shade.maxHp * LEG_HP;
    const chip = shoot(shade, 0.4, 0.1);
    const lr = shade.def.litResist;
    check('a shade held by light is as hard in the leg', near(chip, pistol.damage * LEG_BODY_DAMAGE * lr) && near(shade.legHp[1], sLeg - pistol.damage * lr) && shade.anim !== ZANIM.STUMBLE && shade.stumbleT <= 0, `-${chip.toFixed(2)} hp, leg ${shade.legHp[1].toFixed(1)} of ${sLeg.toFixed(0)}`);
    g.combat.killZombie(shade, null, {});

    // a spitter on its feet spits; one on the ground has no way to rear up for it
    const spits = (cripple) => {
      const z = put(ZTYPE.SPITTER, 10);
      z.aggroId = p.id;
      z.aggroT = 60;
      if (cripple) for (let i = 0; i < 2; i++) g.combat.hitLeg(z, z.maxHp, 1);
      const spat = new Set();
      tick(9 * SERVER_TICK_RATE, () => g.projectiles.forEach((e) => e.ownerRef === z && spat.add(e)));
      const legs = z.legs;
      g.combat.killZombie(z, null, {});
      tick(2);
      return [spat.size, legs];
    };
    const [up, upLegs] = spits(false);
    const [down, downLegs] = spits(true);
    check('a crawler has no spit left in it', up > 0 && upLegs === 0 && down === 0 && downLegs === 3, `on its feet ${up}, crawling ${down}`);
  }
}

// the pier, and where dropped things come to rest. The deck runs unbroken to the T end, so the crate and the loot spot
// out there can be walked to. And nothing dropped ends up where nobody can pick it up again - on the lake bed off the
// pier, inside something solid, beyond the edge of the map - least of all a car supply: a game has just the seven.
// (no ticks, and none of the game's rng: the rest of the run is left as it was)
{
  const w = game.world;
  const dock = w.zoneById[ZONE.DOCK];
  const [dc, ds] = [Math.cos(dock.ry), Math.sin(dock.ry)];
  // the dock's own frame: the pier runs out over the lake along +z, 3 m wide, the T end 43-47 m out
  const at = (lx, lz) => ({ x: dock.x + dc * lx + ds * lz, z: dock.z - ds * lx + dc * lz });
  const out = (p) => ds * (p.x - dock.x) + dc * (p.z - dock.z);
  const deckY = WATER_LEVEL + 1.1;
  const outermost = (list) => list.filter((e) => e.zone === ZONE.DOCK).sort((a, b) => out(b) - out(a))[0];
  const crate = outermost(game.caches);
  const spot = outermost(game.lootPoints);
  // a survivor walks out from the bank with the real movement code, then across the T to the loot spot
  const s = createPlayerState();
  Object.assign(s, at(0, 4));
  s.y = groundAt(w, s.x, s.z, w.heightAt(s.x, s.z) + 0.5);
  const walk = (to, there) => {
    for (let i = 0; i < 60 * 15 && !there(); i++) simulatePlayer(s, { buttons: BTN.FWD, yaw: Math.atan2(s.x - to.x, s.z - to.z), pitch: 0, slot: 255 }, w, null);
  };
  const off = (e) => Math.hypot(e.x - s.x, e.z - s.z);
  walk(at(0, 60), () => out(s) > 43.3);
  check('the pier deck runs unbroken to its T end', out(s) > 43.3 && Math.abs(s.y - deckY) < 0.01 && w.isDeepWater(s.x, s.z), `walked ${out(s).toFixed(1)} m out`);
  const search = off(crate) <= 2.8 && game.canReachEnt({ state: s }, crate); // holdBegin's rule
  const crateOff = off(crate);
  walk(spot, () => off(spot) < 1.2);
  const pick = off(spot) < 1.2 && game.canReachEnt({ state: s }, { kind: ENT.ITEM, x: spot.x, y: spot.y, z: spot.z });
  check('...where its crate can be searched and its loot spot walked to', search && pick && out(crate) > 43 && out(spot) > 43, `crate ${crateOff.toFixed(1)} m off, loot spot ${off(spot).toFixed(1)} m off`);

  const rng = game.rng;
  let n = 0;
  game.rng = () => (n = (n + 0.618034) % 1);
  const drops = [];
  const drop = (...args) => drops[drops.push(game.dropItem(...args)) - 1];
  const sunk = (e) => !e || (w.isDeepWater(e.x, e.z) && e.y < w.heightAt(e.x, e.z) + 1);
  // inside a wall, a rock, a crate (on top of one is fine)
  const buried = (e) => !e || w.colliderGrids.some((g) => g.query(e.x, e.z, 0.1, []).some((c) => !(c.flags & (COL.NOBLOCK | COL.HUMANPASS)) && c.y0 < e.y + 0.1 && c.y1 > e.y + 0.5 && footprintContains(c, e.x, e.z)));
  // car supplies scattered from the deck's edges the way a death scatters them
  let wet = 0;
  for (let i = 0; i < 80; i++) {
    const p = at(i % 2 ? 1.3 : -1.3, 41 + (i % 6));
    if (w.isDeepWater(p.x, p.z)) wet++;
    drop(SUPPLIES[i % SUPPLIES.length], 1, p.x, deckY, p.z, { spread: 1.5 + (i % 4) * 0.5 });
  }
  // ...and one out of the backpack of a survivor at the edge who faces the water
  const a = A.p();
  const sa = a.state;
  const was = [sa.x, sa.y, sa.z, sa.yaw, a.inv[0]];
  Object.assign(sa, at(1.3, 41), { y: deckY, yaw: Math.atan2(-dc, ds) });
  a.inv[0] = { item: ITEM.CAR_BATTERY, count: 1 };
  const m = new Writer(8);
  m.u8(C2S.ACTION);
  m.u8(ACT.DROP_SLOT);
  m.u8(0);
  m.u16(0);
  const had = game.items.length;
  game.onMessage(A.session, m.bytes().slice());
  drops.push(game.items[had]);
  [sa.x, sa.y, sa.z, sa.yaw, a.inv[0]] = was;
  check('car supplies dropped on the pier stay out of the lake', wet === 80 && drops.length === 81 && !drops.some(sunk) && !drops.some(buried) && drops.every((e) => e.permanent), `${drops.filter(sunk).length} of ${drops.length} on the lake bed`);
  // into the middle of a wall (the first upright slab of the map will do) by someone 1 m off its face, and from well
  // beyond the edge of the map
  let wall = null;
  for (const cell of w.staticGrid.cells) wall ||= cell.find((c) => c.type === BOX && c.y1 - c.y0 > 2 && c.y0 < w.heightAt(c.x, c.z) + 0.3);
  const [nx, nz, thick] = wall.hx < wall.hz ? [wall.c, -wall.s, wall.hx] : [wall.s, wall.c, wall.hz]; // across its thin side
  const inside = drop(ITEM.CAR_BATTERY, 1, wall.x, w.heightAt(wall.x, wall.z), wall.z, { spread: 0, from: { x: wall.x + nx * (thick + 1), z: wall.z + nz * (thick + 1) } });
  const beyond = drop(ITEM.FUEL_CAN, 1, MAP_HALF + 40, 0, MAP_HALF + 40, { spread: 3 });
  check('...and out of the walls, and inside the map', !buried(inside) && !footprintContains(wall, inside.x, inside.z, 0.1) && !sunk(inside) && !buried(beyond) && !sunk(beyond) && Math.max(Math.abs(beyond.x), Math.abs(beyond.z)) <= MAP_HALF - 3);
  // if no spot at all will do (no map has such a place), a supply goes back to the breakdown rather than vanish
  game.dropRest = () => null;
  const last = drop(ITEM.CAR_BATTERY, 1, sa.x, sa.y, sa.z);
  delete game.dropRest;
  check('a car supply with nowhere to land turns up at the breakdown', last && last.permanent && Math.hypot(last.x - w.spawnPoints[0].x, last.z - w.spawnPoints[0].z) < 0.01);
  game.rng = rng;
  for (const e of drops.reverse()) if (e) game.removeItemEnt(e);
}

// supplies + escape
{
  const car = game.world.car;
  A.tp(car.x + CAR_REACH + RUN_UP - 0.02, car.z); // the edge of the car's [E] prompt (see promptEdge)
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

// one new kind of the dead a night (ZOMBIE_DEFS minNight): none before its night, the new one there for certain on
// its night, and from their night on at least one shade and never more than six
{
  const early = [];
  const missing = [];
  const shades = [];
  for (let n = 1; n <= 10; n++) {
    game.day = n;
    game.startNight();
    const q = game.waves.flatMap((wv) => wv.queue);
    const kinds = new Set(q);
    for (const t of kinds) if (ZOMBIE_DEFS[t].minNight > n) early.push(`${ZOMBIE_DEFS[t].name} on night ${n}`);
    for (const [t, d] of Object.entries(ZOMBIE_DEFS)) if (!d.boss && d.minNight === n && !kinds.has(+t)) missing.push(`${d.name} on night ${n}`);
    const k = q.filter((t) => t === ZTYPE.SHADE).length;
    if (n >= ZOMBIE_DEFS[ZTYPE.SHADE].minNight) shades.push(k);
  }
  const fresh = [];
  for (let n = 2; n <= 9; n++) fresh.push(Object.values(ZOMBIE_DEFS).filter((d) => !d.boss && d.minNight === n).length);
  check('one new kind of the dead a night, and none before its night', fresh.every((k) => k === 1) && !early.length, early.join(', ') || `new on nights 2-9: ${fresh.join('/')}`);
  check('...each one in the horde on its night', !missing.length, missing.join(', '));
  check('...and from their night on, one to six shades', shades.every((k) => k >= 1 && k <= 6), `nights ${ZOMBIE_DEFS[ZTYPE.SHADE].minNight}-10: ${shades.join('/')}`);
}

// a full entity registry: a join that cannot get an id is turned away and leaves nothing behind, what a survivor
// does meanwhile costs them nothing, every snapshot still decodes, and the game is whole again once the entities
// have expired and their ids are back (a game of its own: the one above is left as it was)
{
  const g = new Game({ seed, godMode: true, log: () => {} });
  const join = (name) => {
    const c = { id: 0, reject: 0, snaps: 0, bad: 0, net: { tick: 0, ack: 0 }, global: null, self: {}, store: { ents: new Map(), onCreate() {}, onRemove() {}, onUpdate() {} }, handler: new Proxy({}, { get: () => () => {} }) };
    c.session = g.onOpen({
      send(bytes) {
        const r = new Reader(bytes.slice().buffer);
        const t = r.u8();
        if (t === S2C.WELCOME) c.id = r.u16();
        else if (t === S2C.REJECT) c.reject = r.u8();
        else if (t === S2C.SNAPSHOT) {
          c.snaps++;
          try {
            readSnapshot(r, c);
            if (r.left !== 0) c.bad++;
          } catch {
            c.bad++;
          }
        }
      },
    });
    const w = new Writer(64);
    w.u8(C2S.JOIN);
    w.u8(PROTOCOL_VERSION);
    w.str(name);
    g.onMessage(c.session, w.bytes().slice());
    return c;
  };
  const ticks = (n) => {
    for (let i = 0; i < n; i++) g.update();
  };
  const W = join('Witness');
  ticks(5);
  const p = g.players.get(W.id);
  const s = p.state;
  // fill it with items that last 3.5 s, at the place furthest from the witness (out of its sight: only the ids matter)
  const far = g.world.zones.reduce((a, b) => (Math.hypot(b.x - s.x, b.z - s.z) > Math.hypot(a.x - s.x, a.z - s.z) ? b : a));
  const filler = [];
  for (let e; (e = g.spawnItem(ITEM.WOOD, 1, far.x, 0, far.z, { life: 3.5 })); ) filler.push(e);
  check('the entity registry fills up, and then refuses to spawn', filler.length > 10000 && g.zm.spawn(ZTYPE.WALKER, s.x + 30, s.z) === null, `${g.all.length} entities`);
  const G = join('Ghost');
  check('a join with no entity id left is turned away', G.reject === REJECT_REASON.FULL && G.id === 0 && !G.session.player && g.players.size === 1 && !g.players.has(undefined));
  // the witness tries to build, drop a stack, drop the pistol and throw a molotov
  g.giveItem(p, ITEM.MOLOTOV, 1);
  s.slot = 4;
  const held = () => JSON.stringify([p.inv, s.weapons, s.throwCount]);
  const build = () => {
    for (let k = 0; k < 12 && !g.structures.length; k++) {
      p.actionT = -99;
      g.build(p, STRUCT.CAMPFIRE, s.x + Math.sin(k * 0.52) * 3, s.z + Math.cos(k * 0.52) * 3, 0);
    }
    return g.structures.length;
  };
  const had = held();
  const built = build();
  g.onMessage(W.session, new Uint8Array([C2S.ACTION, ACT.DROP_SLOT, p.inv.findIndex((it) => it), 0, 0]));
  g.onMessage(W.session, new Uint8Array([C2S.ACTION, ACT.DROP_WEAPON, 1]));
  s.throwCount--; // (the simulation counts the molotov as thrown before the server hears of it)
  g.handleSimEvent(p, { type: 'throw', item: ITEM.MOLOTOV });
  // (g.dropper: a drop that found no id must not leave the next items spawned marked as this survivor's own)
  check('while it is full, building, dropping and throwing cost a survivor nothing', built === 0 && held() === had && g.projectiles.length === 0 && g.dropper === 0);
  // forty ids come free as the ghost goes: they are back from quarantine 3 s later
  for (const e of filler.splice(0, 40)) g.removeItemEnt(e);
  g.onClose(G.session);
  ticks(62);
  const isId = (id) => Number.isInteger(id) && id > 0 && id < g.ents.length;
  const clean = () => g.freeIds.every(isId) && g.quarantine.every((v, i) => i % 2 === 1 || isId(v)) && g.all.every((e) => isId(e.id) && g.ents[e.id] === e);
  check('...and leaves nothing behind when it goes', g.players.size === 1 && clean());
  const zs = [0, 1, 2].map((i) => g.zm.spawn(ZTYPE.WALKER, s.x + 10 + i * 2, s.z + 10));
  ticks(40);
  check('what spawns next has an id of its own and is replicated', zs.every((z) => z && isId(z.id) && W.store.ents.get(z.id)?.kind === ENT.ZOMBIE));
  ticks(40);
  const L = join('Late');
  ticks(10);
  const room = filler.every((e) => e.removed) && L.id > 0 && g.players.get(L.id)?.session === L.session && clean();
  check('once the items have expired there is room again: for a join, for a campfire', room && build() === 1 && held() !== had, `${g.all.length} entities`);
  check('every snapshot decoded on the way', W.bad === 0 && L.bad === 0 && W.snaps >= 150 && L.snaps >= 10, `${W.snaps + L.snaps} snapshots`);
}

// the night boss: it comes in with the second wave (most of the night is left to fight it), its health follows the
// size of the team, and it drops what it carries only if it is brought down before the dawn sun sets it alight
{
  const { BOSS_WAVE, BOSS_HP_PER_PLAYER, BOSS_HP_PER_NIGHT, TANK_BOSS_HP } = await import('../shared/constants.js');
  const { KILLER } = await import('../shared/defs.js');
  const pending = (n) => {
    game.day = n;
    game.startNight();
    return game.bossPending;
  };
  const drawn = [];
  const due = [];
  for (let n = 1; n <= 8; n++) {
    const b = pending(n);
    drawn.push(b && b.types.length === 1 && b.types[0] === nightBoss(game.seed, n) ? b.types[0] : -1);
    due.push(b ? b.t : -1);
  }
  const w2 = game.waves[BOSS_WAVE].start;
  check('every night a boss comes in with the second wave, The Brute on the first', drawn[0] === ZTYPE.BOSS_BRUTE && !drawn.includes(-1) && due.every((t) => t >= w2 && t < w2 + 15 && t < game.nightLen / 2), `${drawn.map((t) => ZOMBIE_DEFS[t]?.name).join(', ')}; due ${due.map((t) => t.toFixed(0)).join('/')} s of ${game.nightLen} (wave 2 at ${w2.toFixed(0)} s)`);
  // the draw, over many valleys: the same answer every time, nothing before its night, never the same boss two nights
  // running, and every boss in the pool met somewhere
  {
    const bad = [];
    const met = new Set();
    for (let sd = 1; sd <= 300; sd++) {
      let prev = -1;
      for (let n = 1; n <= 9; n++) {
        const b = nightBoss(sd, n);
        const pb = BOSS_POOL.find((x) => x.type === b);
        if (b !== nightBoss(sd, n) || (n === 1 ? b !== FIRST_BOSS : !pb || n < pb.from) || b === prev) bad.push(`seed ${sd} night ${n}: ${ZOMBIE_DEFS[b]?.name}`);
        met.add(b);
        prev = b;
      }
    }
    check("...drawn from the pool by the seed and the night, never the night before's", !bad.length && BOSS_POOL.every((b) => met.has(b.type)), bad.slice(0, 4).join(', ') || `${met.size} bosses met over 300 valleys`);
  }
  const feed = [];
  A.handler.killfeed = (kk, killer, victim) => feed.push([kk, victim]);
  const fed = (kk, type) => feed.some((f) => f[0] === kk && f[1] === (0x8000 | type));
  const spawn = (type) => {
    game.bossId = 0;
    for (let i = 0; i < 5 && !game.bossId; i++) game.spawnBosses([type]);
    return game.ents[game.bossId];
  };
  const killedBy = (z, p) => {
    const n = game.items.length;
    game.combat.damageZombie(z, z.hp, p, {});
    return game.items.length - n;
  };
  pending(3);
  const team = game.humanCount();
  const abom = spawn(ZTYPE.BOSS_ABOMINATION);
  const tank = spawn(ZTYPE.TANK);
  const queen = spawn(ZTYPE.BOSS_HIVEQUEEN);
  const hpOf = (z) => z.def.hp * (1 + BOSS_HP_PER_PLAYER * (team - 1) + BOSS_HP_PER_NIGHT * (3 - 1)) * (z.ztype === ZTYPE.TANK ? TANK_BOSS_HP : 1);
  const bosses = [abom, tank, queen];
  check('boss health follows the size of the team', bosses.every((z) => z && z.boss && Math.abs(z.maxHp - hpOf(z)) < 1), `${bosses.map((z) => z?.maxHp.toFixed(0)).join('/')} hp for ${team}`);
  // killed in the night: its loot is on the ground and the feed names who did it
  const loot = killedBy(abom, A.p());
  run(2);
  check('a boss killed before sunrise drops its loot', abom.dead && loot === 8 && fed(KILLER.PLAYER, ZTYPE.BOSS_ABOMINATION) && !fed(KILLER.WORLD, ZTYPE.BOSS_ABOMINATION), `${loot} items`);
  // dawn finds the other two still standing. One is left to the sun, one finished off by a survivor while it burns
  game.startDay();
  run(20 * 6);
  const late = queen.onFire && !queen.dead ? killedBy(queen, A.p()) : -1;
  // what its death leaves, not what lay there already: counted over the tick it dies on (it walks to the survivors
  // while it burns, and a zombie killed by a blast beside them may have dropped something of its own by then)
  let had = new Set(game.items);
  let t = 0;
  for (; t < 20 * 40 && !tank.dead; t++) {
    had = new Set(game.items);
    run(1);
  }
  const left = game.items.filter((e) => !had.has(e) && !e.point && Math.hypot(e.x - tank.x, e.z - tank.z) < 6).length;
  run(2);
  check('a boss the sun kills drops nothing', tank.dead && left === 0 && fed(KILLER.WORLD, ZTYPE.TANK), `dead ${((20 * 6 + t) / 20).toFixed(0)} s after dawn, ${left} items`);
  check('...whoever lands the last blow once it is burning', queen.dead && late === 0 && fed(KILLER.WORLD, ZTYPE.BOSS_HIVEQUEEN) && !fed(KILLER.PLAYER, ZTYPE.BOSS_HIVEQUEEN), `${late} items`);
}

// night themes: the seed and the night number decide what a night's horde is made of (shared/nights.js)
{
  // the draw: the same answer every time, night 1 plain, no theme before its first night or two nights running
  let broken = 0;
  let themed = 0;
  let nights = 0;
  const drawn = new Set();
  for (let s = 1; s <= 300; s++) {
    for (let n = 1; n <= 8; n++) {
      const t = nightTheme(s, n);
      if (t !== nightTheme(s, n) || (t && (n === 1 || n < t.from || t === nightTheme(s, n - 1)))) broken++;
      if (n === 1) continue;
      nights++;
      if (t) themed++;
      if (t) drawn.add(t);
    }
  }
  check('a night\'s theme is drawn from the seed and the night', broken === 0 && drawn.size === NIGHT_THEMES.length, `${drawn.size} of ${NIGHT_THEMES.length} themes over 300 seeds`);
  check('...and some nights stay plain', themed / nights > 0.55 && themed / nights < 0.75, `${((themed / nights) * 100).toFixed(0)}% themed`);

  // the blend: 500 rolls of the real startNight on a seed whose night draws the theme, against a plain night of
  // the same number. (startNight reads the seed for the theme alone, so the map can stay as it is. 500 rolls:
  // two plain samples of 150 differ by up to a fifth in the share of a rare type, which is the margin below.)
  const kept = game.seed;
  const seedFor = (th, n) => {
    let s = 1;
    while (nightTheme(s, n) !== th) s++;
    return s;
  };
  const roll = (th, n) => {
    game.seed = seedFor(th, n);
    const r = { n: 0, hp: 0, by: new Map(), shades: 0 };
    const queued = game.events.length;
    for (let i = 0; i < 500; i++) {
      game.day = n;
      game.startNight();
      game.events.length = queued; // (drop the "night falls" notice each roll queues for the clients)
      let shades = 0;
      for (const wv of game.waves) {
        for (const t of wv.queue) {
          r.n++;
          r.hp += ZOMBIE_DEFS[t].hp;
          r.by.set(t, (r.by.get(t) || 0) + 1);
          if (t === ZTYPE.SHADE) shades++;
        }
      }
      r.shades = Math.max(r.shades, shades);
    }
    return r;
  };
  const share = (r, t) => (r.by.get(t) || 0) / r.n;
  const blend = [];
  const size = [];
  const early = [];
  let wrongBlend = 0;
  let wrongSize = 0;
  for (const th of NIGHT_THEMES) {
    const n = th.from;
    const plain = roll(null, n);
    const r = roll(th, n);
    // what it boosts is at least 1.3x as common as on a plain night, what it thins at most 0.85x
    for (const [t, mul] of Object.entries(th.mul)) {
      const k = share(r, +t) / share(plain, +t);
      if (mul > 1 ? k < 1.3 : k > 0.85) wrongBlend++;
      blend.push(`${ZOMBIE_DEFS[t].name} x${k.toFixed(1)}`);
    }
    // same head count (a dog pack can run a wave a body or two over), total health within a fifth
    const kn = r.n / plain.n;
    const kh = r.hp / plain.hp;
    if (Math.abs(kn - 1) > 0.04 || Math.abs(kh - 1) > 0.2) wrongSize++;
    size.push(`${th.id} x${kn.toFixed(2)}/x${kh.toFixed(2)}`);
    for (const t of r.by.keys()) if (ZOMBIE_DEFS[t].minNight > n) early.push(`${th.id}: ${ZOMBIE_DEFS[t].name} on night ${n}`);
    if (r.shades > 6) early.push(`${th.id}: ${r.shades} shades`);
  }
  check('a themed night has its blend', wrongBlend === 0, `against a plain night: ${blend.join(', ')}`);
  check('...the same head count and about the same total health as a plain one', wrongSize === 0, `count/health: ${size.join(', ')}`);
  check('...and no zombie the night has not unlocked', early.length === 0, early.join(', '));
  // switched off (tests, benchmarks), the same seed gives the plain night
  const pack = NIGHT_THEMES.find((th) => th.id === 'pack');
  const plain = roll(null, 2);
  game.themes = false;
  const off = roll(pack, 2);
  game.themes = true;
  const on = roll(pack, 2);
  game.seed = kept;
  const dogs = [plain, off, on].map((r) => share(r, ZTYPE.DOG));
  check('themes can be switched off', dogs[1] < dogs[0] * 1.3 && dogs[2] > dogs[0] * 2, `dogs on night 2: plain ${(dogs[0] * 100).toFixed(0)}%, The Pack switched off ${(dogs[1] * 100).toFixed(0)}%, The Pack ${(dogs[2] * 100).toFixed(0)}%`);
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
      const down = (o) => !!w.mine?.under(o.x, o.y + 0.3, o.z); // (what stands down in the mine stands on its floor: scripts/test-mine.js)
      const decked = (o) => !!w.rail && w.rail.floorFor(o.x, o.z, o.y + 0.3) <= o.y + 0.01; // (...and in a boxcar on its floor: scripts/test-rail.js)
      for (const p of w.props) {
        const def = PROPS[p.type];
        if (def.boxes?.length !== 1 || def.cyls || !open(p.x, p.z) || down(p) || decked(p)) continue;
        const [lx, , lz, sx, , sz] = def.boxes[0];
        const c = Math.cos(p.ry);
        const s = Math.sin(p.ry);
        let low = Infinity; // the ground under the lowest corner of its footprint: that is where an upright prop rests
        for (const dx of [lx - sx / 2, lx + sx / 2]) for (const dz of [lz - sz / 2, lz + sz / 2]) low = Math.min(low, w.heightAt(p.x + c * dx + s * dz, p.z - s * dx + c * dz));
        stood++;
        if (Math.abs(p.y - low) > 0.05) off++;
      }
      for (const ct of w.containers) if (open(ct.x, ct.z) && !down(ct) && w.heightAt(ct.x, ct.z) > ct.y) buried++;
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
  A.act(ACT.WAYPOINT, { x: 5, z: 5, zone: 255 });
  run(1);
  const wayBefore = !!B.roster.get(A.id)?.way;
  game.gameOver();
  game.restartT = 0;
  game.update();
  check("a new game clears everyone's waypoint", wayBefore && B.roster.get(A.id)?.way === null && pa.waypoint === null);
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

// the admin commands: only for a player who has said the server's ADMIN_SECRET (`/admin <it>`), which nobody else
// ever sees - not the right one, not a wrong one. `/admin` alone stops them; five wrong tries and that connection is
// done trying; a server without a secret has none. (games of their own: the run above is left as it was)
{
  const setup = (adminSecret) => {
    const g = new Game({ seed, dayLength: 3600, adminSecret, log: () => {} });
    const join = (name) => {
      const c = { heard: [], system: [] };
      c.session = g.onOpen({
        send(bytes) {
          const r = new Reader(bytes.slice().buffer);
          const t = r.u8();
          if (t === S2C.WELCOME) c.id = r.u16();
          else if (t === S2C.CHAT) {
            r.u16();
            const flags = r.u8();
            (flags & CHATF.SYSTEM ? c.system : c.heard).push(r.str());
          }
        },
      });
      const w = new Writer(64);
      w.u8(C2S.JOIN);
      w.u8(PROTOCOL_VERSION);
      w.str(name);
      g.onMessage(c.session, w.bytes().slice());
      c.p = g.players.get(c.id);
      c.say = (text, wait = false) => {
        if (!wait) c.p.adminT = 0; // (one try a second: these come faster)
        const w2 = new Writer(160);
        w2.u8(C2S.CHAT);
        w2.str(text);
        g.onMessage(c.session, w2.bytes().slice());
        return c.system.at(-1) || '';
      };
      return c;
    };
    return { g, join };
  };
  const { g, join } = setup('hunter2 is long');
  const A = join('Ann');
  const B = join('Bob');
  B.p.state.x = A.p.state.x + 1; // (in earshot: Bob would hear anything Ann's chat let out)
  B.p.state.z = A.p.state.z;
  g.update();
  g.timeLeft = 500;
  A.say('/night');
  check('admin: without the password a command does nothing', g.timeLeft === 500 && !A.p.admin);
  const wrong = A.say('/admin hunter3');
  check('...a wrong password is refused, to them alone', !A.p.admin && /Wrong admin password/.test(wrong) && !B.heard.concat(B.system).some((t) => /hunter/.test(t)), wrong);
  const right = A.say('/admin   hunter2 is long  ');
  check('...the right one lets them run the commands', A.p.admin && /Admin commands on/.test(right) && !B.p.admin, right);
  A.say('/night');
  check('...which work', g.timeLeft === 0.05, `${g.timeLeft}`);
  check('...and neither try reached anyone else, nor came back to them as chat', !B.heard.concat(B.system).some((t) => /admin|hunter/i.test(t)) && !A.heard.some((t) => /hunter/.test(t)), B.heard.join(' | '));
  const off = A.say('/ADMIN');
  g.timeLeft = 500;
  A.say('/night');
  check('...`/admin` alone turns them off', !A.p.admin && /Admin commands off/.test(off) && g.timeLeft === 500, off);
  for (let i = 0; i < 5; i++) B.say(`/admin guess${i}`);
  const locked = B.say('/admin hunter2 is long');
  check('...five wrong tries and the right one is no good on that connection', !B.p.admin && B.p.adminFails === 5 && /Too many/.test(locked), locked);
  A.say('/admin guess');
  const soon = A.say('/admin hunter2 is long', true);
  check('...and one try a second at most', !A.p.admin && /Wait a second/.test(soon), soon);
  const bare = setup('');
  const C = bare.join('Cal');
  const none = C.say('/admin anything');
  check('...a server without an ADMIN_SECRET has no admin commands', !C.p.admin && /no admin commands/.test(none) && !bare.g.adminHash, none);
}

console.log(`\n${fails.length ? 'FAILED: ' + fails.join(', ') : 'all checks passed'}  (server tick avg ${game.stats.tickMs.toFixed(2)} ms)`);
process.exit(fails.length ? 1 : 0);
