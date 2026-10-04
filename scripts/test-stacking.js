// Stacking: a survivor never carries more than one part-used stack of anything, and that stack is the one the next
// pickup tops up. In-process against a real Game, with the packets written as Connection.action writes them and
// S2C.INVENTORY decoded as Game.onInventory reads it (the client's grid is checked against the server's after every
// step). Starts from what a player reported: three part-used stacks of Canned Tuna (3, 4 and 2 tins, where 9 tins
// are a 5 and a 4). Then every way into, out of and around the backpack: walk-over and [E] pickups (the backpack's
// own slots too), eating from the stack clicked or with [H] / [B], partial drops (Shift+RMB, the popover's Drop n),
// salvage, splits, drags, the auto sort, crafting, searches, leaving and coming back - and a randomized soak of thousands of
// those, the invariant checked after every one of them.
//
// A deliberate split (ACT.SPLIT_INV) is the one exception: the player asked for two stacks, and keeps them while that
// item's count stays as it is. The next change to it (a pickup, a use, a craft, a drop) merges the part stacks again
// (consolidate, server/inventory.js).
// usage: node scripts/test-stacking.js [seed] [soak steps]
import { randomUUID } from 'node:crypto';
import { Game } from '../server/game.js';
import { invCap } from '../server/inventory.js';
import { C2S, S2C, ACT, LEFT_CODE, PROTOCOL_VERSION, Writer, Reader, qangle16, qpitch, writeInput } from '../shared/protocol.js';
import { INVENTORY_SIZE, INVENTORY_MAX } from '../shared/constants.js';
import { ITEM, ITEM_DEFS, RECIPES, CONT, CONT_DEFS, SALVAGE } from '../shared/defs.js';
import { readSnapshot } from '../client/net/decode.js';
import { craftRun, copyInv } from '../client/game/bulkcraft.js';

const seed = +(process.argv[2] || 4242);
const SOAK = +(process.argv[3] || 4000);
const game = new Game({ seed, godMode: true, dayLength: 3600, log: () => {} });
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};
// the client's own pick for [H] / [B] (Game.quickHeal / quickDrink: shared/stacks.js), when there is one to import
const stacks = await import('../shared/stacks.js').catch(() => null);

// a client as test-backpack.js has it
function client(name, pid = '') {
  const c = { name, id: 0, net: { tick: 0, ack: 0 }, global: null, self: {}, store: { ents: new Map(), onCreate() {}, onRemove() {}, onUpdate() {} }, notes: [], seq: 0, slots: [], backpack: -1 };
  const nop = () => {};
  c.handler = new Proxy({ notify: (m, a) => c.notes.push([m, a]) }, { get: (t, k) => t[k] || nop });
  c.conn = {
    send(bytes) {
      const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
      const t = r.u8();
      if (t === S2C.WELCOME) c.id = r.u16();
      else if (t === S2C.SNAPSHOT) readSnapshot(r, c);
      else if (t === S2C.INVENTORY) {
        for (let i = 0; i < INVENTORY_MAX; i++) {
          const item = r.u8();
          const count = r.u16();
          c.slots[i] = item ? { item, count } : null;
        }
        r.u8();
        r.u8();
        r.u8();
        c.backpack = r.u8();
      }
    },
  };
  c.session = game.onOpen(c.conn);
  const w = new Writer(96);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str(name);
  if (pid) w.str(pid);
  game.onMessage(c.session, w.bytes().slice());
  c.p = () => game.players.get(c.id);
  if (c.p()) c.p().admin = true;
  c.act = (act, a, b) => {
    const w2 = new Writer(16);
    w2.u8(C2S.ACTION);
    w2.u8(act);
    if (act === ACT.INTERACT || act === ACT.HOLD_BEGIN) w2.u16(a);
    else {
      if (a !== undefined) w2.u8(a);
      if (act === ACT.DROP_SLOT || act === ACT.SPLIT_INV || act === ACT.SALVAGE) w2.u16(b);
      else if (b !== undefined) w2.u8(b);
    }
    game.onMessage(c.session, w2.bytes().slice());
  };
  c.input = (buttons = 0) => {
    const w2 = new Writer(64);
    w2.u8(C2S.INPUT);
    w2.u16(game.tick & 0xffff);
    w2.u8(0);
    const cmds = [];
    for (let i = 0; i < 3; i++) {
      c.seq = (c.seq + 1) & 0xffff;
      cmds.push({ seq: c.seq, buttons, qyaw: qangle16(0), qpitch: qpitch(0), slot: 255 });
    }
    writeInput(w2, cmds);
    game.onMessage(c.session, w2.bytes().slice());
  };
  return c;
}

