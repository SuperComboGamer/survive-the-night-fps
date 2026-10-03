// The night bosses and the day's specials, in-process against a real Game:
//   - The Brute (night 1's boss): plods, and once it is badly hurt stops to roar and comes on at a run; drops its
//     bossLoot, not a full boss's
//   - The Alpha: howls up dogs into its own pack, never past summonMax of them alive, and lunges as a dog does
//   - The Bloater: heaves a fan of bile at whoever is in front of it; dies in a burst that takes the dead around it
//     and what was built beside it - unless the dawn sun burnt it out
//   - by day the further from the car, the more of the specials, and the nastier: none near the car, leapers and
//     ropers only well out (ZombieManager.daySpecial); and never a boss, a Tank, a bat or a shade
// usage: node scripts/test-bosses.js [seed = 1]
import { Game } from '../server/game.js';
import { C2S, S2C, PROTOCOL_VERSION, Writer, Reader, ENT } from '../shared/protocol.js';
import { ZTYPE, ZOMBIE_DEFS, PROJ, STRUCT, STRUCT_DEFS } from '../shared/defs.js';
import { PHASE } from '../shared/constants.js';

const seed = +(process.argv[2] || 1);
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};

const game = new Game({ seed, godMode: true, dayLength: 3600, themes: false, log: () => {} });
const conn = {
  id: 0,
  send(bytes) {
    const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
    if (r.u8() === S2C.WELCOME) conn.id = r.u16();
  },
};
const session = game.onOpen(conn);
{
  const w = new Writer(64);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str('Alice');
  game.onMessage(session, w.bytes().slice());
}
const p = game.players.get(conn.id);
const s = p.state;
const run = (ticks, each) => {
  for (let i = 0; i < ticks; i++) {
    game.update();
    if (each) each(i);
  }
};
const clear = () => {
  for (const z of [...game.zombies]) {
    game._listRemove(game.zombies, z);
    game.removeEntity(z);
  }
};

// an open, flat stretch of road well away from everything: the survivor stands at one end
const spot = (() => {
  const w = game.world;
  for (const c of w.hordeSpawns) {
    let ok = true;
    for (let d = -30; d <= 30 && ok; d += 3) {
      const h = w.heightAt(c.x + d, c.z);
      if (Math.abs(h - w.heightAt(c.x, c.z)) > 1.2 || w.isDeepWater(c.x + d, c.z) || game.nav.isBlocked(c.x + d, c.z)) ok = false;
    }
    if (ok) return c;
  }
  return w.car;
})();
const place = () => {
  s.x = spot.x;
  s.z = spot.z;
  s.y = game.world.heightAt(s.x, s.z);
  s.vx = s.vz = 0;
};
const boss = (type, dx, dz = 0) => game.zm.spawn(type, spot.x + dx, spot.z + dz, { horde: true, boss: true });
game.startNight();
game.bossPending = null;
for (const wv of game.waves) wv.queue.length = 0;
clear();

// ---------------------------------------------------------------- The Brute
{
  place();
  const z = boss(ZTYPE.BOSS_BRUTE, 28);
  const def = ZOMBIE_DEFS[ZTYPE.BOSS_BRUTE];
  const pace = () => {
    const x0 = z.x;
    const z0 = z.z;
    run(20);
    return Math.hypot(z.x - x0, z.z - z0);
  };
  run(10);
  const calm = pace();
  game.combat.damageZombie(z, z.maxHp * (1 - def.enrage) + 5, p, {});
  let roared = false;
  run(30, () => (roared = roared || (z.state === 1 && z.stateAct === 9)));
  z.x = spot.x + 28;
  z.z = spot.z;
  run(4);
  const angry = pace();
  check('The Brute plods, and once badly hurt roars and comes on at a run', roared && z.enraged && calm > 1 && angry > calm * 1.6, `${calm.toFixed(1)} m/s, then ${angry.toFixed(1)} m/s (roared: ${roared})`);
  const before = game.items.length;
  game.combat.damageZombie(z, z.hp + 1, p, {});
  const loot = game.items.length - before;
  check('...and drops its bossLoot, not a full boss\'s', z.dead && loot === def.bossLoot, `${loot} items`);
  clear();
}

// ---------------------------------------------------------------- The Alpha
{
  place();
  const def = ZOMBIE_DEFS[ZTYPE.BOSS_ALPHA];
  const z = boss(ZTYPE.BOSS_ALPHA, 30);
  const pack = () => game.zombies.filter((o) => !o.dead && o !== z && o.pack === z.pack && o.ztype === ZTYPE.DOG).length;
  const counts = [];
  let howls = 0;
  let was = false;
  for (let k = 0; k < 3; k++) {
    z.summonCd = 0;
    z.x = spot.x + 30;
    z.z = spot.z;
    run(30, () => {
      const howling = z.state === 1 && z.stateAct === 10;
      if (howling && !was) howls++;
      was = howling;
    });
    counts.push(pack());
  }
  check('The Alpha howls dogs up into its own pack, never past summonMax', counts[0] === def.summon && counts[1] === Math.min(def.summonMax, 2 * def.summon) && counts[2] === counts[1] && howls === 2, `pack after each howl: ${counts.join('/')} (${howls} howls)`);
  for (const o of [...game.zombies]) if (o !== z) game.combat.damageZombie(o, o.hp + 1, null, {});
  z.x = spot.x + 7;
  z.z = spot.z;
  z.specialCd = 0;
  z.summonCd = 99;
  let lunged = false;
  run(40, () => (lunged = lunged || z.state === 2));
  check('...and lunges at a survivor as a dog does', lunged);
  clear();
}

