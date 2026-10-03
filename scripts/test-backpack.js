// The craftable Backpack, in-process against a real Game, with what the server sends decoded as a client does. Worn
// in an equipment slot of its own like armor, it opens BACKPACK_SLOTS more slots in the same grid (INVENTORY_SIZE ->
// INVENTORY_MAX). Without it those slots are locked: nothing a pickup, a craft, a search, a split or a drag does may
// put anything in one. It does not come off while its own slots hold anything; it goes down with everything else
// when its wearer dies, and stays on through a dropped connection. Also: play never leaves two part-used stacks of
// an item (removeItem takes from the smallest).
// usage: node scripts/test-backpack.js [seed]
import { randomUUID } from 'node:crypto';
import { Game } from '../server/game.js';
import { invCap } from '../server/inventory.js';
import { C2S, S2C, ACT, PFLAG, WORN, WORN_DO, PROTOCOL_VERSION, Writer, Reader, qangle16, qpitch, writeInput } from '../shared/protocol.js';
import { BTN, INVENTORY_SIZE, INVENTORY_MAX, BACKPACK_SLOTS, SLOT_PISTOL, SLOT_BUILD } from '../shared/constants.js';
import { ITEM, ITEM_DEFS, WEAPONS, RECIPES, STRUCT, STRUCT_DEFS, CONT, CONT_DEFS, AMMO, AMMO_MAX, NOTIFY, salvageOf } from '../shared/defs.js';
import { readSnapshot } from '../client/net/decode.js';

const seed = +(process.argv[2] || 4242);
const game = new Game({ seed, godMode: true, dayLength: 3600, log: () => {} });
game.debugCommands = true;
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};

// a client as test-ammo.js has it, that also reads the worn backpack off the end of S2C.INVENTORY. pid: a browser
// id, so that a dropped connection is held for it (Game.hold / resume)
function client(name, pid = '') {
  const c = { name, id: 0, net: { tick: 0, ack: 0 }, global: null, self: {}, store: { ents: new Map(), onCreate() {}, onRemove() {}, onUpdate() {} }, notes: [], seq: 0, slots: [], backpack: -1, invMsgs: 0 };
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
        c.backpack = r.u8();
        c.invMsgs++;
        if (r.left !== 0) throw new Error(`${name}: ${r.left} trailing inventory bytes`);
      }
    },
  };
  c.join = () => {
    c.session = game.onOpen(c.conn);
    const w = new Writer(96);
    w.u8(C2S.JOIN);
    w.u8(PROTOCOL_VERSION);
    w.str(name);
    if (pid) w.str(pid);
    game.onMessage(c.session, w.bytes().slice());
  };
  c.join();
  c.p = () => game.players.get(c.id);
  // an action, as Connection.action writes it (client/net/connection.js)
  c.act = (act, a, b) => {
    const w2 = new Writer(16);
    w2.u8(C2S.ACTION);
    w2.u8(act);
    if (act === ACT.INTERACT || act === ACT.HOLD_BEGIN) w2.u16(a);
    else if (act === ACT.BUILD) {
      w2.u8(a);
      w2.i16(Math.round(b.x * 64));
      w2.i16(Math.round(b.z * 64));
      w2.u8(0);
    } else {
      if (a !== undefined) w2.u8(a);
      if (act === ACT.DROP_SLOT || act === ACT.SPLIT_INV) w2.u16(b);
      else if (b !== undefined) w2.u8(b);
    }
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
  c.told = (m) => c.notes.filter(([n]) => n === m).length;
  return c;
}