// The safety net (tidyStacks, as the inventory goes out) must never be what keeps the invariant: every path merges its
// own part stacks, or the bulk craft model (bulkcraft.js) would part from the server between two crafts of a tick.
// What it would have had to merge is noted here, before it does.
// (A pack laid out by hand below is the test's doing, not a path's: `seeded`, skipped once.)
const netCaught = [];
const seeded = new Set();
const sendTick = game.sendTick;
game.sendTick = function (p, g) {
  if (seeded.delete(p)) {
    // laid out by hand
  } else if (p.invDirty) {
    const keep = new Set([...(p.splitKeep || [])].filter(([item, n]) => cnt(p, item) === n).map(([item]) => item));
    const bad = broken(p.inv, keep);
    if (bad.length && netCaught.length < 5) netCaught.push(`${p.name} at tick ${game.tick}: ${bad.map((i) => show(p, i)).join('; ')}`);
  }
  return sendTick.call(this, p, g);
};

const A = client('Alice');
let a = A.p();
const run = (ticks) => {
  for (let i = 0; i < ticks; i++) {
    A.input();
    game.update();
  }
};
const stackable = (item) => (ITEM_DEFS[item]?.stack || 1) > 1;
const cnt = (p, item) => p.inv.reduce((n, x) => n + (x && x.item === item ? x.count : 0), 0);
const of = (p, item) => p.inv.filter((x) => x && x.item === item).map((x) => x.count);
const show = (p, item) => `${ITEM_DEFS[item].name}: ${of(p, item).join(' / ') || 'none'}`;
const parts = (slots, item) => slots.filter((x) => x && x.item === item && x.count < ITEM_DEFS[item].stack).length;
// every item with more than one part-used stack (but those `except`)
const broken = (slots, except = new Set()) => {
  const seen = new Set();
  for (const x of slots) if (x && stackable(x.item) && !except.has(x.item) && parts(slots, x.item) > 1) seen.add(x.item);
  return [...seen];
};
const same = (c, p) => p.inv.every((x, i) => (x ? x.item * 65536 + x.count : 0) === (c.slots[i] ? c.slots[i].item * 65536 + c.slots[i].count : 0));
const pack = (p, ...list) => {
  seeded.add(p);
  p.inv.fill(null);
  list.forEach((x, i) => (p.inv[i] = x && { item: x[0], count: x[1] }));
  p.invDirty = true;
};
const clearGround = () => {
  for (const e of [...game.items]) if (!e.removed && e.drop) game.removeItemEnt(e);
};
// n of an item lying at the survivor's feet: walked over (auto), or left for [E] (noAuto)
const lay = (p, item, n, opts = {}) => game.spawnItem(item, n, p.state.x, p.state.y, p.state.z, { drop: true, ...opts });
const walkOver = (p, item, n) => {
  const e = lay(p, item, n);
  run(6);
  return e;
};
// eat / use what is in slot idx, to the end (a use runs on the ticks: its time is wound on, not waited out)
const use = (c, idx) => {
  const p = c.p();
  p.hp = 10;
  c.act(ACT.USE_ITEM, idx);
  run(1);
  if (p.useItem) p.useItem.t = p.useItem.total;
  run(2);
};
// [H] / [B]: the stack the client picks (shared/stacks.js: the smallest; the first one on the old client)
const keyIdx = (p, item) => (stacks ? stacks.smallestStack(p.inv, item) : p.inv.findIndex((x) => x && x.item === item));

run(5);
const s = a.state;

