// The generator and its floodlights (server/power.js, shared/power.js), against a real Game in-process and with what
// the server sends decoded as a client does: what they cost, fuel in and the switch, which floodlights a generator
// feeds, the hum and the dead it draws, and the rule the whole thing is for - a Shade walking at a survivor freezes
// when it enters a powered cone, moves again when the generator runs dry, and is not frozen behind a wall inside the
// cone. The yard is laid out on the flattest open strip of the valley, so any seed will do.
// usage: node scripts/test-power.js [seed]
import { Game } from '../server/game.js';
import { C2S, S2C, ACT, ENT, PROTOCOL_VERSION, Writer, Reader } from '../shared/protocol.js';
import { MAP_HALF, PHASE, SLOT_BUILD, SLOT_MELEE, MAX_STRUCTURES, NOISE } from '../shared/constants.js';
import { ITEM, ITEM_DEFS, STRUCT, STRUCT_DEFS, STRUCT_ORDER, ZTYPE, ZANIM, NOTIFY, WEAPONS } from '../shared/defs.js';
import { groundAt, COL } from '../shared/collision.js';
import { readSnapshot } from '../client/net/decode.js';
import { GEN_RANGE, GEN_POUR, GEN_FUEL_UNIT, GEN_TANK, GEN_HUM, GEN_HUM_EVERY, GEN_STEP, FLOOD_RANGE, FLOOD_HALF, genState, genOn, genFuel, genRunning, genPour, floodAim, inFloodCone } from '../shared/power.js';

const seed = +(process.argv[2] || 4242);
const game = new Game({ seed, godMode: true, dayLength: 36000, nightLength: 36000, themes: false, log: () => {} });
const world = game.world;
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};

// ---------------------------------------------------------------- a client, as far as this needs one
const A = { id: 0, net: { tick: 0, ack: 0 }, global: null, self: {}, store: { ents: new Map(), onCreate() {}, onRemove() {}, onUpdate() {} }, notes: [] };
A.handler = new Proxy({ notify: (m, a) => A.notes.push([m, a]) }, { get: (t, k) => t[k] || (() => {}) });
A.conn = {
  send(bytes) {
    const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
    const t = r.u8();
    if (t === S2C.WELCOME) A.id = r.u16();
    else if (t === S2C.SNAPSHOT) readSnapshot(r, A);
  },
};
A.session = game.onOpen(A.conn);
{
  const w = new Writer(64);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str('Alice');
  game.onMessage(A.session, w.bytes().slice());
}
const p = game.players.get(A.id);
const s = p.state;
// an action on an entity, as Connection.action writes it (client/net/connection.js)
const act = (a, id) => {
  const w = new Writer(8);
  w.u8(C2S.ACTION);
  w.u8(a);
  w.u16(id);
  game.onMessage(A.session, w.bytes().slice());
};