const A = client('Alice');
const B = client('Bob');
const a = A.p();
const b = B.p();
const s = a.state;
let fn = null; // what Alice presses on a tick
const run = (ticks) => {
  for (let i = 0; i < ticks; i++) {
    A.input(fn ? fn(i) : 0);
    game.update();
  }
};
const has = (p, item) => p.inv.reduce((n, x) => n + (x && x.item === item ? x.count : 0), 0);
const pockets = (p) => p.inv.slice(INVENTORY_SIZE).filter(Boolean).length;
const lockedClean = (p) => p.inv.length === INVENTORY_MAX && p.inv.slice(invCap(p)).every((x) => !x);
// what is where in the pack (the full stacks of leather that pad it out counted, not listed)
const desc = (p) => {
  const pad = p.inv.filter((x) => x && x.item === ITEM.LEATHER && x.count === ITEM_DEFS[ITEM.LEATHER].stack).length;
  const rest = p.inv.map((x, i) => (x && !(x.item === ITEM.LEATHER && x.count === ITEM_DEFS[ITEM.LEATHER].stack) ? `${i}:${ITEM_DEFS[x.item].name}x${x.count}` : '')).filter(Boolean);
  return (pad ? [`${pad} full leather`, ...rest] : rest).join(' ');
};
const loose = (item) => game.items.filter((e) => e.item === item && !e.removed);
// the pack emptied but for these stacks, from slot 0 on
const pack = (p, ...list) => {
  p.inv.fill(null);
  list.forEach(([item, count], i) => (p.inv[i] = { item, count }));
  p.invDirty = true;
};
// n full stacks of leather (nothing below can add to them or use them)
const fill = (n) => Array.from({ length: n }, () => [ITEM.LEATHER, ITEM_DEFS[ITEM.LEATHER].stack]);
// put a backpack on: into the grid, and LMB on it there (the inventory screen sends ACT.EQUIP_ARMOR for it)
const wear = (c, at = 0) => {
  const p = c.p();
  p.inv[at] = { item: ITEM.BACKPACK, count: 1 };
  p.invDirty = true;
  c.act(ACT.EQUIP_ARMOR, at);
  run(2);
};
const unwear = (p) => {
  p.backpackItem = 0;
  p.invDirty = true;
};

run(5);

// ---------------------------------------------------------------- the item and its recipe
{
  const rec = RECIPES.find((r) => r.out === ITEM.BACKPACK);
  const def = ITEM_DEFS[ITEM.BACKPACK];
  check('the backpack is a worn item of its own category, one to a slot', ITEM.BACKPACK === 46 && def.cat === 'pack' && def.stack === 1);
  check('...made at the workbench from 4 leather, 6 cloth and 2 rope (its id is its place in RECIPES)', !!rec && RECIPES[rec.id] === rec && rec.station === 'bench' && JSON.stringify(rec.cost) === JSON.stringify({ [ITEM.CLOTH]: 6, [ITEM.ROPE]: 2, [ITEM.LEATHER]: 4 }), JSON.stringify(rec?.cost));
  check('...and salvaged for about half: 2 leather, 3 cloth, 1 rope', JSON.stringify(salvageOf(ITEM.BACKPACK)) === JSON.stringify({ [ITEM.CLOTH]: 3, [ITEM.ROPE]: 1, [ITEM.LEATHER]: 2 }), JSON.stringify(salvageOf(ITEM.BACKPACK)));
}

// ---------------------------------------------------------------- capacity
check('a survivor has 24 slots, and an inventory is always 34 long', invCap(a) === INVENTORY_SIZE && INVENTORY_SIZE === 24 && INVENTORY_MAX === 34 && a.inv.length === 34 && A.slots.length === 34 && A.backpack === 0, `${invCap(a)} open of ${a.inv.length}, client told ${A.slots.length} and backpack ${A.backpack}`);