// ---------------------------------------------------------------- the report: tins in 3 / 4 / 2
// Fifteen tins come in two at a time (walked over, and out of a fridge), three are eaten with [H], two are handed to
// a teammate from the first stack (the popover's Drop 2) and one from the second (Shift+RMB). Nine tins are a 5
// and a 4.
{
  pack(a);
  run(2);
  for (let k = 0; k < 4; k++) walkOver(a, ITEM.TUNA, 2);
  for (let k = 0; k < 3; k++) game.giveOrDrop(a, ITEM.TUNA, 2);
  walkOver(a, ITEM.TUNA, 1);
  const in15 = of(a, ITEM.TUNA).join('/');
  for (let k = 0; k < 3; k++) use(A, keyIdx(a, ITEM.TUNA));
  const first = a.inv.findIndex((x) => x && x.item === ITEM.TUNA);
  A.act(ACT.DROP_SLOT, first, 2); // the popover's "Drop 2"
  run(1);
  const second = a.inv.findIndex((x, i) => i > first && x && x.item === ITEM.TUNA && x.count === ITEM_DEFS[ITEM.TUNA].stack);
  if (second >= 0) A.act(ACT.DROP_SLOT, second, 1); // Shift+RMB: one tin
  run(2);
  const got = of(a, ITEM.TUNA);
  check('15 tins picked up two at a time are three full stacks', in15 === '5/5/5', in15);
  check('...and with 3 eaten and 3 handed over, the 9 left are a 5 and a 4 (not 3 / 4 / 2)', cnt(a, ITEM.TUNA) === 9 && got.length === 2 && parts(a.inv, ITEM.TUNA) === 1 && same(A, a), show(a, ITEM.TUNA));
  clearGround();
  walkOver(a, ITEM.TUNA, 2);
  check('...and the next 2 picked up make 5 + 5 + 1', of(a, ITEM.TUNA).join('/') === '5/5/1' && same(A, a), show(a, ITEM.TUNA));
}

// ---------------------------------------------------------------- walk-over pickups: topping up across the grid
{
  // the part stack sits in the backpack's slots, with free slots in front of it
  const pad = Array.from({ length: 10 }, () => [ITEM.LEATHER, 10]);
  pack(a, ...pad);
  a.inv[0] = { item: ITEM.BACKPACK, count: 1 };
  A.act(ACT.EQUIP_ARMOR, 0);
  run(2);
  a.inv[30] = { item: ITEM.TUNA, count: 2 };
  a.inv[5] = { item: ITEM.TUNA, count: 5 };
  a.invDirty = true;
  walkOver(a, ITEM.TUNA, 2);
  check('a walk-over pickup tops up a part stack in the backpack\'s slots, and the grid is sorted: the tins first', of(a, ITEM.TUNA).join('/') === '5/4' && a.inv[1]?.item === ITEM.TUNA && same(A, a), show(a, ITEM.TUNA));
  walkOver(a, ITEM.TUNA, 3);
  check('...fills it and starts one new part stack with the rest', of(a, ITEM.TUNA).join('/') === '5/5/2' && a.inv[2]?.item === ITEM.TUNA && parts(a.inv, ITEM.TUNA) === 1, show(a, ITEM.TUNA));
  walkOver(a, ITEM.TUNA, 1);
  check('...and the next pickup goes onto that one', of(a, ITEM.TUNA).join('/') === '5/5/3', show(a, ITEM.TUNA));
  // a full grid: only what tops up the part stack is taken, the rest stays on the ground
  for (let i = 0; i < invCap(a); i++) if (!a.inv[i]) a.inv[i] = { item: ITEM.LEATHER, count: 10 };
  a.invDirty = true;
  const e = walkOver(a, ITEM.TUNA, 4);
  check('with every slot taken, a pile of 4 tops up the part stack and leaves the rest lying', of(a, ITEM.TUNA).join('/') === '5/5/5' && !e.removed && e.count === 2, `${show(a, ITEM.TUNA)}, ${e.removed ? 'none' : e.count} left on the ground`);
  a.backpackItem = 0;
  pack(a);
  clearGround();
  run(2);
}

// ---------------------------------------------------------------- [E] pickups, and a pickup after a use
{
  pack(a, [ITEM.TUNA, 5], null, [ITEM.TUNA, 5]);
  use(A, 0); // the first stack, clicked
  check('a tin eaten from the stack clicked (the first) comes out of that one', of(a, ITEM.TUNA).join('/') === '4/5' && same(A, a), show(a, ITEM.TUNA));
  const e = lay(a, ITEM.TUNA, 3, { noAuto: 60 });
  run(1);
  a.interactT = -1;
  A.act(ACT.INTERACT, e.id);
  run(2);
  check('...[E] on 3 tins tops it up and puts the other 2 in a stack of their own, the grid sorted', e.removed && of(a, ITEM.TUNA).join('/') === '5/5/2' && a.inv[2]?.count === 2 && parts(a.inv, ITEM.TUNA) === 1 && same(A, a), show(a, ITEM.TUNA));
  clearGround();
}

