// Ammunition is carried in the backpack, in stacks like anything else: in-process checks of that, against a real Game
// and with what the server sends decoded as a client does. The reserve a gun reloads from (state.ammo, which the
// client predicts with) is the count of its calibre in the backpack; a reload takes its rounds out of there; a stack
// splits (ACT.SPLIT_INV), and any part of it goes on the ground for a teammate (ACT.DROP_SLOT with a count).
// usage: node scripts/test-ammo.js [seed]
import { Game } from '../server/game.js';
import { C2S, S2C, ACT, PROTOCOL_VERSION, Writer, Reader, qangle16, qpitch, writeInput } from '../shared/protocol.js';
import { BTN, INVENTORY_SIZE, SLOT_PRIMARY, SLOT_PISTOL } from '../shared/constants.js';
import { ITEM, ITEM_DEFS, WEAPONS, AMMO, AMMO_MAX, AMMO_ITEMS, NOTIFY } from '../shared/defs.js';
import { readSnapshot } from '../client/net/decode.js';

const seed = +(process.argv[2] || 4242);
const game = new Game({ seed, godMode: true, dayLength: 3600, log: () => {} });
game.debugCommands = true;
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};

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
        // (as Game.onInventory reads it, client/game/game.js)
        for (let i = 0; i < INVENTORY_SIZE; i++) {
          const item = r.u8();
          const count = r.u16();
          c.slots[i] = item ? { item, count } : null;
        }
        r.u8();
        r.u8();
        r.u8();
        if (r.left !== 0) throw new Error(`${name}: ${r.left} trailing inventory bytes`);
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
  // an inventory action, as Connection.action writes it (client/net/connection.js)
  c.act = (act, a, b) => {
    const w2 = new Writer(16);
    w2.u8(C2S.ACTION);
    w2.u8(act);
    w2.u8(a);
    if (act === ACT.DROP_SLOT || act === ACT.SPLIT_INV) w2.u16(b);
    else if (b !== undefined) w2.u8(b);
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
    writeInput(w2, cmds); // (no prediction here, so no state fingerprint: the server keeps sending its state)
    game.onMessage(c.session, w2.bytes().slice());
  };
  return c;
}

const A = client('Alice');
const B = client('Bob');
const a = A.p();
const b = B.p();
const s = a.state;
// ticks, with A standing still (fn: what she presses on tick i). After each one the reserves have to be what the
// backpacks hold, on the server and in what each client was last sent.
let drift = '';
const run = (ticks, fn) => {
  for (let i = 0; i < ticks; i++) {
    A.input(fn ? fn(i) : 0);
    game.update();
    for (const c of [A, B]) {
      const p = c.p();
      AMMO_ITEMS.forEach((item, cal) => {
        const pack = p.inv.reduce((n, x) => n + (x && x.item === item ? x.count : 0), 0);
        const sent = c.slots.reduce((n, x) => n + (x && x.item === item ? x.count : 0), 0);
        if (!drift && (p.state.ammo[cal] !== pack || c.self.ammo[cal] !== pack || sent !== pack)) drift = `${c.name} ${ITEM_DEFS[item].name} at tick ${game.tick}: backpack ${pack}, reserve ${p.state.ammo[cal]}, client told reserve ${c.self.ammo[cal]} and backpack ${sent}`;
      });
    }
  }
};
const has = (p, item) => p.inv.reduce((n, x) => n + (x && x.item === item ? x.count : 0), 0);
const stacks = (p, item) => p.inv.filter((x) => x && x.item === item).map((x) => x.count).join('+');
const slotOf = (p, item, count) => p.inv.findIndex((x) => x && x.item === item && (count === undefined || x.count === count));
const loose = (item) => game.items.filter((e) => e.item === item && e.drop);
// the pack emptied but for these stacks
const pack = (p, ...list) => {
  p.inv.fill(null);
  list.forEach(([item, count], i) => (p.inv[i] = { item, count }));
  p.invDirty = true;
};
// the weapon in a slot, drawn and ready
const draw = (slot, weapon, mag) => {
  if (weapon) {
    s.weapons[slot] = weapon;
    s.mags[slot === SLOT_PRIMARY ? 0 : 1] = mag;
  }
  A.input(0, slot);
  game.update();
  run(12);
};

