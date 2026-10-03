// Clinic test: Mercy Clinic (shared/clinic.js) and the rule that its wards are dark at noon (world.darkAt).
// A place of the random pool, so the valleys are looked for first: the seeds from 1 up that draw it. On each this
// checks that
//   - reception, the pharmacy and everything outside are in daylight, every ward is fully dark, and walking in
//     down the passage the dark comes on with no step in it
//   - the drug locker is the one of the valley, in the dark, and the medicine cabinets are there
//   - by the valley's flow fields the dead get into the deepest ward from the front gate, and out of it again
// and, with a game running on the first of them, that the wards have their dead, that a Shade moves in there by day
// and is pinned in reception, that the sunrise spares what stands in the wards, and what the drug locker gives.
// usage: node scripts/test-clinic.js [seed ...]
import { createWorld } from '../shared/world.js';
import { gatePoint } from '../shared/layout.js';
import { ZONE, ZTYPE, ITEM, CONT, CONT_DEFS } from '../shared/defs.js';
import { groundAt, resolveBody } from '../shared/collision.js';
import { PHASE, SERVER_TICK_RATE, PLAYER_RADIUS } from '../shared/constants.js';
import { Game } from '../server/game.js';
import { Nav } from '../server/nav.js';
import { C2S, S2C, PROTOCOL_VERSION, Writer, Reader } from '../shared/protocol.js';
import { countItem } from '../server/inventory.js';

const WANT = 5; // valleys with the clinic to check
const fails = [];
// (a pass is only printed with VERBOSE=1)
const check = (name, ok, info = '') => {
  if (!ok) fails.push(name);
  if (!ok || process.env.VERBOSE) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  return ok;
};

const worlds = [];
if (process.argv.length > 2) for (const s of process.argv.slice(2)) worlds.push(createWorld(+s));
else for (let seed = 1; seed < 80 && worlds.length < WANT; seed++) {
  const w = createWorld(seed);
  if (w.clinic) worlds.push(w);
}
check('the pool deals Mercy Clinic to some valleys', worlds.length === (process.argv.length > 2 ? process.argv.length - 2 : WANT) && worlds.every((w) => w.clinic), `${worlds.filter((w) => w.clinic).length} found`);

// a point of the clinic's own frame (front: -Z) in the world
const frame = (c) => (lx, lz) => [c.x + Math.cos(c.ry) * lx + Math.sin(c.ry) * lz, c.z - Math.sin(c.ry) * lx + Math.cos(c.ry) * lz];

// Follows the flow field `key` of the valley's grid from (x, z) the way a zombie does (Zombies.updateOne: by the
// field, and where it has no step to offer, pressed against a door jamb, straight at whoever it is after), a
// quarter of a metre at a time, kept off the walls by resolveBody. -> how near it got to (tx, tz)
const _dir = { x: 0, z: 0, cost: 0 };
const NEAR = 1.5; // (a field ends in the cell of what it leads to: a metre square)
function follow(world, nav, key, x, z, y, tx, tz) {
  const pos = { x, y, z };
  let best = Infinity;
  for (let i = 0; i < 1200; i++) {
    const d = Math.hypot(pos.x - tx, pos.z - tz);
    best = Math.min(best, d);
    if (d < NEAR) return d;
    if (!nav.flowDir(key, pos.x, pos.z, _dir, pos.y)) {
      _dir.x = (tx - pos.x) / d;
      _dir.z = (tz - pos.z) / d;
    }
    pos.x += _dir.x * 0.25;
    pos.z += _dir.z * 0.25;
    pos.y = groundAt(world, pos.x, pos.z, pos.y + 0.1, 0.2, false);
    resolveBody(world, pos, 0.38, 1.75, false);
  }
  return best;
}