// crafting it at a real workbench
{
  game.giveItem(a, ITEM.WOOD, 10);
  game.giveItem(a, ITEM.NAILS, 10);
  game.giveItem(a, ITEM.SCRAP, 4);
  A.input(0, SLOT_BUILD);
  run(12);
  let built = null;
  for (let k = 0; k < 24 && !built; k++) {
    const r = 2.5 + (k % 3);
    const ang = (k / 24) * Math.PI * 2 * 3;
    a.actionT = -1;
    A.act(ACT.BUILD, STRUCT.WORKBENCH, { x: s.x + Math.sin(ang) * r, z: s.z + Math.cos(ang) * r });
    run(2);
    built = game.structures.find((e) => e.stype === STRUCT.WORKBENCH);
  }
  check('a workbench goes up beside her', !!built);
  pack(a, [ITEM.LEATHER, 5], [ITEM.CLOTH, 7], [ITEM.ROPE, 3]);
  run(2);
  const id = RECIPES.find((r) => r.out === ITEM.BACKPACK).id;
  A.act(ACT.CRAFT, id);
  run(2);
  check('the backpack is crafted at the workbench, for exactly its cost', has(a, ITEM.BACKPACK) === 1 && has(a, ITEM.LEATHER) === 1 && has(a, ITEM.CLOTH) === 1 && has(a, ITEM.ROPE) === 1 && a.backpackItem === 0, desc(a));
  A.notes.length = 0;
  A.act(ACT.CRAFT, id);
  run(2);
  check('...and not without the materials', has(a, ITEM.BACKPACK) === 1 && A.told(NOTIFY.NOT_ENOUGH) === 1);

  // worn by LMB on it in the grid
  const at = a.inv.findIndex((x) => x && x.item === ITEM.BACKPACK);
  A.act(ACT.EQUIP_ARMOR, at);
  run(2);
  check('LMB on it in the grid puts it on: 34 slots, told to the client', a.backpackItem === ITEM.BACKPACK && !a.inv[at] && invCap(a) === INVENTORY_MAX && A.backpack === ITEM.BACKPACK && has(a, ITEM.BACKPACK) === 0, `worn ${a.backpackItem}, cap ${invCap(a)}, client ${A.backpack}`);
  const seen = B.store.ents.get(a.id);
  check('...and the others see it on her back (PFLAG.BACKPACK)', !!seen && (seen.q[5] & PFLAG.BACKPACK) !== 0, seen ? `flags ${seen.q[5]}` : 'not in view');

  // salvaged from its equipment row: about half back, and it is gone
  pack(a);
  A.act(ACT.WORN, WORN.BACKPACK, WORN_DO.SALVAGE);
  run(2);
  check('Shift+LMB on the Backpack row salvages it: 2 leather, 3 cloth, 1 rope', a.backpackItem === 0 && has(a, ITEM.LEATHER) === 2 && has(a, ITEM.CLOTH) === 3 && has(a, ITEM.ROPE) === 1 && A.backpack === 0 && invCap(a) === INVENTORY_SIZE, desc(a));
  const seen2 = B.store.ents.get(a.id);
  check('...and it is off her back', !!seen2 && (seen2.q[5] & PFLAG.BACKPACK) === 0);
}

// ---------------------------------------------------------------- nothing lands in a locked slot
// a pickup from the ground (walked over), past a full 24
{
  pack(a, ...fill(24));
  run(2);
  const lying = game.dropItem(ITEM.BANDAGE, 2, s.x, s.y, s.z, { spread: 0 });
  run(12);
  check('with 24 slots full a pickup is refused without a backpack', !!lying && !lying.removed && has(a, ITEM.BANDAGE) === 0 && lockedClean(a), desc(a));
  wear(A, 0);
  a.inv[0] = { item: ITEM.LEATHER, count: 10 }; // (full again, with the backpack on)
  a.invDirty = true;
  lying.noAutoUntil = 0;
  run(12);
  check('...and taken into slot 25 with one', lying.removed && a.inv[INVENTORY_SIZE]?.item === ITEM.BANDAGE && A.slots[INVENTORY_SIZE]?.count === 2, desc(a));
  unwear(a);
}
// what a craft makes
{
  pack(a, ...fill(23), [ITEM.CLOTH, 20]);
  A.notes.length = 0;
  A.act(ACT.CRAFT, 1); // bandage: 2 cloth
  run(2);
  check('a craft with nowhere to go but a locked slot is refused', has(a, ITEM.BANDAGE) === 0 && has(a, ITEM.CLOTH) === 20 && A.told(NOTIFY.INVENTORY_FULL) === 1 && lockedClean(a));
  wear(A, 24 - 1);
  a.inv[23] = { item: ITEM.CLOTH, count: 20 };
  a.invDirty = true;
  A.act(ACT.CRAFT, 1);
  run(2);
  check('...and goes into slot 25 with a backpack worn', a.inv[INVENTORY_SIZE]?.item === ITEM.BANDAGE && has(a, ITEM.CLOTH) === 18, desc(a));
  unwear(a);
}
// what a search turns up
{
  const box = game.caches.find((c) => c.ctype === CONT.DUFFEL) || game.caches.find((c) => CONT_DEFS[c.ctype].table);
  const before = new Set(game.items);
  pack(a, ...fill(24));
  game.searchCache(a, box);
  run(2);
  const spilt = game.items.filter((e) => !before.has(e) && !e.removed);
  check('a search with the 24 full puts nothing in a locked slot: it all goes at her feet', lockedClean(a) && spilt.length > 0, `${spilt.length} stacks on the ground`);
  for (const e of spilt) game.removeItemEnt(e);
  wear(A, 0);
  a.inv[0] = { item: ITEM.LEATHER, count: 10 };
  const before2 = new Set(game.items);
  game.searchCache(a, box);
  run(2);
  const spilt2 = game.items.filter((e) => !before2.has(e) && !e.removed && e.item !== ITEM.LEATHER);
  check('...and into the backpack\'s slots with one on', pockets(a) > 0 && spilt2.length === 0, `${pockets(a)} pockets used, ${spilt2.length} stacks on the ground`);
  unwear(a);
}
// split, drag (swap), drop and use name a slot: a locked one is nothing to any of them
{
  pack(a, ...fill(23), [ITEM.CLOTH, 20]);
  run(2);
  A.notes.length = 0;
  A.act(ACT.SPLIT_INV, 23, 5);
  A.act(ACT.SWAP_INV, 0, 30);
  A.act(ACT.SWAP_INV, 30, 1);
  A.act(ACT.DROP_SLOT, 30, 0);
  A.act(ACT.USE_ITEM, 30);
  run(2);
  check('split, drag and swap never reach a locked slot', lockedClean(a) && a.inv[23]?.count === 20 && a.inv[0]?.item === ITEM.LEATHER && A.told(NOTIFY.INVENTORY_FULL) === 1, desc(a));
  wear(A, 22);
  a.inv[22] = { item: ITEM.LEATHER, count: 10 };
  A.act(ACT.SPLIT_INV, 23, 5);
  run(2);
  A.act(ACT.SWAP_INV, 0, 33);
  run(2);
  check('...which open with a backpack on: a split and a drag go into them', a.inv[24]?.item === ITEM.CLOTH && a.inv[24].count === 5 && a.inv[33]?.item === ITEM.LEATHER && !a.inv[0], desc(a));
}

