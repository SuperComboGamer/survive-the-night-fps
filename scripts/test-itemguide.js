// Holds the tooltip lines of client/game/itemguide.js ("Used in", "Found in") against what they are derived from:
// the recipe, structure and loot tables in shared/defs.js, the worlds that roll those tables, and the server's
// gathering. A line that names a source the game does not have, or misses one it has, fails here.
// usage: node scripts/test-itemguide.js
import { Game } from '../server/game.js';
import { createWorld } from '../shared/world.js';
import { COL } from '../shared/collision.js';
import { ITEM, ITEM_DEFS, RECIPES, STRUCT_DEFS, STRUCT_ORDER, SCHEMATICS, SCHEM_BIT, SUPPLIES, ZONE, ZONE_NAMES, LOOT_TABLES, CONT_TABLES, CONT_DEFS, ZOMBIE_LOOT, SPECIAL_LOOT, WEAPONS, AMMO_ITEMS, ZTYPE, BOSS_PACK_CHANCE } from '../shared/defs.js';
import { usedIn, foundIn, sourcesOf, GATHER } from '../client/game/itemguide.js';
import { FIXTURE_USES, RADIO_COST } from '../shared/fixtures.js';
import { DEER_LOOT } from '../shared/deer.js';

const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};
const items = Object.keys(ITEM_DEFS).map(Number);
const nameOf = (item) => ITEM_DEFS[item].name;
const ALL = SCHEMATICS.reduce((mask, s) => mask | (1 << SCHEM_BIT[s]), 0); // every schematic found
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const near = (a, b) => Math.abs(a - b) < 1e-9;

// ---------------------------------------------------------------- found in: the sources are the tables
// What every item should list, built here straight from the tables: source name -> expected count from one visit.
const expected = new Map(items.map((item) => [item, new Map()]));
const expectFrom = (name, table, visits) => {
  const total = table.reduce((sum, row) => sum + row[1], 0);
  for (const [item, weight, min, max] of table) {
    const at = expected.get(item);
    at.set(name, (at.get(name) || 0) + visits * (weight / total) * ((min + max) / 2));
  }
};
const contName = { 'Ammo Crate': 'ammo crates', 'Car Trunk': 'car trunks', 'Duffel Bag': 'duffel bags', Locker: 'lockers', Cabinet: 'cabinets', Toolbox: 'toolboxes', Dumpster: 'dumpsters', 'Log Pile': 'log piles', Fridge: 'fridges', Strongbox: "the mine's strongbox", Casket: 'the casket in the crypt', 'Freight Crate': 'freight crates' };
Object.assign(contName, { 'Medicine Cabinet': 'medicine cabinets', 'Drug Locker': "the clinic's drug locker" }); // (Mercy Clinic's)
for (const d of Object.values(CONT_DEFS)) {
  if (!d.table) continue;
  const name = contName[d.name] || d.name;
  const rolls = (d.rolls[0] + d.rolls[1]) / 2;
  expectFrom(name, CONT_TABLES[d.table], rolls);
  // what is always in it besides the rolls, and the magazines its weapons come with (the strongbox down the mine)
  for (const [item, n] of d.also || []) expected.get(item).set(name, (expected.get(item).get(name) || 0) + n);
  const total = CONT_TABLES[d.table].reduce((sum, row) => sum + row[1], 0);
  for (const [item, weight, min, max] of d.loaded ? CONT_TABLES[d.table] : []) {
    const w = WEAPONS[item];
    if (!w || w.melee) continue;
    const at = expected.get(AMMO_ITEMS[w.ammo]);
    at.set(name, (at.get(name) || 0) + rolls * (weight / total) * ((min + max) / 2) * w.mag * d.loaded);
  }
}
check('every kind of container with a table of its own has a plural the player would recognise', Object.values(CONT_DEFS).every((d) => !d.table || contName[d.name]), Object.values(CONT_DEFS).filter((d) => d.table && !contName[d.name]).map((d) => d.name).join(', '));