run(5);
const kit = has(a, ITEM.AMMO_9MM);
check('a survivor starts with their 9mm as a stack in the backpack', kit === 36 && stacks(a, ITEM.AMMO_9MM) === '36' && s.ammo[AMMO.P9] === 36 && A.self.ammo[AMMO.P9] === 36, `backpack ${stacks(a, ITEM.AMMO_9MM)}, reserve ${s.ammo[AMMO.P9]}`);

// picked up: onto the stack, and past a full stack into the next slot
{
  const took = game.giveItem(a, ITEM.AMMO_9MM, 200);
  run(2);
  check('ammunition picked up stacks in the backpack, a full stack and then the next', took === 200 && stacks(a, ITEM.AMMO_9MM) === `${AMMO_MAX[AMMO.P9]}+${36 + 200 - AMMO_MAX[AMMO.P9]}` && s.ammo[AMMO.P9] === 236, `${stacks(a, ITEM.AMMO_9MM)}, reserve ${s.ammo[AMMO.P9]}`);
  pack(a, [ITEM.AMMO_9MM, 36], ...Array.from({ length: INVENTORY_SIZE - 1 }, () => [ITEM.CLOTH, 1]));
  A.notes.length = 0;
  const some = game.giveItem(a, ITEM.AMMO_SHELLS, 8);
  const more = game.giveItem(a, ITEM.AMMO_9MM, 200);
  run(2);
  check('...and with no slot free only what the stack of it still takes', some === 0 && more === AMMO_MAX[AMMO.P9] - 36 && s.ammo[AMMO.SHELL] === 0 && s.ammo[AMMO.P9] === AMMO_MAX[AMMO.P9], `${some} shells, ${more} rounds of 9mm`);
}

// a reload takes its rounds out of the backpack
{
  pack(a, [ITEM.BANDAGE, 2], [ITEM.AMMO_9MM, 36]);
  draw(SLOT_PISTOL, ITEM.PISTOL, WEAPONS[ITEM.PISTOL].mag);
  let t = 0;
  while (t < 200 && s.mags[1] > 7) run(1, () => (t++ % 2 ? 0 : BTN.ATTACK));
  const fired = WEAPONS[ITEM.PISTOL].mag - s.mags[1];
  run(1, () => BTN.RELOAD);
  run(Math.ceil(WEAPONS[ITEM.PISTOL].reload * 20) + 4);
  check('a reload takes its rounds out of the backpack', fired === 5 && s.mags[1] === WEAPONS[ITEM.PISTOL].mag && has(a, ITEM.AMMO_9MM) === 31 && A.slots[1]?.count === 31 && A.self.ammo[AMMO.P9] === 31, `${fired} fired, magazine ${s.mags[1]}, backpack ${stacks(a, ITEM.AMMO_9MM)}`);
  // split stacks: the last of them is used up first, and a stack used up leaves its slot free
  pack(a, [ITEM.AMMO_9MM, 20], [ITEM.BANDAGE, 2], [ITEM.AMMO_9MM, 3]);
  s.mags[1] = 0;
  run(1, () => BTN.RELOAD);
  run(Math.ceil(WEAPONS[ITEM.PISTOL].reload * 20) + 4);
  check('...from the last stack of it first, and an emptied stack frees its slot', s.mags[1] === 12 && stacks(a, ITEM.AMMO_9MM) === '11' && a.inv[2] === null && A.slots[2] === null, `backpack ${stacks(a, ITEM.AMMO_9MM)}`);
  // no more than there is
  pack(a, [ITEM.AMMO_9MM, 4]);
  s.mags[1] = 0;
  run(1, () => BTN.RELOAD);
  run(Math.ceil(WEAPONS[ITEM.PISTOL].reload * 20) + 4);
  check('...and no more than the backpack holds', s.mags[1] === 4 && has(a, ITEM.AMMO_9MM) === 0 && s.ammo[AMMO.P9] === 0, `magazine ${s.mags[1]}, backpack ${has(a, ITEM.AMMO_9MM)}`);
}
// a shotgun, shell by shell
{
  pack(a, [ITEM.AMMO_SHELLS, 10]);
  draw(SLOT_PRIMARY, ITEM.SHOTGUN, 0);
  run(1, () => BTN.RELOAD);
  run(Math.ceil(WEAPONS[ITEM.SHOTGUN].reload * 20) + 2);
  const one = [s.mags[0], has(a, ITEM.AMMO_SHELLS)].join('/');
  run(Math.ceil(WEAPONS[ITEM.SHOTGUN].reload * 20 * 6) + 4);
  check('a shotgun takes its shells out of the backpack one by one', one === '1/9' && s.mags[0] === WEAPONS[ITEM.SHOTGUN].mag && has(a, ITEM.AMMO_SHELLS) === 4, `after one shell ${one}, after the lot ${s.mags[0]}/${has(a, ITEM.AMMO_SHELLS)}`);
}

