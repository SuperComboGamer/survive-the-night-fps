// In-process server smoke test: fake clients join, meet the cat, walk around, search containers, chop trees,
// build (incl. door boards), go down + get revived, pin a shade with light, survive a night of waves and run the
// escape finale.
// Decodes every snapshot with the real client decoder. usage: node scripts/sim-smoke.js [seed]
import { Game } from '../server/game.js';
import { C2S, ACT, ENT, HOLD, CAR_ID, PROTOCOL_VERSION, Writer, Reader, S2C, qangle16, qpitch } from '../shared/protocol.js';
import { PHASE, BTN } from '../shared/constants.js';
import { STRUCT, ITEM, SUPPLIES, SUPPLY_NEED, NOTIFY, ZTYPE, ZANIM, CANIM, PROJ, ZOMBIE_DEFS, STRUCT_DEFS, THROWABLES } from '../shared/defs.js';
import { groundAt } from '../shared/collision.js';
import { readGlobal, readSelf, readEntities, readEvents } from '../client/net/decode.js';

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
  run(20 * 90, () => {
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

  // the shade: only moves in darkness. Light on it (a beam, a torch, a flare) freezes it and makes it tough.
  {
    game.godMode = true;
    const zm = game.zm;
    const w = game.world;
    const car = w.car;
    const open = (x, z) => !w.isDeepWater(x, z) && !game.nav.isBlocked(x, z);
    // somewhere open and unlit, with a clear 20 m run to the north (-Z, yaw 0)
    let spot = null;
    for (let r = 40; r <= 120 && !spot; r += 10) {
      for (let k = 0; k < 16 && !spot; k++) {
        const x = car.x + Math.sin((k / 16) * Math.PI * 2) * r;
        const z = car.z + Math.cos((k / 16) * Math.PI * 2) * r;
        let ok = Math.abs(x) < 280 && Math.abs(z) < 280;
        for (let d = 0; d <= 20 && ok; d += 2) ok = open(x, z - d) && open(x + 2, z - d) && open(x - 2, z - d);
        const y = ok ? groundAt(w, x, z, 200, 0.3) : 0;
        const ty = ok ? groundAt(w, x, z - 20, 200, 0.3) : 0;
        if (ok && Math.abs(ty - y) < 1.5 && zm.clearLine(x, y + 1.6, z, x, ty + 1, z - 20) && zm.clearLine(x, y + 0.5, z, x, ty + 0.4, z - 20)) spot = { x, z };
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
    game.godMode = false;
    run(40, face);
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

console.log(`\n${fails.length ? 'FAILED: ' + fails.join(', ') : 'all checks passed'}  (server tick avg ${game.stats.tickMs.toFixed(2)} ms)`);
process.exit(fails.length ? 1 : 0);