// ---------------------------------------------------------------- the yard
// The flattest strip of open ground on the map: 50 m long, nothing standing within `clear` m of the lines along it
// (`sides`: how far to the left of its middle each line runs).
function findStrip(sides, clear, step) {
  let best = null;
  const tmp = [];
  for (let x = -MAP_HALF + 70; x <= MAP_HALF - 70; x += step) {
    for (let z = -MAP_HALF + 70; z <= MAP_HALF - 70; z += step) {
      if (Math.hypot(x - world.car.x, z - world.car.z) < 60) continue;
      for (const [ux, uz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        let lo = Infinity;
        let hi = -Infinity;
        let ok = true;
        for (let t = -10; t <= 40 && ok; t += 2) {
          for (const side of sides) {
            const px = x + ux * t - uz * side;
            const pz = z + uz * t + ux * side;
            if (world.isDeepWater(px, pz) || game.nav.isBlocked(px, pz) || world.staticGrid.query(px, pz, clear, tmp).length) ok = false;
            const h = world.heightAt(px, pz);
            lo = Math.min(lo, h);
            hi = Math.max(hi, h);
          }
        }
        if (ok && (!best || hi - lo < best.rise)) best = { x, z, ux, uz, rise: hi - lo };
      }
    }
  }
  return best;
}
// a wide one if the valley has it; a wooded valley may only have room for the yard itself
const yard = findStrip([-8, -4, 0, 4, 8], 3, 12) || findStrip([-4, 0, 4], 3, 8) || findStrip([-2, 0, 3], 2.5, 6);
if (!yard) {
  console.log('FAIL  no open strip of ground on this map to lay the yard out on');
  process.exit(1);
}
const { ux, uz } = yard;
// a spot t metres along the strip and `side` metres to its left
const at = (t, side = 0) => ({ x: yard.x + ux * t - uz * side, z: yard.z + uz * t + ux * side });
const FACING = Math.round((Math.atan2(-ux, -uz) / (Math.PI * 2)) * 256) & 255; // a structure's rot8 that faces along the strip
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

const keep = new Set(); // the zombies of this test: every other one is taken off the map before each tick
const run = (ticks) => {
  for (let i = 0; i < ticks; i++) {
    for (const z of [...game.zombies]) {
      if (keep.has(z)) continue;
      game._listRemove(game.zombies, z);
      game.removeEntity(z);
    }
    game.update();
  }
};
const put = (spot) => {
  s.x = spot.x;
  s.z = spot.z;
  s.y = groundAt(world, s.x, s.z, 200, 0.3);
  s.vx = s.vy = s.vz = 0;
  game.fillHistory(p);
};
// what the survivor carries: the backpack, and the fuel in its own reserve (ammunition is carried apart from the pack)
const pack = (...list) => {
  p.inv.fill(null);
  s.ammo.fill(0);
  let i = 0;
  for (const [item, count] of list) {
    const def = ITEM_DEFS[item];
    if (def.cat === 'ammo') s.ammo[def.ammo] += count;
    else p.inv[i++] = { item, count };
  }
  p.invDirty = true;
};
const has = (item) => (ITEM_DEFS[item].cat === 'ammo' ? s.ammo[ITEM_DEFS[item].ammo] : p.inv.reduce((n, x) => n + (x && x.item === item ? x.count : 0), 0));
const costOf = (type, n = 1) => Object.entries(STRUCT_DEFS[type].cost).map(([k, c]) => [+k, c * n]);
// built by the survivor from 3 m off, with the hammer out (Game.build is what ACT.BUILD calls)
const build = (type, spot, rot8 = FACING) => {
  const before = new Set(game.structures);
  put({ x: spot.x - ux * 3, z: spot.z - uz * 3 });
  s.slot = SLOT_BUILD;
  p.actionT = -1;
  game.build(p, type, spot.x, spot.z, rot8);
  return game.structures.find((e) => !before.has(e)) || null;
};
const move = (z, spot) => {
  z.x = spot.x;
  z.z = spot.z;
  z.y = groundAt(world, z.x, z.z, 200, 0.2, false);
  z.vx = z.vz = z.vy = 0;
  z.lastX = z.x;
  z.lastZ = z.z;
  z.wanderX = z.x;
  z.wanderZ = z.z;
  z.darkT = 1;
  z.lit = false;
  z.target = 0;
  z.targetT = 0;
  z.alertT = 0;
  game.fillHistory(z);
};
const AWAY = -25; // where the survivor stands along the strip to be out of an idle zombie's sight (26 m by day)
const seen = (e) => A.store.ents.get(e.id); // the entity as the client has it

run(3);
console.log(`seed ${seed}: the yard is at ${yard.x} ${yard.z}, heading ${ux} ${uz}, ${yard.rise.toFixed(2)} m of rise along it`);

// ---------------------------------------------------------------- the two structures
{
  check('both are in the build menu, at the end of it', STRUCT_ORDER.slice(-2).join() === [STRUCT.GENERATOR, STRUCT.FLOODLIGHT].join() && STRUCT.GENERATOR === 11 && STRUCT.FLOODLIGHT === 12);
  const g = STRUCT_DEFS[STRUCT.GENERATOR];
  const f = STRUCT_DEFS[STRUCT.FLOODLIGHT];
  check('what the menu says of them is what the rule does', g.desc.includes(`${GEN_RANGE} m`) && g.desc.includes(`${GEN_HUM} m`) && f.desc.includes(`${FLOOD_RANGE} m`) && f.desc.includes(`${GEN_RANGE} m`) && g.fuel === ITEM.AMMO_FUEL, `${g.desc} | ${f.desc}`);
  check('the hum carries a little further than an MP5 and less far than a pistol', GEN_HUM > WEAPONS[ITEM.MP5].noise && GEN_HUM < WEAPONS[ITEM.PISTOL].noise && GEN_HUM < NOISE.GUNSHOT, `hum ${GEN_HUM} m, MP5 ${WEAPONS[ITEM.MP5].noise} m, pistol ${WEAPONS[ITEM.PISTOL].noise} m`);
  check('one pour is a minute, a full tank ten', GEN_POUR * GEN_FUEL_UNIT === 60 && GEN_TANK === 600 && genPour(300, 0) === GEN_POUR && genPour(10, 0) === 10 && genPour(300, GEN_TANK) === 0 && genPour(300, GEN_TANK - 12) === 5 && genPour(300, GEN_TANK - 2) === 0 && genPour(0, 0) === 0);
  const states = [[true, 0], [false, 0], [true, 0.01], [true, 60], [false, 337], [true, GEN_TANK]].map(([on, fuel]) => [on, fuel, genState(on, fuel)]);
  check('the state byte carries the switch and the fuel to within 5 s', states.every(([on, fuel, st]) => st <= 255 && genOn(st) === on && genFuel(st) >= fuel && genFuel(st) - fuel < GEN_STEP && genRunning(st) === (on && fuel > 0)), states.map((x) => x[2]).join(' '));
}

// built: the cost is paid, they count as structures, a new generator has its switch on and a dry tank
pack(...costOf(STRUCT.GENERATOR), ...costOf(STRUCT.FLOODLIGHT, 2), [ITEM.AMMO_FUEL, 40]);
const count0 = game.structures.length;
const gen = build(STRUCT.GENERATOR, at(-3, 3));
const flood = build(STRUCT.FLOODLIGHT, at(0));
const far = build(STRUCT.FLOODLIGHT, at(GEN_RANGE - 3 + 1.5, -3)); // further than GEN_RANGE from the generator, off the middle of the strip
run(2);
check('a generator and two floodlights are built for their cost and count towards the cap', !!gen && !!flood && !!far && game.structures.length === count0 + 3 && MAX_STRUCTURES >= game.structures.length && p.inv.filter(Boolean).length === 0 && has(ITEM.AMMO_FUEL) === 40, p.inv.filter(Boolean).map((x) => `${x.item}x${x.count}`).join(' '));
if (!gen || !flood || !far) {
  console.log('\nnothing to test: the structures could not be built');
  process.exit(1);
}
check('...a new generator stands with its switch on and a dry tank, the floodlights dark', !gen.off && gen.burnLeft === 0 && gen.state === genState(true, 0) && flood.state === 0 && far.state === 0 && game.power.cones.length === 0 && seen(gen)?.q[4] === gen.state && seen(flood)?.q[4] === 0 && seen(gen)?.stype === STRUCT.GENERATOR && seen(flood)?.rot8 === FACING);
check('they block, so the dead that walk into them break them', !(gen.collider.flags & COL.NOBLOCK) && !(flood.collider.flags & COL.NOBLOCK));

// ---------------------------------------------------------------- the hum (by day: the dead see 26 m, so one further off is idle)
const lens = floodAim(flood.x, flood.y, flood.z, flood.rot8, {});
{
  const UP = at(-3 + 33, 3); // 33 m up the strip from the generator: open ground between the two
  const near = game.zm.spawn(ZTYPE.WALKER, UP.x, UP.z);
  const off = game.zm.spawn(ZTYPE.WALKER, at(-3 - 50, 3).x, at(-3 - 50, 3).z);
  keep.add(near).add(off);
  put(at(AWAY, 3));
  run(Math.ceil((GEN_HUM_EVERY + 1) * 20));
  check('a generator with a dry tank makes no noise', game.phase === PHASE.DAY && !near.target && near.alertT <= 0 && off.alertT <= 0, `target ${near.target}/${off.target}, alert ${near.alertT.toFixed(1)}/${off.alertT.toFixed(1)} s`);

  // [E]: a pour out of the backpack
  move(near, UP);
  put(at(-0.2, 3)); // beside the generator
  s.slot = SLOT_MELEE;
  A.notes.length = 0;
  act(ACT.INTERACT, gen.id);
  run(1);
  check('[E] pours 25 units of fuel in: a minute, and it starts', has(ITEM.AMMO_FUEL) === 40 - GEN_POUR && Math.abs(gen.burnLeft - (60 - 0.05)) < 1e-6 && genRunning(gen.state) && game.power.running.includes(gen), `tank ${gen.burnLeft.toFixed(2)} s, ${has(ITEM.AMMO_FUEL)} units kept`);
  check('...which powers the floodlight within 16 m and not the one beyond', flood.state === 1 && far.state === 0 && dist(gen, flood) <= GEN_RANGE && dist(gen, far) > GEN_RANGE && game.power.cones.length === 6, `${dist(gen, flood).toFixed(1)} m and ${dist(gen, far).toFixed(1)} m off`);
  run(1);
  check('...and the client is told: running, the fuel, which lamp has power', genRunning(seen(gen).q[4]) && genFuel(seen(gen).q[4]) === 60 && seen(flood).q[4] === 1 && seen(far).q[4] === 0);
  put(at(AWAY, 3)); // (out of the walkers' sight for as long as they are watched)
  run(Math.ceil((GEN_HUM_EVERY + 1) * 20));
  const drawn = near.alertT > 0 && Math.hypot(near.alertX - gen.x, near.alertZ - gen.z) < 6;
  check('running, it hums: an idle zombie 33 m off heads for it, one 50 m off hears nothing', drawn && !near.target && off.alertT <= 0 && near.alertRush < 0.4, `alert ${near.alertT.toFixed(1)} s, at an amble (${near.alertRush.toFixed(2)})`);
  const x0 = dist(near, gen);
  run(100);
  check('...and walks towards it', dist(near, gen) < x0 - 2.5, `${x0.toFixed(1)} m -> ${dist(near, gen).toFixed(1)} m in 5 s`);

  // the game's own random stream is not drawn from by the hum
  let calls = 0;
  const main = game.rng;
  game.rng = () => (calls++, main());
  near.alertT = 0;
  game.power.hum(gen);
  check('the hum scatters the dead from a stream of its own, not the game\'s', calls === 0 && near.alertT > 0 && game.rng() >= 0 && calls === 1);
  game.rng = main;

  // a pour of what is left, and no fuel at all
  put(at(-0.2, 3));
  const tank = gen.burnLeft;
  act(ACT.INTERACT, gen.id);
  run(4);
  const left = has(ITEM.AMMO_FUEL);
  const poured = gen.burnLeft - (tank - 4 * 0.05);
  act(ACT.INTERACT, gen.id);
  run(4);
  check('a second [E] pours what is left of the fuel carried, a third says there is none', left === 0 && Math.abs(poured - (40 - GEN_POUR) * GEN_FUEL_UNIT) < 1e-6 && A.notes.some(([m, a]) => m === NOTIFY.NOT_ENOUGH && a === ITEM.AMMO_FUEL), `${poured.toFixed(1)} s more in the tank`);

  // the switch (the walker back up the strip, idle, to listen)
  move(near, UP);
  run(6);
  const fuel = gen.burnLeft;
  act(ACT.GEN_SWITCH, gen.id);
  run(2);
  put(at(AWAY, 3));
  move(near, UP);
  run(Math.ceil((GEN_HUM_EVERY + 1) * 20));
  check('[E] held switches it off: the fuel stays in the tank, the light goes, the hum stops', gen.off && gen.burnLeft === fuel && flood.state === 0 && !genOn(seen(gen).q[4]) && genFuel(seen(gen).q[4]) >= fuel && !near.target && near.alertT <= 0, `tank ${gen.burnLeft.toFixed(2)} s`);
  put(at(-0.2, 3));
  act(ACT.GEN_SWITCH, gen.id);
  run(2);
  check('...and on again: it runs on what was left', !gen.off && flood.state === 1 && Math.abs(gen.burnLeft - (fuel - 0.1)) < 1e-6);
  // out of reach, the switch does not answer
  put(at(-3 - 9, 3));
  run(8);
  act(ACT.GEN_SWITCH, gen.id);
  run(2);
  check('...but not from out of reach', !gen.off);
  // a full tank takes no more, and nothing is spilt on the way there
  pack([ITEM.AMMO_FUEL, 300]);
  put(at(-0.2, 3));
  move(near, UP);
  s.slot = SLOT_MELEE;
  const before = gen.burnLeft;
  for (let i = 0; i < 14; i++) {
    act(ACT.INTERACT, gen.id);
    run(4);
  }
  const took = 300 - has(ITEM.AMMO_FUEL);
  const burnt = 14 * 4 * 0.05;
  check('the tank holds ten minutes: a full one takes no more, and none is spilt', gen.burnLeft <= GEN_TANK && gen.burnLeft > GEN_TANK - GEN_FUEL_UNIT - 0.25 && Math.abs(took * GEN_FUEL_UNIT - (gen.burnLeft - before + burnt)) < 1e-6, `tank ${gen.burnLeft.toFixed(1)} s after ${took} units more (it held ${before.toFixed(1)} s)`);

  // the dead break it like anything else that stands in their way (switched off: the hum would call the walker to
  // the generator itself, where it has already arrived)
  keep.delete(near);
  gen.off = true;
  const hp0 = gen.hp;
  move(off, { x: gen.x + ux * 1.4, z: gen.z + uz * 1.4 });
  off.alertX = gen.x - ux * 6;
  off.alertZ = gen.z - uz * 6;
  off.alertT = 30;
  off.alertRush = 1;
  put(at(32, 3));
  run(80);
  check('a zombie walking into the generator hits it', gen.hp < hp0 && !gen.removed, `${hp0} -> ${gen.hp.toFixed(0)} hp`);
  keep.delete(off);
  gen.hp = gen.maxHp;
}

// ---------------------------------------------------------------- the Shade
game.startNight();
game.waves = [];
game.bossPending = null;
put(at(-6));
p.flashlight = false;
const shade = game.zm.spawn(ZTYPE.SHADE, at(34).x, at(34).z, { horde: true });
keep.add(shade);
const toLens = () => Math.hypot(shade.x - lens.x, shade.y + 1 - lens.y, shade.z - lens.z);
{
  // unpowered: dark, and it does nothing
  gen.off = true;
  run(2);
  move(shade, at(34));
  let frozen = 0;
  for (let i = 0; i < 50; i++) {
    run(1);
    if (shade.lit) frozen++;
  }
  check('with the generator off the floodlight is dark: a Shade walks through where its cone would be', flood.state === 0 && frozen === 0 && dist(shade, at(34)) > 12 && inFloodCone(lens, shade.x, shade.y + 1, shade.z), `${dist(shade, at(34)).toFixed(1)} m in 2.5 s`);

  // powered: it freezes as it enters the cone
  gen.off = false;
  gen.burnLeft = 8;
  move(shade, at(34));
  run(1);
  check('(the Shade starts outside the cone, in the dark, on its way to the survivor)', flood.state === 1 && !shade.lit && toLens() > FLOOD_RANGE);
  let ticks = 0;
  while (!shade.lit && ticks++ < 100) run(1);
  const where = toLens();
  const spot = { x: shade.x, z: shade.z };
  check('a Shade walking at a survivor freezes when it enters the powered cone', shade.lit && shade.anim === ZANIM.FROZEN && where <= FLOOD_RANGE + shade.def.radius && where > FLOOD_RANGE - 1.2 && inFloodCone(lens, shade.x, shade.y + 1, shade.z, shade.def.radius), `${where.toFixed(2)} m from the lens after ${(ticks * 0.05).toFixed(2)} s`);
  run(40);
  check('...and stands there for as long as the light is on it', shade.lit && dist(shade, spot) < 0.01 && seen(shade)?.q[4] === ZANIM.FROZEN);

  // the generator runs dry
  A.notes.length = 0;
  ticks = 0;
  while (gen.burnLeft > 0 && ticks++ < 400) run(1);
  const stoodUntilDry = dist(shade, spot) < 0.01;
  run(30);
  check('...and moves again when the generator runs dry', gen.burnLeft === 0 && flood.state === 0 && stoodUntilDry && !shade.lit && dist(shade, spot) > 3 && seen(flood).q[4] === 0 && A.notes.some(([m]) => m === NOTIFY.GEN_OUT), `${dist(shade, spot).toFixed(1)} m on in 1.5 s`);
}
{
  // a wall inside the cone casts a shadow it can move in
  pack(...costOf(STRUCT.WALL));
  move(shade, at(38));
  const wall = build(STRUCT.WALL, at(10));
  put(at(-6));
  gen.burnLeft = 120;
  run(2);
  move(shade, at(14));
  const inCone = inFloodCone(lens, shade.x, shade.y + 1, shade.z);
  const lit = game.zm.isLit(shade);
  run(4);
  const walked = dist(shade, at(14));
  check('behind a wall inside the cone it is not frozen', !!wall && flood.state === 1 && inCone && !lit && !shade.lit && walked > 0.3, `in the cone ${inCone}, lit ${lit}, ${walked.toFixed(2)} m in 0.2 s`);
  let ticks = 0;
  while (!shade.lit && ticks++ < 200) run(1);
  const side = Math.abs((shade.x - yard.x) * -uz + (shade.z - yard.z) * ux);
  check('...until it steps out of the wall\'s shadow into the light', shade.lit && side > 1.4, `${side.toFixed(2)} m to the side of the wall's middle (it is 3 m wide)`);
  // the same spot with the wall gone is lit
  game.destroyStructure(wall, false);
  move(shade, at(14));
  run(3);
  check('...and with the wall gone the same spot is in the light', shade.lit && dist(shade, at(14)) < 0.5);

  // outside the cone, beside the lamp: dark
  move(shade, at(2, 12));
  check('beside the lamp, outside its cone, a Shade is in the dark', !inFloodCone(lens, shade.x, shade.y + 1, shade.z, shade.def.radius) && !game.zm.isLit(shade) && Math.abs(Math.atan2(12, 2 - 0.3)) > FLOOD_HALF);

  // a broken generator drops the lights it fed
  move(shade, at(18));
  run(3);
  const pinned = shade.lit;
  game.damageStructure(gen, 1e6);
  run(6);
  check('a broken generator drops the lights it fed', pinned && gen.removed && flood.state === 0 && !shade.lit && !A.store.ents.has(gen.id) && seen(flood).q[4] === 0);
}

// ---------------------------------------------------------------- /floodlight
{
  p.admin = true; // (the admin chat commands)
  pack();
  game.handleChat(p, '/floodlight');
  const want = { [ITEM.AMMO_FUEL]: GEN_TANK / GEN_FUEL_UNIT };
  for (const [type, n] of [[STRUCT.GENERATOR, 1], [STRUCT.FLOODLIGHT, 2]]) for (const [k, c] of costOf(type, n)) want[k] = (want[k] || 0) + c;
  check('/floodlight gives what a generator, two floodlights and a full tank take', Object.keys(want).every((k) => has(+k) === want[k]), Object.keys(want).map((k) => `${k}x${has(+k)}`).join(' '));

  // taken down with the hammer, a generator gives back what is left in its tank
  const g2 = build(STRUCT.GENERATOR, at(-3, -5));
  s.slot = SLOT_MELEE;
  run(8);
  act(ACT.INTERACT, g2.id);
  run(1);
  const fuel = has(ITEM.AMMO_FUEL);
  const left = g2.burnLeft;
  game.demolish(p, g2.id);
  check('a generator taken down gives back the fuel left in its tank', g2.removed && has(ITEM.AMMO_FUEL) === fuel + Math.floor(left / GEN_FUEL_UNIT), `${left.toFixed(2)} s in the tank, ${has(ITEM.AMMO_FUEL) - fuel} units back`);
}

console.log(fails.length ? `\n${fails.length} FAILED:\n  ${fails.join('\n  ')}` : '\nall power checks passed');
process.exit(fails.length ? 1 : 0);