// ---------------------------------------------------------------- The Bloater
{
  place();
  const def = ZOMBIE_DEFS[ZTYPE.BOSS_BLOATER];
  const z = boss(ZTYPE.BOSS_BLOATER, 10);
  z.specialCd = 0;
  const acid = () => game.projectiles.filter((e) => e.ptype === PROJ.ACID && e.ownerRef === z).length;
  let most = 0;
  run(30, () => (most = Math.max(most, acid())));
  check('The Bloater heaves a fan of bile at whoever is in front of it', most >= 5, `${most} globs`);
  // a barricade beside it and walkers round it: it bursts, and takes them along
  run(60);
  const bx = z.x + 3;
  const bz = z.z;
  const by = game.world.heightAt(bx, bz);
  const wall = { kind: ENT.STRUCTURE, stype: STRUCT.BARRICADE, rot8: 0, x: bx, y: by, z: bz, hp: STRUCT_DEFS[STRUCT.BARRICADE].hp, maxHp: STRUCT_DEFS[STRUCT.BARRICADE].hp, state: 1, owner: p.id, burnLeft: 0, collider: null, trapTick: 0 };
  game.spawnEntity(wall);
  wall.collider = game.structCollider(STRUCT.BARRICADE, bx, by, bz, 0, wall.id);
  game.world.structGrid.add(wall.collider);
  game.nav.addStructure(wall.collider);
  game.structures.push(wall);
  const crowd = [];
  for (let i = 0; i < 4; i++) crowd.push(game.zm.spawn(ZTYPE.WALKER, z.x + Math.sin(i * 1.6) * 3, z.z + Math.cos(i * 1.6) * 3, { horde: true }));
  run(1); // (into the zombie grid the blast looks them up in)
  game.combat.damageZombie(z, z.hp + 1, p, {});
  run(2);
  const dead = crowd.filter((o) => o.dead).length;
  check('...and bursts when it dies: the dead beside it and what was built there go with it', z.dead && dead >= 3 && (wall.removed || wall.hp <= 0 || !game.structures.includes(wall)), `${dead} of 4 walkers, barricade ${game.structures.includes(wall) ? `left at ${wall.hp.toFixed(0)} hp` : 'gone'}`);
  // burnt out by the sun at dawn it only falls
  clear();
  const z2 = boss(ZTYPE.BOSS_BLOATER, 12);
  const near = [];
  for (let i = 0; i < 3; i++) near.push(game.zm.spawn(ZTYPE.WALKER, z2.x + Math.sin(i * 2) * 3, z2.z + Math.cos(i * 2) * 3, { horde: true }));
  run(1);
  z2.onFire = true;
  game.combat.damageZombie(z2, z2.hp + 1, null, {});
  run(2);
  check('...but one the dawn sun burns out only falls', z2.dead && near.every((o) => !o.dead), `${near.filter((o) => o.dead).length} walkers killed`);
  clear();
}

// ---------------------------------------------------------------- the day's specials, by distance from the car
{
  game.phase = PHASE.DAY;
  const car = game.world.car;
  const SPECIAL = new Set([ZTYPE.SPITTER, ZTYPE.BOOMER, ZTYPE.LEAPER, ZTYPE.ROPER]);
  const NEVER = new Set([ZTYPE.TANK, ZTYPE.BAT, ZTYPE.SHADE]);
  const rows = [];
  let never = 0;
  for (let i = 0; i < 1500; i++) {
    const z = game.zm.spawnRoamer([]);
    if (!z) continue;
    rows.push([Math.hypot(z.x - car.x, z.z - car.z), z.ztype]);
    if (z.def.boss || NEVER.has(z.ztype)) never++;
    game._listRemove(game.zombies, z);
    game.removeEntity(z);
  }
  const band = (lo, hi) => {
    const r = rows.filter(([d]) => d >= lo && d < hi);
    return { n: r.length, sp: r.filter(([, t]) => SPECIAL.has(t)).length, leap: r.filter(([, t]) => t === ZTYPE.LEAPER).length, rope: r.filter(([, t]) => t === ZTYPE.ROPER).length };
  };
  const near = band(0, 90);
  const mid = band(90, 200);
  const far = band(260, 1000);
  const share = (b) => (b.n ? b.sp / b.n : 0);
  check('by day no specials near the car, and more of them further out', near.sp === 0 && share(far) > share(mid) && share(far) > 0.2 && never === 0, `under 90 m ${near.sp}/${near.n}, 90-200 m ${(share(mid) * 100).toFixed(0)}% of ${mid.n}, past 260 m ${(share(far) * 100).toFixed(0)}% of ${far.n}; bosses, Tanks, bats, shades: ${never}`);
  const early = rows.filter(([d, t]) => (t === ZTYPE.LEAPER && d < 168) || (t === ZTYPE.ROPER && d < 238)).length;
  check('...leapers and ropers only well out', early === 0 && far.leap > 0 && far.rope > 0, `past 260 m: ${far.leap} leapers, ${far.rope} ropers; too near: ${early}`);
}

if (fails.length) {
  console.log(`\n${fails.length} FAILED: ${fails.join('; ')}`);
  process.exit(1);
}
console.log('\nall boss checks passed');
process.exit(0);