// ---------------------------------------------------------------- [H], [B] and a clicked stack
{
  pack(a, [ITEM.TUNA, 5], [ITEM.TUNA, 3], [ITEM.TUNA, 5]);
  run(2);
  use(A, keyIdx(a, ITEM.TUNA));
  check('[H] eats from the smallest stack', of(a, ITEM.TUNA).join('/') === '5/2/5' && same(A, a), show(a, ITEM.TUNA));
  use(A, 2);
  check('a tin eaten from a full stack clicked in the grid, with a part stack beside it, comes out of the part stack', of(a, ITEM.TUNA).join('/') === '5/1/5' && cnt(a, ITEM.TUNA) === 11 && same(A, a), show(a, ITEM.TUNA));
  pack(a, [ITEM.ENERGY_DRINK, 5], [ITEM.ENERGY_DRINK, 2]);
  a.state.stamina = 0;
  run(2);
  use(A, keyIdx(a, ITEM.ENERGY_DRINK));
  a.state.stamina = 0;
  use(A, 0);
  check('[B] and a can clicked: the drinks are a 5 and a part stack', of(a, ITEM.ENERGY_DRINK).join('/') === '5' && same(A, a), show(a, ITEM.ENERGY_DRINK));
  if (stacks) {
    const inv = [null, { item: ITEM.TUNA, count: 5 }, { item: ITEM.TUNA, count: 2 }, { item: ITEM.TUNA, count: 2 }, { item: ITEM.TUNA, count: 5 }];
    check('the client\'s [H] / [B] pick is the stack removeItem takes from (the smallest, the later of two)', stacks.smallestStack(inv, ITEM.TUNA) === 3 && stacks.smallestStack(inv, ITEM.BANDAGE) === -1);
  }
}

// ---------------------------------------------------------------- partial drops, salvage, splits and drags
{
  pack(a, [ITEM.BANDAGE, 5], [ITEM.BANDAGE, 5], [ITEM.BANDAGE, 3]);
  run(2);
  A.act(ACT.DROP_SLOT, 0, 2);
  run(2);
  check('dropping 2 off a full stack while another is part-used takes them from the part stack', of(a, ITEM.BANDAGE).join('/') === '5/5/1' && same(A, a), show(a, ITEM.BANDAGE));
  A.act(ACT.SALVAGE, 0, 2);
  run(2);
  check('salvaging 2 off a full stack likewise, and what is left is one part stack (the cloth it gives sorts the grid)', of(a, ITEM.BANDAGE).join('/') === '5/4' && cnt(a, ITEM.CLOTH) === 2 && same(A, a), show(a, ITEM.BANDAGE));
  clearGround();
  // a split is kept apart while nothing changes, then merged by the next pickup
  pack(a, [ITEM.TUNA, 5], [ITEM.TUNA, 4]);
  run(2);
  A.act(ACT.SPLIT_INV, 0, 2);
  run(2);
  check('a split makes the stacks asked for', of(a, ITEM.TUNA).join('/') === '3/4/2' && same(A, a), show(a, ITEM.TUNA));
  A.act(ACT.SWAP_INV, 2, 5);
  run(2);
  check('...and they stay apart while they are only moved about', of(a, ITEM.TUNA).join('/') === '3/4/2' && a.inv[5]?.count === 2, show(a, ITEM.TUNA));
  walkOver(a, ITEM.TUNA, 1);
  check('...until the next pickup, which merges them: 10 tins are two full stacks', of(a, ITEM.TUNA).join('/') === '5/5' && same(A, a), show(a, ITEM.TUNA));
  A.act(ACT.SPLIT_INV, 0, 1);
  run(2);
  use(A, keyIdx(a, ITEM.TUNA));
  check('...or the next one eaten', of(a, ITEM.TUNA).join('/') === '4/5' && parts(a.inv, ITEM.TUNA) === 1, show(a, ITEM.TUNA));
  // drags: a part stack onto a full one of the same trades places with it; one part stack onto another tops it up
  pack(a, [ITEM.TUNA, 2], [ITEM.TUNA, 5]);
  run(2);
  A.act(ACT.SWAP_INV, 0, 1);
  run(2);
  check('dragged onto a full stack of the same, a part stack trades places with it (as the client shows it at once)', a.inv[0]?.count === 5 && a.inv[1]?.count === 2 && same(A, a), show(a, ITEM.TUNA));
  A.act(ACT.SPLIT_INV, 0, 2);
  run(2);
  A.act(ACT.SWAP_INV, 2, 1);
  run(2);
  check('...and one part stack dragged onto another tops it up', of(a, ITEM.TUNA).join('/') === '3/4' || of(a, ITEM.TUNA).join('/') === '3/4/0', show(a, ITEM.TUNA));
  // the auto sort: a pickup or a drop sorts the grid, but leaves a split of something else apart
  const gapless = (p) => p.inv.findIndex((x) => !x) === p.inv.filter(Boolean).length;
  pack(a, [ITEM.CLOTH, 5], null, [ITEM.TUNA, 5], [ITEM.TUNA, 4]);
  run(2);
  A.act(ACT.SPLIT_INV, 2, 2);
  run(2);
  walkOver(a, ITEM.BANDAGE, 1);
  const cloth = a.inv.findIndex((x) => x && x.item === ITEM.CLOTH);
  check('a pickup sorts the grid: no gaps, the consumables before the cloth, and the tins split stay apart', gapless(a) && cloth === 4 && of(a, ITEM.TUNA).join('/') === '4/3/2' && cnt(a, ITEM.BANDAGE) === 1 && same(A, a), `${show(a, ITEM.TUNA)}, cloth in ${cloth}`);
  A.act(ACT.DROP_SLOT, 0, 0);
  run(2);
  check('...and so does a drop: the slot it leaves is closed up', gapless(a) && a.inv.filter(Boolean).length === 4 && same(A, a), a.inv.slice(0, 6).map((x) => (x ? ITEM_DEFS[x.item].name + ' x' + x.count : '-')).join(', '));
  clearGround();
}