// Which place tables are rolled at all is world generation's business: the floor loot of a zone, and its crates and
// shelves (Game.searchCache: a container with no table of its own rolls its zone's, or the roadside one).
const seeds = [12345, 1, 2, 3, 7, 42];
const rolled = new Set();
const bare = [];
for (const seed of seeds) {
  const w = createWorld(seed);
  const here = new Set();
  for (const sp of w.lootSpawns) here.add(LOOT_TABLES[sp.zone] ? sp.zone : ZONE.FOREST);
  if (w.resourceSpawns.length) here.add(ZONE.FOREST);
  for (const c of w.containers) if (!CONT_DEFS[c.ctype].table) here.add(LOOT_TABLES[c.zone] ? c.zone : ZONE.ROADSIDE);
  for (const z of w.zones) if (!here.has(z.id)) bare.push(`${ZONE_NAMES[z.id]} (seed ${seed})`);
  for (const zone of here) rolled.add(zone);
}
check('every place on a map has loot of its own table to find', bare.length === 0, bare.join(', '));
for (const zone of rolled) expectFrom(ZONE_NAMES[zone], LOOT_TABLES[zone], 1);
const places = new Set([...rolled].map((zone) => ZONE_NAMES[zone]));

// zombie drops are checked by membership only (their odds are an average over the kinds of zombie)
const drops = { zombies: ZOMBIE_LOOT, 'special zombies': SPECIAL_LOOT };
for (const name in drops) for (const row of drops[name]) expected.get(row[0]).set(name, null);
for (const g of GATHER) for (const [item, n] of g.gives) expected.get(item).set(g.name, n * g.hits);
// a deer leaves all of its table, every time
for (const [item, min, max] of DEER_LOOT) expected.get(item).set('hunt deer', (min + max) / 2);
// and a boss, besides its loot, a sealed pack of Dead Hand cards now and then (server/cards.js bossDrop)
expected.get(ITEM.SEALED_PACK).set('bosses', BOSS_PACK_CHANCE);

{
  const wrong = [];
  const off = [];
  const order = [];
  for (const item of items) {
    const told = sourcesOf(item);
    const want = expected.get(item);
    if (!sameSet(new Set(told.map((s) => s.name)), new Set(want.keys()))) {
      const names = new Set(told.map((s) => s.name));
      wrong.push(`${nameOf(item)}: missing [${[...want.keys()].filter((n) => !names.has(n))}] extra [${[...names].filter((n) => !want.has(n))}]`);
      continue;
    }
    for (const s of told) {
      if (s.place !== places.has(s.name)) off.push(`${nameOf(item)}: ${s.name} place=${s.place}`);
      if (want.get(s.name) != null && !near(s.n, want.get(s.name))) off.push(`${nameOf(item)}: ${s.name} ${s.n} != ${want.get(s.name)}`);
    }
    // the best two found anywhere, then the places, then the rest - each run best first
    const any = told.filter((s) => !s.place);
    const lead = Math.min(2, any.length);
    const runs = [told.slice(0, lead), told.slice(lead, told.length - (any.length - lead)), told.slice(told.length - (any.length - lead))];
    const sorted = (run) => run.every((s, i) => !i || run[i - 1].n >= s.n);
    if (!runs[0].every((s) => !s.place) || !runs[1].every((s) => s.place) || !runs[2].every((s) => !s.place) || !runs.every(sorted) || (runs[2].length && runs[2][0].n > runs[0][lead - 1].n)) order.push(nameOf(item));
  }
  check('an item lists exactly the sources whose tables hold it', wrong.length === 0, wrong.join(' ; '));
  check('...each with the yield the table gives it, and places told from sources found anywhere', off.length === 0, off.slice(0, 5).join(' ; '));
  check('...in order: the best two found anywhere, then places, then the rest', order.length === 0, order.join(', '));
  check('the roadside table, which nothing rolls, is not named as a source', !rolled.has(ZONE.ROADSIDE) && items.every((item) => sourcesOf(item).every((s) => s.name !== ZONE_NAMES[ZONE.ROADSIDE])));
}