// splitting a stack
{
  pack(a, [ITEM.BANDAGE, 2], [ITEM.AMMO_9MM, 36]);
  run(2);
  A.act(ACT.SPLIT_INV, 1, 16);
  run(2);
  check('a stack splits into a free slot', stacks(a, ITEM.AMMO_9MM) === '20+16' && a.inv[2]?.count === 16 && A.slots[2]?.count === 16 && A.slots[1]?.count === 20 && s.ammo[AMMO.P9] === 36, `backpack ${stacks(a, ITEM.AMMO_9MM)}, reserve ${s.ammo[AMMO.P9]}`);
  // nothing of it, all of it, more than it, another slot's nothing: no split
  for (const [i, n] of [[1, 0], [1, 20], [1, 999], [9, 5], [200, 5]]) A.act(ACT.SPLIT_INV, i, n);
  run(2);
  check('...but not by nothing, by the whole stack or from an empty slot', stacks(a, ITEM.AMMO_9MM) === '20+16' && a.inv.filter(Boolean).length === 3, a.inv.filter(Boolean).map((x) => `${x.item}x${x.count}`).join(' '));
  // dragged back onto the other they are one stack again
  A.act(ACT.SWAP_INV, 2, 1);
  run(2);
  check('...and two stacks dragged together are one again', stacks(a, ITEM.AMMO_9MM) === '36' && a.inv[2] === null);
  pack(a, [ITEM.AMMO_9MM, 36], ...Array.from({ length: INVENTORY_SIZE - 1 }, () => [ITEM.CLOTH, 1]));
  A.notes.length = 0;
  A.act(ACT.SPLIT_INV, 0, 10);
  run(2);
  check('no free slot: the stack stays whole, and the survivor is told', stacks(a, ITEM.AMMO_9MM) === '36' && A.notes.some(([m]) => m === NOTIFY.INVENTORY_FULL));
}

// part of a stack put down for a teammate
{
  game.handleChat(b, `/tp ${s.x + 30} ${s.z}`);
  pack(a, [ITEM.AMMO_9MM, 36]);
  pack(b, [ITEM.BANDAGE, 1]);
  run(2);
  A.act(ACT.DROP_SLOT, 0, 16);
  run(2);
  const lying = loose(ITEM.AMMO_9MM);
  const e = lying[0];
  const seen = e && A.store.ents.get(e.id);
  check('part of a stack goes on the ground', lying.length === 1 && e.count === 16 && has(a, ITEM.AMMO_9MM) === 20 && s.ammo[AMMO.P9] === 20 && A.self.ammo[AMMO.P9] === 20 && seen?.q[3] === 16, `${lying.map((x) => x.count).join()} on the ground, ${has(a, ITEM.AMMO_9MM)} kept`);
  run(120); // (past the pause before a drop can be walked over)
  check('...where the one who put it down does not walk it back up', !e.removed && e.count === 16 && has(a, ITEM.AMMO_9MM) === 20);
  game.handleChat(b, `/tp ${e.x} ${e.z}`);
  run(8);
  check('...and a teammate who walks over it has it in their backpack', e.removed && has(b, ITEM.AMMO_9MM) === 16 && b.state.ammo[AMMO.P9] === 16 && B.self.ammo[AMMO.P9] === 16 && B.slots.some((x) => x && x.item === ITEM.AMMO_9MM && x.count === 16), `Bob has ${has(b, ITEM.AMMO_9MM)}, reserve ${b.state.ammo[AMMO.P9]}`);
  game.handleChat(b, `/tp ${s.x + 30} ${s.z}`);
  run(2);
  // more of a stack than there is: all of it. And 0 is the whole stack, as before
  A.act(ACT.DROP_SLOT, 0, 999);
  run(2);
  const all = loose(ITEM.AMMO_9MM);
  check('more than the stack holds is the stack', all.length === 1 && all[0].count === 20 && has(a, ITEM.AMMO_9MM) === 0 && s.ammo[AMMO.P9] === 0);
  for (const x of all) game.removeItemEnt(x);
}

