// Ammunition is carried apart from the backpack: a reserve per calibre (state.ammo), up to AMMO_MAX of it, shown in
// the inventory's Ammunition panel. In-process checks of that, against a real Game and with what the server sends
// decoded as a client does: what is picked up goes into the reserve and never into a slot, a reload takes its rounds
// out of it, and half of a calibre or all of it goes on the ground for a teammate (ACT.DROP_AMMO).
// usage: node scripts/test-ammo.js [seed]
import { Game } from '../server/game.js';
import { C2S, S2C, ACT, PROTOCOL_VERSION, Writer, Reader, qangle16, qpitch, writeInput } from '../shared/protocol.js';
import { BTN, INVENTORY_SIZE, INVENTORY_MAX, SLOT_PRIMARY, SLOT_PISTOL } from '../shared/constants.js';
import { ITEM, ITEM_DEFS, WEAPONS, AMMO, AMMO_MAX, AMMO_ITEMS, NOTIFY, RECIPES } from '../shared/defs.js';
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
        for (let i = 0; i < INVENTORY_MAX; i++) {
          const item = r.u8();
          const count = r.u16();
          c.slots[i] = item ? { item, count } : null;
        }
        r.u8(); // armor: item, points, max
        r.u8();
        r.u8();
        r.u8(); // the backpack worn
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
    if (act === ACT.DROP_SLOT || act === ACT.SPLIT_INV || act === ACT.DROP_AMMO) w2.u16(b);
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
// ticks, with A standing still (fn: what she presses on tick i). After each one no backpack may hold a round, on the
// server or in what its client was last sent, and each client must have been told its reserves.
let drift = '';
const run = (ticks, fn) => {
  for (let i = 0; i < ticks; i++) {
    A.input(fn ? fn(i) : 0);
    game.update();
    for (const c of [A, B]) {
      const p = c.p();
      if (drift) continue;
      const inPack = p.inv.find((x) => x && ITEM_DEFS[x.item].cat === 'ammo');
      const told = c.slots.find((x) => x && ITEM_DEFS[x.item].cat === 'ammo');
      if (inPack || told) drift = `${c.name} at tick ${game.tick}: ${ITEM_DEFS[(inPack || told).item].name} in a backpack slot (${inPack ? 'server' : 'client'})`;
      else if (AMMO_ITEMS.some((_, cal) => c.self.ammo[cal] !== p.state.ammo[cal])) drift = `${c.name} at tick ${game.tick}: reserves ${p.state.ammo.join()}, client told ${c.self.ammo.join()}`;
    }
  }
};
const has = (p, item) => p.inv.reduce((n, x) => n + (x && x.item === item ? x.count : 0), 0);
const loose = (item) => game.items.filter((e) => e.item === item && e.drop && !e.removed);
const clearLoose = () => AMMO_ITEMS.forEach((item) => loose(item).forEach((e) => game.removeItemEnt(e)));
// the pack emptied but for these stacks
const pack = (p, ...list) => {
  p.inv.fill(null);
  list.forEach(([item, count], i) => (p.inv[i] = { item, count }));
  p.invDirty = true;
};
// the reserves set outright: these calibres to these counts, the rest empty
const carry = (p, list = {}) => {
  p.state.ammo.fill(0);
  for (const cal in list) p.state.ammo[cal] = list[cal];
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
const reloadTicks = (item, n = 1) => Math.ceil(WEAPONS[item].reload * 20 * n) + 4;

run(5);
check('a survivor starts with their 9mm in reserve, and none of it in the backpack', s.ammo[AMMO.P9] === 36 && has(a, ITEM.AMMO_9MM) === 0 && A.self.ammo[AMMO.P9] === 36, `reserve ${s.ammo[AMMO.P9]}, backpack ${has(a, ITEM.AMMO_9MM)}`);

// picked up: into the reserve, never a slot, and no further than AMMO_MAX
{
  const slots = a.inv.filter(Boolean).length;
  const took = game.giveItem(a, ITEM.AMMO_9MM, 60);
  run(2);
  check('ammunition picked up goes into the reserve and takes no backpack slot', took === 60 && s.ammo[AMMO.P9] === 96 && a.inv.filter(Boolean).length === slots && A.self.ammo[AMMO.P9] === 96, `took ${took}, reserve ${s.ammo[AMMO.P9]}, ${a.inv.filter(Boolean).length} of ${slots} slots`);
  const more = game.giveItem(a, ITEM.AMMO_9MM, 200);
  run(2);
  check('...up to the most of a calibre a survivor carries', more === AMMO_MAX[AMMO.P9] - 96 && s.ammo[AMMO.P9] === AMMO_MAX[AMMO.P9], `took ${more}, reserve ${s.ammo[AMMO.P9]} of ${AMMO_MAX[AMMO.P9]}`);
  pack(a, ...Array.from({ length: INVENTORY_SIZE }, () => [ITEM.CLOTH, 1]));
  const shells = game.giveItem(a, ITEM.AMMO_SHELLS, 8);
  run(2);
  check('...and a full backpack does not stop it', shells === 8 && s.ammo[AMMO.SHELL] === 8, `${shells} shells taken`);
  // walked over: what fits is taken, the rest stays down, and a full reserve is not news
  carry(a, { [AMMO.P9]: AMMO_MAX[AMMO.P9] - 10 });
  pack(a, [ITEM.BANDAGE, 1]);
  A.notes.length = 0;
  const e = game.spawnItem(ITEM.AMMO_9MM, 25, s.x + 0.6, s.y + 0.02, s.z, { drop: true, life: 60 });
  run(8);
  check('walked over, a stack gives what the reserve has room for and the rest stays on the ground', !e.removed && e.count === 15 && s.ammo[AMMO.P9] === AMMO_MAX[AMMO.P9] && has(a, ITEM.AMMO_9MM) === 0, `${e.count} left on the ground, reserve ${s.ammo[AMMO.P9]}`);
  check('...without a word about a full backpack', !A.notes.some(([m]) => m === NOTIFY.INVENTORY_FULL));
  game.removeItemEnt(e);
}

// a reload takes its rounds out of the reserve
{
  carry(a, { [AMMO.P9]: 36 });
  pack(a, [ITEM.BANDAGE, 2]);
  draw(SLOT_PISTOL, ITEM.PISTOL, WEAPONS[ITEM.PISTOL].mag);
  let t = 0;
  while (t < 200 && s.mags[1] > 7) run(1, () => (t++ % 2 ? 0 : BTN.ATTACK));
  const fired = WEAPONS[ITEM.PISTOL].mag - s.mags[1];
  run(1, () => BTN.RELOAD);
  run(reloadTicks(ITEM.PISTOL));
  check('a reload takes its rounds out of the reserve', fired === 5 && s.mags[1] === WEAPONS[ITEM.PISTOL].mag && s.ammo[AMMO.P9] === 31 && A.self.ammo[AMMO.P9] === 31 && has(a, ITEM.BANDAGE) === 2, `${fired} fired, magazine ${s.mags[1]}, reserve ${s.ammo[AMMO.P9]}`);
  carry(a, { [AMMO.P9]: 4 });
  s.mags[1] = 0;
  run(1, () => BTN.RELOAD);
  run(reloadTicks(ITEM.PISTOL));
  check('...and no more than there is', s.mags[1] === 4 && s.ammo[AMMO.P9] === 0, `magazine ${s.mags[1]}, reserve ${s.ammo[AMMO.P9]}`);
}
// a shotgun, shell by shell
{
  carry(a, { [AMMO.SHELL]: 10 });
  draw(SLOT_PRIMARY, ITEM.SHOTGUN, 0);
  run(1, () => BTN.RELOAD);
  run(Math.ceil(WEAPONS[ITEM.SHOTGUN].reload * 20) + 2);
  const one = [s.mags[0], s.ammo[AMMO.SHELL]].join('/');
  run(reloadTicks(ITEM.SHOTGUN, 6));
  check('a shotgun takes its shells out of the reserve one by one', one === '1/9' && s.mags[0] === WEAPONS[ITEM.SHOTGUN].mag && s.ammo[AMMO.SHELL] === 4, `after one shell ${one}, after the lot ${s.mags[0]}/${s.ammo[AMMO.SHELL]}`);
}

// Drop half / Drop all, for a teammate
{
  game.handleChat(b, `/tp ${s.x + 30} ${s.z}`);
  carry(a, { [AMMO.P9]: 37, [AMMO.SHELL]: 12 });
  carry(b);
  run(2);
  A.act(ACT.DROP_AMMO, AMMO.P9, Math.ceil(37 / 2)); // (what the panel's Half sends)
  run(2);
  const lying = loose(ITEM.AMMO_9MM);
  const e = lying[0];
  const seen = e && A.store.ents.get(e.id);
  check('Drop half puts half a calibre on the ground (rounded up) and keeps the rest', lying.length === 1 && e.count === 19 && s.ammo[AMMO.P9] === 18 && A.self.ammo[AMMO.P9] === 18 && seen?.q[3] === 19 && s.ammo[AMMO.SHELL] === 12, `${lying.map((x) => x.count).join()} on the ground, ${s.ammo[AMMO.P9]} kept`);
  run(120); // (past the pause before a drop can be walked over)
  check('...where the one who put it down does not walk it back up', !e.removed && e.count === 19 && s.ammo[AMMO.P9] === 18);
  game.handleChat(b, `/tp ${e.x} ${e.z}`);
  run(8);
  check('...and a teammate who walks over it has it in their reserve, not their backpack', e.removed && b.state.ammo[AMMO.P9] === 19 && B.self.ammo[AMMO.P9] === 19 && has(b, ITEM.AMMO_9MM) === 0, `Bob's reserve ${b.state.ammo[AMMO.P9]}`);
  game.handleChat(b, `/tp ${s.x + 30} ${s.z}`);
  run(2);
  A.act(ACT.DROP_AMMO, AMMO.SHELL, 0); // (what the panel's All sends)
  run(2);
  const shells = loose(ITEM.AMMO_SHELLS);
  check('Drop all puts the whole calibre down in one stack', shells.length === 1 && shells[0].count === 12 && s.ammo[AMMO.SHELL] === 0 && A.self.ammo[AMMO.SHELL] === 0 && s.ammo[AMMO.P9] === 18, `${shells.map((x) => x.count).join()} on the ground`);
  // more than there is: all of it. An empty reserve, or a calibre that is not one: nothing
  A.act(ACT.DROP_AMMO, AMMO.P9, 999);
  run(2);
  const nine = loose(ITEM.AMMO_9MM);
  check('...and asked for more than there is, it drops what there is', nine.length === 1 && nine[0].count === 18 && s.ammo[AMMO.P9] === 0);
  clearLoose();
  for (const [cal, n] of [[AMMO.P9, 0], [AMMO.SHELL, 5], [AMMO_ITEMS.length, 5], [200, 0]]) A.act(ACT.DROP_AMMO, cal, n);
  run(2);
  check('...but an empty reserve, or no calibre at all, drops nothing', AMMO_ITEMS.every((item) => loose(item).length === 0) && s.ammo.every((n) => n === 0));
}

// counts past 255: 16 bits on the wire, in the snapshot and in a drop
{
  carry(a, { [AMMO.FUEL]: 300 });
  run(2);
  const told = A.self.ammo[AMMO.FUEL];
  A.act(ACT.DROP_AMMO, AMMO.FUEL, 0);
  run(2);
  const lying = loose(ITEM.AMMO_FUEL);
  const seen = lying[0] && A.store.ents.get(lying[0].id);
  check('a reserve of 300 survives the wire: told, and dropped whole', told === 300 && lying.length === 1 && lying[0].count === 300 && seen?.q[3] === 300 && s.ammo[AMMO.FUEL] === 0, `told ${told}, dropped ${lying.map((x) => x.count).join()}`);
  clearLoose();
}

// all of it dropped in the middle of a reload: the reload finds nothing
{
  carry(a, { [AMMO.R762]: 30 });
  draw(SLOT_PRIMARY, ITEM.AK47, 0);
  run(1, () => BTN.RELOAD);
  run(4);
  const reloading = s.reloadT > 0;
  A.act(ACT.DROP_AMMO, AMMO.R762, 0);
  run(reloadTicks(ITEM.AK47));
  const lying = loose(ITEM.AMMO_762);
  check('rounds dropped in the middle of a reload do not end up in the magazine as well', reloading && s.mags[0] === 0 && s.ammo[AMMO.R762] === 0 && lying.length === 1 && lying[0].count === 30, `magazine ${s.mags[0]}, ${lying.map((x) => x.count).join()} on the ground`);
  clearLoose();
}

// crafted: a full reserve takes no more; one with room for part of a batch has the rest put at their feet
{
  const rec = RECIPES.find((r) => r.out === ITEM.AMMO_9MM);
  const bench = game.nearStation;
  game.nearStation = () => true;
  pack(a, [ITEM.SCRAP, 5], [ITEM.POWDER, 10]);
  carry(a, { [AMMO.P9]: AMMO_MAX[AMMO.P9] });
  A.notes.length = 0;
  A.act(ACT.CRAFT, rec.id);
  run(2);
  check('a full reserve crafts no more of it, and says which', has(a, ITEM.SCRAP) === 5 && A.notes.some(([m, x]) => m === NOTIFY.INVENTORY_FULL && x === ITEM.AMMO_9MM) && loose(ITEM.AMMO_9MM).length === 0);
  carry(a, { [AMMO.P9]: AMMO_MAX[AMMO.P9] - 5 });
  A.act(ACT.CRAFT, rec.id);
  run(2);
  const spilt = loose(ITEM.AMMO_9MM);
  check('...and a batch it has room for only part of goes on the ground for the rest', s.ammo[AMMO.P9] === AMMO_MAX[AMMO.P9] && spilt.length === 1 && spilt[0].count === rec.n - 5 && has(a, ITEM.SCRAP) === 4, `reserve ${s.ammo[AMMO.P9]}, ${spilt.map((x) => x.count).join()} on the ground`);
  game.nearStation = bench;
  clearLoose();
}

// dying: each reserve goes on the ground as one stack, once
{
  pack(a, [ITEM.BANDAGE, 1]);
  carry(a, { [AMMO.P9]: 45, [AMMO.SHELL]: 7 });
  run(2);
  game.killPlayer(a, {});
  run(2);
  const nine = loose(ITEM.AMMO_9MM).map((x) => x.count).join('+');
  const shells = loose(ITEM.AMMO_SHELLS).map((x) => x.count).join('+');
  check('a survivor who dies drops each calibre they carried', nine === '45' && shells === '7' && s.ammo.every((n) => n === 0), `9mm ${nine}, shells ${shells}`);
}

check('no backpack ever held a round, and every client was told its reserves', !drift, drift);

console.log(fails.length ? `\n${fails.length} FAILED:\n  ${fails.join('\n  ')}` : '\nall ammo checks passed');
process.exit(fails.length ? 1 : 0);