for (const world of worlds) {
  const c = world.clinic;
  if (!c) continue;
  const tag = `[${world.seed}]`;
  const at = frame(c);
  const dark = (lx, lz, up = 1) => {
    const [x, z] = at(lx, lz);
    return world.darkAt(x, c.y + up, z);
  };

  // ---- where it is dark
  const day = [[4, -6.5], [4, -3], [7, 2], [-5, 2], [-5, -2], [6, 3.6], [-3, 7], [8.4, 7], [0, 24], [-10.5, 16], [10.5, 16]];
  check(`${tag} reception, the pharmacy, the yard and all outside are in daylight`, day.every(([lx, lz]) => dark(lx, lz) === 0), day.filter(([lx, lz]) => dark(lx, lz) > 0).join(' | '));
  const wards = [[6, 11.3], [-5, 11.3], [4.6, 14.6], [8, 21], [-5, 15], [-5, 20], [-8.5, 21.5]];
  check(`${tag} every ward is wholly dark, and so are the dens and the spots the dead shuffle between`, [...wards.map(([lx, lz]) => dark(lx, lz)), ...[...c.dens, ...c.roam].map((d) => world.darkAt(d.x, d.y + 1, d.z))].every((k) => k > 0.97));
  check(`${tag} ...but not the roof over them`, dark(0, 16, 4) === 0 && dark(6, 7, 3.6) === 0);
  let worst = 0;
  let prev = 0;
  let back = false;
  for (let lz = 3; lz <= 12; lz += 0.1) {
    const k = dark(6, lz);
    worst = Math.max(worst, Math.abs(k - prev));
    if (k < prev - 1e-9) back = true;
    prev = k;
  }
  check(`${tag} down the passage the dark comes on steadily: no step in it, and never back towards the light`, worst < 0.04 && !back && prev > 0.97, `largest step ${worst.toFixed(3)} in 10 cm, ${prev.toFixed(2)} at the end`);
  check(`${tag} a map has its dark interiors as a list (world.darks)`, world.darks.length === 2);

  // ---- what is kept there
  const mine = world.containers.filter((o) => o.zone === ZONE.CLINIC);
  const lockers = world.containers.filter((o) => o.ctype === CONT.DRUG_LOCKER);
  const deep = (o) => world.darkAt(o.x, c.y + 1, o.z) > 0.97;
  check(`${tag} the one drug locker of the valley is in the dark`, lockers.length === 1 && deep(lockers[0]));
  const cabinets = mine.filter((o) => o.ctype === CONT.MEDICINE);
  check(`${tag} medicine cabinets in the pharmacy, and one in the wards`, cabinets.filter((o) => !deep(o)).length >= 3 && cabinets.filter(deep).length >= 1, `${cabinets.length} of them`);
  check(`${tag} a supply can be hidden in daylight or in the dark`, world.partSpots.filter((o) => o.zone === ZONE.CLINIC && deep(o)).length === 1 && world.partSpots.filter((o) => o.zone === ZONE.CLINIC && !deep(o)).length === 1);
  check(`${tag} the lining of the wards is not left in the static world`, c.lining.length > 20 && !world.parts.some((p) => ['wall', 'floor', 'ceil', 'board'].includes(p.mat)));

  // ---- the dead find their way in and out
  const nav = new Nav(world);
  const zn = world.zoneById[ZONE.CLINIC];
  const gate = gatePoint(zn, 'f');
  const lair = at(-4.4, 19.6); // the isolation ward
  nav.computeField('in', lair[0], lair[1]);
  const near = follow(world, nav, 'in', gate[0], gate[1], world.heightAt(gate[0], gate[1]), lair[0], lair[1]);
  check(`${tag} from the front gate the flow field leads into the deepest ward`, near < NEAR, `got within ${near.toFixed(1)} m`);
  nav.computeField('out', gate[0], gate[1]);
  const far = follow(world, nav, 'out', lair[0], lair[1], c.y, gate[0], gate[1]);
  check(`${tag} ...and from the deepest ward out to the gate`, far < NEAR, `got within ${far.toFixed(1)} m`);
  let lost = 0;
  for (const d of c.roam) if (follow(world, nav, 'out', d.x, d.z, d.y, gate[0], gate[1]) >= NEAR) lost++;
  check(`${tag} ...from every spot the dead stand at in there`, lost === 0, `${lost} of ${c.roam.length} cannot`);
  let bad = 0;
  for (const d of [...c.dens, ...c.roam, c.ward, c.home]) {
    const pos = { x: d.x, y: d.y, z: d.z };
    if (resolveBody(world, pos, 0.45, 1.8, false) && Math.hypot(pos.x - d.x, pos.z - d.z) > 0.3) bad++;
    if (Math.abs(groundAt(world, d.x, d.z, d.y + 0.2, PLAYER_RADIUS * 0.7) - d.y) > 0.05) bad++;
  }
  check(`${tag} every den and standing spot is a place on the floor to stand`, bad === 0, `${bad} are not`);
}