// ---------------------------------------------------------------- crafting and searches
{
  // a craft's output and its payment, after a split
  pack(a, [ITEM.BANDAGE, 5], [ITEM.BANDAGE, 4], [ITEM.CLOTH, 20], [ITEM.CLOTH, 20]);
  run(2);
  A.act(ACT.SPLIT_INV, 1, 2);
  A.act(ACT.SPLIT_INV, 2, 5);
  run(2);
  A.act(ACT.CRAFT, 1); // a bandage, for 2 cloth
  run(2);
  check('a craft merges the part stacks of what it makes and of what it pays with', of(a, ITEM.BANDAGE).join('/') === '5/5' && broken(a.inv).length === 0 && cnt(a, ITEM.CLOTH) === 38, `${show(a, ITEM.BANDAGE)}; ${show(a, ITEM.CLOTH)}`);
  // a bulk craft (Ctrl+click): the client's model of it ends where the server does, merging included
  pack(a, [ITEM.CLOTH, 3], [ITEM.BANDAGE, 2], [ITEM.CLOTH, 3], [ITEM.BANDAGE, 1], ...Array.from({ length: 20 }, () => [ITEM.LEATHER, 10]));
  run(2);
  const model = copyInv({ slots: a.inv, ammo: s.ammo, weapons: s.weapons, cap: invCap(a) });
  const n = craftRun(RECIPES[1], model, 20);
  for (let k = 0; k < n; k++) A.act(ACT.CRAFT, 1);
  run(2);
  const at = (x) => (x ? x.item * 65536 + x.count : 0);
  check('a bulk craft: the client\'s model (bulkcraft.js) is what the server ends with', n === 3 && a.inv.every((x, i) => at(x) === at(model.slots[i])) && broken(a.inv).length === 0, `${n} crafts; ${show(a, ITEM.BANDAGE)}`);
  // searches: fridges, again and again
  const box = game.caches.find((c) => c.ctype === CONT.FRIDGE) || game.caches.find((c) => CONT_DEFS[c.ctype].table);
  pack(a, [ITEM.TUNA, 3]);
  let worst = [];
  for (let k = 0; k < 60; k++) {
    game.searchCache(a, box);
    if (k % 5 === 4) use(A, keyIdx(a, ITEM.TUNA) >= 0 ? keyIdx(a, ITEM.TUNA) : 0);
    run(1);
    const bad = broken(a.inv);
    if (bad.length) worst = bad;
  }
  check('60 searches, eating as they go, never leave two part stacks', worst.length === 0 && same(A, a), worst.map((i) => show(a, i)).join('; '));
  pack(a);
  clearGround();
  run(2);
}

