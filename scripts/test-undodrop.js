// Taking a drop back (ACT.UNDO_DROP: the inventory's Undo, for a few seconds after a drop), against a real Game: a stack,
// some rounds, a weapon with rounds in it and the armor worn come back as they went down; only the dropper's own last
// drop, only while it lies there, only for UNDO_DROP_TIME and only near it; what has no room stays on the ground.
// usage: node scripts/test-undodrop.js [seed]
import { Game } from '../server/game.js';
import { C2S, ACT, UNDO_NO, WORN, WORN_DO, PROTOCOL_VERSION, Writer, qangle16, qpitch, writeInput } from '../shared/protocol.js';
import { INVENTORY_SIZE, SERVER_TICK_RATE, SLOT_PRIMARY } from '../shared/constants.js';
import { ITEM, ITEM_DEFS, AMMO, NOTIFY } from '../shared/defs.js';

const seed = +(process.argv[2] || 4242);
const game = new Game({ seed, godMode: true, dayLength: 3600, log: () => {} });
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};

// a client that sends: what it is told is read off the game (its notices, below)
function client(name) {
  const c = { name, seq: 0 };
  c.conn = { send() {} };
  c.session = game.onOpen(c.conn);
  const w = new Writer(64);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str(name);
  game.onMessage(c.session, w.bytes().slice());
  c.p = () => [...game.players.values()].find((p) => p.name === name);
  // as Connection.action writes them: DROP_SLOT / DROP_AMMO u8 + u16, WORN two u8, UNDO_DROP nothing, the rest one u8
  c.act = (act, ...args) => {
    const w2 = new Writer(16);
    w2.u8(C2S.ACTION);
    w2.u8(act);
    if (act === ACT.DROP_SLOT || act === ACT.DROP_AMMO) {
      w2.u8(args[0]);
      w2.u16(args[1]);
    } else for (const a of args) w2.u8(a);
    game.onMessage(c.session, w2.bytes().slice());
  };
  c.input = () => {
    const w2 = new Writer(64);
    w2.u8(C2S.INPUT);
    w2.u16(game.tick & 0xffff);
    w2.u8(0);
    const cmds = [];
    for (let i = 0; i < 3; i++) {
      c.seq = (c.seq + 1) & 0xffff;
      cmds.push({ seq: c.seq, buttons: 0, qyaw: qangle16(0), qpitch: qpitch(0), slot: 255 });
    }
    writeInput(w2, cmds);
    game.onMessage(c.session, w2.bytes().slice());
  };
  return c;
}

const A = client('Alice');
const B = client('Bob');
const a = A.p();
const s = a.state;
const run = (ticks) => {
  for (let i = 0; i < ticks; i++) {
    A.input();
    B.input();
    game.update();
  }
};
// the notices the game sent Alice since the last look, from its own record of them
const noted = [];
const realNotify = game.notify.bind(game);
game.notify = (type, arg = 0, to = 0) => {
  if (to === a.id) noted.push([type, arg]);
  return realNotify(type, arg, to);
};
const pack = (...list) => {
  a.inv.fill(null);
  list.forEach((x, i) => (a.inv[i] = x && { count: 1, ...x }));
  a.invDirty = true;
};
const count = (item) => a.inv.reduce((n, x) => n + (x && x.item === item ? x.count : 0), 0);
// what lies dropped at her feet (not the loot the world put about)
const lying = (item) => game.items.filter((e) => !e.removed && e.drop && e.item === item && Math.hypot(e.x - s.x, e.z - s.z) < 12).reduce((n, e) => n + e.count, 0);
run(5);

// part of a stack, and back
{
  pack({ item: ITEM.BANDAGE, count: 5 });
  A.act(ACT.DROP_SLOT, 0, 3);
  run(2);
  const down = lying(ITEM.BANDAGE);
  A.act(ACT.UNDO_DROP);
  run(2);
  check('3 of 5 bandages dropped, then undone: all 5 back in the pack, none left lying', down === 3 && count(ITEM.BANDAGE) === 5 && lying(ITEM.BANDAGE) === 0, `down ${down}, carried ${count(ITEM.BANDAGE)}, lying ${lying(ITEM.BANDAGE)}`);
  noted.length = 0;
  A.act(ACT.UNDO_DROP);
  run(2);
  check('...and a second undo does nothing, and says nothing', count(ITEM.BANDAGE) === 5 && !noted.length);
}

// only the last drop, and only the dropper's
{
  pack({ item: ITEM.CLOTH, count: 6 }, { item: ITEM.NAILS, count: 10 });
  A.act(ACT.DROP_SLOT, 0, 0);
  A.act(ACT.DROP_SLOT, 1, 4);
  run(2);
  B.act(ACT.UNDO_DROP);
  run(2);
  check("a teammate's undo takes nothing of hers", lying(ITEM.CLOTH) === 6 && lying(ITEM.NAILS) === 4);
  A.act(ACT.UNDO_DROP);
  run(2);
  check('her undo takes back the last drop (the nails), not the one before (the cloth)', count(ITEM.NAILS) === 10 && lying(ITEM.CLOTH) === 6 && count(ITEM.CLOTH) === 0, `nails ${count(ITEM.NAILS)}, cloth lying ${lying(ITEM.CLOTH)}`);
  for (const e of game.items.filter((x) => x.item === ITEM.CLOTH)) game.removeItemEnt(e);
}

