// A weapon out of its slot into the backpack (ACT.UNEQUIP: the inventory's Equipment panel, a click or a drag onto
// the grid), against a real Game and with what the server sends decoded as a client does: it keeps its magazine,
// lands in the cell it was dropped on (or the first free one), trades places with a weapon for the same slot, and
// a full backpack leaves it where it is.
// usage: node scripts/test-unequip.js [seed]
import { Game } from '../server/game.js';
import { C2S, S2C, ACT, PROTOCOL_VERSION, Writer, Reader, qangle16, qpitch, writeInput } from '../shared/protocol.js';
import { BTN, INVENTORY_SIZE, SLOT_PRIMARY, SLOT_PISTOL, SLOT_MELEE, SLOT_THROW, SLOT_BUILD } from '../shared/constants.js';
import { ITEM, WEAPONS, AMMO, NOTIFY } from '../shared/defs.js';
import { readSnapshot } from '../client/net/decode.js';

const seed = +(process.argv[2] || 4242);
const game = new Game({ seed, godMode: true, dayLength: 3600, log: () => {} });
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};

// a client, as test-ammo.js has it: the snapshot and the inventory decoded as the game does
function client(name) {
  const c = { name, id: 0, net: { tick: 0, ack: 0 }, global: null, self: {}, store: { ents: new Map(), onCreate() {}, onRemove() {}, onUpdate() {} }, notes: [], seq: 0, slots: [] };
  const nop = () => {};
  c.handler = new Proxy({ notify: (m, a) => c.notes.push([m, a]) }, { get: (t, k) => t[k] || nop });
  c.conn = {
    send(bytes) {
      const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
      const t = r.u8();
      if (t === S2C.WELCOME) c.id = r.u16();
      else if (t === S2C.SNAPSHOT) readSnapshot(r, c);
      else if (t === S2C.INVENTORY) {
        for (let i = 0; i < INVENTORY_SIZE; i++) {
          const item = r.u8();
          const count = r.u16();
          c.slots[i] = item ? { item, count } : null;
        }
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
  // as Connection.action writes it: ACT.UNEQUIP and ACT.USE_ITEM are bytes (client/net/connection.js)
  c.act = (act, ...args) => {
    const w2 = new Writer(16);
    w2.u8(C2S.ACTION);
    w2.u8(act);
    for (const a of args) w2.u8(a);
    game.onMessage(c.session, w2.bytes().slice());
  };
  c.input = (buttons, slot = 255) => {
    const w2 = new Writer(64);
    w2.u8(C2S.INPUT);
    w2.u16(game.tick & 0xffff);
    w2.u8(0);
    const cmds = [];
    for (let i = 0; i < 3; i++) {
      c.seq = (c.seq + 1) & 0xffff;
      cmds.push({ seq: c.seq, buttons, qyaw: qangle16(0), qpitch: qpitch(0), slot: i === 0 ? slot : 255 });
    }
    writeInput(w2, cmds);
    game.onMessage(c.session, w2.bytes().slice());
  };
  return c;
}

const A = client('Alice');
const a = A.p();
const s = a.state;
const run = (ticks, fn) => {
  for (let i = 0; i < ticks; i++) {
    A.input(fn ? fn(i) : 0);
    game.update();
  }
};
const pack = (...list) => {
  a.inv.fill(null);
  list.forEach((x, i) => (a.inv[i] = x && { count: 1, ...x }));
  a.invDirty = true;
};
const at = (i) => (a.inv[i] ? `${a.inv[i].item}:${a.inv[i].mag ?? '-'}` : '-');
run(5);

// a rifle with rounds in it, into the first free cell, and back
{
  s.weapons[SLOT_PRIMARY] = ITEM.AK47;
  s.mags[0] = 17;
  pack({ item: ITEM.BANDAGE, count: 2 });
  A.act(ACT.UNEQUIP, SLOT_PRIMARY, 255);
  run(2);
  check('a click puts the rifle in the first free backpack cell with its magazine, and empties the slot', s.weapons[SLOT_PRIMARY] === 0 && s.mags[0] === 0 && a.inv[1]?.item === ITEM.AK47 && a.inv[1].mag === 17 && A.slots[1]?.item === ITEM.AK47 && A.self.weapons[SLOT_PRIMARY] === 0, `slot ${s.weapons[SLOT_PRIMARY]}, cell 1 ${at(1)}`);
  A.act(ACT.USE_ITEM, 1);
  run(2);
  check('...and a click on it in the backpack equips it again, rounds and all', s.weapons[SLOT_PRIMARY] === ITEM.AK47 && s.mags[0] === 17 && a.inv[1] === null);
}

// dragged onto a cell: that one if it is free, the first free one if not
{
  pack({ item: ITEM.BANDAGE, count: 2 }, { item: ITEM.CLOTH, count: 3 });
  A.act(ACT.UNEQUIP, SLOT_PRIMARY, 10);
  run(2);
  check('dragged onto an empty cell, it lands in that cell', s.weapons[SLOT_PRIMARY] === 0 && a.inv[10]?.item === ITEM.AK47 && a.inv[10].mag === 17 && a.inv[2] === null, `cell 10 ${at(10)}`);
  A.act(ACT.USE_ITEM, 10);
  run(2);
  A.act(ACT.UNEQUIP, SLOT_PRIMARY, 1); // (onto the cloth)
  run(2);
  check('...onto another stack, the first free cell instead, the stack left as it was', a.inv[1]?.item === ITEM.CLOTH && a.inv[1].count === 3 && a.inv[2]?.item === ITEM.AK47, `cell 1 ${at(1)}, cell 2 ${at(2)}`);
  A.act(ACT.USE_ITEM, 2);
  run(2);
}

// dragged onto a weapon for the same slot: they trade places, as a click on that one does
{
  pack({ item: ITEM.BANDAGE, count: 2 }, { item: ITEM.SHOTGUN, mag: 4 });
  s.mags[0] = 17;
  A.act(ACT.UNEQUIP, SLOT_PRIMARY, 1);
  run(2);
  check('onto a weapon for the same slot, the two trade places, each with its own rounds', s.weapons[SLOT_PRIMARY] === ITEM.SHOTGUN && s.mags[0] === 4 && a.inv[1]?.item === ITEM.AK47 && a.inv[1].mag === 17, `slot ${s.weapons[SLOT_PRIMARY]} (${s.mags[0]}), cell 1 ${at(1)}`);
  A.act(ACT.USE_ITEM, 1);
  run(2);
}

// the other slots: the pistol, the knife, the hammer. The throwable slot and empty slots: nothing
{
  pack();
  s.mags[1] = 9;
  A.act(ACT.UNEQUIP, SLOT_PISTOL, 255);
  A.act(ACT.UNEQUIP, SLOT_MELEE, 255);
  A.act(ACT.UNEQUIP, SLOT_BUILD, 255);
  run(2);
  check('the pistol (with its rounds), the knife and the hammer go into the backpack too', s.weapons[SLOT_PISTOL] === 0 && s.weapons[SLOT_MELEE] === 0 && s.weapons[SLOT_BUILD] === 0 && at(0) === `${ITEM.PISTOL}:9` && a.inv[1]?.item === ITEM.KNIFE && a.inv[2]?.item === ITEM.HAMMER, [0, 1, 2].map(at).join(' '));
  for (const i of [0, 1, 2]) A.act(ACT.USE_ITEM, i);
  run(2);
  pack({ item: ITEM.MOLOTOV, count: 2 });
  s.weapons[SLOT_THROW] = ITEM.MOLOTOV;
  const before = JSON.stringify([a.inv, s.weapons]);
  A.act(ACT.UNEQUIP, SLOT_THROW, 255);
  A.act(ACT.UNEQUIP, 5, 255);
  A.act(ACT.UNEQUIP, 200, 255);
  s.weapons[SLOT_PRIMARY] = 0;
  const empty = JSON.stringify(a.inv);
  A.act(ACT.UNEQUIP, SLOT_PRIMARY, 255);
  run(2);
  check('...but not the throwable (a backpack stack already), a slot that is not one, or an empty slot', JSON.stringify(a.inv) === empty && before.includes(`"item":${ITEM.MOLOTOV}`) && s.weapons[SLOT_THROW] === ITEM.MOLOTOV);
  s.weapons[SLOT_PRIMARY] = ITEM.AK47;
  s.mags[0] = 17;
}

// a full backpack: it stays in its slot, and the survivor is told
{
  pack(...Array.from({ length: INVENTORY_SIZE }, () => ({ item: ITEM.CLOTH })));
  A.notes.length = 0;
  A.act(ACT.UNEQUIP, SLOT_PRIMARY, 255);
  run(2);
  check('with the backpack full it stays in its slot, and the survivor is told', s.weapons[SLOT_PRIMARY] === ITEM.AK47 && s.mags[0] === 17 && a.inv.every((x) => x.item === ITEM.CLOTH) && A.notes.some(([m]) => m === NOTIFY.INVENTORY_FULL));
}

// put away in the middle of a reload: the reload ends there, no rounds move
{
  pack();
  s.mags[0] = 0;
  s.ammo[AMMO.R762] = 60;
  A.input(0, SLOT_PRIMARY);
  game.update();
  run(12);
  run(1, () => BTN.RELOAD);
  run(4);
  const reloading = s.reloadT > 0;
  A.act(ACT.UNEQUIP, SLOT_PRIMARY, 255);
  run(Math.ceil(WEAPONS[ITEM.AK47].reload * 20) + 4);
  check('put away mid-reload: the reload ends, the 7.62 stays carried and the rifle stays empty', reloading && s.reloadT === 0 && s.ammo[AMMO.R762] === 60 && a.inv[0]?.item === ITEM.AK47 && a.inv[0].mag === 0, `reserve ${s.ammo[AMMO.R762]}, rifle ${at(0)}`);
}

console.log(fails.length ? `\n${fails.length} FAILED:\n  ${fails.join('\n  ')}` : '\nall unequip checks passed');
process.exit(fails.length ? 1 : 0);
