// Auto-crafting (shared/autocraft.js): a build, a craft or a repair short of a material a recipe makes is paid with
// what that material is made of, when that recipe could be crafted there (its station near, its schematic found).
// planCost on its own, then against a real Game in-process: a Wood Wall from Sticks and Scrap Metal at a workbench
// and not away from one, a Spiked Bat whose Nails and Planks are made on the way (and the client's craftRun leaving
// the backpack exactly as the server does), and a repair. A refusal spends nothing.
// usage: node scripts/test-autocraft.js [seed]
import { Game } from '../server/game.js';
import { invCap } from '../server/inventory.js';
import { C2S, S2C, PROTOCOL_VERSION, Writer, Reader } from '../shared/protocol.js';
import { SLOT_BUILD } from '../shared/constants.js';
import { ITEM, STRUCT, STRUCT_DEFS, RECIPES, NOTIFY } from '../shared/defs.js';
import { planCost } from '../shared/autocraft.js';
import { groundAt } from '../shared/collision.js';
import { readSnapshot } from '../client/net/decode.js';
import { craftRun, copyInv } from '../client/game/bulkcraft.js';

const seed = +(process.argv[2] || 4242);
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};
const same = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

// ---------------------------------------------------------------- the planner
const WALL = STRUCT_DEFS[STRUCT.WALL].cost; // 5 Planks, 4 Nails
const bench = { fire: false, bench: true, unlocked: 0 };
const none = { fire: false, bench: false, unlocked: 0 };
{
  const p = planCost({ [ITEM.STICK]: 15, [ITEM.SCRAP]: 1 }, WALL, bench);
  check('a wall from 15 Sticks and 1 Scrap Metal at a workbench', !!p && same(p.take, { [ITEM.STICK]: 15, [ITEM.SCRAP]: 1 }) && same(p.give, { [ITEM.NAILS]: 6 }), JSON.stringify(p));
  check('...not away from one (Nails are made at a workbench)', planCost({ [ITEM.STICK]: 15, [ITEM.SCRAP]: 1 }, WALL, none) === null);
  check('...nor with a Stick short', planCost({ [ITEM.STICK]: 14, [ITEM.SCRAP]: 1 }, WALL, bench) === null);
  const q = planCost({ [ITEM.STICK]: 15, [ITEM.NAILS]: 4 }, WALL, none);
  check('Planks are made by hand anywhere: a wall from 15 Sticks and 4 Nails', !!q && same(q.take, { [ITEM.STICK]: 15, [ITEM.NAILS]: 4 }) && same(q.give, {}));
  const r = planCost({ [ITEM.WOOD]: 3, [ITEM.STICK]: 6, [ITEM.NAILS]: 9 }, WALL, none);
  check('what is carried is used first: 3 Planks carried, only 2 made', !!r && same(r.take, { [ITEM.WOOD]: 3, [ITEM.STICK]: 6, [ITEM.NAILS]: 4 }));
  const fire = STRUCT_DEFS[STRUCT.CAMPFIRE].cost; // 4 Sticks, 1 Plank
  check('a campfire from 7 Sticks (4, and 3 for its Plank)', !!planCost({ [ITEM.STICK]: 7 }, fire, none) && !planCost({ [ITEM.STICK]: 6 }, fire, none));
  check('without a context nothing is made', planCost({ [ITEM.STICK]: 15, [ITEM.SCRAP]: 1 }, WALL) === null && !!planCost({ [ITEM.WOOD]: 5, [ITEM.NAILS]: 4 }, WALL));
  const pipe = RECIPES.find((x) => x.out === ITEM.PIPEBOMB); // 4 Gunpowder: made at a campfire
  const raw = { [ITEM.SCRAP]: 2, [ITEM.TAPE]: 1, [ITEM.CHEM]: 1, [ITEM.STICK]: 2 };
  check('a recipe needs its own station to be made on the way: Gunpowder at a campfire', !planCost(raw, pipe.cost, bench) && !!planCost(raw, pipe.cost, { fire: true, bench: true, unlocked: 0 }));
  const torch = STRUCT_DEFS[STRUCT.TORCH].cost; // 1 Torch
  check('a standing torch from a Stick and a Cloth', !!planCost({ [ITEM.STICK]: 1, [ITEM.CLOTH]: 1 }, torch, none));
}

// ---------------------------------------------------------------- against the server
const game = new Game({ seed, godMode: true, dayLength: 36000, nightLength: 36000, themes: false, log: () => {} });
const world = game.world;
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
const run = (ticks) => {
  for (let i = 0; i < ticks; i++) {
    for (const z of [...game.zombies]) {
      game._listRemove(game.zombies, z);
      game.removeEntity(z);
    }
    game.update();
  }
};
const put = (x, z) => {
  s.x = x;
  s.z = z;
  s.y = groundAt(world, x, z, 200, 0.3);
  s.vx = s.vy = s.vz = 0;
  game.fillHistory(p);
};
const pack = (...list) => {
  p.inv.fill(null);
  list.forEach(([item, count], i) => (p.inv[i] = { item, count }));
  p.invDirty = true;
};
const has = (item) => p.inv.reduce((n, x) => n + (x && x.item === item ? x.count : 0), 0);
const told = (m) => A.notes.filter(([n]) => n === m).length;
// a workbench in reach or not, as test-ammo has it
const nearStation = game.nearStation;
const atBench = (on) => (game.nearStation = (pp, kind) => (on && kind === 'bench' ? {} : null));