// stacks past 255: the count is 16 bits on the wire, in the inventory and in a drop
{
  pack(a, [ITEM.AMMO_FUEL, 300]);
  run(2);
  const told = A.slots[0]?.count;
  A.act(ACT.SPLIT_INV, 0, 280);
  run(2);
  const split = stacks(a, ITEM.AMMO_FUEL);
  A.act(ACT.DROP_SLOT, slotOf(a, ITEM.AMMO_FUEL, 280), 270);
  run(2);
  const lying = loose(ITEM.AMMO_FUEL);
  check('a stack of 300 survives the wire: sent, split and dropped by more than 255', told === 300 && split === '20+280' && lying.length === 1 && lying[0].count === 270 && stacks(a, ITEM.AMMO_FUEL) === '20+10' && A.slots.filter((x) => x?.item === ITEM.AMMO_FUEL).map((x) => x.count).join('+') === '20+10', `told ${told}, split ${split}, dropped ${lying.map((x) => x.count).join()}, kept ${stacks(a, ITEM.AMMO_FUEL)}`);
  for (const x of lying) game.removeItemEnt(x);
}

// the stack dropped in the middle of a reload: the reload finds nothing
{
  pack(a, [ITEM.AMMO_762, 30]);
  draw(SLOT_PRIMARY, ITEM.AK47, 0);
  run(1, () => BTN.RELOAD);
  run(4);
  const reloading = s.reloadT > 0;
  A.act(ACT.DROP_SLOT, 0, 0);
  run(Math.ceil(WEAPONS[ITEM.AK47].reload * 20) + 4);
  const lying = loose(ITEM.AMMO_762);
  check('rounds dropped in the middle of a reload do not end up in the magazine as well', reloading && s.mags[0] === 0 && s.ammo[AMMO.R762] === 0 && lying.length === 1 && lying[0].count === 30, `magazine ${s.mags[0]}, ${lying.map((x) => x.count).join()} on the ground`);
  for (const x of lying) game.removeItemEnt(x);
}

// dying: the ammunition goes on the ground with the rest of the backpack, once
{
  pack(a, [ITEM.AMMO_9MM, 40], [ITEM.AMMO_9MM, 5], [ITEM.AMMO_SHELLS, 7]);
  run(2);
  game.killPlayer(a, {});
  run(2);
  const nine = loose(ITEM.AMMO_9MM).map((x) => x.count).sort((x, y) => y - x).join('+');
  const shells = loose(ITEM.AMMO_SHELLS).map((x) => x.count).join('+');
  check('a survivor who dies drops their ammunition stack by stack', nine === '40+5' && shells === '7' && has(a, ITEM.AMMO_9MM) === 0 && s.ammo.every((n) => n === 0), `9mm ${nine}, shells ${shells}`);
}

check('the reserves were the backpack\'s count after every tick, on the server and on the clients', !drift, drift);

console.log(fails.length ? `\n${fails.length} FAILED:\n  ${fails.join('\n  ')}` : '\nall ammo checks passed');
process.exit(fails.length ? 1 : 0);