// ---------------------------------------------------------------- leaving and coming back
{
  // (Alice out of the way: what is laid at Dana's feet is for Dana)
  const home = { x: s.x, z: s.z };
  game.handleChat(a, `/tp ${s.x + 40} ${s.z}`);
  run(3);
  const pid = randomUUID();
  let D = client('Dana', pid);
  run(2);
  let d = D.p();
  // her starting 2 bandages, 11 found, and a split
  game.giveItem(d, ITEM.BANDAGE, 11);
  d.inv[d.inv.findIndex((x) => x && x.item === ITEM.BANDAGE && x.count === 5)].count = 4;
  d.inv[d.inv.findIndex((x) => !x)] = { item: ITEM.BANDAGE, count: 1 };
  d.invDirty = true;
  seeded.add(d);
  run(2);
  game.onClose(D.session, 1006); // a dropped connection: her body is held
  run(3);
  D = client('Dana', pid);
  run(3);
  check('a dropped survivor comes back to the stacks she had', D.p() === d && same(D, d), show(d, ITEM.BANDAGE));
  const lying = new Set(game.items);
  game.onClose(D.session, LEFT_CODE); // "Leave game": the kit goes with her, the rest is dropped
  run(3);
  const spilt = game.items.filter((e) => !e.removed && !lying.has(e) && e.item === ITEM.BANDAGE);
  D = client('Dana', pid);
  run(3);
  d = D.p();
  const kit = of(d, ITEM.BANDAGE).join('/');
  for (const e of spilt) {
    e.droppedBy = 0;
    e.noAutoUntil = 0;
    game.removeItemEnt(e);
    lay(d, ITEM.BANDAGE, e.count);
  }
  run(8);
  check('back with her kit (2 bandages), she picks the rest up off the ground into full stacks and one part stack', kit === '2' && cnt(d, ITEM.BANDAGE) === 13 && of(d, ITEM.BANDAGE).join('/') === '5/5/3' && same(D, d), `kit ${kit}; ${show(d, ITEM.BANDAGE)}`);
  game.onClose(D.session, LEFT_CODE);
  clearGround();
  game.handleChat(a, `/tp ${home.x} ${home.z}`);
  run(3);
}