// ---------------------------------------------------------------- taking it off
{
  // (on, with slots 25 and 34 holding something)
  A.notes.length = 0;
  for (const what of [WORN_DO.OFF, WORN_DO.DROP, WORN_DO.SALVAGE]) A.act(ACT.WORN, WORN.BACKPACK, what);
  run(2);
  check('it does not come off while its slots hold anything: not taken off, dropped or salvaged, and she is told', a.backpackItem === ITEM.BACKPACK && A.told(NOTIFY.POCKETS) === 3 && loose(ITEM.BACKPACK).length === 0 && pockets(a) === 2, `${A.told(NOTIFY.POCKETS)} told`);
  A.act(ACT.SWAP_INV, 24, 0);
  A.act(ACT.SWAP_INV, 33, 1);
  run(2);
  // with its slots empty but every one of the 24 taken it has nowhere to go: refused, and still on
  pack(a, ...fill(24));
  A.notes.length = 0;
  A.act(ACT.WORN, WORN.BACKPACK, WORN_DO.OFF);
  run(2);
  check('...nor into a full grid (it would only fit a slot that locks as it comes off)', a.backpackItem === ITEM.BACKPACK && A.told(NOTIFY.INVENTORY_FULL) === 1 && pockets(a) === 0);
  a.inv[5] = null;
  A.act(ACT.WORN, WORN.BACKPACK, WORN_DO.OFF);
  run(2);
  check('emptied, it comes off into the grid, and the slots lock again', a.backpackItem === 0 && a.inv[5]?.item === ITEM.BACKPACK && invCap(a) === INVENTORY_SIZE && A.backpack === 0, desc(a));
  wear(A, 5);
  pack(a);
  A.act(ACT.WORN, WORN.BACKPACK, WORN_DO.DROP);
  run(2);
  const lying = loose(ITEM.BACKPACK);
  check('RMB on the row drops it in front of her', a.backpackItem === 0 && lying.length === 1, `${lying.length} on the ground`);
  for (const e of lying) game.removeItemEnt(e);
}

