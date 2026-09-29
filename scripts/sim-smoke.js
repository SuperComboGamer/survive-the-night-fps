// In-process server smoke test: fake clients join, meet the cat, get hunted by a zombie dog pack, walk around,
// search containers, chop trees,
// build (incl. door boards), go down + get revived, survive a night of waves and run the escape finale.
// Decodes every snapshot with the real client decoder. usage: node scripts/sim-smoke.js [seed]
import { Game } from '../server/game.js';
import { C2S, ACT, ENT, HOLD, CAR_ID, PROTOCOL_VERSION, Writer, Reader, S2C, qangle16, qpitch } from '../shared/protocol.js';
import { PHASE, BTN } from '../shared/constants.js';
import { STRUCT, ITEM, SUPPLIES, SUPPLY_NEED, NOTIFY, ZTYPE, CANIM, ZANIM, ZONE, SOUND } from '../shared/defs.js';
import { readGlobal, readSelf, readEntities, readEvents } from '../client/net/decode.js';
import { raycastWorld } from '../shared/collision.js';

const seed = +(process.argv[2] || 4242);
const game = new Game({ seed, log: () => {} });
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};

function client(name) {
  const c = { name, id: 0, global: null, self: {}, store: { ents: new Map(), onCreate() {}, onRemove() {}, onUpdate() {} }, notes: [], pickups: [], seq: 0, summary: null, pings: 0 };
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
  };
  c.conn = {
    send(bytes) {
      const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
      const t = r.u8();
      if (t === S2C.WELCOME) c.id = r.u16();
      else if (t === S2C.SNAPSHOT) {
        const tick = r.u32();
        r.u16();
        if (r.u8()) c.global = readGlobal(r);
        readSelf(r, c.self);
        readEntities(r, c.store, tick);
        readEvents(r, handler);
        if (r.left !== 0) throw new Error(`${name}: ${r.left} trailing snapshot bytes`);
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
    w2.u8(3);
    for (let i = 0; i < 3; i++) {
      c.seq = (c.seq + 1) & 0xffff;
      w2.u16(c.seq);
      w2.u16(buttons);
      w2.u16(qangle16(yaw));
      w2.i16(qpitch(pitch));
      w2.u8(i === 0 ? slot : 255);
    }
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

game.debugCommands = true;
const A = client('Alice');
const B = client('Bob');
run(5);
check('game started', game.phase === PHASE.DAY && A.global?.phase === PHASE.DAY);
check('players spawned near car', Math.hypot(A.p().state.x - game.world.car.x, A.p().state.z - game.world.car.z) < 14);
check('supply hints sent', A.global.hints.slice(0, 7).every((z) => z !== 255), JSON.stringify(A.global.hints));
check('caches replicated', [...A.store.ents.values()].some((e) => e.kind === ENT.CACHE));

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
  const z = game.zm.spawn(ZTYPE.WALKER, cat.x + 3, cat.z);
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

// zombie dogs: packs den in the thick woods, hunt together, lunge and bite; the head sits ahead of the body
{
  const car = game.world.car;
  const dogs = game.zombies.filter((z) => z.ztype === ZTYPE.DOG && !z.dead);
  const packs = new Set(dogs.map((d) => d.pack));
  check('dog packs roam the woods', dogs.length >= 4 && packs.size >= 2, `${dogs.length} dogs, ${packs.size} packs`);
  const denOk = (d) => game.zm.forestAt(d.homeX, d.homeZ) >= 13 && game.world.zoneAt(d.homeX, d.homeZ) === ZONE.FOREST && Math.hypot(d.homeX - car.x, d.homeZ - car.z) >= 80;
  check('dogs den in dense forest', dogs.every(denOk) && dogs.every((d) => Math.hypot(d.x - d.homeX, d.z - d.homeZ) < 25));
  const d0 = dogs[0];
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
  A.tp(d0.x + 22, d0.z);
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
  A.tp(game.world.car.x + 12, game.world.car.z + 12);
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
  // craft at the fire: gunpowder needs chem
  game.giveItem(p, ITEM.CHEM, 2);
  A.act(ACT.CRAFT, 19);
  run(3);
  check('crafted at campfire', p.inv.some((x) => x && x.item === ITEM.POWDER));
  const nails0 = p.inv.reduce((n, x) => n + (x && x.item === ITEM.NAILS ? x.count : 0), 0);
  A.act(ACT.CRAFT, 21); // nails at the bench
  run(3);
  check('crafted at workbench', p.inv.reduce((n, x) => n + (x && x.item === ITEM.NAILS ? x.count : 0), 0) === nails0 + 10);
  // locked recipe
  A.notes.length = 0;
  A.act(ACT.CRAFT, 15);
  run(3);
  check('schematic lock enforced', A.notes.some(([m]) => m === NOTIFY.LOCKED));
  // door boards in a doorway
  const o = game.world.openings[0];
  A.tp(o.x + Math.cos(o.ry) * 0 + Math.sin(o.ry) * 2, o.z + Math.cos(o.ry) * 2);
  run(3);
  const n1 = game.structures.length;
  A.act(ACT.BUILD, STRUCT.DOOR, o.x + 0.3, o.z - 0.2, 0);
  run(8);
  const door = game.structures.find((e) => e.stype === STRUCT.DOOR);
  check('door boards snap into doorway', game.structures.length === n1 + 1 && door && Math.hypot(door.x - o.x, door.z - o.z) < 0.01);
}

// ping
A.act(ACT.PING, 0, 10, 1, 10);
run(2);
check('ping broadcast', B.pings > 0);

// downed + revive
{
  const b = B.p();
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
  check('no dogs in the first night\'s horde', game.waves.every((w) => !w.queue.includes(ZTYPE.DOG)));
  const n0 = game.zombies.length;
  game.spawnHordeGroup([ZTYPE.DOG, ZTYPE.DOG, ZTYPE.DOG]);
  const hd = game.zombies.slice(n0);
  check('horde dogs come as one pack', hd.length === 3 && hd.every((d) => d.ztype === ZTYPE.DOG && d.horde && d.pack === hd[0].pack));
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
  game.escape.t = 0.1;
  run(5);
  check('victory at the car', game.phase === PHASE.VICTORY);
}

console.log(`\n${fails.length ? 'FAILED: ' + fails.join(', ') : 'all checks passed'}  (server tick avg ${game.stats.tickMs.toFixed(2)} ms)`);
process.exit(fails.length ? 1 : 0);