// ---------------------------------------------------------------- the soak
// Thousands of random steps by one survivor over a handful of items: pickups (walked over, [E], searched, given),
// eating from a stack clicked or with [H], crafts, whole and partial drops, salvage, splits and drags. After
// every step, no item has two part stacks - but one split since its count last changed - and the client's grid is
// the server's.
{
  let r = seed >>> 0;
  const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const ITEMS = [ITEM.TUNA, ITEM.BANDAGE, ITEM.ENERGY_DRINK, ITEM.CLOTH, ITEM.TORCH, ITEM.STICK];
  const USABLE = [ITEM.TUNA, ITEM.BANDAGE, ITEM.ENERGY_DRINK];
  pack(a, [ITEM.CLOTH, 20], [ITEM.STICK, 20]);
  run(2);
  const split = new Map(); // item -> its count when it was last split (exempt while that is still the count)
  let firstBad = null;
  let steps = 0;
  const occupied = () => a.inv.map((x, i) => (x && i < invCap(a) ? i : -1)).filter((i) => i >= 0);
  const slotOf = (items) => {
    const at = a.inv.map((x, i) => (x && items.includes(x.item) ? i : -1)).filter((i) => i >= 0);
    return at.length ? pick(at) : -1;
  };
  for (; steps < SOAK && !firstBad; steps++) {
    const op = Math.floor(rnd() * 12);
    let what = '';
    if (op === 0 || op === 1) {
      const item = pick(ITEMS);
      const n = 1 + Math.floor(rnd() * 7);
      what = `walk over ${n} ${ITEM_DEFS[item].name}`;
      walkOver(a, item, n);
    } else if (op === 2) {
      const item = pick(ITEMS);
      const n = 1 + Math.floor(rnd() * 4);
      what = `[E] on ${n} ${ITEM_DEFS[item].name}`;
      const e = lay(a, item, n, { noAuto: 60 });
      a.interactT = -1;
      A.act(ACT.INTERACT, e.id);
      run(1);
    } else if (op === 3) {
      const item = pick(ITEMS);
      const n = 1 + Math.floor(rnd() * 3);
      what = `search / craft refund: ${n} ${ITEM_DEFS[item].name}`;
      game.giveOrDrop(a, item, n);
      run(1);
    } else if (op === 4 || op === 5) {
      const i = slotOf(USABLE);
      if (i < 0) continue;
      what = `eat / use slot ${i} (${ITEM_DEFS[a.inv[i].item].name})`;
      a.state.stamina = 0;
      use(A, i);
    } else if (op === 6) {
      const item = pick(USABLE);
      const i = keyIdx(a, item);
      if (i < 0) continue;
      what = `[H]/[B] ${ITEM_DEFS[item].name} (slot ${i})`;
      a.state.stamina = 0;
      use(A, i);
    } else if (op === 7) {
      const id = pick([0, 1]); // a torch, a bandage
      what = `craft ${ITEM_DEFS[RECIPES[id].out].name}`;
      A.act(ACT.CRAFT, id);
      run(1);
    } else if (op === 8) {
      const i = slotOf(ITEMS);
      if (i < 0) continue;
      const n = rnd() < 0.3 ? 0 : 1 + Math.floor(rnd() * a.inv[i].count);
      what = `drop ${n || 'all'} of slot ${i} (${ITEM_DEFS[a.inv[i].item].name} x${a.inv[i].count})`;
      A.act(ACT.DROP_SLOT, i, n);
      run(1);
      clearGround();
    } else if (op === 9) {
      const i = slotOf([ITEM.BANDAGE, ITEM.TORCH]);
      if (i < 0 || !SALVAGE[a.inv[i].item]) continue;
      const n = 1 + Math.floor(rnd() * a.inv[i].count);
      what = `salvage ${n} of slot ${i} (${ITEM_DEFS[a.inv[i].item].name} x${a.inv[i].count})`;
      A.act(ACT.SALVAGE, i, n);
      run(1);
      clearGround();
    } else if (op === 10) {
      const i = slotOf(ITEMS);
      if (i < 0 || a.inv[i].count < 2) continue;
      const n = 1 + Math.floor(rnd() * (a.inv[i].count - 1));
      const item = a.inv[i].item;
      what = `split ${n} off slot ${i} (${ITEM_DEFS[item].name} x${a.inv[i].count})`;
      A.act(ACT.SPLIT_INV, i, n);
      run(1);
      split.set(item, cnt(a, item));
    } else {
      const occ = occupied();
      if (occ.length < 2) continue;
      const i = pick(occ);
      const j = pick(occ);
      what = `drag slot ${i} onto ${j}`;
      A.act(ACT.SWAP_INV, i, j);
      run(1);
    }
    run(1);
    // a split is exempt only while its item's count is what it was split at
    for (const [item, n] of split) if (cnt(a, item) !== n) split.delete(item);
    const bad = broken(a.inv, new Set(split.keys()));
    if (bad.length || !same(A, a)) firstBad = `step ${steps}, after "${what}": ${bad.length ? bad.map((i) => show(a, i)).join('; ') : 'the client grid is not the server\'s'}`;
    // keep a few slots free, and the pile from getting out of hand
    if (a.inv.filter(Boolean).length > 20) {
      pack(a, [ITEM.CLOTH, 20], [ITEM.STICK, 20]);
      split.clear();
      run(1);
    }
  }
  check(`a soak of ${SOAK} random pickups, uses, crafts, drops, salvage, splits, drags and sorts never leaves two part stacks`, !firstBad, firstBad || `${steps} steps`);
}

check('no path left part stacks for the safety net (tidyStacks) to merge', netCaught.length === 0, netCaught.join(' | '));

console.log(fails.length ? `\n${fails.length} FAILED:\n  ${fails.join('\n  ')}` : '\nall stacking checks passed');
process.exit(fails.length ? 1 : 0);
