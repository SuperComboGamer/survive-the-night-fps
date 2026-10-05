// Repairs (Game.repair: [E] on a structure, and ACT.REPAIR), against a real Game in-process and with what the server
// sends decoded as a client does: a wall, a gate or a torch is mended only with the hammer in hand - not with it
// carried in the build slot while something else is held, nor with it in the backpack - and a refusal spends
// nothing and tells the survivor why. Feeding a campfire is not a repair and needs no hammer.
// usage: node scripts/test-repair.js [seed]
import { Game } from '../server/game.js';
import { C2S, S2C, ACT, PROTOCOL_VERSION, Writer, Reader } from '../shared/protocol.js';
import { SLOT_BUILD, SLOT_MELEE } from '../shared/constants.js';
import { ITEM, STRUCT, STRUCT_DEFS, NOTIFY, REPAIR_COST } from '../shared/defs.js';
import { groundAt } from '../shared/collision.js';
import { readSnapshot } from '../client/net/decode.js';

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
// an action on an entity, as Connection.action writes it (client/net/connection.js); the cooldowns are let go first
const act = (a, id) => {
  p.actionT = -1;
  p.interactT = -1;
  const w = new Writer(8);
  w.u8(C2S.ACTION);
  w.u8(a);
  w.u16(id);
  game.onMessage(A.session, w.bytes().slice());
};
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

// Built with the hammer out on open ground somewhere round the car, the survivor left standing 2.5 m off it.
const built = [];
function build(type) {
  const car = world.car;
  for (let r = 12; r <= 60; r += 4) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const x = car.x + Math.cos(a) * r;
      const z = car.z + Math.sin(a) * r;
      if (built.some((e) => Math.hypot(e.x - x, e.z - z) < 6)) continue;
      pack(...Object.entries(STRUCT_DEFS[type].cost).map(([item, n]) => [+item, n]));
      put(x - 2.5, z);
      s.slot = SLOT_BUILD;
      s.weapons[SLOT_BUILD] = ITEM.HAMMER;
      p.actionT = -1;
      const before = new Set(game.structures);
      game.build(p, type, x, z, 64); // (rot8 64: facing along x, its broad side to the survivor)
      const e = game.structures.find((o) => !before.has(o));
      if (e) {
        built.push(e);
        return e;
      }
    }
  }
  return null;
}
const stand = (e) => put(e.x - 2.5, e.z);

run(3);
const wall = build(STRUCT.WALL);
const gate = build(STRUCT.GATE);
const torch = build(STRUCT.TORCH);
const fire = build(STRUCT.CAMPFIRE);
run(2);
check('a wall, a gate, a torch and a campfire are built', !!wall && !!gate && !!torch && !!fire);
if (!wall || !gate || !torch || !fire) {
  console.log('\nnothing to test: the structures could not be built');
  process.exit(1);
}

const mats = () => [...Object.entries(REPAIR_COST).map(([item, n]) => [+item, n * 3]), [ITEM.CLOTH, 3]];
const spent = () => Object.keys(REPAIR_COST).some((item) => has(+item) !== REPAIR_COST[item] * 3) || has(ITEM.CLOTH) !== 3;