// ---------------------------------------------------------------- a game on the first of them
if (worlds[0]?.clinic) {
  const seed = worlds[0].seed;
  const game = new Game({ seed, godMode: true, dayLength: 3600, log: () => {} });
  const tag = `[game ${seed}]`;
  const join = (name) => {
    const cl = { id: 0 };
    cl.session = game.onOpen({
      send(bytes) {
        const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
        if (r.u8() === S2C.WELCOME) cl.id = r.u16();
      },
    });
    const w = new Writer(64);
    w.u8(C2S.JOIN);
    w.u8(PROTOCOL_VERSION);
    w.str(name);
    game.onMessage(cl.session, w.bytes().slice());
    cl.p = () => game.players.get(cl.id);
    cl.put = (x, y, z) => {
      const s = cl.p().state;
      [s.x, s.y, s.z, s.vx, s.vy, s.vz, s.onGround] = [x, y, z, 0, 0, 0, 1];
    };
    return cl;
  };
  const A1 = join('Ada');
  const run = (secs, until) => {
    for (let t = 0; t < secs * SERVER_TICK_RATE; t++) {
      game.update();
      if (until?.()) return t / SERVER_TICK_RATE;
    }
    return -1;
  };
  run(0.5);
  const world = game.world;
  const c = world.clinic;
  const at = frame(c);
  const zm = game.zm;
  const inDark = (e) => world.darkAt(e.x, e.y + 1, e.z) > 0.97;
  const living = () => game.zombies.filter((z) => !z.dead);
  const dwellers = () => living().filter((z) => z.ward);
  const clear = () => {
    for (const z of [...game.zombies]) if (!z.dead) game.combat.killZombie(z, null, {});
    run(2);
  };
  const car = () => A1.put(world.car.x, world.heightAt(world.car.x, world.car.z), world.car.z);
  // the survivor onto the clinic's floor at a point of its frame
  const put = (lx, lz) => {
    const [x, z] = at(lx, lz);
    A1.put(x, c.y, z);
  };
  const spawn = (type, lx, lz, opts) => zm.spawn(type, ...at(lx, lz), { y: c.y, ...opts });
  // where something is, in the clinic's own frame
  const where = (e) => [Math.cos(c.ry) * (e.x - c.x) - Math.sin(c.ry) * (e.z - c.z), Math.sin(c.ry) * (e.x - c.x) + Math.cos(c.ry) * (e.z - c.z)].map((v) => v.toFixed(1)).join(', ');

  // ---- the dead live in the wards
  car();
  {
    const d = dwellers();
    check(`${tag} on the first day three of the dead are in the wards, one of them a crawler, and no Shade`, d.length === 3 && d.every(inDark) && d.filter((z) => z.legs === 3).length === 1 && d.every((z) => z.ztype === ZTYPE.WALKER), `${d.length} of them, ${d.filter((z) => z.legs === 3).length} crawling`);
    check(`${tag} ...on the floor, not on the roof`, d.every((z) => Math.abs(z.y - c.y) < 0.3));
    run(90);
    const still = dwellers();
    check(`${tag} left alone for a minute and a half they keep to the dark`, still.length === 3 && still.every(inDark), `${still.filter((z) => !inDark(z)).length} of ${still.length} came out`);
    check(`${tag} ...and have moved about in it`, still.some((z) => Math.hypot(z.x - z.homeX, z.z - z.homeZ) > 1.5));
  }

  // ---- a dweller led out into the day and left there goes back in
  {
    const z = dwellers().find((d) => d.legs !== 3);
    [z.x, z.z] = at(4, -9);
    z.y = groundAt(world, z.x, z.z, 200, 0.2, false);
    z.target = 0;
    const t = run(90, () => inDark(z) && Math.hypot(z.x - c.home.x, z.z - c.home.z) < 2.5);
    check(`${tag} one of them left out on the car park walks back into the wards`, t >= 0, t >= 0 ? `in ${t.toFixed(0)} s` : `it is at ${z.x.toFixed(1)}, ${z.z.toFixed(1)}`);
  }

  // ---- a survivor comes in
  {
    put(4.6, 14.6);
    const s = A1.p().state;
    const t = run(40, () => dwellers().some((z) => z.target === A1.id && Math.hypot(z.x - s.x, z.z - s.z) < 2.2));
    check(`${tag} a survivor in a ward is found by the dead that live there`, t >= 0, t >= 0 ? `after ${t.toFixed(1)} s` : '');
  }

  // ---- in from outside, and out again: a runner on the car park after a survivor in the isolation ward, then one
  // in that ward after a survivor at the front gate
  clear();
  {
    put(-4.4, 19.6);
    const s = A1.p().state;
    const z = zm.spawn(ZTYPE.RUNNER, ...at(-11, -19));
    z.aggroId = A1.id;
    z.aggroT = 600;
    const t = run(40, () => Math.hypot(z.x - s.x, z.z - s.z) < 2.2 && inDark(z));
    check(`${tag} a zombie on the car park comes in through reception and the passage after a survivor in the deepest ward`, t >= 0, t >= 0 ? `in ${t.toFixed(1)} s` : `it is at ${where(z)} in the clinic's frame`);
    clear();
    const gate = gatePoint(world.zoneById[ZONE.CLINIC], 'f');
    A1.put(gate[0], world.heightAt(gate[0], gate[1]), gate[1]);
    const z2 = spawn(ZTYPE.RUNNER, -4.4, 19.6);
    z2.aggroId = A1.id;
    z2.aggroT = 600;
    const t2 = run(40, () => Math.hypot(z2.x - gate[0], z2.z - gate[1]) < 2.2);
    check(`${tag} ...and one in the deepest ward comes out after a survivor at the gate`, t2 >= 0, t2 >= 0 ? `in ${t2.toFixed(1)} s` : `it is at ${where(z2)} in the clinic's frame`);
  }

  // ---- the Shade: the dark of the wards is dark to it, at noon
  clear();
  car();
  {
    check(`${tag} it is day`, game.phase === PHASE.DAY);
    const inWard = spawn(ZTYPE.SHADE, -4.4, 19.6);
    const inHall = spawn(ZTYPE.SHADE, -5, 11.3);
    const inReception = spawn(ZTYPE.SHADE, 6, 0);
    const mouth = spawn(ZTYPE.SHADE, 6, 5.5);
    const outside = zm.spawn(ZTYPE.SHADE, ...at(4, -9));
    run(0.3);
    check(`${tag} by day no light is on a Shade in the wards`, !zm.isLit(inWard) && !zm.isLit(inHall) && !inWard.lit && !inHall.lit);
    check(`${tag} ...the day pins one in reception, at the mouth of the passage and outside`, zm.isLit(inReception) && zm.isLit(mouth) && zm.isLit(outside) && inReception.lit && outside.lit);
    // a flashlight still does what it does: the survivor beside the ward door, the beam on the Shade
    const s = A1.p().state;
    put(-3, 18.4);
    s.yaw = Math.atan2(-(inWard.x - s.x), -(inWard.z - s.z));
    s.pitch = 0;
    A1.p().flashlight = true;
    zm.humansCache = game.humans();
    const beam = zm.isLit(inWard);
    A1.p().flashlight = false;
    check(`${tag} ...and a flashlight beam pins one in the wards as it does at night`, beam && !zm.isLit(inWard));
    // left to itself in the dark it goes for a survivor who comes in, by day
    put(-3, 18.4);
    const t = run(20, () => inWard.target === A1.id && Math.hypot(inWard.x - s.x, inWard.z - s.z) < 2.5);
    check(`${tag} ...unlit, it comes for a survivor in its ward at noon`, t >= 0, t >= 0 ? `in ${t.toFixed(1)} s` : `it is ${Math.hypot(inWard.x - s.x, inWard.z - s.z).toFixed(1)} m off, lit ${inWard.lit}`);
  }

  // ---- sunrise: what stands in the wards is not burnt, and the wards have their dead again
  clear();
  car();
  {
    const inWard = spawn(ZTYPE.WALKER, 5, 14.6, { horde: true });
    const outside = zm.spawn(ZTYPE.WALKER, ...at(8, -24), { horde: true });
    game.phase = PHASE.NIGHT;
    run(0.2);
    game.day = 1;
    game.startDay();
    run(10);
    check(`${tag} at sunrise the horde outside burns, the horde in the wards does not`, outside.dead && !inWard.dead && inWard.burning <= 0 && !inWard.onFire);
    const d = dwellers();
    check(`${tag} ...and the wards have their dead again, with a Shade from the second day`, game.day === 2 && d.length === 4 && d.filter((z) => z.ztype === ZTYPE.SHADE).length === 1 && d.filter((z) => z.legs === 3).length === 1, `day ${game.day}: ${d.length} of them, ${d.filter((z) => z.ztype === ZTYPE.SHADE).length} Shade`);
    [inWard.x, inWard.z] = at(4, -9);
    inWard.y = groundAt(world, inWard.x, inWard.z, 200, 0.2, false);
    run(8);
    check(`${tag} ...until it walks out into the day`, inWard.dead);
    // not topped up under a survivor's eyes
    for (const z of dwellers()) game.combat.killZombie(z, null, {});
    run(2);
    put(-5, 11.3);
    check(`${tag} nothing is put back while a survivor is in the dark`, zm.wards.stock(game.humans()) === 0 && dwellers().length === 0);
    car();
    check(`${tag} ...only once they have left`, zm.wards.stock(game.humans()) === 4 && zm.wards.stock(game.humans()) === 0);
  }

  // ---- the drug locker: medkits, painkillers and bandages for the team, once
  {
    const box = game.caches.find((o) => o.ctype === CONT.DRUG_LOCKER);
    const p = A1.p();
    A1.put(box.x, c.y, box.z);
    p.inv.fill(null);
    game.searchCache(p, box);
    const got = [ITEM.MEDKIT, ITEM.PAINKILLERS, ITEM.BANDAGE].map((item) => countItem(p.inv, item) + game.items.filter((e) => e.item === item && Math.hypot(e.x - box.x, e.z - box.z) < 4).reduce((n, e) => n + e.count, 0));
    check(`${tag} the drug locker holds at least two medkits, three painkillers and four bandages`, got[0] >= 2 && got[1] >= 3 && got[2] >= 4, `${got.join(' / ')}`);
    car();
    let refilled = 0;
    for (let day = 0; day < 12; day++) {
      game.phase = PHASE.NIGHT;
      game.startDay();
      if (box.state !== 1) refilled++;
    }
    check(`${tag} ...and it is not there again at sunrise`, CONT_DEFS[CONT.DRUG_LOCKER].once && box.state === 1 && refilled === 0, `refilled ${refilled} of 12 mornings`);
  }

  // ---- the admin commands (debugCommand)
  {
    const p = A1.p();
    const s = p.state;
    car();
    game.debugCommand(p, ['clinic']);
    check(`${tag} /clinic puts a survivor at the front door, in daylight`, Math.hypot(s.x - c.door.x, s.z - c.door.z) < 0.1 && world.darkAt(s.x, s.y + 1, s.z) === 0 && Math.abs(s.y - world.heightAt(s.x, s.z)) < 0.3, `at ${where(s)}`);
    game.debugCommand(p, ['clinic', 'ward']);
    check(`${tag} /clinic ward puts them on the floor of a ward, in the dark`, inDark(s) && Math.abs(s.y - c.y) < 0.05, `at ${where(s)}, ${(s.y - c.y).toFixed(2)} m above the floor`);
    // ...and on a valley without the clinic it says so, and moves nobody
    let bare = 1;
    while (createWorld(bare).clinic) bare++;
    const g = new Game({ seed: bare, log: () => {} });
    const said = [];
    g.systemChat = (text) => said.push(text);
    const nobody = { state: { x: 1, y: 2, z: 3 } };
    g.debugCommand(nobody, ['clinic', 'ward']);
    check(`[game ${bare}] /clinic on a valley without one says so`, said.some((t) => /no Mercy Clinic/.test(t)) && nobody.state.x === 1 && nobody.state.z === 3, said.join(' | '));
  }
}
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