// gone, partly gone, too late, too far
{
  pack({ item: ITEM.SCRAP, count: 8 });
  A.act(ACT.DROP_SLOT, 0, 0);
  run(2);
  game.removeItemEnt(a.lastDrop.e); // (a teammate picked it up)
  noted.length = 0;
  A.act(ACT.UNDO_DROP);
  run(2);
  check('taken by somebody else: nothing comes back, and she is told it is gone', count(ITEM.SCRAP) === 0 && noted.some(([t, g]) => t === NOTIFY.UNDO_GONE && g === UNDO_NO.GONE));

  pack({ item: ITEM.SCRAP, count: 8 });
  A.act(ACT.DROP_SLOT, 0, 0);
  run(2);
  a.lastDrop.e.count = 5; // (a teammate took 3 of them)
  A.act(ACT.UNDO_DROP);
  run(2);
  check('partly taken: what is left of it comes back', count(ITEM.SCRAP) === 5 && lying(ITEM.SCRAP) === 0, `carried ${count(ITEM.SCRAP)}`);

  pack({ item: ITEM.SCRAP, count: 8 });
  A.act(ACT.DROP_SLOT, 0, 0);
  run(7 * SERVER_TICK_RATE);
  noted.length = 0;
  A.act(ACT.UNDO_DROP);
  run(2);
  check('7 s later: too late, it stays on the ground', count(ITEM.SCRAP) === 0 && lying(ITEM.SCRAP) === 8 && noted.some(([t, g]) => t === NOTIFY.UNDO_GONE && g === UNDO_NO.LATE));
  for (const e of game.items.filter((x) => x.item === ITEM.SCRAP)) game.removeItemEnt(e);

  pack({ item: ITEM.SCRAP, count: 8 });
  A.act(ACT.DROP_SLOT, 0, 0);
  run(2);
  const e = a.lastDrop.e;
  e.x += 9; // (she has walked off from it)
  noted.length = 0;
  A.act(ACT.UNDO_DROP);
  run(2);
  check('9 m away from it: too far, it stays on the ground', count(ITEM.SCRAP) === 0 && !e.removed && noted.some(([t, g]) => t === NOTIFY.UNDO_GONE && g === UNDO_NO.FAR));
  game.removeItemEnt(e);
}

// rounds, a weapon with its magazine, the armor worn
{
  pack();
  s.ammo[AMMO.R762] = 90;
  A.act(ACT.DROP_AMMO, AMMO.R762, 30);
  run(2);
  const after = s.ammo[AMMO.R762];
  A.act(ACT.UNDO_DROP);
  run(2);
  check('30 rounds of 7.62 dropped and undone: the reserve is back at 90', after === 60 && s.ammo[AMMO.R762] === 90 && lying(ITEM.AMMO_762) === 0, `after the drop ${after}, now ${s.ammo[AMMO.R762]}`);

  s.weapons[SLOT_PRIMARY] = ITEM.AK47;
  s.mags[0] = 17;
  A.act(ACT.DROP_WEAPON, SLOT_PRIMARY);
  run(2);
  const gone = s.weapons[SLOT_PRIMARY] === 0;
  A.act(ACT.UNDO_DROP);
  run(2);
  check('the rifle dropped and undone: back in its slot with its 17 rounds', gone && s.weapons[SLOT_PRIMARY] === ITEM.AK47 && s.mags[0] === 17, `slot ${s.weapons[SLOT_PRIMARY]}, mag ${s.mags[0]}`);

  a.armorItem = ITEM.KEVLAR;
  a.armorMax = ITEM_DEFS[ITEM.KEVLAR].armor;
  a.armor = 23;
  A.act(ACT.WORN, WORN.ARMOR, WORN_DO.DROP);
  run(2);
  const off = a.armorItem === 0;
  A.act(ACT.UNDO_DROP);
  run(2);
  const vest = a.inv.find((x) => x && x.item === ITEM.KEVLAR);
  check('the vest worn dropped and undone: in the pack with the 23 points it had', off && vest?.mag === 23, `in the pack: ${vest ? vest.mag : 'none'}`);
}

// no room
{
  pack(...Array.from({ length: INVENTORY_SIZE }, () => ({ item: ITEM.CLOTH, count: ITEM_DEFS[ITEM.CLOTH].stack })));
  A.act(ACT.DROP_SLOT, 0, 0);
  run(2);
  a.inv[a.inv.indexOf(null)] = { item: ITEM.WOOD, count: ITEM_DEFS[ITEM.WOOD].stack }; // (the slot it left is taken again, wherever the sort moved it)
  noted.length = 0;
  A.act(ACT.UNDO_DROP);
  run(2);
  check('with the pack full again, it stays on the ground and she is told', lying(ITEM.CLOTH) === ITEM_DEFS[ITEM.CLOTH].stack && noted.some(([t]) => t === NOTIFY.INVENTORY_FULL));
}

console.log(fails.length ? `\n${fails.length} FAILED:\n  ${fails.join('\n  ')}` : '\nall undo-drop checks passed');
process.exit(fails.length ? 1 : 0);