// ---------------------------------------------------------------- refused: the hammer not in hand
for (const [e, name] of [[wall, 'wall'], [gate, 'gate']]) {
  e.hp = e.maxHp * 0.4;
  stand(e);
  pack(...mats());
  s.weapons[SLOT_BUILD] = ITEM.HAMMER;
  s.slot = SLOT_MELEE;
  A.notes.length = 0;
  act(ACT.INTERACT, e.id);
  run(2);
  act(ACT.REPAIR, e.id);
  run(2);
  check(`a damaged ${name}, the hammer in the build slot but the melee weapon in hand: [E] and ACT.REPAIR mend nothing and spend nothing`, e.hp === e.maxHp * 0.4 && !spent(), `${e.hp.toFixed(0)} / ${e.maxHp} hp`);
  check(`...and the survivor is told to take the hammer out, once for each try`, told(NOTIFY.NEED_HAMMER) === 2, `${told(NOTIFY.NEED_HAMMER)} told`);
}
{
  pack(...mats(), [ITEM.HAMMER, 1]);
  s.weapons[SLOT_BUILD] = 0;
  s.slot = SLOT_BUILD;
  stand(wall);
  A.notes.length = 0;
  act(ACT.INTERACT, wall.id);
  run(2);
  check('the hammer in the backpack, not equipped: nothing mended, nothing spent, and told', wall.hp === wall.maxHp * 0.4 && has(ITEM.HAMMER) === 1 && Object.keys(REPAIR_COST).every((item) => has(+item) === REPAIR_COST[item] * 3) && told(NOTIFY.NEED_HAMMER) === 1);
}
{
  torch.burnLeft = 0;
  stand(torch);
  pack(...mats());
  s.weapons[SLOT_BUILD] = ITEM.HAMMER;
  s.slot = SLOT_MELEE;
  A.notes.length = 0;
  act(ACT.INTERACT, torch.id);
  run(2);
  check('a torch gone out is not relit without the hammer in hand, and its Cloth is kept', torch.burnLeft <= 0 && has(ITEM.CLOTH) === 3 && told(NOTIFY.NEED_HAMMER) === 1);
}
{
  wall.hp = wall.maxHp;
  stand(wall);
  s.weapons[SLOT_BUILD] = ITEM.HAMMER;
  s.slot = SLOT_MELEE;
  A.notes.length = 0;
  act(ACT.INTERACT, wall.id);
  run(2);
  check('[E] on a wall that needs nothing says nothing', told(NOTIFY.NEED_HAMMER) === 0);
}

// ---------------------------------------------------------------- the hammer in hand: as before
for (const [e, name] of [[wall, 'wall'], [gate, 'gate']]) {
  e.hp = e.maxHp * 0.4;
  stand(e);
  pack(...mats());
  s.weapons[SLOT_BUILD] = ITEM.HAMMER;
  s.slot = SLOT_BUILD;
  A.notes.length = 0;
  act(ACT.INTERACT, e.id);
  run(2);
  const once = e.hp;
  act(ACT.REPAIR, e.id);
  run(2);
  const each = Object.keys(REPAIR_COST).every((item) => has(+item) === REPAIR_COST[item] * 1);
  check(`the hammer in hand: [E] and ACT.REPAIR each mend the ${name} by 35% for one repair's materials`, Math.abs(once - e.maxHp * 0.75) < 1e-6 && e.hp === e.maxHp && each && told(NOTIFY.NEED_HAMMER) === 0, `${(e.maxHp * 0.4).toFixed(0)} -> ${once.toFixed(0)} -> ${e.hp.toFixed(0)} hp`);
}
{
  stand(torch);
  pack(...mats());
  s.slot = SLOT_BUILD;
  act(ACT.INTERACT, torch.id);
  run(2);
  check('...and a torch is relit for one Cloth', torch.burnLeft > 0 && torch.hp === torch.maxHp && has(ITEM.CLOTH) === 2);
}

// ---------------------------------------------------------------- a campfire is fed, hammer or not
{
  stand(fire);
  fire.burnLeft = 30;
  pack([ITEM.WOOD, 2]);
  s.weapons[SLOT_BUILD] = 0;
  s.slot = SLOT_MELEE;
  A.notes.length = 0;
  act(ACT.INTERACT, fire.id);
  run(2);
  check('[E] feeds a campfire Planks without the hammer, and says nothing of one', fire.burnLeft > 60 && has(ITEM.WOOD) === 1 && told(NOTIFY.NEED_HAMMER) === 0, `${fire.burnLeft.toFixed(0)} s of fire`);
}

console.log(fails.length ? `\n${fails.length} FAILED:\n  ${fails.join('\n  ')}` : '\nall repair checks passed');
process.exit(fails.length ? 1 : 0);