// ---------------------------------------------------------------- found in: the line
{
  const bad = [];
  for (const item of items) {
    const all = sourcesOf(item).map((s) => s.name);
    for (const mask of [0, ALL]) {
      const craft = RECIPES.some((r) => r.out === item && (!r.schem || mask & (1 << SCHEM_BIT[r.schem])));
      let want = all.slice(0, 3).join(', ') + (all.length > 3 ? ` +${all.length - 3} more` : '');
      if (craft) want += want ? ', or craft it' : 'craft it';
      want = want && want[0].toUpperCase() + want.slice(1);
      if (foundIn(item, mask) !== want) bad.push(`${nameOf(item)}: "${foundIn(item, mask)}" != "${want}"`);
    }
  }
  check('the line names the first three sources, counts the rest, and offers crafting only when the team can', bad.length === 0, bad.slice(0, 3).join(' ; '));

  // a player short of an ingredient is always told where to look - with no schematic found, as on the first day
  const asked = new Set();
  for (const r of RECIPES) for (const k in r.cost) asked.add(+k);
  for (const type of STRUCT_ORDER) for (const k in STRUCT_DEFS[type].cost) asked.add(+k);
  const silent = [...asked].filter((item) => !foundIn(item, 0));
  check('every ingredient of a recipe or a structure has a source line', asked.size > 10 && silent.length === 0, silent.map(nameOf).join(', ') || `${asked.size} ingredients`);
  const unmade = RECIPES.filter((r) => !r.hide && !foundIn(r.out, ALL)).map((r) => nameOf(r.out));
  check('...and so has everything a recipe makes', unmade.length === 0, unmade.join(', '));
  const quiet = [...SUPPLIES, ...SCHEMATICS, ITEM.WALKIE];
  check('what no table yields says nothing (car supplies, schematics, the walkie-talkie)', quiet.every((item) => foundIn(item, ALL) === '' && sourcesOf(item).length === 0));

  // a few known items, read off the tables rather than typed in, so a change to a table moves them and not this
  const holders = (item, tables) => Object.keys(tables).filter((k) => tables[k].some((row) => row[0] === item));
  const text = (item) => foundIn(item, 0, 99).replace(/, or craft it$/, '');
  const leatherAt = holders(ITEM.LEATHER, LOOT_TABLES).filter((zone) => rolled.has(+zone)).map((zone) => ZONE_NAMES[zone]);
  const leatherIn = Object.values(CONT_DEFS).filter((d) => d.table && holders(ITEM.LEATHER, CONT_TABLES).includes(d.table)).map((d) => contName[d.name]);
  check('leather: the places and containers whose tables list it, the deer, and nothing else', leatherAt.length > 0 && sameSet(new Set(text(ITEM.LEATHER).toLowerCase().split(', ')), new Set([...leatherAt, ...leatherIn, 'hunt deer'].map((n) => n.toLowerCase()))), text(ITEM.LEATHER));
  check('hunting deer is a source of leather and of raw venison, and cooked venison is made from the raw', foundIn(ITEM.LEATHER).startsWith('Hunt deer') && foundIn(ITEM.VENISON_RAW) === 'Hunt deer' && foundIn(ITEM.VENISON) === 'Craft it' && usedIn(ITEM.VENISON_RAW).list.some((u) => u.name === nameOf(ITEM.VENISON) && !u.locked), `${foundIn(ITEM.LEATHER)} | ${foundIn(ITEM.VENISON_RAW)} | ${foundIn(ITEM.VENISON)}`);
  const packCost = [ITEM.LEATHER, ITEM.CLOTH, ITEM.ROPE];
  check('the backpack is made at the workbench, from leather, cloth and rope that say they go into it', foundIn(ITEM.BACKPACK) === 'Craft it' && RECIPES.find((r) => r.out === ITEM.BACKPACK)?.station === 'bench' && packCost.every((item) => usedIn(item, 0, 99).list.some((u) => u.name === nameOf(ITEM.BACKPACK) && !u.locked)), foundIn(ITEM.BACKPACK));
  const powderIn = Object.values(CONT_DEFS).filter((d) => d.table && holders(ITEM.POWDER, CONT_TABLES).includes(d.table)).map((d) => contName[d.name]);
  check('gunpowder: its containers, the zombies that drop it, and that it can be crafted', powderIn.length > 0 && powderIn.every((n) => text(ITEM.POWDER).toLowerCase().includes(n)) && text(ITEM.POWDER).includes('special zombies') === SPECIAL_LOOT.some((row) => row[0] === ITEM.POWDER) && foundIn(ITEM.POWDER).endsWith(', or craft it') === RECIPES.some((r) => r.out === ITEM.POWDER && !r.schem), foundIn(ITEM.POWDER));
  check('sticks come from trees and scrap from wrecks, before anything else', foundIn(ITEM.STICK).startsWith('Chop trees') && foundIn(ITEM.SCRAP).startsWith('Salvage wrecks'), `${foundIn(ITEM.STICK)} | ${foundIn(ITEM.SCRAP)}`);
}