// A wall tried on open ground round the car with what `stuff` holds, the survivor 2.5 m off it: the one built, or null
// once a spot was found clear (anything else refused it)
const built = [];
function tryWall(stuff) {
  const car = world.car;
  for (let r = 12; r <= 60; r += 4) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const x = car.x + Math.cos(a) * r;
      const z = car.z + Math.sin(a) * r;
      if (built.some((e) => Math.hypot(e.x - x, e.z - z) < 6)) continue;
      pack(...stuff);
      put(x - 2.5, z);
      s.slot = SLOT_BUILD;
      s.weapons[SLOT_BUILD] = ITEM.HAMMER;
      p.actionT = -1;
      A.notes.length = 0;
      const before = new Set(game.structures);
      game.build(p, STRUCT.WALL, x, z, 64);
      run(1); // (what the server says reaches the client with the next tick)
      const e = game.structures.find((o) => !before.has(o));
      if (e) {
        built.push(e);
        return e;
      }
      if (told(NOTIFY.NOT_ENOUGH)) return null;
    }
  }
  return null;
}

run(3);
const raw = [[ITEM.STICK, 15], [ITEM.SCRAP, 1]];
{
  atBench(false);
  const e = tryWall(raw);
  check('server: no wall from Sticks and Scrap Metal away from a workbench, nothing spent, and told', !e && told(NOTIFY.NOT_ENOUGH) === 1 && has(ITEM.STICK) === 15 && has(ITEM.SCRAP) === 1);
}
let wall = null;
{
  atBench(true);
  wall = tryWall(raw);
  check('server: at a workbench the wall goes up from 15 Sticks and 1 Scrap Metal', !!wall);
  check('...which are all spent, and the 6 Nails left from the batch of 10 are in the pack', has(ITEM.STICK) === 0 && has(ITEM.SCRAP) === 0 && has(ITEM.WOOD) === 0 && has(ITEM.NAILS) === 6, `nails ${has(ITEM.NAILS)}`);
}

// a craft at the workbench: the Spiked Bat takes 3 Planks, 8 Nails and 1 Wire
{
  atBench(true);
  const rec = RECIPES.find((x) => x.out === ITEM.SPIKED_BAT);
  pack([ITEM.STICK, 9], [ITEM.SCRAP, 1], [ITEM.WIRE, 1], [ITEM.CLOTH, 4]);
  s.weapons[2] = ITEM.BAT; // (a melee weapon already in its slot: the bat goes into the pack)
  const ctx = game.craftCtx(p);
  const model = copyInv({ slots: p.inv, ammo: s.ammo, weapons: s.weapons, cap: invCap(p) });
  const n = craftRun(rec, model, 1, ctx);
  game.craft(p, rec.id);
  check('server: a Spiked Bat from Sticks, Scrap Metal and Wire at a workbench', has(ITEM.SPIKED_BAT) === 1 && has(ITEM.STICK) === 0 && has(ITEM.SCRAP) === 0 && has(ITEM.WIRE) === 0 && has(ITEM.NAILS) === 2, `nails left ${has(ITEM.NAILS)}`);
  const slots = (a) => JSON.stringify(a.map((x) => (x ? [x.item, x.count] : null)));
  check("client: craftRun counts it and leaves the backpack as the server's", n === 1 && slots(model.slots) === slots(p.inv));
  atBench(false);
  pack([ITEM.STICK, 9], [ITEM.SCRAP, 1], [ITEM.WIRE, 1]);
  check('client: craftRun makes none of it without the workbench context', craftRun(rec, copyInv({ slots: p.inv, ammo: s.ammo, weapons: s.weapons, cap: invCap(p) }), 1, game.craftCtx(p)) === 0);
}

// a repair (1 Plank, 1 Nail) from 3 Sticks and a Scrap Metal, at a workbench
if (wall) {
  atBench(true);
  wall.hp = wall.maxHp * 0.4;
  put(wall.x - 2.5, wall.z);
  pack([ITEM.STICK, 3], [ITEM.SCRAP, 1]);
  s.slot = SLOT_BUILD;
  s.weapons[SLOT_BUILD] = ITEM.HAMMER;
  p.actionT = -1;
  game.repair(p, wall.id);
  check('server: a repair from 3 Sticks and 1 Scrap Metal at a workbench', wall.hp > wall.maxHp * 0.7 && has(ITEM.STICK) === 0 && has(ITEM.SCRAP) === 0 && has(ITEM.NAILS) === 9, `${wall.hp.toFixed(0)} hp`);
}
game.nearStation = nearStation;

console.log(fails.length ? `\n${fails.length} FAILED:\n  ${fails.join('\n  ')}` : '\nall auto-craft checks passed');
process.exit(fails.length ? 1 : 0);