// ---------------------------------------------------------------- the stacking fix: one part-used stack at most
{
  pack(a, [ITEM.BANDAGE, 1], [ITEM.AMMO_9MM, AMMO_MAX[AMMO.P9]]);
  a.inv[0] = null;
  s.weapons[SLOT_PISTOL] = ITEM.PISTOL;
  A.input(0, SLOT_PISTOL);
  run(12);
  let worst = 0;
  for (let k = 0; k < 8; k++) {
    game.giveItem(a, ITEM.AMMO_9MM, 25 + k * 7);
    s.mags[1] = 0;
    fn = (i) => (i === 0 ? BTN.RELOAD : 0);
    run(Math.ceil(WEAPONS[ITEM.PISTOL].reload * 20) + 6);
    fn = null;
    worst = Math.max(worst, a.inv.filter((x) => x && x.item === ITEM.AMMO_9MM && x.count < AMMO_MAX[AMMO.P9]).length);
  }
  check('pickups and reloads in turn never leave a second part-used stack', worst === 1, `at worst ${worst}: ${a.inv.filter((x) => x && x.item === ITEM.AMMO_9MM).map((x) => x.count).join('+')}`);
}

// ---------------------------------------------------------------- death, and a teammate who takes it up
{
  pack(a, [ITEM.BANDAGE, 2]);
  wear(A, 1);
  a.inv[INVENTORY_SIZE + 3] = { item: ITEM.ROPE, count: 2 };
  a.invDirty = true;
  run(2);
  const before = new Set(game.items);
  game.killPlayer(a, {});
  run(2);
  const dropped = game.items.filter((e) => !before.has(e) && !e.removed);
  const packs = dropped.filter((e) => e.item === ITEM.BACKPACK);
  check('a survivor who dies drops everything, the worn backpack and what was in its slots too', packs.length === 1 && dropped.some((e) => e.item === ITEM.ROPE && e.count === 2) && dropped.some((e) => e.item === ITEM.BANDAGE) && a.backpackItem === 0 && a.inv.every((x) => !x), dropped.map((e) => `${ITEM_DEFS[e.item].name}x${e.count}`).join(' '));
  const bag = packs[0];
  // Bob comes over and takes it up ([E]: it is gear, not something walked over)
  game.handleChat(b, `/tp ${bag.x} ${bag.z}`);
  run(4);
  pack(b, [ITEM.BANDAGE, 1]);
  B.act(ACT.INTERACT, bag.id);
  run(2);
  const at = b.inv.findIndex((x) => x && x.item === ITEM.BACKPACK);
  check('a teammate picks up the dropped backpack', bag.removed && at >= 0, desc(b));
  B.act(ACT.EQUIP_ARMOR, at);
  run(2);
  check('...wears it, and has 34 slots', b.backpackItem === ITEM.BACKPACK && invCap(b) === INVENTORY_MAX && B.backpack === ITEM.BACKPACK, `cap ${invCap(b)}, client told ${B.backpack}`);
  game.giveItem(b, ITEM.LEATHER, ITEM_DEFS[ITEM.LEATHER].stack * INVENTORY_MAX);
  run(2);
  check('...and fills them all', b.inv.every(Boolean) && B.slots.filter(Boolean).length === INVENTORY_MAX, `${b.inv.filter(Boolean).length} of ${INVENTORY_MAX}`);
}

// ---------------------------------------------------------------- a dropped connection keeps it on
{
  const pid = randomUUID();
  const D = client('Dana', pid);
  run(2);
  const d = D.p();
  wear(D, 0);
  d.inv[INVENTORY_SIZE + 1] = { item: ITEM.TAPE, count: 4 };
  d.invDirty = true;
  run(2);
  game.onClose(D.session, 1006);
  run(4);
  const held = !!d.away && game.players.get(d.id) === d;
  const D2 = client('Dana', pid);
  run(3);
  check('a dropped survivor comes back wearing their backpack, its slots as they were', held && D2.id === d.id && d.backpackItem === ITEM.BACKPACK && D2.backpack === ITEM.BACKPACK && D2.slots[INVENTORY_SIZE + 1]?.item === ITEM.TAPE && invCap(d) === INVENTORY_MAX, `held ${held}, same body ${D2.id === d.id}, worn ${d.backpackItem}, told ${D2.backpack}`);
}

check('every inventory sent was INVENTORY_MAX slots and the backpack byte (no trailing bytes)', A.invMsgs > 0 && B.invMsgs > 0 && BACKPACK_SLOTS === 10);

console.log(fails.length ? `\n${fails.length} FAILED:\n  ${fails.join('\n  ')}` : '\nall backpack checks passed');
process.exit(fails.length ? 1 : 0);