// ---------------------------------------------------------------- used in
{
  const users = new Map(items.map((item) => [item, []])); // item -> [{ name, schem, share }] in table order
  const use = (name, cost, schem) => {
    const total = Object.values(cost).reduce((a, b) => a + b, 0);
    for (const k in cost) users.get(+k).push({ name, schem: schem || 0, share: cost[k] / total });
  };
  for (const r of RECIPES) if (!r.hide) use(nameOf(r.out), r.cost, r.schem);
  for (const type of STRUCT_ORDER) use(STRUCT_DEFS[type].name, STRUCT_DEFS[type].cost, STRUCT_DEFS[type].schem);
  for (const f of FIXTURE_USES) use(f.name, f.cost); // (what is spent at a fixture: the Relay Station's radio)
  // (what a structure burns once built is a use of that fuel: the generator's)
  const burners = STRUCT_ORDER.filter((type) => STRUCT_DEFS[type].fuel);
  for (const type of burners) use(STRUCT_DEFS[type].name, { [STRUCT_DEFS[type].fuel]: 1 }, STRUCT_DEFS[type].schem);
  const bad = [];
  for (const item of items) {
    const want = users.get(item);
    for (const mask of [0, ALL, 1 << SCHEM_BIT[ITEM.SCHEM_KEVLAR]]) {
      const all = usedIn(item, mask, 99);
      const top = usedIn(item, mask);
      if (!want.length) {
        if (all !== null || top !== null) bad.push(`${nameOf(item)}: nothing consumes it`);
        continue;
      }
      const locked = (u) => !!u.schem && !(mask & (1 << SCHEM_BIT[u.schem]));
      // what the team can make first, then what waits on a schematic; in each, the biggest share first
      const order = [...want].sort((a, b) => locked(a) - locked(b) || b.share - a.share);
      const got = all.list.map((u) => `${u.locked ? '#' : ''}${u.name}`).join('|');
      if (got !== order.map((u) => `${locked(u) ? '#' : ''}${u.name}`).join('|') || all.more !== 0) bad.push(`${nameOf(item)} (mask ${mask}): ${got}`);
      if (top.list.length !== Math.min(3, want.length) || top.more !== Math.max(0, want.length - 3) || top.list.some((u, i) => u.name !== all.list[i].name)) bad.push(`${nameOf(item)}: cap`);
    }
  }
  check('an item lists exactly the recipes and structures that cost it, craftable first, locked ones marked', bad.length === 0, bad.slice(0, 3).join(' ; '));
  const plate = usedIn(ITEM.PLATE, 0, 99).list;
  const vest = RECIPES.find((r) => r.out === ITEM.KEVLAR);
  check('a kevlar plate names the vest, locked until its schematic is found', !!vest.cost[ITEM.PLATE] && plate.some((u) => u.name === nameOf(ITEM.KEVLAR) && u.locked === !!vest.schem) && usedIn(ITEM.PLATE, ALL, 99).list.every((u) => !u.locked), plate.map((u) => `${u.locked ? 'locked ' : ''}${u.name}`).join(', '));
  const cells = usedIn(ITEM.BATTERY, 0, 99)?.list || [];
  check("batteries name the Relay Station's radio, which spends them on a supply drop", RADIO_COST[ITEM.BATTERY] > 0 && cells.some((u) => /radio/i.test(u.name) && !u.locked), cells.map((u) => u.name).join(', '));
  const burnt = burners.map((type) => [STRUCT_DEFS[type].fuel, STRUCT_DEFS[type].name]);
  check('a fuel names what burns it: Flamethrower Fuel the Generator', burnt.length > 0 && burnt.every(([item, name]) => usedIn(item, ALL, 99).list.some((u) => u.name === name)) && burnt.some(([item]) => item === ITEM.AMMO_FUEL), burnt.map(([item, name]) => `${nameOf(item)}: ${usedIn(item, ALL, 99).list.map((u) => u.name).join(', ')}`).join(' | '));
}

// ---------------------------------------------------------------- gathering: GATHER mirrors Game.gatherHit
// The one table the guide cannot derive. Swing the starting knife at trees and wrecks on a real server and count.
{
  const game = new Game({ seed: 4242, log: () => {} });
  let got = {};
  game.giveOrDrop = (p, item, n) => (got[item] = (got[item] || 0) + n);
  game.notify = () => {};
  const p = { id: 0, state: { x: 0, y: 0, z: 0 } }; // (where a felled tree falls away from)
  const flags = [COL.TREE, COL.SALVAGE];
  GATHER.forEach((g, i) => {
    // a living tree of the plain kind (tv 0); a wreck has no kinds
    const one = { flags: flags[i], tv: 0 };
    let hits = 0;
    for (let k = 0; k < g.hits + 3; k++) {
      got = {};
      game.gatherHit(p, one, 0, 0, 0, ITEM.KNIFE);
      if (Object.keys(got).length) hits++;
    }
    got = {};
    const N = 3000;
    for (let n = 0; n < N; n++) {
      const col = { flags: flags[i], tv: 0 };
      for (let k = 0; k < g.hits; k++) game.gatherHit(p, col, 0, 0, 0, ITEM.KNIFE);
    }
    const stated = new Map(g.gives);
    const drift = Object.keys(got).map(Number).filter((item) => !stated.has(item));
    for (const [item, per] of g.gives) if (Math.abs((got[item] || 0) / (N * g.hits) - per) > Math.max(0.012, per * 0.15)) drift.push(item);
    check(`"${g.name}" gives what the server gives: ${g.hits} hits, ${g.gives.map(([item]) => nameOf(item)).join(', ')}`, hits === g.hits && drift.length === 0, drift.length ? `GATHER in client/game/itemguide.js is out of step with Game.gatherHit for ${drift.map(nameOf).join(', ')}` : `per hit: ${g.gives.map(([item]) => ((got[item] || 0) / (N * g.hits)).toFixed(2)).join(' / ')}`);
  });
}

// ---------------------------------------------------------------- hunting: 'hunt deer' is what a kill leaves
// Bring deer down on a real server and count what Deer.kill puts on the ground.
{
  const game = new Game({ seed: 4242, log: () => {} });
  game.startGame();
  const got = {};
  game.dropItem = (item, n) => (got[item] = (got[item] || 0) + n);
  const at = game.dm.grounds()[0];
  const N = 600;
  let only = true;
  for (let n = 0; n < N; n++) {
    const before = JSON.stringify(got);
    const d = game.dm.spawnGroup(at.x, at.z, 1).members[0];
    only = only && game.combat.damageZombie(d, d.hp, null) === true && d.dead && JSON.stringify(got) !== before;
  }
  const stated = new Map(DEER_LOOT.map(([item, min, max]) => [item, (min + max) / 2]));
  const drift = Object.keys(got).map(Number).filter((item) => !stated.has(item));
  for (const [item, per] of stated) if (Math.abs((got[item] || 0) / N - per) > 0.08) drift.push(item);
  check(`"hunt deer" gives what the server gives: ${DEER_LOOT.map(([item]) => nameOf(item)).join(', ')}, every kill`, only && drift.length === 0, drift.length ? `out of step for ${drift.map(nameOf).join(', ')}` : `per kill: ${DEER_LOOT.map(([item]) => ((got[item] || 0) / N).toFixed(2)).join(' / ')}`);
}

// ---------------------------------------------------------------- bosses: 'bosses' is what a boss leaves beside its loot
// Bring bosses down on a real server and count the sealed packs Cards.bossDrop puts on the ground.
{
  const game = new Game({ seed: 4242, log: () => {} });
  game.startGame();
  let packs = 0;
  game.dropItem = (item, n) => (item === ITEM.SEALED_PACK && (packs += n), null);
  const at = game.world.spawnPoints[0];
  const N = 600;
  let killed = 0;
  for (let n = 0; n < N; n++) {
    const z = game.zm.spawn(ZTYPE.BOSS_BRUTE, at.x + 20, at.z, { horde: true, boss: true });
    game.combat.damageZombie(z, z.hp + 1, null, {});
    if (z.dead) killed++;
  }
  check(`"bosses" gives what the server gives: a sealed pack ${BOSS_PACK_CHANCE * 100}% of the time`, killed === N && Math.abs(packs / N - BOSS_PACK_CHANCE) < 0.07, `${packs} packs off ${killed} bosses`);
}

console.log(`\n${fails.length ? 'FAILED: ' + fails.join(', ') : 'all checks passed'}`);
process.exit(fails.length ? 1 : 0);
